import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GATEWAY = "https://connector-gateway.lovable.dev/google_drive";

// Minimal valid 1-page PDF
function makeTinyPdf(text: string): Uint8Array {
  const content = `BT /F1 12 Tf 50 750 Td (${text.replace(/[()\\]/g, "")}) Tj ET`;
  const stream = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    stream,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => { pdf += `${off.toString().padStart(10, "0")} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

async function driveUpload(lovableKey: string, gdriveKey: string, name: string, parentId: string | null, bytes: Uint8Array) {
  const boundary = "----edms" + Math.random().toString(36).slice(2);
  const metadata: Record<string, unknown> = { name, mimeType: "application/pdf" };
  if (parentId) metadata.parents = [parentId];
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0); body.set(bytes, head.length); body.set(tail, head.length + bytes.length);
  const resp = await fetch(`${GATEWAY}/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": gdriveKey,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`Drive upload ${resp.status}: ${txt.slice(0, 200)}`);
  return JSON.parse(txt) as { id: string; name: string };
}

async function driveDownload(lovableKey: string, gdriveKey: string, fileId: string) {
  const resp = await fetch(`${GATEWAY}/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true&acknowledgeAbuse=true`, {
    headers: { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": gdriveKey },
  });
  if (!resp.ok) throw new Error(`Drive download ${resp.status}`);
  return new Uint8Array(await resp.arrayBuffer());
}

async function driveDelete(lovableKey: string, gdriveKey: string, fileId: string) {
  await fetch(`${GATEWAY}/drive/v3/files/${fileId}?supportsAllDrives=true`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": gdriveKey },
  });
}

function driveHeaders(lovableKey: string, gdriveKey: string) {
  return { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": gdriveKey };
}

/** Metadata incl. parents so we can prove a file landed in the right folder. */
async function driveMeta(lovableKey: string, gdriveKey: string, fileId: string) {
  const resp = await fetch(
    `${GATEWAY}/drive/v3/files/${fileId}?fields=id,name,parents,mimeType,trashed&supportsAllDrives=true`,
    { headers: driveHeaders(lovableKey, gdriveKey) },
  );
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`Drive metadata ${resp.status}: ${txt.slice(0, 200)}`);
  return JSON.parse(txt) as { id: string; name: string; parents?: string[]; trashed?: boolean };
}

/** Sharing state — the test fails the file if it is public ("anyone"/"domain"). */
async function drivePermissions(lovableKey: string, gdriveKey: string, fileId: string) {
  const resp = await fetch(
    `${GATEWAY}/drive/v3/files/${fileId}/permissions?fields=permissions(id,type,role,emailAddress)&supportsAllDrives=true`,
    { headers: driveHeaders(lovableKey, gdriveKey) },
  );
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`Drive permissions ${resp.status}: ${txt.slice(0, 200)}`);
  const parsed = JSON.parse(txt) as { permissions?: { type: string; role: string; emailAddress?: string }[] };
  return parsed.permissions ?? [];
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

/** Find a child folder by exact name under a parent, creating it when missing. */
async function ensureFolder(
  lovableKey: string,
  gdriveKey: string,
  name: string,
  parentId: string | null,
): Promise<string> {
  const safe = name.replace(/'/g, "\\'");
  const q = [
    `name='${safe}'`,
    `mimeType='${FOLDER_MIME}'`,
    "trashed=false",
    parentId ? `'${parentId}' in parents` : null,
  ].filter(Boolean).join(" and ");
  const findRes = await fetch(
    `${GATEWAY}/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: driveHeaders(lovableKey, gdriveKey) },
  );
  if (findRes.ok) {
    const found = await findRes.json();
    if (found.files?.[0]?.id) return found.files[0].id as string;
  }
  const meta: Record<string, unknown> = { name, mimeType: FOLDER_MIME };
  if (parentId) meta.parents = [parentId];
  const createRes = await fetch(`${GATEWAY}/drive/v3/files?supportsAllDrives=true`, {
    method: "POST",
    headers: { ...driveHeaders(lovableKey, gdriveKey), "Content-Type": "application/json" },
    body: JSON.stringify(meta),
  });
  const txt = await createRes.text();
  if (!createRes.ok) throw new Error(`Drive create folder "${name}" ${createRes.status}: ${txt.slice(0, 200)}`);
  return (JSON.parse(txt) as { id: string }).id;
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const lovableKey = Deno.env.get("LOVABLE_API_KEY")!;
  const gdriveKey = Deno.env.get("GOOGLE_DRIVE_API_KEY")!;

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await userClient.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: isSuper } = await admin.rpc("has_role", { _user_id: userId, _role: "SUPER_ADMIN" });
  if (!isSuper) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const body = await req.json().catch(() => ({})) as { departments?: string[] };
  const departments = Array.isArray(body?.departments)
    ? body.departments.filter((d) => typeof d === "string" && d.trim()).slice(0, 12)
    : [];

  const steps: Array<Record<string, unknown>> = [];
  const startedAt = new Date().toISOString();
  let uploadedId: string | null = null;
  let overall = false;
  let errorMsg: string | null = null;

  // ---- Multi-department isolation test -------------------------------------
  if (departments.length > 0) {
    const created: { department: string; fileId: string; folderId: string }[] = [];
    try {
      if (!lovableKey || !gdriveKey) throw new Error("Missing LOVABLE_API_KEY or GOOGLE_DRIVE_API_KEY");

      const { data: rootFolder } = await admin
        .from("drive_folder_map").select("folder_id").eq("scope", "root").maybeSingle();
      let rootId = rootFolder?.folder_id as string | undefined;
      if (!rootId) rootId = await ensureFolder(lovableKey, gdriveKey, "EDMS", null);
      steps.push({ name: "resolve_root", ok: true, detail: { folder_id: rootId } });

      const { data: deptRows } = await admin
        .from("drive_folder_map").select("department, folder_id").eq("scope", "department");
      const mapped = new Map<string, string>(
        ((deptRows || []) as { department: string | null; folder_id: string }[])
          .filter((r) => r.department)
          .map((r) => [r.department as string, r.folder_id]),
      );

      // Phase 1 — upload one test PDF per department and verify placement + sharing.
      for (const dept of departments) {
        const stamp = Date.now();
        const detail: Record<string, unknown> = { department: dept };
        let ok = true;
        const t0 = Date.now();
        try {
          const folderId = mapped.get(dept) ?? await ensureFolder(lovableKey, gdriveKey, dept, rootId!);
          detail.folder_id = folderId;

          const pdf = makeTinyPdf(`EDMS smoke test ${dept} ${startedAt}`);
          const uploaded = await driveUpload(lovableKey, gdriveKey, `smoke_${dept.replace(/[^\w]+/g, "_")}_${stamp}.pdf`, folderId, pdf);
          detail.file_id = uploaded.id;
          created.push({ department: dept, fileId: uploaded.id, folderId });

          const meta = await driveMeta(lovableKey, gdriveKey, uploaded.id);
          const placedOk = (meta.parents ?? []).includes(folderId);
          detail.placement_ok = placedOk;
          detail.parents = meta.parents ?? [];
          if (!placedOk) ok = false;

          const back = await driveDownload(lovableKey, gdriveKey, uploaded.id);
          const roundTripOk = back.length === pdf.length;
          detail.download_ok = roundTripOk;
          detail.bytes = { uploaded: pdf.length, downloaded: back.length };
          if (!roundTripOk) ok = false;

          const perms = await drivePermissions(lovableKey, gdriveKey, uploaded.id);
          const publicPerm = perms.find((p) => p.type === "anyone" || p.type === "domain");
          detail.permissions = perms.map((p) => `${p.type}:${p.role}`);
          detail.private_ok = !publicPerm;
          if (publicPerm) ok = false;
        } catch (e) {
          ok = false;
          detail.error = e instanceof Error ? e.message : String(e);
        }
        steps.push({ name: `dept:${dept}`, ok, latency_ms: Date.now() - t0, detail });
      }

      // Phase 2 — delete each test file and confirm the others are untouched.
      for (let i = 0; i < created.length; i++) {
        const cur = created[i];
        const detail: Record<string, unknown> = { department: cur.department, file_id: cur.fileId };
        let ok = true;
        try {
          await driveDelete(lovableKey, gdriveKey, cur.fileId);
          let gone = false;
          try {
            const meta = await driveMeta(lovableKey, gdriveKey, cur.fileId);
            gone = !!meta.trashed;
          } catch { gone = true; }
          detail.deleted = gone;
          if (!gone) ok = false;

          const survivors: Record<string, boolean> = {};
          for (const other of created.slice(i + 1)) {
            try {
              const m = await driveMeta(lovableKey, gdriveKey, other.fileId);
              survivors[other.department] = !m.trashed;
              if (m.trashed) ok = false;
            } catch {
              survivors[other.department] = false;
              ok = false;
            }
          }
          detail.other_departments_intact = survivors;
        } catch (e) {
          ok = false;
          detail.error = e instanceof Error ? e.message : String(e);
        }
        steps.push({ name: `delete_isolation:${cur.department}`, ok, detail });
      }

      overall = steps.every((s) => s.ok !== false);
      if (!overall) errorMsg = "One or more departments failed the isolation test";
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
      steps.push({ name: "error", ok: false, detail: errorMsg });
      // best-effort cleanup of anything left behind
      for (const c of created) {
        try { await driveDelete(lovableKey, gdriveKey, c.fileId); } catch { /* ignore */ }
      }
    }

    const finishedAtMulti = new Date().toISOString();
    await admin.from("integration_health_runs").insert({
      kind: "smoke_test",
      status: overall ? "success" : "failed",
      started_at: startedAt,
      finished_at: finishedAtMulti,
      actor: userId,
      steps,
      error: errorMsg,
    });

    return new Response(JSON.stringify({ ok: overall, steps, error: errorMsg, departments }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ---- Legacy single-file root test ----------------------------------------
  try {
    if (!lovableKey || !gdriveKey) throw new Error("Missing LOVABLE_API_KEY or GOOGLE_DRIVE_API_KEY");

    const { data: rootFolder } = await admin
      .from("drive_folder_map").select("folder_id").eq("scope", "root").maybeSingle();
    const parent = rootFolder?.folder_id ?? null;
    steps.push({ name: "resolve_root", ok: true, detail: { folder_id: parent } });

    const label = `EDMS smoke test ${startedAt}`;
    const pdf = makeTinyPdf(label);

    const t0 = Date.now();
    const uploaded = await driveUpload(lovableKey, gdriveKey, `smoke_${Date.now()}.pdf`, parent, pdf);
    uploadedId = uploaded.id;
    steps.push({ name: "upload", ok: true, latency_ms: Date.now() - t0, detail: uploaded });

    const t1 = Date.now();
    const back = await driveDownload(lovableKey, gdriveKey, uploaded.id);
    const roundTripOk = back.length === pdf.length;
    steps.push({ name: "download", ok: roundTripOk, latency_ms: Date.now() - t1, detail: { uploaded_bytes: pdf.length, downloaded_bytes: back.length } });
    if (!roundTripOk) throw new Error("Round-trip byte length mismatch");

    overall = true;
  } catch (e) {
    errorMsg = e instanceof Error ? e.message : String(e);
    steps.push({ name: "error", ok: false, detail: errorMsg });
  } finally {
    if (uploadedId) {
      try { await driveDelete(lovableKey, gdriveKey, uploadedId); steps.push({ name: "cleanup", ok: true }); }
      catch (e) { steps.push({ name: "cleanup", ok: false, detail: e instanceof Error ? e.message : String(e) }); }
    }
  }


  const finishedAt = new Date().toISOString();
  await admin.from("integration_health_runs").insert({
    kind: "smoke_test",
    status: overall ? "success" : "failed",
    started_at: startedAt,
    finished_at: finishedAt,
    actor: userId,
    steps,
    error: errorMsg,
  });

  return new Response(JSON.stringify({ ok: overall, steps, error: errorMsg }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
