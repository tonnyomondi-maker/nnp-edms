// Builds spreadsheet-friendly CSV exports of the stamping / audit trail for
// one or many documents, straight from the audit_logs table.

import { supabase } from '@/integrations/supabase/client';

export interface AuditCsvOptions {
  documentIds: string[];
}

const HEADERS = [
  'timestamp',
  'document_id',
  'file_name',
  'action',
  'old_status',
  'new_status',
  'stage',
  'stage_order',
  'stage_total',
  'stamp_version',
  'layout_version',
  'mode',
  'pages_before',
  'pages_after',
  'performed_by_name',
  'performed_by_email',
  'details',
];

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

type Details = Record<string, unknown> | null;

/** Fetch every audit event for the given documents and return CSV text. */
export async function buildAuditCsv({ documentIds }: AuditCsvOptions): Promise<string> {
  if (documentIds.length === 0) return HEADERS.join(',');

  const { data: logs, error } = await supabase
    .from('audit_logs')
    .select('*')
    .in('document_id', documentIds)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const rows = (logs || []) as unknown as {
    id: string;
    created_at: string;
    document_id: string | null;
    action: string;
    performed_by: string | null;
    details: Details;
  }[];

  const actorIds = Array.from(new Set(rows.map((r) => r.performed_by).filter(Boolean))) as string[];
  const actorMap = new Map<string, { full_name: string; email: string }>();
  if (actorIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, full_name, email')
      .in('user_id', actorIds);
    (profiles || []).forEach((p: { user_id: string; full_name: string; email: string }) =>
      actorMap.set(p.user_id, { full_name: p.full_name, email: p.email }),
    );
  }

  const { data: docs } = await supabase
    .from('documents')
    .select('id, file_name')
    .in('id', documentIds);
  const nameMap = new Map<string, string>(
    ((docs || []) as { id: string; file_name: string }[]).map((d) => [d.id, d.file_name]),
  );

  const known = new Set([
    'old_status', 'new_status', 'stage', 'stage_order', 'stage_total',
    'stamp_version', 'layout_version', 'mode', 'pages_before', 'pages_after',
  ]);

  const lines = [HEADERS.join(',')];
  rows.forEach((r) => {
    const d = (r.details || {}) as Record<string, unknown>;
    const rest: Record<string, unknown> = {};
    Object.keys(d).forEach((k) => { if (!known.has(k)) rest[k] = d[k]; });
    const actor = r.performed_by ? actorMap.get(r.performed_by) : undefined;
    lines.push([
      r.created_at,
      r.document_id,
      r.document_id ? nameMap.get(r.document_id) ?? '' : '',
      r.action,
      d.old_status, d.new_status, d.stage, d.stage_order, d.stage_total,
      d.stamp_version, d.layout_version, d.mode, d.pages_before, d.pages_after,
      actor?.full_name ?? '', actor?.email ?? '',
      Object.keys(rest).length ? rest : '',
    ].map(escapeCell).join(','));
  });

  return lines.join('\n');
}

export function downloadCsv(csv: string, fileName: string) {
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
