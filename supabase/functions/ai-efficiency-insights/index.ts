import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    if (!LOVABLE_API_KEY) return json({ error: "AI gateway not configured" }, 500);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Invalid token" }, 401);

    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userData.user.id);
    const roleSet = new Set((roles || []).map((r: { role: string }) => r.role));
    if (!roleSet.has("SUPER_ADMIN") && !roleSet.has("IQA")) {
      return json({ error: "Only Super Admin or IQA can request efficiency insights" }, 403);
    }

    const { snapshot } = await req.json();
    if (!snapshot) return json({ error: "snapshot required" }, 400);

    const system = `You are an operations analyst for a Kenyan TVET (CDACC) institution using a document approval workflow (Trainer -> HOD -> DP Academics -> IQA). You will receive an aggregated JSON snapshot of queue depths, average cycle times, oldest waiting items, SLA breaches, and top rejection/return reasons per stage. Identify likely root causes of delays and propose concrete, actionable process improvements. Be specific: mention departments, stages, and reason categories from the data. Return STRICT JSON with keys: rootCauses (array of {stage, cause, evidence}), improvements (array of {action, expectedImpact, owner}), summary (2-3 sentence executive summary). No prose outside JSON.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": LOVABLE_API_KEY },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(snapshot).slice(0, 12000) },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (res.status === 429) return json({ error: "Rate limited by AI gateway — try again shortly." }, 429);
    if (res.status === 402) return json({ error: "AI credits exhausted for this workspace." }, 402);
    if (!res.ok) return json({ error: `AI gateway error ${res.status}` }, 502);
    const body = await res.json();
    const raw = body?.choices?.[0]?.message?.content ?? "";
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(raw); } catch { parsed = { raw }; }
    return json(parsed, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
