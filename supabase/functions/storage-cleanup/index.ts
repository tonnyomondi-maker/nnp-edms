// Reclaims cloud storage taken by superseded (rejected then corrected) uploads.
// The rejection HISTORY is never touched — only the raw bytes of old versions go.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

interface Body {
  graceDays?: number;
  dryRun?: boolean;
}

function parseStorageRef(url: string): { bucket: string; path: string } | null {
  if (!url) return null;
  const m = url.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?|$)/);
  if (m) return { bucket: m[1], path: decodeURIComponent(m[2]) };
  if (!url.startsWith("http")) {
    const parts = url.replace(/^\/+/, "").split("/");
    if (parts.length > 1) return { bucket: parts[0], path: parts.slice(1).join("/") };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const userId = userData.user.id;
    const [{ data: isSuper }, { data: isIqa }] = await Promise.all([
      admin.rpc("has_role", { _user_id: userId, _role: "SUPER_ADMIN" }),
      admin.rpc("has_role", { _user_id: userId, _role: "IQA" }),
    ]);
    if (!isSuper && !isIqa) return json({ error: "Forbidden" }, 403);

    const { graceDays = 14, dryRun = false } = ((await req.json().catch(() => ({}))) || {}) as Body;
    const grace = Math.min(Math.max(Number(graceDays) || 14, 0), 365);
    const cutoff = new Date(Date.now() - grace * 86400_000).toISOString();

    // Superseded uploads: a newer version exists, the old file is still on disk.
    const { data: docs, error } = await admin
      .from("documents")
      .select("id, previous_file_url, updated_at, version, department")
      .not("previous_file_url", "is", null)
      .lt("updated_at", cutoff);
    if (error) throw error;

    const byBucket = new Map<string, string[]>();
    const ids: string[] = [];
    for (const d of (docs || []) as Array<{ id: string; previous_file_url: string }>) {
      const ref = parseStorageRef(d.previous_file_url);
      if (!ref) continue;
      byBucket.set(ref.bucket, [...(byBucket.get(ref.bucket) || []), ref.path]);
      ids.push(d.id);
    }

    if (dryRun) return json({ dryRun: true, graceDays: grace, candidates: ids.length });

    let removed = 0;
    for (const [bucket, paths] of byBucket) {
      for (let i = 0; i < paths.length; i += 100) {
        const slice = paths.slice(i, i + 100);
        const { error: rmErr } = await admin.storage.from(bucket).remove(slice);
        if (!rmErr) removed += slice.length;
      }
    }

    if (ids.length) {
      for (let i = 0; i < ids.length; i += 200) {
        await admin.from("documents").update({ previous_file_url: null }).in("id", ids.slice(i, i + 200));
      }
      await admin.from("audit_logs").insert({
        action: "SUPERSEDED_FILES_PURGED",
        performed_by: userId,
        details: { removed, documents: ids.length, grace_days: grace },
      });
    }

    return json({ removed, documents: ids.length, graceDays: grace });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Cleanup failed" }, 500);
  }
});
