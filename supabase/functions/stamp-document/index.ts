import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { PDFDocument } from "npm:pdf-lib@1.17.1";

interface StampRequest {
  documentId: string;
  stage: "HOD" | "DP" | "IQA";
  signatureUrl: string;
  stampUrl: string;
  approverName: string;
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
    const { documentId, stage, signatureUrl, stampUrl, approverName } = body;
    if (!documentId || !stage || !signatureUrl || !stampUrl) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch existing document
    const { data: doc, error: docErr } = await supabase
      .from("documents").select("*").eq("id", documentId).single();
    if (docErr || !doc) throw new Error("Document not found");

    const sourceUrl = doc.signed_file_url || doc.file_url;
    if (!sourceUrl) throw new Error("Document has no file");

    // Fetch PDF + images
    const [pdfRes, sigRes, stampRes] = await Promise.all([
      fetch(sourceUrl), fetch(signatureUrl), fetch(stampUrl),
    ]);
    const [pdfBytes, sigBytes, stampBytes] = await Promise.all([
      pdfRes.arrayBuffer(), sigRes.arrayBuffer(), stampRes.arrayBuffer(),
    ]);

    const pdfDoc = await PDFDocument.load(pdfBytes);

    const embedImage = async (bytes: ArrayBuffer, contentType: string | null) => {
      const isPng = (contentType || "").includes("png") || new Uint8Array(bytes)[0] === 0x89;
      return isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
    };
    const sigImage = await embedImage(sigBytes, sigRes.headers.get("content-type"));
    const stampImage = await embedImage(stampBytes, stampRes.headers.get("content-type"));

    // Stamp the LAST page in bottom-right area; offset stages so they don't overlap
    const pages = pdfDoc.getPages();
    const lastPage = pages[pages.length - 1];
    const { width, height } = lastPage.getSize();

    const stageOffset: Record<string, number> = { HOD: 0, DP: 1, IQA: 2 };
    const offsetY = stageOffset[stage] * 110;

    const sigDims = sigImage.scaleToFit(140, 50);
    const stampDims = stampImage.scaleToFit(90, 90);

    // Layout: stage label + signature + stamp, stacked from bottom
    const baseY = 60 + offsetY;
    lastPage.drawText(`${stage} APPROVAL — ${approverName}`, {
      x: 40, y: baseY + 95, size: 9,
    });
    lastPage.drawImage(sigImage, {
      x: 40, y: baseY + 40, width: sigDims.width, height: sigDims.height,
    });
    lastPage.drawImage(stampImage, {
      x: 200, y: baseY + 10, width: stampDims.width, height: stampDims.height,
    });
    lastPage.drawText(new Date().toLocaleString(), {
      x: 40, y: baseY + 25, size: 8,
    });

    const stampedBytes = await pdfDoc.save();

    // Upload stamped PDF
    const newPath = `${doc.trainer_id}/${doc.assignment_id}/stamped_${stage}_${Date.now()}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from("documents")
      .upload(newPath, stampedBytes, { contentType: "application/pdf", upsert: false });
    if (uploadErr) throw uploadErr;

    const { data: urlData } = supabase.storage.from("documents").getPublicUrl(newPath);

    return new Response(
      JSON.stringify({ signedFileUrl: urlData.publicUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("stamp-document error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
