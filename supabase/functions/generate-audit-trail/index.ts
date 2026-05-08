import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

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

    const { documentId } = await req.json();
    if (!documentId) {
      return new Response(JSON.stringify({ error: "Missing documentId" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: doc, error: docErr } = await supabase
      .from("documents")
      .select("*, teaching_assignments(*)")
      .eq("id", documentId)
      .single();
    if (docErr || !doc) throw new Error("Document not found");

    const userIds = [doc.trainer_id, doc.hod_approved_by, doc.dp_approved_by, doc.iqa_archived_by]
      .filter((x): x is string => !!x);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, full_name, email, pf_number, department")
      .in("user_id", userIds);
    const profById = new Map((profiles || []).map((p) => [p.user_id, p]));

    const { data: auditLogs } = await supabase
      .from("audit_logs")
      .select("*")
      .eq("document_id", documentId)
      .order("created_at", { ascending: true });

    // Pull role/department audit for the trainer
    const { data: roleAudit } = await supabase
      .from("role_change_audit")
      .select("*")
      .eq("target_user_id", doc.trainer_id)
      .eq("action", "DEPARTMENT_CHANGED")
      .order("created_at", { ascending: true })
      .limit(50);

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    let page = pdfDoc.addPage([595, 842]); // A4
    const { width, height } = page.getSize();
    let y = height - 50;

    const drawLine = (text: string, opts: { size?: number; bold?: boolean; color?: [number, number, number] } = {}) => {
      const size = opts.size ?? 10;
      const f = opts.bold ? fontBold : font;
      const color = opts.color ?? [0, 0, 0];
      if (y < 60) { page = pdfDoc.addPage([595, 842]); y = height - 50; }
      page.drawText(text, { x: 50, y, size, font: f, color: rgb(color[0], color[1], color[2]) });
      y -= size + 6;
    };
    const sep = () => { y -= 6; page.drawLine({ start: { x: 50, y }, end: { x: width - 50, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) }); y -= 10; };

    drawLine("DOCUMENT AUDIT TRAIL", { size: 18, bold: true });
    drawLine(`Generated: ${new Date().toLocaleString()}`, { size: 9, color: [0.4, 0.4, 0.4] });
    sep();

    drawLine("Document", { size: 12, bold: true });
    drawLine(`Type: ${doc.document_type}`);
    drawLine(`Department: ${doc.department}`);
    drawLine(`Status: ${doc.status}`);
    if (doc.week_number) drawLine(`Week: ${doc.week_number}`);
    if (doc.teaching_assignments) {
      drawLine(`Unit: ${doc.teaching_assignments.unit_code} — ${doc.teaching_assignments.unit_name}`);
      drawLine(`Class: ${doc.teaching_assignments.class_code}`);
    }
    drawLine(`File: ${doc.file_name}`, { size: 9 });
    drawLine(`Document ID: ${doc.id}`, { size: 8, color: [0.5, 0.5, 0.5] });
    sep();

    drawLine("Approval Chain", { size: 12, bold: true });

    const trainerProf = profById.get(doc.trainer_id);
    drawLine("1. Submitted by Trainer", { bold: true });
    drawLine(`   Name: ${trainerProf?.full_name || "—"}`);
    if (trainerProf?.pf_number) drawLine(`   PF Number: ${trainerProf.pf_number}`);
    drawLine(`   Email: ${trainerProf?.email || "—"}`);
    drawLine(`   Submitted: ${new Date(doc.submitted_at).toLocaleString()}`);
    y -= 4;

    const stageInfo = (
      label: string,
      approvedAt: string | null,
      approverId: string | null,
    ) => {
      drawLine(label, { bold: true });
      if (!approvedAt) {
        drawLine("   (pending)", { color: [0.6, 0.6, 0.6] });
      } else {
        const p = approverId ? profById.get(approverId) : null;
        drawLine(`   Name: ${p?.full_name || "—"}`);
        if (p?.pf_number) drawLine(`   PF Number: ${p.pf_number}`);
        drawLine(`   Email: ${p?.email || "—"}`);
        drawLine(`   Timestamp: ${new Date(approvedAt).toLocaleString()}`);
      }
      y -= 4;
    };

    stageInfo("2. HOD Approval", doc.hod_approved_at, doc.hod_approved_by);
    stageInfo("3. DP Academics Approval", doc.dp_approved_at, doc.dp_approved_by);
    stageInfo("4. IQA Archive", doc.archived_at, doc.iqa_archived_by);

    if (doc.status === "REJECTED" && doc.rejection_reason) {
      sep();
      drawLine("Rejection Reason", { size: 12, bold: true, color: [0.7, 0, 0] });
      // wrap simple
      const words = doc.rejection_reason.split(/\s+/);
      let line = "";
      for (const w of words) {
        if ((line + " " + w).length > 80) {
          drawLine(line);
          line = w;
        } else line = line ? `${line} ${w}` : w;
      }
      if (line) drawLine(line);
    }

    sep();
    drawLine("Activity Log", { size: 12, bold: true });
    if (auditLogs && auditLogs.length > 0) {
      for (const log of auditLogs) {
        const details = (log.details ?? {}) as Record<string, unknown>;
        const summary = details.old_status && details.new_status
          ? `${details.old_status} → ${details.new_status}`
          : log.action;
        drawLine(`• ${new Date(log.created_at).toLocaleString()} — ${summary}`, { size: 9 });
      }
    } else {
      drawLine("(no log entries)", { size: 9, color: [0.6, 0.6, 0.6] });
    }

    const bytes = await pdfDoc.save();
    return new Response(bytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="audit-trail-${documentId}.pdf"`,
      },
    });
  } catch (e) {
    console.error("generate-audit-trail error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
