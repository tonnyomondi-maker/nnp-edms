import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { PDFDocument } from "npm:pdf-lib@1.17.1";

interface Placement {
  page?: number | null;
  sigX?: number | null;
  sigY?: number | null;
  sigW?: number | null;
  sigH?: number | null;
  stampX?: number | null;
  stampY?: number | null;
  stampW?: number | null;
  stampH?: number | null;
}
interface StampRequest {
  documentId: string;
  stage: "HOD" | "DP" | "IQA";
  signatureUrl: string;
  stampUrl: string;
  approverName: string;
  placement?: Placement | null;
}

const SIG_W = 140, SIG_H = 50, STAMP_W = 90, STAMP_H = 90;

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
  const res = await fetch(url);
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
    const { documentId, stage, signatureUrl, stampUrl, approverName, placement } = body;
    if (!documentId || !stage || !signatureUrl || !stampUrl) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
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

    // Signature & stamp images are stored in a public bucket — direct fetch is fine
    const [sig, stamp] = await Promise.all([
      fetchAsArrayBuffer(signatureUrl),
      fetchAsArrayBuffer(stampUrl),
    ]);

    const pdfDoc = await PDFDocument.load(pdfBytes);

    const embedImage = async (bytes: ArrayBuffer, contentType: string | null) => {
      const isPng = (contentType || "").includes("png") || new Uint8Array(bytes)[0] === 0x89;
      return isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
    };
    const sigImage = await embedImage(sig.buffer, sig.contentType);
    const stampImage = await embedImage(stamp.buffer, stamp.contentType);

    const pages = pdfDoc.getPages();
    const useCustom = placement && (placement.sigX != null || placement.stampX != null);

    if (useCustom) {
      const pageIdx = Math.max(0, Math.min(pages.length - 1, (placement!.page ?? pages.length) - 1));
      const page = pages[pageIdx];
      const { width, height } = page.getSize();

      const sigBoxW = (placement!.sigW != null ? placement!.sigW * width : SIG_W);
      const sigBoxH = (placement!.sigH != null ? placement!.sigH * height : SIG_H);
      const stampBoxW = (placement!.stampW != null ? placement!.stampW * width : STAMP_W);
      const stampBoxH = (placement!.stampH != null ? placement!.stampH * height : STAMP_H);

      const sigDims = sigImage.scaleToFit(sigBoxW, sigBoxH);
      const stampDims = stampImage.scaleToFit(stampBoxW, stampBoxH);

      if (placement!.sigX != null && placement!.sigY != null) {
        const x = placement!.sigX * width;
        const y = height - placement!.sigY * height - sigDims.height;
        page.drawImage(sigImage, { x, y, width: sigDims.width, height: sigDims.height });
        page.drawText(`${stage} — ${approverName}`, { x, y: y - 12, size: 8 });
        page.drawText(new Date().toLocaleString(), { x, y: y - 22, size: 7 });
      }
      if (placement!.stampX != null && placement!.stampY != null) {
        const x = placement!.stampX * width;
        const y = height - placement!.stampY * height - stampDims.height;
        page.drawImage(stampImage, { x, y, width: stampDims.width, height: stampDims.height });
      }
    } else {
      const lastPage = pages[pages.length - 1];
      const stageOffset: Record<string, number> = { HOD: 0, DP: 1, IQA: 2 };
      const offsetY = stageOffset[stage] * 110;
      const sigDims = sigImage.scaleToFit(SIG_W, SIG_H);
      const stampDims = stampImage.scaleToFit(STAMP_W, STAMP_H);
      const baseY = 60 + offsetY;
      lastPage.drawText(`${stage} APPROVAL — ${approverName}`, { x: 40, y: baseY + 95, size: 9 });
      lastPage.drawImage(sigImage, { x: 40, y: baseY + 40, width: sigDims.width, height: sigDims.height });
      lastPage.drawImage(stampImage, { x: 200, y: baseY + 10, width: stampDims.width, height: stampDims.height });
      lastPage.drawText(new Date().toLocaleString(), { x: 40, y: baseY + 25, size: 8 });
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
