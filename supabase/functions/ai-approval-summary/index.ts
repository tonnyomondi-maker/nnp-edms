import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
// PDF text extraction via a Deno-compatible lib
// unpdf is ESM-friendly and works in Deno edge runtime
// deno-lint-ignore no-explicit-any
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.11.0";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Unauthorized" }, 401);
    }
    if (!LOVABLE_API_KEY) {
      return json({ error: "AI gateway not configured" }, 500);
    }

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

    // Only approvers or super admin
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userData.user.id);
    const roleSet = new Set((roles || []).map((r: { role: string }) => r.role));
    const allowed = ["HOD", "DP_ACADEMICS", "IQA", "SUPER_ADMIN"].some(r => roleSet.has(r));
    if (!allowed) return json({ error: "Only approvers can request AI review" }, 403);

    const { documentId } = await req.json();
    if (!documentId) return json({ error: "documentId required" }, 400);

    const { data: doc, error: docErr } = await supabase
      .from("documents")
      .select("id,document_type,file_url,signed_file_url,unit_code,unit_name,department,file_name")
      .eq("id", documentId).single();
    if (docErr || !doc) return json({ error: "Document not found" }, 404);

    // Parse storage path
    const src = doc.signed_file_url || doc.file_url || "";
    const m = src.match(/\/storage\/v1\/object\/(?:public\/|sign\/)?([^/]+)\/(.+?)(?:\?|$)/);
    let bytes: ArrayBuffer;
    if (m) {
      const { data, error } = await supabase.storage.from(decodeURIComponent(m[1])).download(decodeURIComponent(m[2]));
      if (error || !data) return json({ error: `download failed: ${error?.message}` }, 500);
      bytes = await data.arrayBuffer();
    } else {
      const { data, error } = await supabase.storage.from("documents").download(src);
      if (error || !data) return json({ error: `download failed: ${error?.message}` }, 500);
      bytes = await data.arrayBuffer();
    }

    // Extract first ~5 pages of text
    let text = "";
    try {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const totalPages = pdf.numPages;
      const wanted = Math.min(5, totalPages);
      const { text: pageTexts } = await extractText(pdf, { mergePages: false });
      const arr = Array.isArray(pageTexts) ? pageTexts.slice(0, wanted) : [String(pageTexts)];
      text = arr.join("\n\n---\n\n");
    } catch (e) {
      text = `(Failed to extract PDF text: ${(e as Error).message})`;
    }
    // Cap text length to keep credit use small
    if (text.length > 8000) text = text.slice(0, 8000) + "\n…(truncated)";

    const system = `You are an internal quality assurance reviewer for a Kenyan TVET (CDACC) institution.
CBET/CDACC required elements per document type:
- Scheme of Work: Unit Code, Unit Title, Learning Outcomes, Performance Criteria, Content, Teaching/Learning Methods, Resources, Assessment Methods, Week/Session mapping.
- Session Plan: Date, Duration, Learning Outcomes, Content, Learning Activities, Assessment, Resources, Trainer/Learner activities.
- Course Outline: Course code/title, Duration, Purpose, Entry requirements, Modules/units, Assessment strategy.
- Learning Plan: Learner profile, Unit coverage schedule, RPL considerations, Assessment plan.
- Class Attendance: Date, Unit, Class code, Learner names, Signatures column, Trainer signature.
- Workload Allocation: Trainer name, Units, Contact hours, Class sizes, Term.
- Personal Timetable: Days, Time slots, Units taught, Classes, Rooms.
Return STRICT JSON with keys: summary (3 sentences), detectedSections (array of strings actually found), missingItems (array of specific gaps or issues), suggestedVerdict ("approve"|"return"|"reject"), suggestedRejectionReason (string, only if verdict is reject or return). No prose outside JSON.`;

    const user = `Document type: ${doc.document_type}
Unit: ${doc.unit_code || "-"} ${doc.unit_name || ""}
Department: ${doc.department || "-"}
File: ${doc.file_name || "-"}

---
EXTRACTED CONTENT (first pages):
${text}`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": LOVABLE_API_KEY,
      },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
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
