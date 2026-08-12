// Super Admin only: permanently removes a user account, its profile and roles.
// Documents are retained (they carry approval history) — only the account goes.
import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u.user) return json({ error: "Invalid token" }, 401);

    const { data: roleRow } = await admin
      .from("user_roles").select("role")
      .eq("user_id", u.user.id).eq("role", "SUPER_ADMIN").maybeSingle();
    if (!roleRow) return json({ error: "Only Super Admin may remove users" }, 403);

    const body = (await req.json().catch(() => ({}))) as { user_id?: string };
    const targetId = (body.user_id || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(targetId)) return json({ error: "Valid user_id is required" }, 400);
    if (targetId === u.user.id) return json({ error: "You cannot remove your own account" }, 400);

    const { data: target } = await admin.from("profiles").select("email, full_name").eq("user_id", targetId).maybeSingle();

    // Block removal of the last Super Admin.
    const { data: targetRoles } = await admin.from("user_roles").select("role").eq("user_id", targetId);
    if ((targetRoles || []).some((r) => r.role === "SUPER_ADMIN")) {
      const { count } = await admin.from("user_roles").select("id", { count: "exact", head: true }).eq("role", "SUPER_ADMIN");
      if ((count ?? 0) <= 1) return json({ error: "Cannot remove the only Super Admin" }, 400);
    }

    await admin.from("user_roles").delete().eq("user_id", targetId);
    await admin.from("profiles").delete().eq("user_id", targetId);
    const { error: delErr } = await admin.auth.admin.deleteUser(targetId);
    if (delErr) return json({ error: delErr.message }, 400);

    await admin.from("security_events").insert({
      actor_id: u.user.id,
      action: "USER_REMOVED",
      target_table: "auth.users",
      target_id: targetId,
      details: { email: target?.email ?? null, full_name: target?.full_name ?? null },
    });

    return json({ removed: targetId, email: target?.email ?? null });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Removal failed" }, 500);
  }
});
