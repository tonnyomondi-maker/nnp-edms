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
  stage: "HOD" | "IQA_REVIEW" | "DP" | "IQA";
  signatureUrl?: string;
  stampUrl?: string;
  approverName: string;
  placement?: Placement | null;
  mode?: "IMAGE" | "TEXT_ONLY";
}

const SIG_W = 140, SIG_H = 50, STAMP_W = 90, STAMP_H = 90;
const STAGE_LABEL: Record<string, string> = { HOD: "Head of Department", IQA_REVIEW: "IQA Review", DP: "DP Academics", IQA: "IQA Archival" };
const STAGE_TITLE: Record<string, string> = {
  HOD: "1. VERIFIED BY HEAD OF DEPARTMENT",
  IQA_REVIEW: "2. REVIEWED BY INTERNAL QUALITY ASSURANCE",
  DP: "3. APPROVED BY DEPUTY PRINCIPAL — ACADEMICS",
  IQA: "4. ARCHIVED BY INTERNAL QUALITY ASSURANCE",
};
const STAGE_SLOT: Record<string, number> = { HOD: 0, IQA_REVIEW: 1, DP: 2, IQA: 3 };
const SHEET_MARKER = "EDMS-APPROVAL-SHEET";

/**
 * Returns the dedicated approval sheet appended at the end of the document,
 * creating it on first use. The sheet is marked in the PDF subject so later
 * approval stages reuse the same page instead of appending a new one — this
 * keeps all four signatures ordered and evenly spaced without the approver
 * ever having to open the document.
 */
// deno-lint-ignore no-explicit-any
function ensureApprovalSheet(pdfDoc: any, bold: any, regular: any) {
  const marked = (pdfDoc.getSubject() || "").includes(SHEET_MARKER);
  const pages = pdfDoc.getPages();
  if (marked && pages.length > 0) return pages[pages.length - 1];

  const page = pdfDoc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  page.drawText("DOCUMENT APPROVAL & VERIFICATION SHEET", {
    x: 40, y: height - 60, size: 14, font: bold, color: rgb(0.1, 0.25, 0.5),
  });
  page.drawText(
    "System-generated. Each stage below is signed in order by the responsible officer.",
    { x: 40, y: height - 76, size: 8, font: regular, color: rgb(0.35, 0.35, 0.35) },
  );
  page.drawLine({
    start: { x: 40, y: height - 86 }, end: { x: width - 40, y: height - 86 },
    thickness: 1, color: rgb(0.1, 0.25, 0.5),
  });
  pdfDoc.setSubject(`${pdfDoc.getSubject() || ""} ${SHEET_MARKER}`.trim());
  return page;
}

/** Y coordinate of the bottom of a stage slot on the approval sheet. */
// deno-lint-ignore no-explicit-any
function slotBox(page: any, stage: string) {
  const { width, height } = page.getSize();
  const top = height - 110;
  const slotH = 155;
  const gap = 14;
  const idx = STAGE_SLOT[stage] ?? 0;
  const y = top - (idx + 1) * slotH - idx * gap;
  return { x: 40, y, w: width - 80, h: slotH };
}




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

async function fetchImageAsset(
  supabase: ReturnType<typeof createClient>,
  url: string,
): Promise<{ buffer: ArrayBuffer; contentType: string | null }> {
  // Bare paths (the new default from ProfileSettings) go straight to the
  // private 'signatures' bucket. Only enforce SSRF when we actually see a URL.
  const isUrl = /^https?:\/\//i.test(url);
  if (isUrl) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error("Invalid image URL"); }
    const expectedOrigin = new URL(supabaseUrl).origin;
    if (parsed.origin !== expectedOrigin || !parsed.pathname.startsWith("/storage/v1/object/")) {
      throw new Error("Image URL must point to this project's Supabase Storage");
    }
  }
  const ref = parseStorageRef(url, "signatures");
  if (!ref) throw new Error("Could not parse storage reference for image");
  const { data, error } = await supabase.storage.from(ref.bucket).download(ref.path);
  if (error || !data) throw new Error(`Storage download failed for ${ref.bucket}/${ref.path}: ${error?.message || "unknown"}`);
  const buffer = await data.arrayBuffer();
  return { buffer, contentType: data.type || null };
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

    // Role/stage authorization: caller must hold the role matching the stage.
    const callerId = userData.user.id;
    const stageRole: Record<string, string> = { HOD: "HOD", IQA_REVIEW: "IQA", DP: "DP_ACADEMICS", IQA: "IQA" };
    const requiredRole = stageRole[stage];
    if (!requiredRole) {
      return new Response(JSON.stringify({ error: "Invalid stage" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: rolesRows } = await supabase
      .from("user_roles").select("role").eq("user_id", callerId);
    const callerRoles = new Set((rolesRows || []).map((r) => r.role));
    if (!callerRoles.has(requiredRole) && !callerRoles.has("SUPER_ADMIN")) {
      return new Response(JSON.stringify({ error: `Forbidden — ${requiredRole} role required` }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Stage/status consistency: caller can only stamp docs currently at the
    // expected upstream status for their stage.
    const expectedStatus: Record<string, string> = {
      HOD: "SUBMITTED", IQA_REVIEW: "HOD_APPROVED", DP: "IQA_REVIEWED", IQA: "DP_APPROVED",
    };
    const { data: docStatus } = await supabase
      .from("documents").select("status,trainer_id").eq("id", documentId).single();
    if (!docStatus) {
      return new Response(JSON.stringify({ error: "Document not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Trainers may never stamp their own docs even if they somehow hold a role.
    if (docStatus.trainer_id === callerId && !callerRoles.has("SUPER_ADMIN")) {
      return new Response(JSON.stringify({ error: "You cannot approve your own document" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (docStatus.status !== expectedStatus[stage] && !callerRoles.has("SUPER_ADMIN")) {
      return new Response(JSON.stringify({ error: `Document is not awaiting ${stage} action` }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    // Re-check per-document-type policy server-side so a tampered client
    // cannot bypass a stamp requirement.
    const { data: policyRow } = await supabase
      .from("document_type_policy")
      .select("signature_only_allowed,stamp_required,forbid_text_only_fallback")
      .eq("document_type", (await supabase.from("documents").select("document_type").eq("id", documentId).single()).data?.document_type ?? "")
      .maybeSingle();
    const stampMandatory = (policyRow?.stamp_required ?? true) && !(policyRow?.signature_only_allowed ?? false);
    if (stampMandatory && !stampUrl && mode === "IMAGE") {
      return new Response(JSON.stringify({ error: "Policy requires an embedded stamp for this document type." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (mode === "TEXT_ONLY") {
      if (policyRow?.forbid_text_only_fallback) {
        return new Response(JSON.stringify({ error: "Text-only approval is disabled for this document type." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if ((policyRow?.stamp_required ?? true) && !(policyRow?.signature_only_allowed ?? false)) {
        return new Response(JSON.stringify({ error: "Text-only approval is not allowed for this document type." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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
      : stage === "IQA_REVIEW" ? (doc.iqa_reviewed_at ?? null)
      : stage === "DP" ? (doc.approved_by_dp_academics_at ?? doc.dp_approved_at ?? null)
      : (doc.archived_at ?? null);
    const stageDate = stageDateIso ? new Date(stageDateIso) : new Date();

    // Text-only quick approval: write the stage block on the shared approval sheet
    if (mode === "TEXT_ONLY") {
      const sheet = ensureApprovalSheet(pdfDoc, helvBold, helv);
      const box = slotBox(sheet, stage);
      sheet.drawRectangle({
        x: box.x, y: box.y, width: box.w, height: box.h,
        borderColor: rgb(0.15, 0.35, 0.6), borderWidth: 1,
        color: rgb(0.96, 0.98, 1), opacity: 0.9,
      });
      let ty = box.y + box.h - 20;
      sheet.drawText(STAGE_TITLE[stage], { x: box.x + 14, y: ty, size: 10, font: helvBold, color: rgb(0.1, 0.25, 0.5) });
      ty -= 22;
      sheet.drawText(`Name: ${approverName || "—"}`, { x: box.x + 14, y: ty, size: 9, font: helv });
      ty -= 16;
      sheet.drawText(`Role: ${STAGE_LABEL[stage]}`, { x: box.x + 14, y: ty, size: 9, font: helv });
      ty -= 16;
      sheet.drawText(`Date: ${stageDate.toLocaleDateString()}`, { x: box.x + 14, y: ty, size: 9, font: helv });
      ty -= 16;
      sheet.drawText(`Timestamp: ${stageDate.toLocaleString()}`, { x: box.x + 14, y: ty, size: 7, font: helv, color: rgb(0.3, 0.3, 0.3) });
      sheet.drawText("Approved electronically in the EDMS — no wet signature supplied for this stage.", {
        x: box.x + 14, y: box.y + 12, size: 7, font: helv, color: rgb(0.45, 0.45, 0.45),
      });


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
    const sig = await fetchImageAsset(supabase, signatureUrl!);
    const stamp = stampUrl ? await fetchImageAsset(supabase, stampUrl) : null;

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
      // No custom placement (typical for bulk approvals): render the stage on
      // the shared, ordered approval sheet appended at the end of the PDF.
      const sheet = ensureApprovalSheet(pdfDoc, helvBold, helv);
      const box = slotBox(sheet, stage);
      sheet.drawRectangle({
        x: box.x, y: box.y, width: box.w, height: box.h,
        borderColor: rgb(0.15, 0.35, 0.6), borderWidth: 1,
        color: rgb(0.98, 0.99, 1), opacity: 0.9,
      });
      sheet.drawText(STAGE_TITLE[stage], {
        x: box.x + 14, y: box.y + box.h - 20, size: 10, font: helvBold, color: rgb(0.1, 0.25, 0.5),
      });

      const sigDims = sigImage.scaleToFit(SIG_W, SIG_H);
      const stampDims = stampImage ? stampImage.scaleToFit(STAMP_W, STAMP_H) : { width: STAMP_W, height: STAMP_H };
      const sigX = box.x + 14;
      const sigY = box.y + 52;
      const lineY = sigY - 4;

      if (autofill) {
        sheet.drawImage(sigImage, { x: sigX, y: sigY, width: sigDims.width, height: sigDims.height });
        sheet.drawLine({ start: { x: sigX, y: lineY }, end: { x: sigX + Math.max(sigDims.width, 160), y: lineY }, thickness: 0.6 });
        sheet.drawText(`Name: ${approverName}`, { x: sigX, y: lineY - 14, size: 9, font: helv });
        sheet.drawText(`Role: ${STAGE_LABEL[stage]}`, { x: sigX, y: lineY - 27, size: 9, font: helv });
        sheet.drawText(`Date: ${stageDate.toLocaleDateString()} · ${stageDate.toLocaleTimeString()}`, {
          x: sigX, y: lineY - 40, size: 7.5, font: helv, color: rgb(0.35, 0.35, 0.35),
        });
        if (stampImage) {
          sheet.drawImage(stampImage, {
            x: box.x + box.w - stampDims.width - 24,
            y: box.y + 22,
            width: stampDims.width,
            height: stampDims.height,
          });
        }
      } else {
        sheet.drawText('Sign: ______________________________', { x: sigX, y: box.y + box.h - 55, size: 9, font: helv });
        sheet.drawText('Name: ______________________________', { x: sigX, y: box.y + box.h - 78, size: 9, font: helv });
        sheet.drawText('Date: ______________________________', { x: sigX, y: box.y + box.h - 101, size: 9, font: helv });
        if (stampImage) {
          const cx = box.x + box.w - 70, cy = box.y + box.h / 2;
          sheet.drawCircle({ x: cx, y: cy, size: 35, borderWidth: 1, borderColor: rgb(0.3, 0.3, 0.3) });
          sheet.drawText('STAMP', { x: cx - 14, y: cy - 3, size: 8, font: helvBold, color: rgb(0.4, 0.4, 0.4) });
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
