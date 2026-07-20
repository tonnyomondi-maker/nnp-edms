// Runs due offload schedules. Meant to be invoked by cron OR manually by IQA/Admin
// via `body: { department?: string, dryRun?: boolean }`.
// For each enabled schedule, selects eligible archived documents (age + tier
// threshold) that already have a Google Drive mirror and offloads their Cloud
// Storage copies. Writes an audit_logs row per document and updates last_run.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const GATEWAY = "https://connector-gateway.lovable.dev/google_drive";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function pathFromUrl(url: string | null): string | null {
  if (!url) return null;
  const markers = ["/object/public/documents/", "/object/sign/documents/"];
  for (const m of markers) {
    const idx = url.indexOf(m);
    if (idx >= 0) return decodeURIComponent(url.substring(idx + m.length).split("?")[0]);
  }
  if (!/^https?:/i.test(url)) return url.replace(/^\/+/, "");
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Optional auth: if a bearer token is present, restrict to IQA/Admin.
    // Cron calls with the service role bypass this.
    const authHeader = req.headers.get("Authorization");
    let actorId: string | null = null;
    if (authHeader && !authHeader.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "___")) {
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: u } = await userClient.auth.getUser();
      if (!u?.user) return json({ error: "Invalid token" }, 401);
      actorId = u.user.id;
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", actorId);
      const roleSet = new Set((roles || []).map((r) => r.role));
      if (!roleSet.has("IQA") && !roleSet.has("SUPER_ADMIN")) return json({ error: "Forbidden" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const wantedDept: string | undefined = body?.department;
    const dryRun: boolean = !!body?.dryRun;

    let q = admin.from("offload_schedules").select("*").eq("enabled", true);
    if (wantedDept) q = q.eq("department", wantedDept);
    const { data: schedules, error: sErr } = await q;
    if (sErr) return json({ error: sErr.message }, 500);

    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    const gdriveKey = Deno.env.get("GOOGLE_DRIVE_API_KEY");
    if (!lovableKey || !gdriveKey) return json({ error: "Google Drive not configured" }, 500);

    const runs: Array<Record<string, unknown>> = [];

    for (const s of schedules || []) {
      const cutoff = new Date(Date.now() - s.min_age_days * 24 * 60 * 60 * 1000).toISOString();
      let dq = admin.from("documents")
        .select("id, file_url, signed_file_url, gdrive_file_id, storage_tier, archived_at")
        .eq("department", s.department)
        .in("status", ["ARCHIVED", "EXPORTED"])
        .not("gdrive_file_id", "is", null)
        .lte("archived_at", cutoff);
      if (s.only_tier === "cloud") dq = dq.eq("storage_tier", "cloud");
      const { data: docs, error: dErr } = await dq.limit(s.max_files_per_run);
      if (dErr) {
        runs.push({ department: s.department, error: dErr.message });
        continue;
      }

      let offloaded = 0;
      const errors: string[] = [];

      for (const d of docs || []) {
        if (dryRun) { offloaded++; continue; }
        // verify Drive
        const verify = await fetch(
          `${GATEWAY}/drive/v3/files/${d.gdrive_file_id}?fields=id,size`,
          { headers: { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": gdriveKey } },
        );
        if (!verify.ok) { errors.push(`${d.id}: verify HTTP ${verify.status}`); continue; }

        const paths = [pathFromUrl(d.file_url), pathFromUrl(d.signed_file_url)]
          .filter((p): p is string => !!p);
        if (paths.length) {
          const { error: rmErr } = await admin.storage.from("documents").remove(paths);
          if (rmErr) { errors.push(`${d.id}: rm ${rmErr.message}`); continue; }
        }
        await admin.from("documents").update({
          storage_tier: "drive",
          drive_offloaded_at: new Date().toISOString(),
          drive_offloaded_by: actorId,
        }).eq("id", d.id);
        await admin.from("audit_logs").insert({
          document_id: d.id,
          action: "OFFLOADED_TO_DRIVE_SCHEDULED",
          performed_by: actorId,
          details: {
            schedule_id: s.id,
            department: s.department,
            min_age_days: s.min_age_days,
            only_tier: s.only_tier,
          },
        });
        offloaded++;
      }

      const result = {
        department: s.department,
        eligible: (docs || []).length,
        offloaded,
        errors: errors.slice(0, 20),
        dry_run: dryRun,
      };
      if (!dryRun) {
        await admin.from("offload_schedules").update({
          last_run_at: new Date().toISOString(),
          last_result: result,
        }).eq("id", s.id);
      }
      runs.push(result);
    }

    return json({ runs });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
