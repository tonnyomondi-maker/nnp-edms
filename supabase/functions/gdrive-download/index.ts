import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const GATEWAY = "https://connector-gateway.lovable.dev/google_drive";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const documentId = String(body?.documentId || "");
    const fileId = String(body?.fileId || "");
    if (!documentId && !fileId) return json({ error: "documentId or fileId is required" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Invalid token" }, 401);

    let query = admin.from("documents")
      .select("id, trainer_id, department, file_name, gdrive_file_id, status")
      .limit(1);
    if (documentId) query = query.eq("id", documentId);
    else query = query.eq("gdrive_file_id", fileId);

    const { data: doc } = await query.maybeSingle();
    if (!doc?.gdrive_file_id) return json({ error: "Document not found or has no Google Drive file" }, 404);

    const callerId = userData.user.id;
    let allowed = doc.trainer_id === callerId;
    if (!allowed) {
      const { data: rolesRows } = await admin.from("user_roles").select("role").eq("user_id", callerId);
      const roles = new Set((rolesRows || []).map((r) => r.role));
      if (roles.has("DP_ACADEMICS") || roles.has("IQA") || roles.has("SUPER_ADMIN")) {
        allowed = true;
      } else if (roles.has("HOD")) {
        const { data: profile } = await admin.from("profiles").select("department").eq("user_id", callerId).maybeSingle();
        allowed = profile?.department === doc.department;
      }
    }
    if (!allowed) return json({ error: "Forbidden" }, 403);

    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    const gdriveKey = Deno.env.get("GOOGLE_DRIVE_API_KEY");
    if (!lovableKey || !gdriveKey) return json({ error: "Google Drive connector not configured" }, 500);

    const resp = await fetch(
      `${GATEWAY}/drive/v3/files/${encodeURIComponent(doc.gdrive_file_id)}?alt=media`,
      { headers: { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": gdriveKey } },
    );
    if (!resp.ok) return json({ error: `Google Drive download failed: HTTP ${resp.status}` }, 502);

    const bytes = await resp.arrayBuffer();
    return new Response(bytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${String(doc.file_name || "document.pdf").replace(/["\r\n]/g, "_")}"`,
        "Cache-Control": "private, no-store",
      },
    });
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
