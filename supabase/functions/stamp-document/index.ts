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
const STAGE_LABEL: Record<string, string> = { HOD: "Head of Department", IQA_REVIEW: "Internal Quality Assurance Officer (IQAO)", DP: "Deputy Principal — Academics", IQA: "IQAO Archival" };
const SHEET_MARKER = "EDMS-APPROVAL-SHEET";
const INSTITUTION_NAME = "The Nyamira National Polytechnic";
/** Bump whenever the approval-sheet layout or stamping logic changes. */
// Plain-language hand-off note appended to each approval notification.
const NEXT_STAGE_NOTE: Record<string, string> = {
  HOD: "Forwarded to IQAO for review.",
  IQA_REVIEW: "Forwarded to the Deputy Principal — Academics for approval.",
  DP: "Returned to IQAO for archiving.",
  IQA: "Archived — your approved copy is now available under My Approved Documents.",
};

const STAMP_VERSION = "3.0.0";

/** A single signing slot on the approval sheet. */
interface StageLayout {
  stage: string;
  order: number;
  title: string;
  slot_height: number;
  sig_w: number;
  sig_h: number;
  stamp_size: number;
  title_size: number;
}

/**
 * Only three officers sign the appended sheet, in this order. IQAO archival is
 * recorded as a one-line footer (and in the audit trail) rather than a slot.
 */
const DEFAULT_STAGES: StageLayout[] = [
  { stage: "HOD", order: 1, title: "1. VERIFIED BY HEAD OF DEPARTMENT", slot_height: 200, sig_w: 150, sig_h: 55, stamp_size: 95, title_size: 10 },
  { stage: "IQA_REVIEW", order: 2, title: "2. REVIEWED BY INTERNAL QUALITY ASSURANCE OFFICER (IQAO)", slot_height: 200, sig_w: 150, sig_h: 55, stamp_size: 95, title_size: 10 },
  { stage: "DP", order: 3, title: "3. APPROVED BY DEPUTY PRINCIPAL - ACADEMICS", slot_height: 200, sig_w: 150, sig_h: 55, stamp_size: 95, title_size: 10 },
];

const SHEET_TOP_OFFSET = 110;
const SLOT_GAP = 16;

async function loadLayout(supabase: ReturnType<typeof createClient>) {
  try {
    const { data } = await supabase
      .from("stamp_layouts")
      .select("name, version, stages, header_title")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    const raw = (data?.stages ?? []) as StageLayout[];
    const stages = Array.isArray(raw) && raw.length > 0
      ? raw.map((s, i) => ({ ...DEFAULT_STAGES[i] ?? DEFAULT_STAGES[0], ...s })).sort((a, b) => a.order - b.order)
      : DEFAULT_STAGES;
    return {
      name: (data?.name as string) || "Standard 2026",
      version: (data?.version as number) ?? 1,
      headerTitle: (data?.header_title as string) || "DOCUMENT APPROVAL & VERIFICATION SHEET",
      stages,
    };
  } catch {
    return { name: "Standard 2026", version: 1, headerTitle: "DOCUMENT APPROVAL & VERIFICATION SHEET", stages: DEFAULT_STAGES };
  }
}

/**
 * Returns the dedicated approval sheet appended at the end of the document,
 * creating it on first use. The sheet is marked in the PDF subject so later
 * approval stages reuse the same page instead of appending a new one — this
 * keeps all signatures ordered and evenly spaced without the approver ever
 * having to open the document.
 */
// deno-lint-ignore no-explicit-any
function ensureApprovalSheet(pdfDoc: any, bold: any, regular: any, layout: { headerTitle: string; stages: StageLayout[]; name: string }) {
  const marked = (pdfDoc.getSubject() || "").includes(SHEET_MARKER);
  const pages = pdfDoc.getPages();
  if (marked && pages.length > 0) return { page: pages[pages.length - 1], created: false };

  const page = pdfDoc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  page.drawText(INSTITUTION_NAME, {
    x: 40, y: height - 42, size: 12, font: bold, color: rgb(0.1, 0.25, 0.5),
  });
  page.drawText("Electronic Document Management System", {
    x: 40, y: height - 55, size: 8, font: regular, color: rgb(0.35, 0.35, 0.35),
  });
  page.drawText(layout.headerTitle, {
    x: 40, y: height - 72, size: 14, font: bold, color: rgb(0.1, 0.25, 0.5),
  });
  page.drawText(
    "System-generated. Each stage below is signed in order by the responsible officer.",
    { x: 40, y: height - 86, size: 8, font: regular, color: rgb(0.35, 0.35, 0.35) },
  );
  page.drawLine({
    start: { x: 40, y: height - 96 }, end: { x: width - 40, y: height - 96 },
    thickness: 1, color: rgb(0.1, 0.25, 0.5),
  });

  // Pre-draw every empty slot so the sheet always reads as an ordered form,
  // even when only the first officer has signed so far.
  layout.stages.forEach((s) => {
    const box = slotBox(page, s.stage, layout.stages);
    if (!box) return;
    page.drawRectangle({
      x: box.x, y: box.y, width: box.w, height: box.h,
      borderColor: rgb(0.7, 0.78, 0.88), borderWidth: 0.8,
    });
    page.drawText(s.title, {
      x: box.x + 14, y: box.y + box.h - 20, size: s.title_size, font: bold, color: rgb(0.45, 0.55, 0.7),
    });
    page.drawText("Awaiting signature", {
      x: box.x + 14, y: box.y + 14, size: 7.5, font: regular, color: rgb(0.6, 0.6, 0.6),
    });
  });

  pdfDoc.setSubject(`${pdfDoc.getSubject() || ""} ${SHEET_MARKER}`.trim());
  return { page, created: true };
}

/**
 * Records a stamping operation in the audit trail so every appended page can be
 * traced back to the stage, its order in the approval chain and the layout
 * version that produced it.
 */
async function logStampOperation(
  supabase: ReturnType<typeof createClient>,
  details: Record<string, unknown>,
  documentId: string,
  performedBy: string,
) {
  try {
    await supabase.from("audit_logs").insert({
      document_id: documentId,
      action: "DOCUMENT_STAMPED",
      performed_by: performedBy,
      details,
    });
  } catch (e) {
    console.error("audit log insert failed", e);
  }
}

/** Stores which layout version and stage order produced the latest stamping. */
async function recordStampMeta(
  supabase: ReturnType<typeof createClient>,
  documentId: string,
  layoutVersion: string,
  stageOrder: number,
) {
  try {
    await supabase.from("documents")
      .update({ stamp_layout_version: layoutVersion, stamp_stage_order: stageOrder })
      .eq("id", documentId);
  } catch (e) {
    console.error("stamp meta update failed", e);
  }
}

/** In-app notification for the document owner, carrying full traceability. */
async function notifyTrainer(
  supabase: ReturnType<typeof createClient>,
  n: {
    userId: string; documentId: string; kind: string; stage: string;
    stageOrder: number; stageTotal: number; stampVersion: string;
    layoutVersion: string; title: string; message: string; note?: string | null;
  },
) {
  try {
    await supabase.from("notifications").insert({
      user_id: n.userId,
      document_id: n.documentId,
      kind: n.kind,
      stage: n.stage,
      stage_order: n.stageOrder,
      stage_total: n.stageTotal,
      stamp_version: n.stampVersion,
      layout_version: n.layoutVersion,
      title: n.title,
      message: n.message,
      note: n.note ?? null,
    });
  } catch (e) {
    console.error("notification insert failed", e);
  }
}


/** Geometry of a stage slot on the approval sheet (null for non-signing stages). */
// deno-lint-ignore no-explicit-any
function slotBox(page: any, stage: string, stages: StageLayout[]) {
  const idx = stages.findIndex((s) => s.stage === stage);
  if (idx < 0) return null;
  const { width, height } = page.getSize();
  let y = height - SHEET_TOP_OFFSET;
  for (let i = 0; i <= idx; i++) {
    y -= stages[i].slot_height;
    if (i < idx) y -= SLOT_GAP;
  }
  return { x: 40, y, w: width - 80, h: stages[idx].slot_height };
}

/** One-line archival footer written at the very bottom of the approval sheet. */
// deno-lint-ignore no-explicit-any
function drawArchivalFooter(page: any, font: any, text: string) {
  const { width } = page.getSize();
  page.drawLine({ start: { x: 40, y: 62 }, end: { x: width - 40, y: 62 }, thickness: 0.6, color: rgb(0.6, 0.6, 0.6) });
  page.drawText(text, { x: 40, y: 48, size: 7.5, font, color: rgb(0.35, 0.35, 0.35) });
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
    const layout = await loadLayout(supabase);
    const stageCfg = layout.stages.find((s) => s.stage === stage) || null;
    const stageOrder = stageCfg?.order ?? layout.stages.length + 1;
    const stageTitle = stageCfg?.title ?? `${stageOrder}. ARCHIVED BY INTERNAL QUALITY ASSURANCE`;

    // Resolve a STABLE date for this stage so re-exports always render the same text
    const stageDateIso: string | null =
      stage === "HOD" ? (doc.verified_by_hod_at ?? doc.hod_approved_at ?? null)
      : stage === "IQA_REVIEW" ? (doc.iqa_reviewed_at ?? null)
      : stage === "DP" ? (doc.approved_by_dp_academics_at ?? doc.dp_approved_at ?? null)
      : (doc.archived_at ?? null);
    const stageDate = stageDateIso ? new Date(stageDateIso) : new Date();

    // Text-only quick approval: write the stage block on the shared approval sheet
    if (mode === "TEXT_ONLY") {
      const pagesBefore = pdfDoc.getPageCount();
      const { page: sheet, created: sheetCreated } = ensureApprovalSheet(pdfDoc, helvBold, helv, layout);
      const box = slotBox(sheet, stage, layout.stages);
      if (box) {
        sheet.drawRectangle({
          x: box.x, y: box.y, width: box.w, height: box.h,
          borderColor: rgb(0.15, 0.35, 0.6), borderWidth: 1,
          color: rgb(0.96, 0.98, 1), opacity: 0.9,
        });
        let ty = box.y + box.h - 20;
        sheet.drawText(stageTitle, { x: box.x + 14, y: ty, size: stageCfg?.title_size ?? 10, font: helvBold, color: rgb(0.1, 0.25, 0.5) });
        ty -= 26;
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
      } else {
        drawArchivalFooter(
          sheet, helv,
          `Archived by Internal Quality Assurance — ${approverName || "IQA"} · ${stageDate.toLocaleString()} · layout ${layout.name} v${layout.version} · stamp v${STAMP_VERSION}`,
        );
      }

      const stampedBytes = await pdfDoc.save();
      const newPath = `${doc.trainer_id}/${doc.assignment_id || "unassigned"}/stamped_${stage}_${Date.now()}.pdf`;
      const { error: uploadErr } = await supabase.storage
        .from("documents").upload(newPath, stampedBytes, { contentType: "application/pdf", upsert: false });
      if (uploadErr) throw uploadErr;
      await logStampOperation(supabase, {
        stamp_version: STAMP_VERSION,
        layout_name: layout.name,
        layout_version: layout.version,
        stage,
        stage_order: stageOrder,
        stage_total: layout.stages.length,
        stage_label: STAGE_LABEL[stage],
        mode: "TEXT_ONLY",
        approver_name: approverName,
        approval_sheet_page: pdfDoc.getPageCount(),
        approval_sheet_appended: sheetCreated,
        pages_before: pagesBefore,
        pages_after: pdfDoc.getPageCount(),
        target: box ? "APPROVAL_SHEET" : "ARCHIVAL_FOOTER",
        slot_index: box ? stageOrder - 1 : null,
        signature_embedded: false,
        stamp_embedded: false,
        source_path: sourceRef.path,
        output_path: newPath,
        stamped_at: stageDate.toISOString(),
      }, documentId, callerId);
      await recordStampMeta(supabase, documentId, `${layout.name} v${layout.version}`, stageOrder);
      await notifyTrainer(supabase, {
        userId: doc.trainer_id,
        documentId,
        kind: "APPROVED",
        stage,
        stageOrder,
        stageTotal: layout.stages.length,
        stampVersion: STAMP_VERSION,
        layoutVersion: `${layout.name} v${layout.version}`,
        title: `${STAGE_LABEL[stage]} signed "${doc.file_name || doc.document_type}"`,
        message: `Stage ${stageOrder} of ${layout.stages.length} (${STAGE_LABEL[stage]}) completed by ${approverName || "an approver"} using stamp v${STAMP_VERSION} / layout ${layout.name} v${layout.version}. ${NEXT_STAGE_NOTE[stage] || ""}`,
      });
      return new Response(JSON.stringify({ signedFileUrl: newPath, stampVersion: STAMP_VERSION, layoutVersion: `${layout.name} v${layout.version}`, stageOrder }), {
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

    const pagesBefore = pdfDoc.getPageCount();
    let sheetCreated = false;
    let targetPageIndex = pagesBefore;
    const pages = pdfDoc.getPages();
    const useCustom = placement && (placement.sigX != null || placement.stampX != null);
    const autofill = placement?.autofill ?? true;

    if (useCustom) {
      const pageIdx = Math.max(0, Math.min(pages.length - 1, (placement!.page ?? pages.length) - 1));
      targetPageIndex = pageIdx + 1;
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
      const ensured = ensureApprovalSheet(pdfDoc, helvBold, helv, layout);
      const sheet = ensured.page;
      sheetCreated = ensured.created;
      targetPageIndex = pdfDoc.getPageCount();
      const box = slotBox(sheet, stage, layout.stages);

      if (!box) {
        // IQAO archival has no signing slot — record it as the sheet footer.
        drawArchivalFooter(
          sheet, helv,
          `Archived by Internal Quality Assurance — ${approverName || "IQA"} · ${stageDate.toLocaleString()} · layout ${layout.name} v${layout.version} · stamp v${STAMP_VERSION}`,
        );
      } else {
        sheet.drawRectangle({
          x: box.x, y: box.y, width: box.w, height: box.h,
          borderColor: rgb(0.15, 0.35, 0.6), borderWidth: 1,
          color: rgb(0.98, 0.99, 1), opacity: 0.9,
        });
        sheet.drawText(stageTitle, {
          x: box.x + 14, y: box.y + box.h - 20, size: stageCfg?.title_size ?? 10, font: helvBold, color: rgb(0.1, 0.25, 0.5),
        });

        // Keep every mark inside its own slot so stages can never overlap.
        const maxSigW = Math.min(stageCfg?.sig_w ?? SIG_W, box.w * 0.5);
        const maxSigH = Math.min(stageCfg?.sig_h ?? SIG_H, box.h - 110);
        const maxStamp = Math.min(stageCfg?.stamp_size ?? STAMP_W, box.h - 60);
        const sigDims = sigImage.scaleToFit(maxSigW, maxSigH);
        const stampDims = stampImage ? stampImage.scaleToFit(maxStamp, maxStamp) : { width: maxStamp, height: maxStamp };
        const sigX = box.x + 14;
        const sigY = box.y + box.h - 34 - sigDims.height;
        const lineY = sigY - 6;

        if (autofill) {
          sheet.drawImage(sigImage, { x: sigX, y: sigY, width: sigDims.width, height: sigDims.height });
          sheet.drawLine({ start: { x: sigX, y: lineY }, end: { x: sigX + Math.max(sigDims.width, 180), y: lineY }, thickness: 0.6 });
          sheet.drawText(`Name: ${approverName}`, { x: sigX, y: lineY - 15, size: 9, font: helv });
          sheet.drawText(`Role: ${STAGE_LABEL[stage]}`, { x: sigX, y: lineY - 29, size: 9, font: helv });
          sheet.drawText(`Date: ${stageDate.toLocaleDateString()} · ${stageDate.toLocaleTimeString()}`, {
            x: sigX, y: lineY - 43, size: 7.5, font: helv, color: rgb(0.35, 0.35, 0.35),
          });
          if (stampImage) {
            sheet.drawImage(stampImage, {
              x: box.x + box.w - stampDims.width - 24,
              y: box.y + (box.h - 30 - stampDims.height) / 2,
              width: stampDims.width,
              height: stampDims.height,
            });
          }
        } else {
          sheet.drawText('Sign: ______________________________', { x: sigX, y: box.y + box.h - 55, size: 9, font: helv });
          sheet.drawText('Name: ______________________________', { x: sigX, y: box.y + box.h - 80, size: 9, font: helv });
          sheet.drawText('Date: ______________________________', { x: sigX, y: box.y + box.h - 105, size: 9, font: helv });
          if (stampImage) {
            const cx = box.x + box.w - 70, cy = box.y + box.h / 2;
            sheet.drawCircle({ x: cx, y: cy, size: Math.min(35, box.h / 2 - 20), borderWidth: 1, borderColor: rgb(0.3, 0.3, 0.3) });
            sheet.drawText('STAMP', { x: cx - 14, y: cy - 3, size: 8, font: helvBold, color: rgb(0.4, 0.4, 0.4) });
          }
        }
      }
    }


    const stampedBytes = await pdfDoc.save();

    const newPath = `${doc.trainer_id}/${doc.assignment_id || "unassigned"}/stamped_${stage}_${Date.now()}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from("documents")
      .upload(newPath, stampedBytes, { contentType: "application/pdf", upsert: false });
    if (uploadErr) throw uploadErr;

    await logStampOperation(supabase, {
      stamp_version: STAMP_VERSION,
      layout_name: layout.name,
      layout_version: layout.version,
      stage,
      stage_order: stageOrder,
      stage_total: layout.stages.length,
      stage_label: STAGE_LABEL[stage],
      mode: "IMAGE",
      approver_name: approverName,
      target: useCustom ? "IN_PLACE" : (stageCfg ? "APPROVAL_SHEET" : "ARCHIVAL_FOOTER"),
      slot_index: useCustom || !stageCfg ? null : stageOrder - 1,
      page_index: targetPageIndex,
      approval_sheet_appended: sheetCreated,
      pages_before: pagesBefore,
      pages_after: pdfDoc.getPageCount(),
      signature_embedded: true,
      stamp_embedded: !!stampImage,
      autofill,
      source_path: sourceRef.path,
      output_path: newPath,
      stamped_at: stageDate.toISOString(),
    }, documentId, callerId);
    await recordStampMeta(supabase, documentId, `${layout.name} v${layout.version}`, stageOrder);
    await notifyTrainer(supabase, {
      userId: doc.trainer_id,
      documentId,
      kind: "APPROVED",
      stage,
      stageOrder,
      stageTotal: layout.stages.length,
      stampVersion: STAMP_VERSION,
      layoutVersion: `${layout.name} v${layout.version}`,
      title: `${STAGE_LABEL[stage]} signed "${doc.file_name || doc.document_type}"`,
      message: `Stage ${stageOrder} of ${layout.stages.length} (${STAGE_LABEL[stage]}) completed by ${approverName || "an approver"} using stamp v${STAMP_VERSION} / layout ${layout.name} v${layout.version}. ${NEXT_STAGE_NOTE[stage] || ""}`,
    });

    // Bucket is private — return the bare path. The client uses parseStorageRef
    // and createSignedUrl to build a fresh preview URL each time.
    return new Response(
      JSON.stringify({ signedFileUrl: newPath, stampVersion: STAMP_VERSION, layoutVersion: `${layout.name} v${layout.version}`, stageOrder }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (e) {
    console.error("stamp-document error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
