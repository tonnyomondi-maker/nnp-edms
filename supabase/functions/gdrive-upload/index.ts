// Mirrors a document file from Lovable Cloud Storage to Google Drive with
// retry + exponential backoff. Returns { fileId, webViewLink }.
//
// Body: { documentId: string }
// Auth: bearer JWT of the document owner (or any authenticated user with read
// access). The function uses the service role to read storage so RLS is bypassed.

import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const GATEWAY = "https://connector-gateway.lovable.dev/google_drive";
const MAX_ATTEMPTS = 4;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const { documentId } = await req.json().catch(() => ({}));
    if (!documentId) return json({ error: "documentId is required" }, 400);

    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    const gdriveKey = Deno.env.get("GOOGLE_DRIVE_API_KEY");
    if (!lovableKey || !gdriveKey) {
      return json({ error: "Google Drive connector not configured" }, 500);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Verify caller is authenticated
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: u } = await userClient.auth.getUser();
    if (!u.user) return json({ error: "Invalid token" }, 401);

    // Load document row
    const { data: doc, error: docErr } = await admin
      .from("documents")
      .select("id, file_url, file_name, gdrive_file_id, trainer_id, department, unit_code, session_year, session_term, term_number, module_number, course_type")
      .eq("id", documentId)
      .single();
    if (docErr || !doc) return json({ error: "Document not found" }, 404);

    // Authorization: only the trainer who owns the doc, or a privileged role,
    // may trigger a Google Drive mirror.
    const callerId = u.user.id;
    let allowed = doc.trainer_id === callerId;
    if (!allowed) {
      const { data: rolesRows } = await admin
        .from("user_roles").select("role").eq("user_id", callerId);
      const roles = new Set((rolesRows || []).map((r) => r.role));
      allowed = ["HOD", "DP_ACADEMICS", "IQA", "SUPER_ADMIN"].some((r) => roles.has(r));
    }
    if (!allowed) return json({ error: "Forbidden" }, 403);

    if (doc.gdrive_file_id) {
      // Already mirrored — return cached info
      return json({ fileId: doc.gdrive_file_id, alreadyMirrored: true });
    }

    // Extract storage path from public URL
    const fileUrl = doc.file_url as string;
    const marker = "/object/public/documents/";
    const idx = fileUrl.indexOf(marker);
    let storagePath: string | null = null;
    if (idx >= 0) storagePath = decodeURIComponent(fileUrl.substring(idx + marker.length));
    if (!storagePath) {
      // Try sign route
      const m2 = fileUrl.indexOf("/object/sign/documents/");
      if (m2 >= 0) storagePath = decodeURIComponent(fileUrl.substring(m2 + "/object/sign/documents/".length).split("?")[0]);
    }
    if (!storagePath) return json({ error: "Could not parse storage path" }, 500);

    // Download from storage
    const { data: blob, error: dlErr } = await admin.storage.from("documents").download(storagePath);
    if (dlErr || !blob) return json({ error: `Storage download failed: ${dlErr?.message}` }, 500);
    const bytes = new Uint8Array(await blob.arrayBuffer());

    // Resolve (or create) the organised Drive folder tree:
    //   EDMS / <Session> / <Department> / <Term or Module> / <PF - Trainer name>
    const { data: trainerProfile } = await admin
      .from("profiles").select("full_name, pf_number").eq("user_id", doc.trainer_id).maybeSingle();
    const trainerFolder = [
      (trainerProfile?.pf_number || "").toString().trim(),
      (trainerProfile?.full_name || "Unknown Trainer").toString().trim(),
    ].filter(Boolean).join(" - ");
    const stageFolder = doc.course_type === "MODULAR" && doc.module_number
      ? `Module ${doc.module_number}`
      : doc.term_number ? `Term ${doc.term_number}` : "Unspecified stage";

    const segments = [
      `${doc.session_year ?? "Unknown"}_${doc.session_term ?? "Session"}`,
      doc.department || "Unspecified department",
      stageFolder,
      trainerFolder,
    ];

    let parentId: string | null = null;
    let folderPath = "EDMS";
    try {
      parentId = await resolveRootFolder(admin, lovableKey, gdriveKey);
      for (const seg of segments) {
        parentId = await ensureFolder(lovableKey, gdriveKey, seg, parentId);
        folderPath += `/${seg}`;
      }
    } catch (e) {
      // Folder creation is best-effort — never block the mirror itself.
      console.error("Drive folder resolution failed:", (e as Error).message);
      parentId = null;
    }

    const meta: Record<string, unknown> = {
      name: doc.file_name || `${documentId}.pdf`,
      mimeType: blob.type || "application/pdf",
      description: `EDMS doc ${documentId} • ${folderPath}`,
    };
    if (parentId) meta.parents = [parentId];

    const boundary = `edms_${crypto.randomUUID()}`;
    const enc = new TextEncoder();
    const head = enc.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\nContent-Type: ${String(meta.mimeType)}\r\n\r\n`,
    );
    const tail = enc.encode(`\r\n--${boundary}--`);
    const body = new Uint8Array(head.length + bytes.length + tail.length);
    body.set(head, 0); body.set(bytes, head.length); body.set(tail, head.length + bytes.length);

    let lastErr = "";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const resp = await fetch(
          `${GATEWAY}/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${lovableKey}`,
              "X-Connection-Api-Key": gdriveKey,
              "Content-Type": `multipart/related; boundary=${boundary}`,
            },
            body,
          },
        );
        if (!resp.ok) {
          lastErr = `HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`;
          if (resp.status < 500 && resp.status !== 429) break; // don't retry 4xx (except rate limit)
        } else {
          const json_ = await resp.json();
          await admin.from("documents").update({
            gdrive_file_id: json_.id,
            gdrive_web_view_link: json_.webViewLink ?? null,
            gdrive_sync_status: "success",
            gdrive_last_error: null,
            gdrive_last_attempt_at: new Date().toISOString(),
            gdrive_attempt_count: attempt,
          }).eq("id", documentId);

          await admin.from("audit_logs").insert({
            document_id: documentId,
            action: "GDRIVE_MIRRORED",
            performed_by: u.user.id,
            details: { file_id: json_.id, attempt, size: bytes.length },
          });

          return json({ fileId: json_.id, webViewLink: json_.webViewLink ?? null, attempt });
        }
      } catch (e) {
        lastErr = (e as Error).message;
      }
      if (attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, 500 * 2 ** (attempt - 1)));
      }
    }

    // Persist failure state so users can retry later from the UI
    await admin.from("documents").update({
      gdrive_sync_status: "failed",
      gdrive_last_error: lastErr.slice(0, 500),
      gdrive_last_attempt_at: new Date().toISOString(),
      gdrive_attempt_count: MAX_ATTEMPTS,
    }).eq("id", documentId);

    await admin.from("audit_logs").insert({
      document_id: documentId,
      action: "GDRIVE_MIRROR_FAILED",
      performed_by: u.user.id,
      details: { error: lastErr.slice(0, 500), attempts: MAX_ATTEMPTS },
    });

    return json({ error: `Google Drive upload failed after ${MAX_ATTEMPTS} attempts: ${lastErr}` }, 502);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
