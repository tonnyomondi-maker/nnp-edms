import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { PDFDocument, degrees, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";

interface Placement {
  page?: number | null;
  sigX?: number | null;
  sigY?: number | null;
  sigW?: number | null;
  sigH?: number | null;
  sigRot?: number | null;
  sigOpacity?: number | null;
  stampX?: number | null;
  stampY?: number | null;
  stampW?: number | null;
  stampH?: number | null;
  stampRot?: number | null;
  stampOpacity?: number | null;
  autofill?: boolean | null;
}
interface StampRequest {
  documentId: string;
  stage: "HOD" | "DP" | "IQA";
  signatureUrl?: string;
  stampUrl?: string;
  approverName: string;
  placement?: Placement | null;
  mode?: "IMAGE" | "TEXT_ONLY";
}

const SIG_W = 140, SIG_H = 50, STAMP_W = 90, STAMP_H = 90;
const STAGE_LABEL: Record<string, string> = { HOD: "Head of Department", DP: "DP Academics", IQA: "IQA" };


function parseStorageRef(value: string, defaultBucket = "documents"): { bucket: string; path: string } | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    const m = u.pathname.match(/\/storage\/v1\/object\/(?:public\/|sign\/)?([^/]+)\/(.+?)(?:\?|$)/);
    if (m) return { bucket: decodeURIComponent(m[1]), path: decodeURIComponent(m[2]) };
    return null;
  } catch {
    if (value.startsWith("/")) value = value.slice(1);
    return { bucket: defaultBucket, path: value };
  }
}

async function downloadFromStorage(
  supabase: ReturnType<typeof createClient>,
  ref: { bucket: string; path: string },
): Promise<ArrayBuffer> {
  const { data, error } = await supabase.storage.from(ref.bucket).download(ref.path);
  if (error || !data) throw new Error(`Storage download failed: ${error?.message || "unknown"}`);
  return await data.arrayBuffer();
}

async function fetchAsArrayBuffer(url: string): Promise<{ buffer: ArrayBuffer; contentType: string | null }> {
  // SSRF guard: only allow fetching images from our own Supabase storage.
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("Invalid image URL"); }
  const expectedOrigin = new URL(supabaseUrl).origin;
  if (parsed.origin !== expectedOrigin || !parsed.pathname.startsWith("/storage/v1/object/")) {
    throw new Error("Image URL must point to this project's Supabase Storage");
  }
  const res = await fetch(parsed.toString());
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url.slice(0, 80)}…`);
  const buffer = await res.arrayBuffer();
  return { buffer, contentType: res.headers.get("content-type") };
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as StampRequest;
    const { documentId, stage, signatureUrl, stampUrl, approverName, placement, mode = "IMAGE" } = body;
    if (!documentId || !stage) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (mode === "IMAGE" && !signatureUrl) {
      return new Response(JSON.stringify({ error: "Signature is required for image mode" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Re-check per-document-type policy server-side so a tampered client
    // cannot bypass a stamp requirement.
    const { data: policyRow } = await supabase
      .from("document_type_policy")
      .select("signature_only_allowed,stamp_required")
      .eq("document_type", (await supabase.from("documents").select("document_type").eq("id", documentId).single()).data?.document_type ?? "")
      .maybeSingle();
    const stampMandatory = (policyRow?.stamp_required ?? true) && !(policyRow?.signature_only_allowed ?? false);
    if (stampMandatory && !stampUrl && mode === "IMAGE") {
      return new Response(JSON.stringify({ error: "Policy requires an embedded stamp for this document type." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (mode === "TEXT_ONLY" && (policyRow?.stamp_required ?? true) && !(policyRow?.signature_only_allowed ?? false)) {
      return new Response(JSON.stringify({ error: "Text-only approval is not allowed for this document type." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: doc, error: docErr } = await supabase
      .from("documents").select("*").eq("id", documentId).single();
    if (docErr || !doc) throw new Error("Document not found");

    const sourceRef = parseStorageRef(doc.signed_file_url || doc.file_url || "");
    if (!sourceRef) throw new Error("Document has no parseable file reference");

    // Download the PDF directly from storage (bucket is private)
    const pdfBytes = await downloadFromStorage(supabase, sourceRef);

    // Validate PDF header to fail fast with a clear message
    const head = new Uint8Array(pdfBytes.slice(0, 5));
    const headerStr = String.fromCharCode(...head);
    if (!headerStr.startsWith("%PDF-")) {
      throw new Error(`Source file is not a valid PDF (got header "${headerStr}"). Path: ${sourceRef.path}`);
    }

    const pdfDoc = await PDFDocument.load(pdfBytes);
    const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Resolve a STABLE date for this stage so re-exports always render the same text
    const stageDateIso: string | null =
      stage === "HOD" ? (doc.verified_by_hod_at ?? doc.hod_approved_at ?? null)
      : stage === "DP" ? (doc.approved_by_dp_academics_at ?? doc.dp_approved_at ?? null)
      : (doc.archived_at ?? null);
    const stageDate = stageDateIso ? new Date(stageDateIso) : new Date();

    // Text-only quick approval: draw a labelled text block, skip signature/stamp images
    if (mode === "TEXT_ONLY") {
      const pages = pdfDoc.getPages();
      const lastPage = pages[pages.length - 1];
      const { width } = lastPage.getSize();
      const stageLabel = stage === "HOD"
        ? "VERIFIED BY HOD"
        : stage === "DP"
          ? "APPROVED BY DP ACADEMICS"
          : "ARCHIVED BY IQA";
      const stageOffset: Record<string, number> = { HOD: 0, DP: 1, IQA: 2 };
      const baseY = 60 + stageOffset[stage] * 70;
      const boxX = 40, boxW = Math.min(360, width - 80), boxH = 56;
      lastPage.drawRectangle({
        x: boxX, y: baseY, width: boxW, height: boxH,
        borderColor: rgb(0.15, 0.35, 0.6), borderWidth: 1.2,
        color: rgb(0.95, 0.97, 1), opacity: 0.85,
      });
      lastPage.drawText(stageLabel, { x: boxX + 10, y: baseY + boxH - 16, size: 11, font: helvBold, color: rgb(0.1, 0.25, 0.5) });
      lastPage.drawText(`Name: ${approverName || "—"}`, { x: boxX + 10, y: baseY + boxH - 30, size: 9, font: helv });
      lastPage.drawText(`Date: ${stageDate.toLocaleDateString()}`, { x: boxX + 10, y: baseY + boxH - 42, size: 9, font: helv });
      lastPage.drawText(`Timestamp: ${stageDate.toLocaleString()}`, { x: boxX + 10, y: baseY + boxH - 52, size: 7, font: helv, color: rgb(0.3, 0.3, 0.3) });

      const stampedBytes = await pdfDoc.save();
      const newPath = `${doc.trainer_id}/${doc.assignment_id || "unassigned"}/stamped_${stage}_${Date.now()}.pdf`;
      const { error: uploadErr } = await supabase.storage
        .from("documents").upload(newPath, stampedBytes, { contentType: "application/pdf", upsert: false });
      if (uploadErr) throw uploadErr;
      return new Response(JSON.stringify({ signedFileUrl: newPath }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Signature is mandatory in IMAGE mode; stamp is optional (signature-only
    // approvals are supported when the approver has no stamp configured).
    const sig = await fetchAsArrayBuffer(signatureUrl!);
    const stamp = stampUrl ? await fetchAsArrayBuffer(stampUrl) : null;

    const embedImage = async (bytes: ArrayBuffer, contentType: string | null) => {
      const isPng = (contentType || "").includes("png") || new Uint8Array(bytes)[0] === 0x89;
      return isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
    };
    const sigImage = await embedImage(sig.buffer, sig.contentType);
    const stampImage = stamp ? await embedImage(stamp.buffer, stamp.contentType) : null;

    const pages = pdfDoc.getPages();
    const useCustom = placement && (placement.sigX != null || placement.stampX != null);
    const autofill = placement?.autofill ?? true;

    if (useCustom) {
      const pageIdx = Math.max(0, Math.min(pages.length - 1, (placement!.page ?? pages.length) - 1));
      const page = pages[pageIdx];
      const { width, height } = page.getSize();

      const sigBoxW = (placement!.sigW != null ? placement!.sigW * width : SIG_W);
      const sigBoxH = (placement!.sigH != null ? placement!.sigH * height : SIG_H);
      const stampBoxW = (placement!.stampW != null ? placement!.stampW * width : STAMP_W);
      const stampBoxH = (placement!.stampH != null ? placement!.stampH * height : STAMP_H);

      const sigDims = sigImage.scaleToFit(sigBoxW, sigBoxH);
      const stampDims = stampImage ? stampImage.scaleToFit(stampBoxW, stampBoxH) : { width: stampBoxW, height: stampBoxH };
      const sigOpacity = placement!.sigOpacity ?? 1;
      const stampOpacity = placement!.stampOpacity ?? 1;
      const sigRot = placement!.sigRot ?? 0;
      const stampRot = placement!.stampRot ?? 0;

      if (placement!.sigX != null && placement!.sigY != null) {
        const x = placement!.sigX * width;
        const y = height - placement!.sigY * height - sigDims.height;
        if (autofill) {
          page.drawImage(sigImage, {
            x, y, width: sigDims.width, height: sigDims.height,
            rotate: degrees(sigRot), opacity: sigOpacity,
          });
          page.drawLine({ start: { x, y: y - 2 }, end: { x: x + sigDims.width, y: y - 2 }, thickness: 0.5 });
          page.drawText(`${STAGE_LABEL[stage]}`, { x, y: y - 12, size: 8, font: helvBold });
          page.drawText(`Name: ${approverName}`, { x, y: y - 22, size: 8, font: helv });
          page.drawText(`Date: ${stageDate.toLocaleDateString()}`, { x, y: y - 32, size: 7, font: helv });
          page.drawText(`Signed: ${stageDate.toLocaleString()}`, { x, y: y - 42, size: 7, font: helv });
        } else {
          page.drawText(`${STAGE_LABEL[stage]}`, { x, y: y + sigDims.height + 6, size: 8, font: helvBold });
          page.drawText('Name:', { x, y: y + sigDims.height - 6, size: 8, font: helv });
          page.drawLine({ start: { x: x + 30, y: y + sigDims.height - 6 }, end: { x: x + sigDims.width, y: y + sigDims.height - 6 }, thickness: 0.5 });
          page.drawText('Sign:', { x, y: y + sigDims.height / 2, size: 8, font: helv });
          page.drawLine({ start: { x: x + 30, y: y + sigDims.height / 2 }, end: { x: x + sigDims.width, y: y + sigDims.height / 2 }, thickness: 0.5 });
          page.drawText('Date:', { x, y: y + 4, size: 8, font: helv });
          page.drawLine({ start: { x: x + 30, y: y + 4 }, end: { x: x + sigDims.width, y: y + 4 }, thickness: 0.5 });
        }
      }
      // Only draw the stamp when one was provided AND placement has coords.
      if (stampImage && placement!.stampX != null && placement!.stampY != null) {
        const x = placement!.stampX * width;
        const y = height - placement!.stampY * height - stampDims.height;
        if (autofill) {
          page.drawImage(stampImage, {
            x, y, width: stampDims.width, height: stampDims.height,
            rotate: degrees(stampRot), opacity: stampOpacity,
          });
        } else {
          const cx = x + stampDims.width / 2;
          const cy = y + stampDims.height / 2;
          const r = Math.min(stampDims.width, stampDims.height) / 2;
          page.drawCircle({ x: cx, y: cy, size: r, borderWidth: 1, borderColor: rgb(0.3, 0.3, 0.3) });
          page.drawText('STAMP', { x: cx - 14, y: cy - 3, size: 8, font: helvBold, color: rgb(0.4, 0.4, 0.4) });
        }
      }
    } else {
      const lastPage = pages[pages.length - 1];
      const stageOffset: Record<string, number> = { HOD: 0, DP: 1, IQA: 2 };
      const offsetY = stageOffset[stage] * 110;
      const sigDims = sigImage.scaleToFit(SIG_W, SIG_H);
      const stampDims = stampImage ? stampImage.scaleToFit(STAMP_W, STAMP_H) : { width: STAMP_W, height: STAMP_H };
      const baseY = 60 + offsetY;
      lastPage.drawText(`${STAGE_LABEL[stage]} APPROVAL${autofill ? ` — ${approverName}` : ''}`, { x: 40, y: baseY + 95, size: 9, font: helvBold });
      if (autofill) {
        lastPage.drawImage(sigImage, { x: 40, y: baseY + 40, width: sigDims.width, height: sigDims.height });
        if (stampImage) {
          lastPage.drawImage(stampImage, { x: 200, y: baseY + 10, width: stampDims.width, height: stampDims.height });
        }
        lastPage.drawLine({ start: { x: 40, y: baseY + 38 }, end: { x: 40 + sigDims.width, y: baseY + 38 }, thickness: 0.5 });
        lastPage.drawText(`Name: ${approverName}`, { x: 40, y: baseY + 28, size: 8, font: helv });
        lastPage.drawText(`Date: ${stageDate.toLocaleDateString()}`, { x: 40, y: baseY + 18, size: 8, font: helv });
        lastPage.drawText(`Signed: ${stageDate.toLocaleString()}`, { x: 40, y: baseY + 8, size: 7, font: helv });
      } else {
        lastPage.drawText('Name: __________________________', { x: 40, y: baseY + 75, size: 9, font: helv });
        lastPage.drawText('Sign: __________________________', { x: 40, y: baseY + 55, size: 9, font: helv });
        lastPage.drawText('Date: __________________________', { x: 40, y: baseY + 35, size: 9, font: helv });
        if (stampImage) {
          const cx = 240, cy = baseY + 50;
          lastPage.drawCircle({ x: cx, y: cy, size: 35, borderWidth: 1, borderColor: rgb(0.3, 0.3, 0.3) });
          lastPage.drawText('STAMP', { x: cx - 14, y: cy - 3, size: 8, font: helvBold, color: rgb(0.4, 0.4, 0.4) });
        }
      }
    }

    const stampedBytes = await pdfDoc.save();

    const newPath = `${doc.trainer_id}/${doc.assignment_id || "unassigned"}/stamped_${stage}_${Date.now()}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from("documents")
      .upload(newPath, stampedBytes, { contentType: "application/pdf", upsert: false });
    if (uploadErr) throw uploadErr;

    // Bucket is private — return the bare path. The client uses parseStorageRef
    // and createSignedUrl to build a fresh preview URL each time.
    return new Response(
      JSON.stringify({ signedFileUrl: newPath }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("stamp-document error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
