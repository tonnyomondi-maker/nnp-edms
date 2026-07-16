// Public endpoint — a verifier submits a review decision for a single document.
// POST { token, verifier_id?, document_id, decision, notes? }
// Validates the pack via token, ensures the document belongs to the pack's
// scope, then upserts into public.verifier_reviews.

import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const DECISIONS = new Set(["APPROVED", "QUERY", "REJECTED"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const token = typeof body.token === "string" ? body.token : "";
    const verifier_id = typeof body.verifier_id === "string" ? body.verifier_id : null;
    const document_id = typeof body.document_id === "string" ? body.document_id : "";
    const decision = typeof body.decision === "string" ? body.decision : "";
    const notes = typeof body.notes === "string" ? body.notes.slice(0, 4000) : null;

    if (!token || !document_id || !DECISIONS.has(decision)) {
      return json({ error: "Missing / invalid fields" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: pack } = await admin
      .from("verification_packs")
      .select("id, department, session_year, session_term, revoked_at, expires_at")
      .eq("token", token)
      .maybeSingle();
    if (!pack) return json({ error: "Invalid token" }, 404);
    if (pack.revoked_at) return json({ error: "Link revoked" }, 410);
    if (new Date(pack.expires_at) < new Date()) return json({ error: "Link expired" }, 410);

    // Confirm the document belongs to the pack's scope
    const { data: doc } = await admin
      .from("documents")
      .select("id, department, session_year, session_term, status")
      .eq("id", document_id)
      .maybeSingle();
    if (!doc || doc.department !== pack.department || doc.session_year !== pack.session_year
        || doc.session_term !== pack.session_term || doc.status !== "ARCHIVED") {
      return json({ error: "Document not in pack" }, 400);
    }

    // Validate verifier if provided
    if (verifier_id) {
      const { data: v } = await admin
        .from("verification_pack_assignees")
        .select("id")
        .eq("pack_id", pack.id).eq("verifier_id", verifier_id).maybeSingle();
      if (!v) return json({ error: "Verifier not assigned to this pack" }, 403);
    }

    const { error: upErr } = await admin
      .from("verifier_reviews")
      .upsert({
        pack_id: pack.id,
        document_id,
        verifier_id,
        decision,
        notes,
        reviewed_at: new Date().toISOString(),
      }, { onConflict: "pack_id,document_id,verifier_id" });
    if (upErr) return json({ error: upErr.message }, 500);

    await admin.from("audit_logs").insert({
      action: "VERIFIER_REVIEW_SUBMITTED",
      performed_by: null,
      details: { pack_id: pack.id, document_id, verifier_id, decision },
    });

    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
