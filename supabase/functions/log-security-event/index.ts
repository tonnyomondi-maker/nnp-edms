// Records denied / blocked security-sensitive attempts with elevated privileges,
// so the attempt is captured even though the database refused the original action.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const ALLOWED_ACTIONS = new Set([
  'DENIED_NOTIFICATION_INSERT',
  'DENIED_PACK_DELETE',
  'DENIED_PACK_REVOKE',
]);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

    const anon = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await anon.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) return json({ error: 'Unauthorized' }, 401);

    const actorId = claimsData.claims.sub as string;
    const actorEmail = (claimsData.claims.email as string) ?? null;

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? '');
    if (!ALLOWED_ACTIONS.has(action)) return json({ error: 'Unsupported action' }, 400);

    const targetTable = body?.target_table ? String(body.target_table).slice(0, 100) : null;
    const targetId = body?.target_id ? String(body.target_id).slice(0, 200) : null;
    const reason = body?.reason ? String(body.reason).slice(0, 500) : null;
    const details = typeof body?.details === 'object' && body.details !== null ? body.details : {};

    const service = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { error } = await service.from('security_events').insert({
      actor_id: actorId,
      actor_email: actorEmail,
      action,
      target_table: targetTable,
      target_id: targetId,
      reason,
      details,
    });
    if (error) {
      console.error('security_events insert failed:', error.message);
      return json({ error: error.message }, 500);
    }

    return json({ ok: true });
  } catch (e) {
    console.error('log-security-event failed:', e);
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});
