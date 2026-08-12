// Client-side PDF generation for submission reports.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import logoUrl from '@/assets/polytechnic-logo.jpg';
import type { TrainerCoverage, MissingRow, DeptCoverage, FlowStats } from '@/lib/reportMetrics';

interface Args {
  sessionTitle: string;
  scopeLabel: string;
  generatedBy: string;
  perTrainer: TrainerCoverage[];
  missing: MissingRow[];
  deptRows: DeptCoverage[];
  flow: FlowStats;
  onProgress?: (step: string) => void;
}

let cachedLogo: string | null = null;

async function loadLogo(): Promise<string | null> {
  if (cachedLogo !== null) return cachedLogo;
  try {
    const res = await fetch(logoUrl);
    const blob = await res.blob();
    cachedLogo = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    return cachedLogo;
  } catch {
    return null;
  }
}

export async function exportReportPdf({
  sessionTitle, scopeLabel, generatedBy, perTrainer, missing, deptRows, flow, onProgress,
}: Args) {
  onProgress?.('Preparing report');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  onProgress?.('Adding institution branding');
  const logo = await loadLogo();
  if (logo) {
    try { doc.addImage(logo, 'JPEG', 40, 24, 52, 52); } catch { /* non-fatal */ }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('Nyamira National Polytechnic', pageWidth / 2, 46, { align: 'center' });
  doc.setFontSize(12);
  doc.text('Electronic Document Management System — Submission Report', pageWidth / 2, 64, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Training session: ${sessionTitle}`, 40, 92);
  doc.text(`Scope: ${scopeLabel}`, 40, 105);
  doc.text(`Generated: ${new Date().toLocaleString()} by ${generatedBy}`, 40, 118);
  onProgress?.('Building tables');


  const expected = perTrainer.reduce((s, r) => s + r.expected, 0);
  const covered = perTrainer.reduce((s, r) => s + r.covered, 0);
  const pct = expected > 0 ? Math.round((covered / expected) * 100) : 0;
  const submitting = perTrainer.filter((r) => r.covered > 0).length;

  autoTable(doc, {
    startY: 128,
    head: [['Trainers', 'Trainers submitting', 'Documents on file', 'Coverage', 'Rejected now']],
    body: [[
      String(perTrainer.length),
      String(submitting),
      `${covered} / ${expected}`,
      `${pct}%`,
      String(flow.counts.rejected),
    ]],
    theme: 'grid',
    styles: { fontSize: 9 },
    headStyles: { fillColor: [23, 64, 122] },
  });

  const afterY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  const section = (title: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(title, 40, afterY() + 26);
    doc.setFont('helvetica', 'normal');
  };

  section('Coverage per trainer');
  autoTable(doc, {
    startY: afterY() + 34,
    head: [['Trainer', 'Department', 'Units', 'On file', 'Coverage', 'Awaiting', 'Approved', 'Needs correction']],
    body: perTrainer.map((r) => [
      r.name, r.department, String(r.units), `${r.covered}/${r.expected}`, `${r.pct}%`,
      String(r.pending), String(r.approved), String(r.rejectedTypes),
    ]),
    theme: 'striped',
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [23, 64, 122] },
  });

  section('Coverage per department');
  autoTable(doc, {
    startY: afterY() + 34,
    head: [['Department', 'Trainers', 'Units', 'On file', 'Coverage']],
    body: deptRows.map((d) => [d.dept, String(d.trainers), String(d.units), `${d.covered}/${d.expected}`, `${d.pct}%`]),
    theme: 'striped',
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [23, 64, 122] },
  });

  doc.addPage();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Missing documents per unit', 40, 48);
  doc.setFont('helvetica', 'normal');
  autoTable(doc, {
    startY: 58,
    head: [['Trainer', 'Department', 'Unit', 'Missing document types']],
    body: missing.length
      ? missing.map((m) => [m.trainer, m.department, m.unit, m.missing.join(', ')])
      : [['—', '—', '—', 'No missing documents']],
    theme: 'striped',
    styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: [23, 64, 122] },
  });

  section('Workflow stages');
  autoTable(doc, {
    startY: afterY() + 34,
    head: [['Stage', 'Average turnaround', 'Documents measured']],
    body: flow.stages.map((s) => [s.label, s.avg !== null ? `${s.avg.toFixed(1)} h` : 'No data', String(s.count)]),
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [23, 64, 122] },
  });

  onProgress?.('Finalising document');
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.text(`Page ${i} of ${pages}`, pageWidth - 40, doc.internal.pageSize.getHeight() - 20, { align: 'right' });
  }

  doc.save(`EDMS-report-${sessionTitle.replace(/\s+/g, '-')}.pdf`);
}
