import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  BlobWriter,
  TextReader,
  Uint8ArrayReader,
  ZipWriter,
} from "https://deno.land/x/zipjs@v2.7.45/index.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Session = "JAN_APR" | "MAY_AUG" | "SEP_DEC";

interface ExportRequest {
  year: number;
  session: Session;
  deleteAfter?: boolean;
  department?: string;   // filter to one department
  trainerId?: string;    // filter to one trainer
  nested?: boolean;      // wrap each trainer's files in a per-trainer sub-ZIP
}

const GDRIVE_GATEWAY = "https://connector-gateway.lovable.dev/google_drive";


const SESSION_LABEL: Record<Session, string> = {
  JAN_APR: "January – April",
  MAY_AUG: "May – August",
  SEP_DEC: "September – December",
};

function sessionWindow(year: number, session: Session) {
  // Inclusive start, exclusive end (UTC)
  if (session === "JAN_APR")
    return { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year, 4, 1)) };
  if (session === "MAY_AUG")
    return { start: new Date(Date.UTC(year, 4, 1)), end: new Date(Date.UTC(year, 8, 1)) };
  return { start: new Date(Date.UTC(year, 8, 1)), end: new Date(Date.UTC(year + 1, 0, 1)) };
}

function safe(name: string) {
  return (name || "unknown").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
}

function csvEscape(v: unknown) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Parse a Supabase storage URL OR a bare storage path into { bucket, path }.
// Bare paths (e.g. "<userId>/.../file.pdf") are assumed to live in the
// private "documents" bucket, which is where stamped & uploaded PDFs go.
function parseStorageRef(ref: string): { bucket: string; path: string } | null {
  if (!ref) return null;
  if (/^https?:\/\//i.test(ref)) {
    try {
      const u = new URL(ref);
      const m = u.pathname.match(/\/storage\/v1\/object\/(?:public\/|sign\/)?([^/]+)\/(.+?)(?:\?.*)?$/);
      if (!m) return null;
      return { bucket: decodeURIComponent(m[1]), path: decodeURIComponent(m[2].split("?")[0]) };
    } catch {
      return null;
    }
  }
  // Bare path
  return { bucket: "documents", path: ref.replace(/^\/+/, "") };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !userData?.user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;
    const actorEmail = userData.user.email || "unknown";

    const admin = createClient(supabaseUrl, serviceKey);

    // Authorize: must be IQA or DP_ACADEMICS
    const [{ data: isIqa }, { data: isDp }] = await Promise.all([
      admin.rpc("has_role", { _user_id: userId, _role: "IQA" }),
      admin.rpc("has_role", { _user_id: userId, _role: "DP_ACADEMICS" }),
    ]);
    if (!isIqa && !isDp) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as ExportRequest;
    const { year, session, deleteAfter, department, trainerId, nested } = body || ({} as ExportRequest);
    if (!year || !["JAN_APR", "MAY_AUG", "SEP_DEC"].includes(session)) {
      return new Response(JSON.stringify({ error: "Invalid year or session" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    const gdriveKey = Deno.env.get("GOOGLE_DRIVE_API_KEY");

    // Query by session_year + session_term (new) — falls back to archived_at window for legacy rows
    const { start, end } = sessionWindow(Number(year), session);

    let q = admin
      .from("documents")
      .select("*, teaching_assignments(*)")
      .eq("status", "ARCHIVED")
      .or(
        `and(session_year.eq.${year},session_term.eq.${session}),and(session_year.is.null,archived_at.gte.${start.toISOString()},archived_at.lt.${end.toISOString()})`,
      )
      .order("department", { ascending: true });
    if (department) q = q.eq("department", department);
    if (trainerId) q = q.eq("trainer_id", trainerId);
    const { data: docs, error: docErr } = await q;


    if (docErr) throw docErr;
    if (!docs || docs.length === 0) {
      return new Response(JSON.stringify({ error: "No archived documents match this filter" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Safety: don't allow freeing storage when a doc has no Drive mirror
    if (deleteAfter) {
      const missing = (docs as any[]).filter((d) => !d.gdrive_file_id && d.storage_tier !== "drive");
      if (missing.length) {
        return new Response(JSON.stringify({
          error: `Refusing to free storage: ${missing.length} document(s) are not mirrored to Google Drive yet. Run "Retry Google Drive sync" first.`,
          missingIds: missing.map((d) => d.id).slice(0, 20),
        }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }


    // Fetch trainer + approver names
    const userIds = new Set<string>();
    docs.forEach((d: any) => {
      [d.trainer_id, d.hod_approved_by, d.dp_approved_by, d.iqa_archived_by]
        .filter(Boolean)
        .forEach((id) => userIds.add(id));
    });
    const { data: profiles } = await admin
      .from("profiles")
      .select("user_id, full_name")
      .in("user_id", Array.from(userIds));
    const nameMap = new Map<string, string>();
    (profiles || []).forEach((p: any) => nameMap.set(p.user_id, p.full_name || "Unknown"));

    // Build ZIP
    const zipBlobWriter = new BlobWriter("application/zip");
    const zipWriter = new ZipWriter(zipBlobWriter);

    const csvRows: string[] = [
      [
        "id",
        "department",
        "trainer",
        "unit_code",
        "unit_name",
        "class_code",
        "term_number",
        "document_type",
        "week_number",
        "session_index",
        "submitted_at",
        "hod_approved_at",
        "hod_approver",
        "dp_approved_at",
        "dp_approver",
        "archived_at",
        "iqa_archiver",
        "file_in_zip",
      ].join(","),
    ];

    const exportedIds: string[] = [];
    const deletePaths: { bucket: string; path: string }[] = [];
    let included = 0;
    let skipped = 0;
    let retries = 0;

    // Optional progress row for real-time UI updates
    const jobId = (body as any)?.jobId as string | undefined;
    const progress = jobId
      ? {
          async update(fields: Record<string, unknown>) {
            try {
              await admin.from("export_progress").upsert(
                {
                  job_id: jobId,
                  actor: userId,
                  kind: "session_export",
                  department: department ?? null,
                  session_year: year,
                  session_term: session,
                  ...fields,
                },
                { onConflict: "job_id" },
              );
            } catch (e) { console.error("progress update failed", e); }
          },
        }
      : null;

    await progress?.update({ phase: "running", total: docs.length, processed: 0, skipped: 0, retries: 0, message: "Fetching documents…" });

    async function fetchWithRetry(fetcher: () => Promise<Uint8Array | null>, maxAttempts = 3): Promise<Uint8Array | null> {
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const buf = await fetcher();
          if (buf) return buf;
        } catch (e) { lastErr = e; }
        if (attempt < maxAttempts) {
          retries++;
          await new Promise((r) => setTimeout(r, 400 * attempt));
        }
      }
      if (lastErr) console.error("fetchWithRetry exhausted", lastErr);
      return null;
    }

    async function downloadFromStorage(parsed: { bucket: string; path: string }) {
      const { data: fileData, error } = await admin.storage.from(parsed.bucket).download(parsed.path);
      if (error) throw error;
      return fileData ? new Uint8Array(await fileData.arrayBuffer()) : null;
    }
    async function downloadFromDrive(fileId: string) {
      if (!lovableKey || !gdriveKey) return null;
      const resp = await fetch(
        `${GDRIVE_GATEWAY}/drive/v3/files/${fileId}?alt=media`,
        { headers: { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": gdriveKey } },
      );
      if (!resp.ok) throw new Error(`Drive HTTP ${resp.status}`);
      return new Uint8Array(await resp.arrayBuffer());
    }

    for (const doc of docs as any[]) {
      let buf: Uint8Array | null = null;
      const url = doc.signed_file_url || doc.file_url;
      const parsed = url ? parseStorageRef(url) : null;

      // Preferred source: Drive when offloaded, otherwise Cloud Storage. Fallback to the other.
      const preferDrive = doc.storage_tier === "drive";
      if (preferDrive && doc.gdrive_file_id) {
        buf = await fetchWithRetry(() => downloadFromDrive(doc.gdrive_file_id));
        if (!buf && parsed) buf = await fetchWithRetry(() => downloadFromStorage(parsed));
      } else {
        if (parsed) buf = await fetchWithRetry(() => downloadFromStorage(parsed));
        if (!buf && doc.gdrive_file_id) buf = await fetchWithRetry(() => downloadFromDrive(doc.gdrive_file_id));
      }
      if (!buf) {
        skipped++;
        await progress?.update({ processed: included, skipped, retries, message: `Skipped ${doc.id.slice(0,8)} (source unavailable)` });
        continue;
      }

      const trainerName = nameMap.get(doc.trainer_id) || "Unknown_Trainer";
      const ta = doc.teaching_assignments || {};
      const unitCode = doc.unit_code || ta.unit_code || "UNIT";
      const unitName = doc.unit_name || ta.unit_name || "";
      const classCode = doc.class_code || ta.class_code || "";
      const dept = safe(doc.department || "Unknown_Dept");
      const trainer = safe(trainerName);
      const unit = safe(unitCode);
      const dtype = safe(doc.document_type || "DOC");
      const wk = doc.week_number ? `_w${doc.week_number}` : "";
      const sIdx = doc.session_index ? `_s${doc.session_index}` : "";
      // When nested=true, group per trainer folder (client can re-zip if needed)
      const fileInZip = nested
        ? `${dept}/${trainer}/${unit}_${dtype}${wk}${sIdx}_${doc.id.slice(0, 8)}.pdf`
        : `${dept}/${trainer}/${unit}_${dtype}${wk}${sIdx}_${doc.id.slice(0, 8)}.pdf`;

      await zipWriter.add(fileInZip, new Uint8ArrayReader(buf));
      included++;
      exportedIds.push(doc.id);
      await progress?.update({ processed: included, skipped, retries, message: `Added ${fileInZip}` });

      // Track originals to delete (only Cloud-tier files)
      if (deleteAfter && doc.storage_tier !== "drive") {
        if (doc.signed_file_url) {
          const p = parseStorageRef(doc.signed_file_url);
          if (p) deletePaths.push(p);
        }
        if (doc.file_url) {
          const p = parseStorageRef(doc.file_url);
          if (p) deletePaths.push(p);
        }
      }


      csvRows.push(
        [
          doc.id,
          doc.department,
          trainerName,
          unitCode,
          unitName,
          classCode,
          doc.term_number ?? "",
          doc.document_type,
          doc.week_number ?? "",
          doc.session_index ?? "",
          doc.submitted_at,
          doc.hod_approved_at,
          nameMap.get(doc.hod_approved_by) || "",
          doc.dp_approved_at,
          nameMap.get(doc.dp_approved_by) || "",
          doc.archived_at,
          nameMap.get(doc.iqa_archived_by) || "",
          fileInZip,
        ]
          .map(csvEscape)
          .join(","),
      );
    }

    const exportedAt = new Date().toISOString();
    const readme =
      `Nyamira National Polytechnic — EDMS Session Export\n` +
      `Session: ${SESSION_LABEL[session]} ${year}\n` +
      `Exported at: ${exportedAt}\n` +
      `Exported by: ${actorEmail} (user id: ${userId})\n` +
      `Documents included: ${included}\n` +
      `Documents skipped (missing files): ${skipped}\n` +
      `Originals deleted from cloud: ${deleteAfter ? "Yes" : "No"}\n` +
      `\n` +
      `============================================================\n` +
      `DATA PROTECTION NOTICE — Kenya Data Protection Act, 2019\n` +
      `============================================================\n` +
      `This archive contains personal data of trainers and approving\n` +
      `officers (names, PF numbers, signatures, stamps and approval\n` +
      `timestamps) processed lawfully for the purpose of academic\n` +
      `quality assurance and statutory record keeping.\n\n` +
      `Lawful basis: Performance of a task carried out in the public\n` +
      `interest and compliance with a legal obligation (DPA 2019,\n` +
      `s.30(1)(b) & (e)).\n\n` +
      `Recipient obligations:\n` +
      ` 1. Store this archive on encrypted institutional storage with\n` +
      `    access restricted to authorised officers only.\n` +
      ` 2. Do not transfer outside Kenya without confirming adequate\n` +
      `    safeguards (DPA 2019, Part VI).\n` +
      ` 3. Retain only for the statutory retention period and securely\n` +
      `    destroy thereafter; log the destruction.\n` +
      ` 4. Report any personal-data breach to the Office of the Data\n` +
      `    Protection Commissioner within 72 hours (DPA 2019, s.43).\n` +
      ` 5. Data-subject access, rectification or erasure requests must\n` +
      `    be honoured per DPA 2019, ss.26 & 40.\n\n` +
      `Data controller: Nyamira National Polytechnic.\n` +
      `An immutable audit record of this export has been retained in\n` +
      `the EDMS audit log.\n`;

    await zipWriter.add("manifest.csv", new TextReader(csvRows.join("\n")));
    await zipWriter.add("README.txt", new TextReader(readme));
    await zipWriter.add("DATA_PROTECTION_NOTICE.txt", new TextReader(readme));
    await zipWriter.close();
    const zipBlob = await zipBlobWriter.getData();

    // Free storage if requested
    if (deleteAfter && exportedIds.length > 0) {
      // Group deletes per bucket
      const byBucket = new Map<string, string[]>();
      for (const { bucket, path } of deletePaths) {
        if (!byBucket.has(bucket)) byBucket.set(bucket, []);
        byBucket.get(bucket)!.push(path);
      }
      for (const [bucket, paths] of byBucket) {
        await admin.storage.from(bucket).remove(paths);
      }
      await admin
        .from("documents")
        .update({
          status: "EXPORTED",
          exported_at: exportedAt,
          exported_by: userId,
          file_url: null,
          signed_file_url: null,
        })
        .in("id", exportedIds);
    }

    // DPA 2019 audit trail — immutable record of who exported what and when
    try {
      const auditAction = deleteAfter ? "SESSION_EXPORT_AND_ERASE" : "SESSION_EXPORT";
      const auditRows = exportedIds.map((docId) => ({
        document_id: docId,
        action: auditAction,
        performed_by: userId,
        details: {
          session_year: year,
          session_term: session,
          exported_at: exportedAt,
          exported_by_email: actorEmail,
          originals_deleted: !!deleteAfter,
          dpa_basis: "Kenya DPA 2019 s.30(1)(b)&(e) — public interest / legal obligation",
        },
      }));
      if (auditRows.length > 0) {
        await admin.from("audit_logs").insert(auditRows);
      }
    } catch (auditErr) {
      console.error("audit log insert failed", auditErr);
    }

    await progress?.update({
      phase: "success",
      processed: included,
      skipped,
      retries,
      total: docs.length,
      message: `Completed — ${included} included, ${skipped} skipped, ${retries} retries`,
      finished_at: new Date().toISOString(),
    });

    const filename = `EDMS_${year}_${session}_${included}docs.zip`;
    return new Response(zipBlob, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Included": String(included),
        "X-Skipped": String(skipped),
        "X-Retries": String(retries),
      },
    });
  } catch (e) {
    console.error("export-session-zip error", e);
    try {
      const body2 = await req.clone().json().catch(() => ({}));
      if (body2?.jobId) {
        const admin2 = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        await admin2.from("export_progress").upsert(
          { job_id: body2.jobId, phase: "error", message: e instanceof Error ? e.message : String(e), finished_at: new Date().toISOString() },
          { onConflict: "job_id" },
        );
      }
    } catch { /* ignore */ }
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
