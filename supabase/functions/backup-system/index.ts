// Super Admin only. Snapshots documents, audit_logs, role_change_audit,
// profiles, user_roles, teaching_assignments, unit_session_config to a
// timestamped folder in the 'backups' bucket, then copies all files from
// the 'documents' bucket into <snapshot>/files/.
// Returns { snapshot_key, counts, total_bytes }.

import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const TABLES = [
  "documents",
  "audit_logs",
  "role_change_audit",
  "profiles",
  "user_roles",
  "teaching_assignments",
  "unit_session_config",
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
    if (!role) return j({ error: "Only Super Admin may create backups" }, 403);

    const body = await req.json().catch(() => ({}));
    const note: string | null = body?.note ?? null;
    const includeFiles: boolean = body?.includeFiles !== false;

    const snapshotKey = `snapshot_${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const counts: Record<string, number> = {};

    // 1. Dump tables
    for (const t of TABLES) {
      const { data, error } = await admin.from(t).select("*");
      if (error) return j({ error: `Dump ${t} failed: ${error.message}` }, 500);
      counts[t] = data?.length ?? 0;
      const blob = new Blob([JSON.stringify(data ?? [])], { type: "application/json" });
      const up = await admin.storage.from("backups").upload(`${snapshotKey}/tables/${t}.json`, blob, { upsert: true });
      if (up.error) return j({ error: `Upload ${t}.json failed: ${up.error.message}` }, 500);
    }

    // 2. Copy storage files from 'documents' bucket
    let fileCount = 0, totalBytes = 0;
    if (includeFiles) {
      const copyRecursive = async (prefix: string) => {
        const { data: items } = await admin.storage.from("documents").list(prefix, { limit: 1000 });
        if (!items) return;
        for (const it of items) {
          const fullPath = prefix ? `${prefix}/${it.name}` : it.name;
          if (it.id === null) {
            await copyRecursive(fullPath);
          } else {
            const { data: dl } = await admin.storage.from("documents").download(fullPath);
            if (!dl) continue;
            const buf = await dl.arrayBuffer();
            totalBytes += buf.byteLength;
            await admin.storage.from("backups").upload(`${snapshotKey}/files/${fullPath}`, buf, { upsert: true, contentType: dl.type });
            fileCount++;
          }
        }
      };
      await copyRecursive("");
    }

    // 3. Manifest
    const manifest = {
      snapshot_key: snapshotKey,
      created_at: new Date().toISOString(),
      created_by: u.user.id,
      created_by_email: u.user.email,
      counts,
      storage_files_count: fileCount,
      total_bytes: totalBytes,
      note,
      include_files: includeFiles,
    };
    await admin.storage.from("backups").upload(
      `${snapshotKey}/manifest.json`,
      new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }),
      { upsert: true },
    );

    // 4. Index row
    await admin.from("backup_metadata").insert({
      snapshot_key: snapshotKey,
      created_by: u.user.id,
      created_by_email: u.user.email,
      documents_count: counts.documents ?? 0,
      audit_logs_count: (counts.audit_logs ?? 0) + (counts.role_change_audit ?? 0),
      storage_files_count: fileCount,
      total_bytes: totalBytes,
      note,
    });

    await admin.from("audit_logs").insert({
      action: "BACKUP_CREATED",
      performed_by: u.user.id,
      details: { snapshot_key: snapshotKey, ...manifest.counts, storage_files_count: fileCount, total_bytes: totalBytes },
    });

    return j({ ok: true, snapshot_key: snapshotKey, ...manifest });
  } catch (e) { return j({ error: (e as Error).message }, 500); }
});

function j(p: unknown, s = 200) { return new Response(JSON.stringify(p), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
