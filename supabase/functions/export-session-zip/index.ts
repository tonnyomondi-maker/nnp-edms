import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  BlobWriter,
  TextReader,
  Uint8ArrayReader,
  ZipWriter,
} from "https://deno.land/x/zipjs@v2.7.45/index.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Session = "JAN_APR" | "MAY_AUG" | "SEP_DEC";

interface ExportRequest {
  year: number;
  session: Session;
  deleteAfter?: boolean;
}

const SESSION_LABEL: Record<Session, string> = {
  JAN_APR: "January – April",
  MAY_AUG: "May – August",
  SEP_DEC: "September – December",
};

function sessionWindow(year: number, session: Session) {
  // Inclusive start, exclusive end (UTC)
  if (session === "JAN_APR")
    return { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year, 4, 1)) };
  if (session === "MAY_AUG")
    return { start: new Date(Date.UTC(year, 4, 1)), end: new Date(Date.UTC(year, 8, 1)) };
  return { start: new Date(Date.UTC(year, 8, 1)), end: new Date(Date.UTC(year + 1, 0, 1)) };
}

function safe(name: string) {
  return (name || "unknown").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
}

function csvEscape(v: unknown) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Parse a Supabase storage URL OR a bare storage path into { bucket, path }.
// Bare paths (e.g. "<userId>/.../file.pdf") are assumed to live in the
// private "documents" bucket, which is where stamped & uploaded PDFs go.
function parseStorageRef(ref: string): { bucket: string; path: string } | null {
  if (!ref) return null;
  if (/^https?:\/\//i.test(ref)) {
    try {
      const u = new URL(ref);
      const m = u.pathname.match(/\/storage\/v1\/object\/(?:public\/|sign\/)?([^/]+)\/(.+?)(?:\?.*)?$/);
      if (!m) return null;
      return { bucket: decodeURIComponent(m[1]), path: decodeURIComponent(m[2].split("?")[0]) };
    } catch {
      return null;
    }
  }
  // Bare path
  return { bucket: "documents", path: ref.replace(/^\/+/, "") };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: authErr } = await userClient.auth.getClaims(token);
    if (authErr || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claims.claims.sub as string;

    const admin = createClient(supabaseUrl, serviceKey);

    // Authorize: must be IQA or DP_ACADEMICS
    const [{ data: isIqa }, { data: isDp }] = await Promise.all([
      admin.rpc("has_role", { _user_id: userId, _role: "IQA" }),
      admin.rpc("has_role", { _user_id: userId, _role: "DP_ACADEMICS" }),
    ]);
    if (!isIqa && !isDp) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as ExportRequest;
    const { year, session, deleteAfter } = body || ({} as ExportRequest);
    if (!year || !["JAN_APR", "MAY_AUG", "SEP_DEC"].includes(session)) {
      return new Response(JSON.stringify({ error: "Invalid year or session" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Query by session_year + session_term (new) — falls back to archived_at window for legacy rows
    const { start, end } = sessionWindow(Number(year), session);

    const { data: docs, error: docErr } = await admin
      .from("documents")
      .select("*, teaching_assignments(*)")
      .eq("status", "ARCHIVED")
      .or(
        `and(session_year.eq.${year},session_term.eq.${session}),and(session_year.is.null,archived_at.gte.${start.toISOString()},archived_at.lt.${end.toISOString()})`,
      )
      .order("department", { ascending: true });

    if (docErr) throw docErr;
    if (!docs || docs.length === 0) {
      return new Response(JSON.stringify({ error: "No archived documents in this session" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch trainer + approver names
    const userIds = new Set<string>();
    docs.forEach((d: any) => {
      [d.trainer_id, d.hod_approved_by, d.dp_approved_by, d.iqa_archived_by]
        .filter(Boolean)
        .forEach((id) => userIds.add(id));
    });
    const { data: profiles } = await admin
      .from("profiles")
      .select("user_id, full_name")
      .in("user_id", Array.from(userIds));
    const nameMap = new Map<string, string>();
    (profiles || []).forEach((p: any) => nameMap.set(p.user_id, p.full_name || "Unknown"));

    // Build ZIP
    const zipBlobWriter = new BlobWriter("application/zip");
    const zipWriter = new ZipWriter(zipBlobWriter);

    const csvRows: string[] = [
      [
        "id",
        "department",
        "trainer",
        "unit_code",
        "unit_name",
        "class_code",
        "term_number",
        "document_type",
        "week_number",
        "session_index",
        "submitted_at",
        "hod_approved_at",
        "hod_approver",
        "dp_approved_at",
        "dp_approver",
        "archived_at",
        "iqa_archiver",
        "file_in_zip",
      ].join(","),
    ];

    const exportedIds: string[] = [];
    const deletePaths: { bucket: string; path: string }[] = [];
    let included = 0;
    let skipped = 0;

    for (const doc of docs as any[]) {
      const url = doc.signed_file_url || doc.file_url;
      if (!url) {
        skipped++;
        continue;
      }
      const parsed = parseStorageRef(url);
      if (!parsed) {
        skipped++;
        continue;
      }
      const { data: fileData, error: dlErr } = await admin.storage
        .from(parsed.bucket)
        .download(parsed.path);
      if (dlErr || !fileData) {
        skipped++;
        continue;
      }

      const trainerName = nameMap.get(doc.trainer_id) || "Unknown_Trainer";
      const ta = doc.teaching_assignments || {};
      // Prefer denormalized fields on the doc itself, fall back to assignment
      const unitCode = doc.unit_code || ta.unit_code || "UNIT";
      const unitName = doc.unit_name || ta.unit_name || "";
      const classCode = doc.class_code || ta.class_code || "";
      const dept = safe(doc.department || "Unknown_Dept");
      const trainer = safe(trainerName);
      const unit = safe(unitCode);
      const dtype = safe(doc.document_type || "DOC");
      const wk = doc.week_number ? `_w${doc.week_number}` : "";
      const sIdx = doc.session_index ? `_s${doc.session_index}` : "";
      const fileInZip = `${dept}/${trainer}/${unit}_${dtype}${wk}${sIdx}_${doc.id.slice(0, 8)}.pdf`;

      const buf = new Uint8Array(await fileData.arrayBuffer());
      await zipWriter.add(fileInZip, new Uint8ArrayReader(buf));
      included++;
      exportedIds.push(doc.id);

      // Track originals to delete
      if (deleteAfter) {
        if (doc.signed_file_url) {
          const p = parseStorageRef(doc.signed_file_url);
          if (p) deletePaths.push(p);
        }
        if (doc.file_url) {
          const p = parseStorageRef(doc.file_url);
          if (p) deletePaths.push(p);
        }
      }

      csvRows.push(
        [
          doc.id,
          doc.department,
          trainerName,
          unitCode,
          unitName,
          classCode,
          doc.term_number ?? "",
          doc.document_type,
          doc.week_number ?? "",
          doc.session_index ?? "",
          doc.submitted_at,
          doc.hod_approved_at,
          nameMap.get(doc.hod_approved_by) || "",
          doc.dp_approved_at,
          nameMap.get(doc.dp_approved_by) || "",
          doc.archived_at,
          nameMap.get(doc.iqa_archived_by) || "",
          fileInZip,
        ]
          .map(csvEscape)
          .join(","),
      );
    }

    const readme =
      `Nyamira National Polytechnic — EDMS Session Export\n` +
      `Session: ${SESSION_LABEL[session]} ${year}\n` +
      `Exported at: ${new Date().toISOString()}\n` +
      `Documents included: ${included}\n` +
      `Documents skipped (missing files): ${skipped}\n` +
      `Originals deleted from cloud: ${deleteAfter ? "Yes" : "No"}\n`;

    await zipWriter.add("manifest.csv", new TextReader(csvRows.join("\n")));
    await zipWriter.add("README.txt", new TextReader(readme));
    await zipWriter.close();
    const zipBlob = await zipBlobWriter.getData();

    // Free storage if requested
    if (deleteAfter && exportedIds.length > 0) {
      // Group deletes per bucket
      const byBucket = new Map<string, string[]>();
      for (const { bucket, path } of deletePaths) {
        if (!byBucket.has(bucket)) byBucket.set(bucket, []);
        byBucket.get(bucket)!.push(path);
      }
      for (const [bucket, paths] of byBucket) {
        await admin.storage.from(bucket).remove(paths);
      }
      await admin
        .from("documents")
        .update({
          status: "EXPORTED",
          exported_at: new Date().toISOString(),
          exported_by: userId,
          file_url: null,
          signed_file_url: null,
        })
        .in("id", exportedIds);
    }

    const filename = `EDMS_${year}_${session}_${included}docs.zip`;
    return new Response(zipBlob, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Included": String(included),
        "X-Skipped": String(skipped),
      },
    });
  } catch (e) {
    console.error("export-session-zip error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
