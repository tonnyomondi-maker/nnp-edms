// Assessment Validation vault. All exam files live in the private "exam-vault"
// bucket, which has NO client storage policies — only this function (service
// role) can read or write them. Every view is watermarked with the viewer's
// identity and logged in exam_access_logs (DPA 2019 accountability).
import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { PDFDocument, StandardFonts, rgb, degrees } from "npm:pdf-lib@1.17.1";

const GATEWAY = "https://connector-gateway.lovable.dev/google_drive";
const ROOT = "0AOij6d_FfJPzUk9PVA";
const VAULT_FOLDER = "03 - EXAMS VAULT - APPROVED PAPERS";
const PAPER_TYPES = ["MAIN", "SUPPLEMENTARY", "CAT1", "CAT2"];

const json = (p: unknown, s = 200) =>
  new Response(JSON.stringify(p), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Unauthorized" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u.user) return json({ error: "Invalid session" }, 401);
    const uid = u.user.id;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: prof } = await admin.from("profiles").select("full_name,email,department").eq("user_id", uid).maybeSingle();
    const log = (paper_id: string | null, action: string, details: Record<string, unknown> = {}) =>
      admin.from("exam_access_logs").insert({ paper_id, user_id: uid, user_email: prof?.email ?? u.user!.email, action, details });

    const ct = req.headers.get("content-type") || "";
    if (ct.includes("multipart/form-data")) {
      // ---------- Upload / resubmit ----------
      const f = await req.formData();
      const paper = f.get("paper"); const scheme = f.get("scheme");
      const paperId = String(f.get("paperId") || "");
      for (const x of [paper, scheme]) {
        if (x instanceof File && (x.type !== "application/pdf" || x.size > 25 * 1024 * 1024)) return json({ error: "Files must be PDFs under 25 MB" }, 400);
      }
      if (paperId) {
        const { data: p } = await admin.from("exam_papers").select("*").eq("id", paperId).maybeSingle();
        if (!p || p.trainer_id !== uid) return json({ error: "Not your paper" }, 403);
        if (p.status !== "RETURNED") return json({ error: "Only returned papers can be resubmitted" }, 400);
        if (!(paper instanceof File)) return json({ error: "Upload the corrected paper" }, 400);
        const v = p.version + 1;
        const base = `${p.department}/${p.id}/v${v}`;
        await admin.storage.from("exam-vault").upload(`${base}/paper.pdf`, paper, { contentType: "application/pdf" });
        let scheme_path = p.scheme_path;
        if (scheme instanceof File) { scheme_path = `${base}/scheme.pdf`; await admin.storage.from("exam-vault").upload(scheme_path, scheme, { contentType: "application/pdf" }); }
        await admin.from("exam_papers").update({ version: v, paper_path: `${base}/paper.pdf`, scheme_path, status: "SUBMITTED", return_reason: null, returned_stage: null, rubric: {}, committee_endorsed_at: null }).eq("id", p.id);
        await notifyCommittee(admin, p.committee_id, p.unit_code, p.paper_type, "resubmitted");
        await log(p.id, "RESUBMITTED", { version: v });
        return json({ id: p.id });
      }
      const unit_code = String(f.get("unit_code") || "").trim();
      const paper_type = String(f.get("paper_type") || "");
      const section = String(f.get("section") || "").trim() || null;
      const session_year = Number(f.get("session_year")); const session_term = String(f.get("session_term") || "");
      if (!unit_code || !PAPER_TYPES.includes(paper_type) || !session_year || !session_term) return json({ error: "Unit, paper type and session are required" }, 400);
      if (!(paper instanceof File) || !(scheme instanceof File)) return json({ error: "Both the paper and the marking scheme are required" }, 400);
      if (!prof?.department) return json({ error: "Your profile has no department" }, 400);
      // Pick committee: section-specific first, then department-wide.
      const { data: comms } = await admin.from("exam_committees").select("id,section").eq("department", prof.department)
        .eq("session_year", session_year).eq("session_term", session_term).eq("active", true);
      const committee = (comms || []).find((c) => section && c.section === section) || (comms || []).find((c) => !c.section) || null;
      const id = crypto.randomUUID();
      const base = `${prof.department}/${id}/v1`;
      const up1 = await admin.storage.from("exam-vault").upload(`${base}/paper.pdf`, paper, { contentType: "application/pdf" });
      const up2 = await admin.storage.from("exam-vault").upload(`${base}/scheme.pdf`, scheme, { contentType: "application/pdf" });
      if (up1.error || up2.error) return json({ error: `Upload failed: ${up1.error?.message || up2.error?.message}` }, 500);
      const { error } = await admin.from("exam_papers").insert({
        id, trainer_id: uid, department: prof.department, section, unit_code, unit_name: String(f.get("unit_name") || "") || null,
        class_code: String(f.get("class_code") || "") || null, paper_type, session_year, session_term,
        committee_id: committee?.id ?? null, paper_path: `${base}/paper.pdf`, scheme_path: `${base}/scheme.pdf`,
      });
      if (error) return json({ error: error.message }, 500);
      if (committee) await notifyCommittee(admin, committee.id, unit_code, paper_type, "submitted");
      else {
        const { data: hods } = await admin.from("user_roles").select("user_id").eq("role", "HOD");
        const ids = (hods || []).map((h) => h.user_id);
        const { data: dh } = await admin.from("profiles").select("user_id").in("user_id", ids).eq("department", prof.department);
        if (dh?.length) await admin.from("notifications").insert(dh.map((h) => ({ user_id: h.user_id, kind: "EXAM_COMMITTEE", title: "Exam paper needs a committee", message: `${unit_code} (${paper_type}) has no moderation committee yet` })));
      }
      await log(id, "SUBMITTED", { committee_id: committee?.id ?? null });
      return json({ id, committee_assigned: !!committee });
    }

    const body = await req.json().catch(() => ({}));
    const paperId = String(body.paperId || "");
    const action = String(body.action || "");
    if (!paperId) return json({ error: "paperId required" }, 400);
    // Access check runs as the caller so RLS decides.
    const { data: p } = await userClient.from("exam_papers").select("*").eq("id", paperId).maybeSingle();
    if (!p) { await log(paperId, "ACCESS_DENIED", { action }); return json({ error: "Not authorised" }, 403); }

    if (action === "view") {
      const which = body.which === "scheme" ? "scheme" : "paper";
      const path = which === "scheme" ? p.scheme_path : p.paper_path;
      if (!path) return json({ error: "File missing" }, 404);
      const { data: blob, error } = await admin.storage.from("exam-vault").download(path);
      if (error || !blob) return json({ error: "File unavailable" }, 500);
      const pdf = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()), { ignoreEncryption: true });
      const font = await pdf.embedFont(StandardFonts.HelveticaBold);
      const stamp = `CONFIDENTIAL · ${prof?.full_name || u.user.email} · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;
      for (const page of pdf.getPages()) {
        const { width, height } = page.getSize();
        for (let i = 0; i < 3; i++) {
          page.drawText(stamp, { x: width * 0.08, y: height * (0.2 + i * 0.3), size: 16, font, color: rgb(0.8, 0.1, 0.1), opacity: 0.18, rotate: degrees(30) });
        }
        page.drawText(`NNP Exams Vault · viewed by ${prof?.email || ""} · do not distribute`, { x: 20, y: 10, size: 7, font, color: rgb(0.6, 0, 0), opacity: 0.7 });
      }
      const out = await pdf.save();
      await log(p.id, "VIEWED", { which, version: p.version });
      return new Response(out, { headers: { ...corsHeaders, "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
    }

    if (action === "sync_drive") {
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", uid);
      const rs = new Set((roles || []).map((r) => r.role));
      if (!rs.has("IQA") && !rs.has("EXAMS_OFFICE")) return json({ error: "Forbidden" }, 403);
      if (!["IQA_CLEARED", "RECEIVED"].includes(p.status)) return json({ error: "Only IQAO-cleared papers go to Drive" }, 400);
      const lk = Deno.env.get("LOVABLE_API_KEY"), gk = Deno.env.get("GOOGLE_DRIVE_API_KEY");
      if (!lk || !gk) return json({ error: "Google Drive not connected" }, 500);
      try {
        let parent = ROOT;
        for (const name of [VAULT_FOLDER, `${p.session_year}_${p.session_term}`, p.department, p.paper_type, p.unit_code]) {
          parent = await ensureFolder(lk, gk, name, parent);
        }
        const ids: Record<string, string> = {};
        for (const [k, path] of [["paper", p.paper_path], ["scheme", p.scheme_path]] as const) {
          if (!path) continue;
          const { data: blob } = await admin.storage.from("exam-vault").download(path);
          if (!blob) throw new Error(`Missing ${k}`);
          ids[k] = await uploadFile(lk, gk, parent, `${p.unit_code}_${p.paper_type}_${k === "paper" ? "PAPER" : "MARKING_SCHEME"}_v${p.version}.pdf`, new Uint8Array(await blob.arrayBuffer()));
        }
        await admin.from("exam_papers").update({ gdrive_file_id: ids.paper ?? null, gdrive_scheme_id: ids.scheme ?? null, gdrive_status: "SYNCED", gdrive_error: null }).eq("id", p.id);
        await log(p.id, "DRIVE_SYNCED", ids);
        return json({ ok: true, ...ids });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await admin.from("exam_papers").update({ gdrive_status: "FAILED", gdrive_error: msg }).eq("id", p.id);
        return json({ error: msg }, 502);
      }
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "Server error" }, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function notifyCommittee(admin: any, committeeId: string | null, unit: string, type: string, verb: string) {
  if (!committeeId) return;
  const { data: m } = await admin.from("exam_committee_members").select("user_id").eq("committee_id", committeeId);
  if (m?.length) await admin.from("notifications").insert(m.map((x: { user_id: string }) => ({ user_id: x.user_id, kind: "EXAM_COMMITTEE", title: `Exam paper ${verb} for moderation`, message: `${unit} (${type}) is waiting in your committee workspace` })));
}

const FOLDER = "application/vnd.google-apps.folder";
const h = (lk: string, gk: string) => ({ Authorization: `Bearer ${lk}`, "X-Connection-Api-Key": gk });
async function ensureFolder(lk: string, gk: string, name: string, parent: string) {
  const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='${FOLDER}' and trashed=false and '${parent}' in parents`;
  const r = await fetch(`${GATEWAY}/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=drive&driveId=${ROOT}`, { headers: h(lk, gk) });
  if (!r.ok) throw new Error(`Drive list ${r.status}: ${await r.text()}`);
  const id = (await r.json()).files?.[0]?.id;
  if (id) return id as string;
  const c = await fetch(`${GATEWAY}/drive/v3/files?supportsAllDrives=true&fields=id`, { method: "POST", headers: { ...h(lk, gk), "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }) });
  if (!c.ok) throw new Error(`Drive folder ${c.status}: ${await c.text()}`);
  return (await c.json()).id as string;
}
async function uploadFile(lk: string, gk: string, parent: string, name: string, bytes: Uint8Array) {
  const boundary = "nnpexam" + crypto.randomUUID();
  const meta = JSON.stringify({ name, parents: [parent], mimeType: "application/pdf" });
  const enc = new TextEncoder();
  const head = enc.encode(`--${boundary}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`);
  const tail = enc.encode(`\r\n--${boundary}--`);
  const all = new Uint8Array(head.length + bytes.length + tail.length);
  all.set(head); all.set(bytes, head.length); all.set(tail, head.length + bytes.length);
  const r = await fetch(`${GATEWAY}/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id`, { method: "POST", headers: { ...h(lk, gk), "Content-Type": `multipart/related; boundary=${boundary}` }, body: all });
  if (!r.ok) throw new Error(`Drive upload ${r.status}: ${await r.text()}`);
  return (await r.json()).id as string;
}
