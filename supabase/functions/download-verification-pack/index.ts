// Public endpoint used by external verifiers with a pack token.
// GET ?token=... [&meta=1]
//   meta=1 -> returns { department, session_year, session_term, document_count }
//   else   -> streams a ZIP of all archived documents for that dept+session
//             plus an INDEX.txt manifest. Increments download_count.
// No auth required — the opaque token is the sole credential; validated server-side.

import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import JSZip from "npm:jszip@3.10.1";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token") || "";
    const wantMeta = url.searchParams.get("meta") === "1";
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

    const { data: docs, error: dErr } = await admin
      .from("documents")
      .select("id, file_name, signed_file_url, file_url, document_type, unit_code, unit_name, trainer_id, hod_approved_at, dp_approved_at, archived_at")
      .eq("department", pack.department)
      .eq("session_year", pack.session_year)
      .eq("session_term", pack.session_term)
      .eq("status", "ARCHIVED")
      .order("archived_at", { ascending: true });
    if (dErr) return json({ error: dErr.message }, 500);

    if (wantMeta) {
      return json({
        department: pack.department,
        session_year: pack.session_year,
        session_term: pack.session_term,
        document_count: (docs || []).length,
      });
    }

    const zip = new JSZip();
    const indexLines: string[] = [
      `Verification pack`,
      `Department: ${pack.department}`,
      `Session: ${pack.session_year} · ${pack.session_term}`,
      `Generated: ${new Date().toISOString()}`,
      `Documents: ${(docs || []).length}`,
      ``,
    ];

    for (const d of docs || []) {
      const ref = (d.signed_file_url || d.file_url || "") as string;
      // Parse storage path
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
        `\n    Archived:     ${d.archived_at ?? "—"}`,
      );
    }
    zip.file("INDEX.txt", indexLines.join("\n"));

    const zipBytes = await zip.generateAsync({ type: "uint8array" });

    // Bump counter + audit log
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
        document_count: (docs || []).length,
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
