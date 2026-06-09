// Super Admin only. Restores a snapshot created by backup-system.
// Body: { snapshot_key: string, confirm: string }  // confirm must equal `RESTORE <snapshot_key>`

import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const TABLES_RESTORE_ORDER = [
  "profiles",
  "user_roles",
  "teaching_assignments",
  "unit_session_config",
  "documents",
  "audit_logs",
  "role_change_audit",
] as const;

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
    if (!role) return j({ error: "Only Super Admin may restore" }, 403);

    const body = await req.json().catch(() => ({}));
    const key: string = body?.snapshot_key;
    const confirm: string = body?.confirm;
    if (!key) return j({ error: "snapshot_key is required" }, 400);
    if (confirm !== `RESTORE ${key}`) return j({ error: `Confirmation text must be exactly "RESTORE ${key}"` }, 400);

    // 1. Read manifest
    const { data: manifestBlob, error: mErr } = await admin.storage.from("backups").download(`${key}/manifest.json`);
    if (mErr || !manifestBlob) return j({ error: `Manifest missing: ${mErr?.message}` }, 404);
    const manifest = JSON.parse(await manifestBlob.text());

    // 2. Wipe current data tables (in reverse FK order)
    for (const t of ["audit_logs", "role_change_audit", "documents", "unit_session_config", "teaching_assignments"]) {
      await admin.from(t).delete().not("id", "is", null).then(() => {}, () => {});
    }
    // 3. Restore rows
    const counts: Record<string, number> = {};
    for (const t of TABLES_RESTORE_ORDER) {
      const { data: tBlob } = await admin.storage.from("backups").download(`${key}/tables/${t}.json`);
      if (!tBlob) { counts[t] = 0; continue; }
      const rows = JSON.parse(await tBlob.text()) as Record<string, unknown>[];
      counts[t] = rows.length;
      if (rows.length === 0) continue;
      // Upsert in batches of 200
      for (let i = 0; i < rows.length; i += 200) {
        const batch = rows.slice(i, i + 200);
        const { error } = await admin.from(t).upsert(batch as never, { onConflict: "id" });
        if (error) return j({ error: `Restore ${t} failed: ${error.message}` }, 500);
      }
    }

    // 4. Restore storage files
    if (manifest.include_files) {
      const restoreFiles = async (prefix: string) => {
        const { data: items } = await admin.storage.from("backups").list(`${key}/files/${prefix}`, { limit: 1000 });
        if (!items) return;
        for (const it of items) {
          const rel = prefix ? `${prefix}/${it.name}` : it.name;
          if (it.id === null) await restoreFiles(rel);
          else {
            const { data: dl } = await admin.storage.from("backups").download(`${key}/files/${rel}`);
            if (!dl) continue;
            await admin.storage.from("documents").upload(rel, dl, { upsert: true, contentType: dl.type });
          }
        }
      };
      await restoreFiles("");
    }

    await admin.from("audit_logs").insert({
      action: "SYSTEM_RESTORED",
      performed_by: u.user.id,
      details: { snapshot_key: key, counts, restored_at: new Date().toISOString() },
    });

    return j({ ok: true, snapshot_key: key, counts });
  } catch (e) { return j({ error: (e as Error).message }, 500); }
});

function j(p: unknown, s = 200) { return new Response(JSON.stringify(p), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
