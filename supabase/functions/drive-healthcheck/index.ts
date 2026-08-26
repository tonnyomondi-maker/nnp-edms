import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GATEWAY = "https://connector-gateway.lovable.dev/google_drive";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const gdriveKey = Deno.env.get("GOOGLE_DRIVE_API_KEY");

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await userClient.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: isSuper } = await admin.rpc("has_role", { _user_id: userId, _role: "SUPER_ADMIN" });
  if (!isSuper) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const steps: Array<Record<string, unknown>> = [];
  const startedAt = new Date().toISOString();

  // env vars
  const env = {
    LOVABLE_API_KEY: !!lovableKey,
    GOOGLE_DRIVE_API_KEY: !!gdriveKey,
    SUPABASE_SERVICE_ROLE_KEY: !!serviceKey,
    SUPABASE_URL: !!supabaseUrl,
  };
  const envOk = Object.values(env).every(Boolean);
  steps.push({ name: "env_vars", ok: envOk, detail: env });

  // Drive about
  let aboutOk = false;
  let about: Record<string, unknown> | null = null;
  let latencyMs = 0;
  try {
    const t0 = Date.now();
    const resp = await fetch(`${GATEWAY}/drive/v3/about?fields=user,storageQuota`, {
      headers: { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": gdriveKey ?? "" },
    });
    latencyMs = Date.now() - t0;
    const body = await resp.text();
    aboutOk = resp.ok;
    about = { status: resp.status, body: aboutOk ? JSON.parse(body) : body.slice(0, 500) };
  } catch (e) {
    about = { error: e instanceof Error ? e.message : String(e) };
  }
  steps.push({ name: "drive_about", ok: aboutOk, latency_ms: latencyMs, detail: about });

  // Folder checks
  const { data: folders } = await admin.from("drive_folder_map").select("*");
  const folderResults: Array<Record<string, unknown>> = [];
  for (const f of folders ?? []) {
    try {
      const resp = await fetch(
        `${GATEWAY}/drive/v3/files/${f.folder_id}?fields=id,name,capabilities(canAddChildren,canEdit),trashed&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": gdriveKey ?? "" } },
      );
      const body = await resp.text();
      const parsed = resp.ok ? JSON.parse(body) : null;
      folderResults.push({
        scope: f.scope,
        department: f.department,
        folder_id: f.folder_id,
        ok: resp.ok && parsed && !parsed.trashed,
        writable: !!parsed?.capabilities?.canAddChildren,
        name: parsed?.name ?? null,
        status: resp.status,
        error: resp.ok ? null : body.slice(0, 200),
      });
    } catch (e) {
      folderResults.push({ scope: f.scope, department: f.department, folder_id: f.folder_id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const foldersOk = folderResults.every((r) => r.ok);
  steps.push({ name: "folders", ok: foldersOk, detail: folderResults });

  const overall = envOk && aboutOk && foldersOk;
  const finishedAt = new Date().toISOString();

  await admin.from("integration_health_runs").insert({
    kind: "healthcheck",
    status: overall ? "success" : "failed",
    started_at: startedAt,
    finished_at: finishedAt,
    actor: userId,
    steps,
    error: overall ? null : "One or more health-check steps failed",
  });

  return new Response(JSON.stringify({ ok: overall, steps, started_at: startedAt, finished_at: finishedAt }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
