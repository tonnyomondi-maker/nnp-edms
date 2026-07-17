// Per-document audit timeline: pack membership, verifier opens/downloads, reviews, reminders.

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, PackageCheck, PackageX, UserPlus, Eye, Download, MessageSquare, Bell, CircleDot } from 'lucide-react';

interface Event { ts: string; kind: string; meta: Record<string, unknown>; }

const iconFor = (k: string) => {
  switch (k) {
    case 'pack_created': return PackageCheck;
    case 'pack_revoked': return PackageX;
    case 'verifier_assigned': return UserPlus;
    case 'pack_opened':
    case 'pack_opened_log': return Eye;
    case 'pack_downloaded': return Download;
    case 'review_submitted': return MessageSquare;
    case 'reminder_sent':
    case 'verifier_reminder_sent': return Bell;
    default: return CircleDot;
  }
};

const labelFor = (k: string) => ({
  pack_created: 'Pack created',
  pack_revoked: 'Pack revoked',
  verifier_assigned: 'Verifier assigned',
  pack_opened: 'Verifier opened',
  pack_opened_log: 'Pack opened',
  pack_downloaded: 'Pack downloaded',
  review_submitted: 'Review submitted',
  reminder_sent: 'Reminder sent',
}[k] || k);

export function DocumentAuditTimeline({ documentId }: { documentId: string }) {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      // deno-lint-ignore no-explicit-any
      const { data, error } = await (supabase as any).rpc('document_pack_timeline', { _document_id: documentId });
      setLoading(false);
      if (error) { setErr(error.message); return; }
      setEvents((data as Event[]) || []);
    })();
  }, [documentId]);

  if (loading) return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />;
  if (err) return <p className="text-xs text-destructive">{err}</p>;
  if (events.length === 0) return <p className="text-xs text-muted-foreground">No pack activity yet.</p>;

  return (
    <ol className="space-y-2 border-l pl-3">
      {events.map((e, i) => {
        const Icon = iconFor(e.kind);
        const meta = e.meta || {};
        const who = (meta.verifier_name as string) || (meta.verifier_email as string) || '';
        return (
          <li key={i} className="relative text-xs">
            <span className="absolute -left-[18px] top-0.5 bg-background rounded-full p-0.5">
              <Icon className="w-3 h-3 text-primary" />
            </span>
            <div className="flex flex-wrap gap-x-2">
              <span className="font-medium">{labelFor(e.kind)}</span>
              {who && <span className="text-muted-foreground">· {who}</span>}
              {meta.decision != null && <span className="text-muted-foreground">· {String(meta.decision)}</span>}
              <span className="ml-auto text-muted-foreground">{new Date(e.ts).toLocaleString()}</span>
            </div>
            {meta.notes != null && String(meta.notes).length > 0 && (
              <p className="text-muted-foreground italic mt-0.5">"{String(meta.notes)}"</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
