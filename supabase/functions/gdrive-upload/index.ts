// NNP ADMS Google Drive document storage.
// Primary mode: receives the PDF directly as multipart/form-data and stores it
// in the PENDING Drive tree. No Supabase document-storage object is created.
// Finalize/mirror mode: JSON { documentId, replace?: boolean } moves the same
// Drive file into the APPROVED archive after final approval.
//
// Auth: bearer JWT. The function uses the service role only for metadata/RLS-safe
// server operations and the configured Google Drive connector.

import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const GATEWAY = "https://connector-gateway.lovable.dev/google_drive";
const MAX_ATTEMPTS = 4;
// Existing institutional Google Drive root folder.
// This is the NNP EDMS shared Drive folder, not a folder to be created.
const NNP_EDMS_ROOT_FOLDER_ID = "0AOij6d_FfJPzUk9PVA";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const contentType = req.headers.get("content-type") || "";
    let documentId = "";
    let replace = false;
    let primaryFile: File | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      documentId = String(form.get("documentId") || "");
      replace = String(form.get("replace") || "false") === "true";
      const candidate = form.get("file");
      if (candidate instanceof File) primaryFile = candidate;
    } else {
      const body = await req.json().catch(() => ({}));
      documentId = String(body?.documentId || "");
      replace = !!body?.replace;
    }

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
      .select("id, status, file_url, signed_file_url, file_name, gdrive_file_id, trainer_id, department, unit_code, unit_name, course_id, session_year, session_term, term_number, module_number, course_type")
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

    const primaryMode = !!primaryFile;

    // In primary mode, trainers can upload SUBMITTED documents (and rejected
    // documents during resubmission). In finalize mode only the final approval
    // stages may move a file into the approved archive.
    if (primaryMode) {
      if (doc.trainer_id !== callerId) return json({ error: "Only the document owner may upload its primary file" }, 403);
      if (!["SUBMITTED", "REJECTED"].includes(String(doc.status))) {
        return json({ error: `Primary upload is not allowed for status ${doc.status}` }, 400);
      }
    } else if (!["DP_APPROVED", "ARCHIVED", "EXPORTED"].includes(String(doc.status))) {
      return json({ error: `Only DP-approved, archived or exported documents can be finalized to the approved archive (this one is ${doc.status}).` }, 400);
    }

    if (doc.gdrive_file_id && !replace && !primaryMode) {
      // Already mirrored — return cached info
      return json({ fileId: doc.gdrive_file_id, alreadyMirrored: true });
    }

    // Primary mode receives the PDF directly from the browser. Legacy/finalize
    // mode may still read the old Supabase Storage copy for older documents.
    let bytes: Uint8Array;
    let mimeType = "application/pdf";
    if (primaryFile) {
      bytes = new Uint8Array(await primaryFile.arrayBuffer());
      mimeType = primaryFile.type || "application/pdf";
    } else {
      const fileUrl = (doc.signed_file_url || doc.file_url) as string;
      const marker = "/object/public/documents/";
      const idx = fileUrl?.indexOf(marker) ?? -1;
      let storagePath: string | null = null;
      if (idx >= 0) storagePath = decodeURIComponent(fileUrl.substring(idx + marker.length));
      if (!storagePath && fileUrl && !/^https?:\/\//i.test(fileUrl) && !fileUrl.startsWith("gdrive://")) {
        storagePath = fileUrl.replace(/^\/+/, "");
      }
      if (!storagePath) {
        const m2 = fileUrl?.indexOf("/object/sign/documents/") ?? -1;
        if (m2 >= 0) storagePath = decodeURIComponent(fileUrl.substring(m2 + "/object/sign/documents/".length).split("?")[0]);
      }
      if (!storagePath) {
        // If the document is already Drive-primary, finalize is a move operation;
        // the bytes do not need to be downloaded here.
        if (doc.gdrive_file_id && String(doc.file_url || "").startsWith("gdrive://")) {
          bytes = new Uint8Array();
        } else {
          return json({ error: "Could not parse legacy storage path" }, 500);
        }
      } else {
        const { data: blob, error: dlErr } = await admin.storage.from("documents").download(storagePath);
        if (dlErr || !blob) return json({ error: `Storage download failed: ${dlErr?.message}` }, 500);
        bytes = new Uint8Array(await blob.arrayBuffer());
        mimeType = blob.type || "application/pdf";
      }
    }

    if (primaryFile && bytes.length === 0) return json({ error: "Uploaded file is empty" }, 400);

    // Resolve the lifecycle-aware Drive tree:
    //   EDMS / 01 - PENDING / <Session> / <Department> / <Course> / <Trainer> / ...
    //   EDMS / 02 - APPROVED - ARCHIVE / <Session> / <Department> / <Course> / <Trainer> / ...
    const { data: trainerProfile } = await admin
      .from("profiles").select("full_name, pf_number").eq("user_id", doc.trainer_id).maybeSingle();
    let courseFolder = "Unassigned course";
    if (doc.course_id) {
      const { data: course } = await admin
        .from("courses").select("code, name").eq("id", doc.course_id).maybeSingle();
      if (course) courseFolder = [course.code, course.name].filter(Boolean).join(" - ");
    }
    const trainerFolder = [
      (trainerProfile?.pf_number || "").toString().trim(),
      (trainerProfile?.full_name || "Unknown Trainer").toString().trim(),
    ].filter(Boolean).join(" - ");
    const unitFolder = [doc.unit_code, doc.unit_name].filter(Boolean).join(" - ") || "Unspecified unit";
    const isSessionLevel = ["Workload Allocation", "Personal Timetable"].includes(String(doc.document_type));
    const lifecycleFolder = primaryMode ? "01 - PENDING" : "02 - APPROVED - ARCHIVE";
    const segments = [
      lifecycleFolder,
      `${doc.session_year ?? "Unknown"}_${doc.session_term ?? "Session"}`,
      doc.department || "Unspecified department",
      courseFolder,
      trainerFolder,
      isSessionLevel ? "00 - Session Documents" : "01 - Units",
      ...(isSessionLevel ? [] : [unitFolder]),
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
  console.error(
    "Drive folder resolution failed:",
    (e as Error).message,
  );

  return json(
    {
      error: `Could not resolve the NNP ADMS Google Drive folder: ${(e as Error).message}`,
    },
    502,
  );
}

    const meta: Record<string, unknown> = {
      name: doc.file_name || `${documentId}.pdf`,
      mimeType,
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
        const existingId = (replace || primaryMode) ? (doc.gdrive_file_id as string | null) : null;
        let resp: Response;
        if (existingId && !primaryMode && bytes.length === 0) {
          // Finalize an already Drive-primary file by moving it into the
          // approved archive. The file ID stays unchanged.
          const fileInfo = await fetch(
            `${GATEWAY}/drive/v3/files/${existingId}?fields=id,parents`,
            { headers: { "Authorization": `Bearer ${lovableKey}`, "X-Connection-Api-Key": gdriveKey } },
          );
          const currentParents = fileInfo.ok ? ((await fileInfo.json()).parents || []) : [];
          const oldParents = Array.isArray(currentParents) ? currentParents.join(",") : "";
          resp = await fetch(
            `${GATEWAY}/drive/v3/files/${existingId}?addParents=${encodeURIComponent(parentId || "")}&removeParents=${encodeURIComponent(oldParents)}&supportsAllDrives=true&fields=id,webViewLink,parents`,
            {
              method: "PATCH",
              headers: {
                "Authorization": `Bearer ${lovableKey}`,
                "X-Connection-Api-Key": gdriveKey,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({}),
            },
          );
        } else if (existingId) {
          resp = await fetch(
            `${GATEWAY}/upload/drive/v3/files/${existingId}?uploadType=media&supportsAllDrives=true&fields=id,webViewLink`,
            {
              method: "PATCH",
              headers: {
                "Authorization": `Bearer ${lovableKey}`,
                "X-Connection-Api-Key": gdriveKey,
                "Content-Type": String(meta.mimeType),
              },
              body: bytes,
            },
          );
        } else {
          resp = await fetch(
            `${GATEWAY}/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`,
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
        }
        if (!resp.ok) {
          lastErr = `HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`;
          if (resp.status < 500 && resp.status !== 429) break; // don't retry 4xx (except rate limit)
        } else {
          const json_ = await resp.json();
          await admin.from("documents").update({
            gdrive_file_id: json_.id,
            file_drive_id: json_.id,
            file_url: `gdrive://${json_.id}`,
            signed_file_url: primaryMode ? null : (String(doc.signed_file_url || "").startsWith("gdrive://") ? doc.signed_file_url : null),
            storage_tier: "drive",
            gdrive_web_view_link: json_.webViewLink ?? null,
            gdrive_sync_status: "success",
            gdrive_last_error: null,
            gdrive_last_attempt_at: new Date().toISOString(),
            gdrive_attempt_count: attempt,
          }).eq("id", documentId);

          await admin.from("audit_logs").insert({
            document_id: documentId,
            action: primaryMode ? "GDRIVE_PRIMARY_UPLOAD" : "GDRIVE_FINALIZED",
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
  if (status >= 400) {
    console.error(`gdrive-upload ${status}:`, JSON.stringify(payload));
  }
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

/** Find a child folder by exact name, creating it when missing. */
async function ensureFolder(
  lovableKey: string,
  gdriveKey: string,
  name: string,
  parentId: string | null,
): Promise<string> {
  const safe = name.replace(/'/g, "\\'");
  const q = `name='${safe}' and mimeType='${FOLDER_MIME}' and trashed=false and ${parentId ? `'${parentId}' in parents` : `'root' in parents`}`;
  const listRes = await fetch(
    `${GATEWAY}/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=10&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": gdriveKey } },
  );
  if (listRes.ok) {
    const found = (await listRes.json()).files?.[0];
    if (found?.id) return found.id as string;
  }
  const body: Record<string, unknown> = { name, mimeType: FOLDER_MIME };
  if (parentId) body.parents = [parentId];
  const createRes = await fetch(`${GATEWAY}/drive/v3/files?supportsAllDrives=true&fields=id`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": gdriveKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!createRes.ok) throw new Error(`Drive create folder "${name}" ${createRes.status}`);
  return (await createRes.json()).id as string;
}

/** Root "EDMS" folder id — from drive_folder_map when mapped, else resolved/created. */
async function resolveRootFolder(
  // deno-lint-ignore no-explicit-any
  admin: any,
  lovableKey: string,
  gdriveKey: string,
): Promise<string> {
  // First honour an explicitly mapped institutional root.
  const { data: mapped } = await admin
    .from("drive_folder_map")
    .select("folder_id")
    .eq("scope", "root")
    .maybeSingle();

  if (mapped?.folder_id) {
    return mapped.folder_id as string;
  }

  // The NNP EDMS shared-drive root already exists.
  // Never create another "EDMS" folder at My Drive root.
  try {
    await admin
      .from("drive_folder_map")
      .insert({
        scope: "root",
        department: null,
        folder_id: NNP_EDMS_ROOT_FOLDER_ID,
        folder_name: "NNP EDMS",
      });
  } catch {
    // Mapping may already exist because of a race/duplicate.
    // The known root ID remains authoritative.
  }

  return NNP_EDMS_ROOT_FOLDER_ID;
}
  
