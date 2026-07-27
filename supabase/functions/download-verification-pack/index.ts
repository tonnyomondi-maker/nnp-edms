// Public endpoint used by external verifiers with a pack token.
// GET ?token=... [&v=verifier_id] [&meta=1] [&list=1]
//   meta=1 -> returns { department, session_year, session_term, document_count, included_document_types, include_text_only_fallbacks, verifier? }
//   list=1 -> returns { documents: [...], reviews: [...] } for the review UI
//   else   -> streams a ZIP + INDEX.txt manifest and bumps download_count
// No auth required — the opaque token is the sole credential; validated server-side.

import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import JSZip from "npm:jszip@3.10.1";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface DocRow {
  id: string; file_name: string | null; signed_file_url: string | null; file_url: string | null;
  document_type: string; unit_code: string | null; unit_name: string | null;
  trainer_id: string | null; hod_approved_at: string | null; dp_approved_at: string | null;
  archived_at: string | null; status: string;
  hod_stamp_url: string | null; dp_stamp_url: string | null; iqa_stamp_url: string | null;
}

function isTextOnly(d: DocRow): boolean {
  return !d.hod_stamp_url && !d.dp_stamp_url && !d.iqa_stamp_url;
}

function safeSeg(name: string): string {
  return (name || "unknown").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token") || "";
    const verifierId = url.searchParams.get("v") || null;
    const wantMeta = url.searchParams.get("meta") === "1";
    const wantList = url.searchParams.get("list") === "1";
    if (!token) return json({ error: "Missing token" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: pack, error: pErr } = await admin
      .from("verification_packs")
      .select("*")
      .eq("token", token)
      .maybeSingle();
    if (pErr) return json({ error: pErr.message }, 500);
    if (!pack) return json({ error: "Link not found" }, 404);
    if (pack.revoked_at) return json({ error: "Link has been revoked" }, 410);
    if (new Date(pack.expires_at) < new Date()) return json({ error: "Link has expired" }, 410);

    // Validate verifier assignment if v is present
    let verifier: { id: string; full_name: string; email: string } | null = null;
    if (verifierId) {
      const { data: a } = await admin
        .from("verification_pack_assignees")
        .select("id, verifier_id, first_opened_at, verifiers ( id, full_name, email )")
        .eq("pack_id", pack.id)
        .eq("verifier_id", verifierId)
        .maybeSingle();
      if (a) {
        // deno-lint-ignore no-explicit-any
        const v: any = (a as any).verifiers;
        if (v) verifier = { id: v.id, full_name: v.full_name, email: v.email };
        if (!a.first_opened_at) {
          const openedAt = new Date().toISOString();
          await admin
            .from("verification_pack_assignees")
            .update({ first_opened_at: openedAt })
            .eq("id", a.id);
          await admin.from("audit_logs").insert({
            action: "PACK_OPENED",
            performed_by: null,
            details: { pack_id: pack.id, verifier_id: verifierId, opened_at: openedAt },
          });
        }
      }
    }

    let dq = admin
      .from("documents")
      .select("id, file_name, signed_file_url, file_url, document_type, unit_code, unit_name, trainer_id, hod_approved_at, dp_approved_at, archived_at, hod_stamp_url, dp_stamp_url, iqa_stamp_url")
      .eq("department", pack.department)
      .eq("session_year", pack.session_year)
      .eq("session_term", pack.session_term)
      .eq("status", "ARCHIVED")
      .order("archived_at", { ascending: true });

    if (pack.included_document_types && Array.isArray(pack.included_document_types) && pack.included_document_types.length > 0) {
      dq = dq.in("document_type", pack.included_document_types);
    }

    const { data: docsRaw, error: dErr } = await dq;
    if (dErr) return json({ error: dErr.message }, 500);
    const allDocs = (docsRaw || []) as DocRow[];

    const included: DocRow[] = [];
    const excluded: DocRow[] = [];
    for (const d of allDocs) {
      if (!pack.include_text_only_fallbacks && isTextOnly(d)) excluded.push(d);
      else included.push(d);
    }

    if (wantMeta) {
      return json({
        department: pack.department,
        session_year: pack.session_year,
        session_term: pack.session_term,
        document_count: included.length,
        excluded_count: excluded.length,
        included_document_types: pack.included_document_types,
        include_text_only_fallbacks: pack.include_text_only_fallbacks,
        verifier,
      });
    }

    if (wantList) {
      const { data: reviews } = await admin
        .from("verifier_reviews")
        .select("document_id, decision, notes, reviewed_at, verifier_id")
        .eq("pack_id", pack.id);
      return json({
        pack: {
          id: pack.id,
          department: pack.department,
          session_year: pack.session_year,
          session_term: pack.session_term,
        },
        verifier,
        documents: included.map((d) => ({
          id: d.id, file_name: d.file_name, document_type: d.document_type,
          unit_code: d.unit_code, unit_name: d.unit_name,
          hod_approved_at: d.hod_approved_at, dp_approved_at: d.dp_approved_at,
          archived_at: d.archived_at, text_only: isTextOnly(d),
        })),
        excluded: excluded.map((d) => ({
          id: d.id, file_name: d.file_name, document_type: d.document_type, unit_code: d.unit_code,
          reason: "text-only approval",
        })),
        reviews: reviews || [],
      });
    }

    const zip = new JSZip();
    const indexLines: string[] = [
      `Verification pack`,
      `Department: ${pack.department}`,
      `Session: ${pack.session_year} · ${pack.session_term}`,
      `Generated: ${new Date().toISOString()}`,
      `Included document types: ${pack.included_document_types ? (pack.included_document_types as string[]).join(", ") : "ALL"}`,
      `Text-only fallback documents included: ${pack.include_text_only_fallbacks ? "Yes" : "No"}`,
      `Documents: ${included.length}`,
      ``,
    ];

    for (const d of included) {
      const ref = (d.signed_file_url || d.file_url || "") as string;
      let path: string | null = null;
      const m1 = ref.match(/\/storage\/v1\/object\/(?:public|sign)\/documents\/(.+?)(\?|$)/);
      if (m1) path = decodeURIComponent(m1[1]);
      else if (ref && !ref.startsWith("http")) path = ref;
      if (!path) {
        indexLines.push(`- [SKIPPED] ${d.file_name} (${d.document_type}) — no file`);
        continue;
      }
      const { data: blob, error: dlErr } = await admin.storage.from("documents").download(path);
      if (dlErr || !blob) {
        indexLines.push(`- [ERROR] ${d.file_name} — ${dlErr?.message ?? "download failed"}`);
        continue;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const safeName = `${d.unit_code || "unit"}_${d.document_type.replace(/\s+/g, "_")}_${d.id.slice(0, 8)}.pdf`;
      zip.file(safeName, bytes);
      indexLines.push(
        `- ${safeName}` +
        `\n    Type: ${d.document_type}` +
        `\n    Unit: ${d.unit_code}${d.unit_name ? ` — ${d.unit_name}` : ""}` +
        `\n    HOD approved: ${d.hod_approved_at ?? "—"}` +
        `\n    DP approved:  ${d.dp_approved_at ?? "—"}` +
        `\n    Archived:     ${d.archived_at ?? "—"}` +
        (isTextOnly(d) ? `\n    Note: text-only approval (no stamp)` : ``),
      );
    }
    if (excluded.length > 0) {
      indexLines.push(``, `Excluded (text-only approvals):`);
      for (const d of excluded) {
        indexLines.push(`- ${d.file_name || d.id} (${d.document_type}) — ${d.unit_code ?? ""}`);
      }
    }
    zip.file("INDEX.txt", indexLines.join("\n"));

    const zipBytes = await zip.generateAsync({ type: "uint8array" });

    await admin
      .from("verification_packs")
      .update({ download_count: (pack.download_count as number) + 1 })
      .eq("id", pack.id);
    await admin.from("audit_logs").insert({
      action: "VERIFICATION_PACK_DOWNLOADED",
      performed_by: pack.created_by,
      details: {
        pack_id: pack.id, department: pack.department,
        session_year: pack.session_year, session_term: pack.session_term,
        document_count: included.length,
        excluded_count: excluded.length,
        verifier_id: verifierId,
        ua: req.headers.get("user-agent") ?? null,
      },
    });

    const filename = `verification_${pack.department}_${pack.session_year}_${pack.session_term}.zip`;
    return new Response(zipBytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
