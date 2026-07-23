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
    if (!["HOD", "DP_ACADEMICS", "IQA", "SUPER_ADMIN"].some(r => roleSet.has(r))) {
      return json({ error: "Only approvers can draft rejections" }, 403);
    }

    const { documentId, notes } = await req.json();
    if (!documentId) return json({ error: "documentId required" }, 400);
    const { data: doc } = await supabase
      .from("documents")
      .select("document_type,unit_code,department,file_name")
      .eq("id", documentId).single();

    const prompt = `Write a concise, professional rejection reason (2-3 sentences) for a ${doc?.document_type || "document"} submitted for ${doc?.unit_code || "-"} in the ${doc?.department || "-"} department. Consider CDACC/CBET requirements. Approver notes: "${notes || "unspecified"}". Return ONLY the rejection reason text, no preamble.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": LOVABLE_API_KEY },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: [
          { role: "system", content: "You draft brief, professional document rejection reasons for a TVET/CDACC quality assurance system." },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (res.status === 429) return json({ error: "Rate limited" }, 429);
    if (res.status === 402) return json({ error: "AI credits exhausted" }, 402);
    if (!res.ok) return json({ error: `AI gateway error ${res.status}` }, 502);
    const body = await res.json();
    const text = body?.choices?.[0]?.message?.content?.trim() ?? "";
    return json({ rejectionReason: text }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
