// Super Admin only. DRY-RUN of restore-system.
// Reads a snapshot's manifest + table dumps WITHOUT writing anything.
// Returns a per-table diff (snapshot rows, current rows, ids that would be
// overwritten, ids that would be inserted, ids that would be removed by the
// wipe step) and a list of storage files that would be overwritten/created.
//
// Body: { snapshot_key: string }

import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

// Tables the real restore wipes before re-inserting.
const WIPED_TABLES = new Set([
  "audit_logs",
  "role_change_audit",
  "documents",
  "unit_session_config",
  "teaching_assignments",
]);
// Tables the real restore upserts onto.
const UPSERT_TABLES = ["profiles", "user_roles", "teaching_assignments", "unit_session_config", "documents", "audit_logs", "role_change_audit"];

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
    if (!role) return j({ error: "Only Super Admin may preview restores" }, 403);

    const { snapshot_key: key } = await req.json().catch(() => ({}));
    if (!key) return j({ error: "snapshot_key is required" }, 400);

    const { data: manifestBlob, error: mErr } = await admin.storage.from("backups").download(`${key}/manifest.json`);
    if (mErr || !manifestBlob) return j({ error: `Manifest missing: ${mErr?.message}` }, 404);
    const manifest = JSON.parse(await manifestBlob.text());

    const tableDiffs: Array<Record<string, unknown>> = [];
    for (const t of UPSERT_TABLES) {
      const { data: blob } = await admin.storage.from("backups").download(`${key}/tables/${t}.json`);
      const snapRows = blob ? (JSON.parse(await blob.text()) as Array<{ id?: string }>) : [];
      const snapIds = new Set(snapRows.map(r => r.id).filter(Boolean) as string[]);

      const { data: currentRows } = await admin.from(t).select("id");
      const currentIds = new Set((currentRows ?? []).map((r: { id: string }) => r.id));

      const overlap = [...snapIds].filter(id => currentIds.has(id));
      const onlyInSnap = [...snapIds].filter(id => !currentIds.has(id));
      const onlyInCurrent = [...currentIds].filter(id => !snapIds.has(id));

      tableDiffs.push({
        table: t,
        wiped_before_restore: WIPED_TABLES.has(t),
        snapshot_rows: snapRows.length,
        current_rows: currentIds.size,
        will_overwrite: overlap.length,
        will_insert_new: onlyInSnap.length,
        // If wiped: current-only rows are DELETED. If upsert-only: they survive.
        will_delete: WIPED_TABLES.has(t) ? onlyInCurrent.length : 0,
        will_remain_untouched: WIPED_TABLES.has(t) ? 0 : onlyInCurrent.length,
        sample_overwrite_ids: overlap.slice(0, 5),
        sample_new_ids: onlyInSnap.slice(0, 5),
      });
    }

    // Storage files diff (lightweight: count only)
    let snapFileCount = 0;
    const walk = async (prefix: string) => {
      const { data: items } = await admin.storage.from("backups").list(`${key}/files/${prefix}`, { limit: 1000 });
      if (!items) return;
      for (const it of items) {
        const rel = prefix ? `${prefix}/${it.name}` : it.name;
        if (it.id === null) await walk(rel);
        else snapFileCount++;
      }
    };
    if (manifest.include_files) await walk("");

    // Count current files in documents bucket
    let currentFileCount = 0;
    const walkDocs = async (prefix: string) => {
      const { data: items } = await admin.storage.from("documents").list(prefix, { limit: 1000 });
      if (!items) return;
      for (const it of items) {
        const full = prefix ? `${prefix}/${it.name}` : it.name;
        if (it.id === null) await walkDocs(full);
        else currentFileCount++;
      }
    };
    await walkDocs("");

    return j({
      ok: true,
      dry_run: true,
      snapshot_key: key,
      manifest,
      table_diffs: tableDiffs,
      storage: {
        snapshot_files: snapFileCount,
        current_files: currentFileCount,
        will_overwrite_or_create: snapFileCount,
        note: "Current files NOT present in snapshot remain in place (restore is upsert, not wipe).",
      },
      summary: {
        total_will_overwrite: tableDiffs.reduce((s, d) => s + (d.will_overwrite as number), 0),
        total_will_insert: tableDiffs.reduce((s, d) => s + (d.will_insert_new as number), 0),
        total_will_delete: tableDiffs.reduce((s, d) => s + (d.will_delete as number), 0),
      },
    });
  } catch (e) { return j({ error: (e as Error).message }, 500); }
});

function j(p: unknown, s = 200) { return new Response(JSON.stringify(p), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
