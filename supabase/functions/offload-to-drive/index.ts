// Deletes the Cloud Storage copy of a document after confirming a valid
// Google Drive mirror exists. Sets storage_tier='drive'.
//
// Body: { documentIds: string[] } OR { department: string, sessionYear: number, sessionTerm: string }
// Only IQAO / SUPER_ADMIN may call this.

import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const GATEWAY = "https://connector-gateway.lovable.dev/google_drive";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function pathFromUrl(url: string | null): string | null {
  if (!url) return null;
  const markers = ["/object/public/documents/", "/object/sign/documents/"];
  for (const m of markers) {
    const idx = url.indexOf(m);
    if (idx >= 0) return decodeURIComponent(url.substring(idx + m.length).split("?")[0]);
  }
  // bare path
  if (!/^https?:/i.test(url)) return url.replace(/^\/+/, "");
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    const gdriveKey = Deno.env.get("GOOGLE_DRIVE_API_KEY");
    if (!lovableKey || !gdriveKey) return json({ error: "Google Drive not configured" }, 500);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: u } = await userClient.auth.getUser();
    if (!u.user) return json({ error: "Invalid token" }, 401);

    const { data: rolesRows } = await admin
      .from("user_roles").select("role").eq("user_id", u.user.id);
    const roles = new Set((rolesRows || []).map((r) => r.role));
    if (!roles.has("IQA") && !roles.has("SUPER_ADMIN")) {
      return json({ error: "Forbidden" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    let docIds: string[] = Array.isArray(body?.documentIds) ? body.documentIds : [];

    if (docIds.length === 0 && body?.department) {
      const q = admin.from("documents")
        .select("id")
        .eq("department", body.department)
        .in("status", ["ARCHIVED", "EXPORTED"])
        .eq("storage_tier", "cloud")
        .not("gdrive_file_id", "is", null);
      if (body.sessionYear) q.eq("session_year", body.sessionYear);
      if (body.sessionTerm) q.eq("session_term", body.sessionTerm);
      const { data } = await q.limit(500);
      docIds = (data || []).map((d) => d.id);
    }

    if (docIds.length === 0) return json({ error: "No eligible documents" }, 400);

    const { data: docs, error: dErr } = await admin
      .from("documents")
      .select("id, file_url, signed_file_url, gdrive_file_id, storage_tier")
      .in("id", docIds);
    if (dErr) return json({ error: dErr.message }, 500);

    const results: Array<{ id: string; ok: boolean; error?: string }> = [];

    for (const d of docs || []) {
      if (!d.gdrive_file_id) {
        results.push({ id: d.id, ok: false, error: "No Drive mirror" });
        continue;
      }
      // Verify Drive file is retrievable
      const verify = await fetch(
        `${GATEWAY}/drive/v3/files/${d.gdrive_file_id}?fields=id,size,md5Checksum&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": gdriveKey } },
      );
      if (!verify.ok) {
        results.push({ id: d.id, ok: false, error: `Drive verify HTTP ${verify.status}` });
        continue;
      }

      const paths = [pathFromUrl(d.file_url), pathFromUrl(d.signed_file_url)]
        .filter((p): p is string => !!p);
      if (paths.length) {
        const { error: rmErr } = await admin.storage.from("documents").remove(paths);
        if (rmErr) {
          results.push({ id: d.id, ok: false, error: `Storage delete: ${rmErr.message}` });
          continue;
        }
      }

      await admin.from("documents").update({
        storage_tier: "drive",
        drive_offloaded_at: new Date().toISOString(),
        drive_offloaded_by: u.user.id,
      }).eq("id", d.id);

      await admin.from("audit_logs").insert({
        document_id: d.id,
        action: "OFFLOADED_TO_DRIVE",
        performed_by: u.user.id,
        details: { drive_file_id: d.gdrive_file_id, removed_paths: paths },
      });

      results.push({ id: d.id, ok: true });
    }

    const okCount = results.filter((r) => r.ok).length;
    return json({ total: results.length, offloaded: okCount, results });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
