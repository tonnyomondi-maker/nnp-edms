// Creates a shareable verification pack for an external verifier.
// Auth: authenticated caller must hold IQA or SUPER_ADMIN role.
// Body: { department, session_year, session_term, included_document_types?, include_text_only_fallbacks? }
// Returns: { id, token, expires_at }

import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

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

    const { data: rolesRows } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
    const roles = new Set((rolesRows || []).map((r) => r.role));
    if (!roles.has("IQA") && !roles.has("SUPER_ADMIN")) {
      return json({ error: "Forbidden — IQA or SUPER_ADMIN required" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const department = typeof body.department === "string" ? body.department.trim() : "";
    const session_year = typeof body.session_year === "number" ? body.session_year : parseInt(body.session_year, 10);
    const session_term = typeof body.session_term === "string" ? body.session_term.trim() : "";
    const included_document_types = Array.isArray(body.included_document_types) && body.included_document_types.length > 0
      ? body.included_document_types.filter((t: unknown) => typeof t === "string")
      : null;
    const include_text_only_fallbacks = body.include_text_only_fallbacks !== false;
    const include_dp_approved = body.include_dp_approved === true;

    if (!department || !session_year || !["JAN_APR", "MAY_AUG", "SEP_DEC"].includes(session_term)) {
      return json({ error: "Invalid department / session_year / session_term" }, 400);
    }

    const token = randomToken(32);
    const { data: inserted, error } = await admin
      .from("verification_packs")
      .insert({
        department, session_year, session_term, token,
        included_document_types,
        include_text_only_fallbacks,
        include_dp_approved,
        created_by: u.user.id,
      })
      .select("id, token, expires_at")
      .single();
    if (error) return json({ error: error.message }, 500);

    await admin.from("audit_logs").insert({
      action: "VERIFICATION_PACK_CREATED",
      performed_by: u.user.id,
      details: {
        department, session_year, session_term, pack_id: inserted.id,
        included_document_types, include_text_only_fallbacks, include_dp_approved,
      },
    });

    return json({ id: inserted.id, token: inserted.token, expires_at: inserted.expires_at });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
