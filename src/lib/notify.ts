// In-app notification helpers. Every approval / rejection / return notice
// carries the stamp version and stage order so the recipient can trace exactly
// what changed on their document.

import { supabase } from '@/integrations/supabase/client';
import { logSecurityEvent, isPermissionDenied } from '@/lib/securityEvents';

/** Keep in sync with STAMP_VERSION in supabase/functions/stamp-document. */
export const CLIENT_STAMP_VERSION = '3.0.0';

/** Signing stages on the approval sheet, in order. IQAO archival is stage 4 (footer only). */
export const STAGE_ORDER: Record<string, number> = { HOD: 1, IQA_REVIEW: 2, DP: 3, IQA: 4 };
export const SIGNING_STAGE_TOTAL = 3;

export const STAGE_LABEL: Record<string, string> = {
  HOD: 'Head of Department',
  IQA_REVIEW: 'IQAO — Internal Quality Assurance Officer',
  DP: 'Deputy Principal — Academics',
  IQA: 'IQAO Archival',
};

export type NotificationKind = 'APPROVED' | 'REJECTED' | 'RETURNED';

export interface NotifyInput {
  userId: string;
  documentId: string;
  kind: NotificationKind;
  stage: string;
  title: string;
  message: string;
  note?: string | null;
  layoutVersion?: string | null;
  stampVersion?: string | null;
}

export async function notifyDocumentEvent(input: NotifyInput) {
  try {
    const { error } = await supabase.from('notifications' as never).insert({
      user_id: input.userId,
      document_id: input.documentId,
      kind: input.kind,
      stage: input.stage,
      stage_order: STAGE_ORDER[input.stage] ?? null,
      stage_total: SIGNING_STAGE_TOTAL,
      stamp_version: input.stampVersion ?? CLIENT_STAMP_VERSION,
      layout_version: input.layoutVersion ?? null,
      title: input.title,
      message: input.message,
      note: input.note ?? null,
    } as never);
    if (isPermissionDenied(error)) {
      await logSecurityEvent({
        action: 'DENIED_NOTIFICATION_INSERT',
        targetTable: 'notifications',
        targetId: input.documentId,
        reason: error?.message ?? 'Blocked by access policy',
        details: { target_user_id: input.userId, kind: input.kind, stage: input.stage },
      });
    }
  } catch {
    /* notifications are best-effort — never block the workflow */
  }
}

/** Maps the status a document is sitting at to the stage acting on it. */
export function stageForStatus(status: string): string {
  switch (status) {
    case 'SUBMITTED': return 'HOD';
    case 'HOD_APPROVED': return 'IQA_REVIEW';
    case 'IQA_REVIEWED': return 'DP';
    case 'DP_APPROVED': return 'IQA';
    default: return 'HOD';
  }
}
