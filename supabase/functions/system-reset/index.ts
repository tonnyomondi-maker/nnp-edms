import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u.user) return json({ error: "Invalid token" }, 401);
    const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "SUPER_ADMIN").maybeSingle();
    if (!roleRow) return json({ error: "Only Super Admin may reset the system" }, 403);

    const body = await req.json().catch(() => ({}));
    const today = new Date().toISOString().slice(0, 10);
    if (body?.confirm !== `RESET ${today}`) {
      return json({ error: `Confirmation text must be exactly "RESET ${today}"` }, 400);
    }

    // 0. Engage safety lock — blocks all other users from writing while we reset.
    await admin.from("system_settings").update({
      lock_active: true,
      lock_reason: "SYSTEM_RESET in progress",
      locked_at: new Date().toISOString(),
      locked_by: u.user.id,
      locked_by_email: u.user.email,
    }).eq("id", 1);

    try {
      // 1. Empty storage buckets
      for (const bucket of ["documents", "signatures"]) {
        try {
          const { data: files } = await admin.storage.from(bucket).list("", { limit: 1000 });
          const recurse = async (prefix: string) => {
            const { data: items } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
            if (!items) return;
            const paths: string[] = [];
            for (const it of items) {
              const full = prefix ? `${prefix}/${it.name}` : it.name;
              if (it.id === null) await recurse(full);
              else paths.push(full);
            }
            if (paths.length) await admin.storage.from(bucket).remove(paths);
          };
          await recurse("");
          if (files?.length) await admin.storage.from(bucket).remove(files.map(f => f.name));
        } catch { /* continue */ }
      }

      // 2. Wipe data tables (preserve profiles, user_roles, system_settings)
      // Order matters: child rows first so FK references never block a delete.
      for (const tbl of [
        "verifier_reviews",
        "verification_pack_assignees",
        "verification_packs",
        "verifiers",
        "export_progress",
        "integration_health_runs",
        "drive_folder_map",
        "offload_schedules",
        "documents",
        "audit_logs",
        "role_change_audit",
        "unit_session_config",
        "teaching_assignments",
      ]) {
        await admin.from(tbl).delete().not("id", "is", null).then(() => {}, () => {});
      }

      // 3. Final audit entry post-wipe
      await admin.from("audit_logs").insert({
        action: "SYSTEM_RESET",
        performed_by: u.user.id,
        details: { reset_at: new Date().toISOString(), confirmed_by_email: u.user.email },
      });
    } finally {
      // Release lock whether or not the wipe succeeded.
      await admin.from("system_settings").update({
        lock_active: false, lock_reason: null, locked_at: null, locked_by: null, locked_by_email: null,
      }).eq("id", 1);
    }

    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
