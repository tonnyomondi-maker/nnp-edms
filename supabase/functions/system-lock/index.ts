// Super Admin only. Manually toggle the system safety lock.
// Body: { active: boolean, reason?: string }

import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return j({ error: "Unauthorized" }, 401);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: u } = await userClient.auth.getUser();
    if (!u.user) return j({ error: "Invalid token" }, 401);
    const { data: role } = await admin.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "SUPER_ADMIN").maybeSingle();
    if (!role) return j({ error: "Only Super Admin may toggle the lock" }, 403);

    const { active, reason } = await req.json().catch(() => ({}));
    const patch = active
      ? { lock_active: true, lock_reason: reason ?? "Manual lock", locked_at: new Date().toISOString(), locked_by: u.user.id, locked_by_email: u.user.email }
      : { lock_active: false, lock_reason: null, locked_at: null, locked_by: null, locked_by_email: null };

    const { error } = await admin.from("system_settings").update(patch).eq("id", 1);
    if (error) return j({ error: error.message }, 500);

    await admin.from("audit_logs").insert({
      action: active ? "SYSTEM_LOCKED" : "SYSTEM_UNLOCKED",
      performed_by: u.user.id,
      details: { reason: reason ?? null },
    });

    return j({ ok: true, lock_active: !!active });
  } catch (e) { return j({ error: (e as Error).message }, 500); }
});

function j(p: unknown, s = 200) { return new Response(JSON.stringify(p), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
