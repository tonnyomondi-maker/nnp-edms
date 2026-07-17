// Cron-invoked. Finds verifier assignments where the verifier opened the pack
// more than 24h ago but has not submitted any review, and has not been
// reminded. Sends one reminder email via the shared transactional email
// pipeline (falls back to console log if that function is not set up).

import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: candidates, error } = await admin
      .from("verification_pack_assignees")
      .select("id, pack_id, verifier_id, first_opened_at, verifiers(full_name, email), verification_packs(token, department, session_year, session_term, revoked_at, expires_at)")
      .not("first_opened_at", "is", null)
      .lt("first_opened_at", cutoff)
      .is("reminder_sent_at", null);
    if (error) return json({ error: error.message }, 500);

    const now = new Date();
    let sent = 0;
    const results: { id: string; status: string; detail?: string }[] = [];

    for (const c of candidates || []) {
      // deno-lint-ignore no-explicit-any
      const pack: any = (c as any).verification_packs;
      // deno-lint-ignore no-explicit-any
      const verifier: any = (c as any).verifiers;
      if (!pack || !verifier?.email) { results.push({ id: c.id, status: "skipped_no_meta" }); continue; }
      if (pack.revoked_at || new Date(pack.expires_at) < now) { results.push({ id: c.id, status: "skipped_inactive" }); continue; }

      const { count: reviewCount } = await admin
        .from("verifier_reviews")
        .select("id", { count: "exact", head: true })
        .eq("pack_id", c.pack_id).eq("verifier_id", c.verifier_id);
      if ((reviewCount ?? 0) > 0) {
        await admin.from("verification_pack_assignees")
          .update({ reminder_sent_at: now.toISOString() }).eq("id", c.id);
        results.push({ id: c.id, status: "already_reviewed" });
        continue;
      }

      const link = `${Deno.env.get("PUBLIC_SITE_URL") || ""}/verify/pack?token=${encodeURIComponent(pack.token)}&v=${c.verifier_id}`;

      let emailStatus = "sent";
      try {
        const { error: emailErr } = await admin.functions.invoke("send-transactional-email", {
          body: {
            templateName: "verifier-review-reminder",
            recipientEmail: verifier.email,
            idempotencyKey: `verifier-reminder-${c.id}`,
            templateData: {
              name: verifier.full_name,
              department: pack.department,
              session: `${pack.session_year} · ${pack.session_term}`,
              packUrl: link,
            },
          },
        });
        if (emailErr) emailStatus = `email_error:${emailErr.message}`;
      } catch (e) {
        emailStatus = `email_missing:${(e as Error).message}`;
      }

      await admin.from("verification_pack_assignees")
        .update({ reminder_sent_at: now.toISOString() }).eq("id", c.id);
      await admin.from("audit_logs").insert({
        action: "VERIFIER_REMINDER_SENT",
        performed_by: null,
        details: { pack_id: c.pack_id, verifier_id: c.verifier_id, email_status: emailStatus },
      });

      sent += 1;
      results.push({ id: c.id, status: emailStatus });
    }

    return json({ ok: true, checked: candidates?.length || 0, reminded: sent, results });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
