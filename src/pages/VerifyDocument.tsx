import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Loader2, Download, ExternalLink, CheckCircle2, Clock } from 'lucide-react';
import { DocPreviewLink } from '@/components/common/DocPreviewLink';
import { toast } from '@/hooks/use-toast';
import type { Tables } from '@/integrations/supabase/types';

type Doc = Tables<'documents'> & { teaching_assignments?: Tables<'teaching_assignments'> | null };
type Profile = Pick<Tables<'profiles'>, 'user_id' | 'full_name' | 'email' | 'pf_number'>;

interface StageProps {
  label: string;
  approvedAt: string | null;
  approver: Profile | null | undefined;
  signatureUrl: string | null | undefined;
  stampUrl: string | null | undefined;
}

function StageRow({ label, approvedAt, approver, signatureUrl, stampUrl }: StageProps) {
  const done = !!approvedAt;
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0">
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${done ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
        {done ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm">{label}</p>
        {done ? (
          <>
            <p className="text-xs text-muted-foreground">{approver?.full_name || '—'}{approver?.pf_number ? ` • PF ${approver.pf_number}` : ''}</p>
            <p className="text-xs text-muted-foreground">{approver?.email}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{new Date(approvedAt!).toLocaleString()}</p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Pending</p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        {signatureUrl && (
          <img src={signatureUrl} alt={`${label} signature`} className="h-8 w-20 object-contain rounded border bg-background" />
        )}
        {stampUrl && (
          <img src={stampUrl} alt={`${label} stamp`} className="h-10 w-10 object-contain rounded border bg-background" />
        )}
      </div>
    </div>
  );
}

export default function VerifyDocument() {
  const { documentId } = useParams<{ documentId: string }>();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!documentId) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('documents')
        .select('*, teaching_assignments(*)')
        .eq('id', documentId)
        .single();
      if (error || !data) {
        toast({ title: 'Not found', description: error?.message || 'Document not accessible', variant: 'destructive' });
        setLoading(false);
        return;
      }
      setDoc(data);
      const ids = [data.trainer_id, data.hod_approved_by, data.dp_approved_by, data.iqa_archived_by].filter((x): x is string => !!x);
      if (ids.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('user_id, full_name, email, pf_number')
          .in('user_id', ids);
        setProfiles(new Map((profs || []).map(p => [p.user_id, p])));
      }
      setLoading(false);
    })();
  }, [documentId]);

  const handleDownloadAudit = async () => {
    if (!documentId) return;
    setDownloading(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-audit-trail', {
        body: { documentId },
      });
      if (error) throw error;
      const blob = data instanceof Blob ? data : new Blob([data as ArrayBuffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-trail-${documentId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({ title: 'Download failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }
  if (!doc) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-muted-foreground">Document not found.</p>
        <Link to="/" className="text-primary text-sm underline mt-2 inline-block">Back home</Link>
      </div>
    );
  }

  const trainer = profiles.get(doc.trainer_id);
  const fileRef = doc.signed_file_url || doc.file_url;

  return (
    <div className="space-y-4">
      <PageHeader title="Document Verification" subtitle="Full approval chain & audit trail" />

      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold">{doc.document_type}</p>
              <p className="text-xs text-muted-foreground">{doc.department}</p>
              {doc.teaching_assignments && (
                <p className="text-xs text-muted-foreground">
                  {doc.teaching_assignments.unit_code} — {doc.teaching_assignments.unit_name} • {doc.teaching_assignments.class_code}
                </p>
              )}
              {doc.week_number && <p className="text-xs text-muted-foreground">Week {doc.week_number}</p>}
            </div>
            <StatusBadge status={doc.status} />
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            {fileRef && <DocPreviewLink fileRef={fileRef} variant="button" label="Open signed PDF" />}
            <Button size="sm" onClick={handleDownloadAudit} disabled={downloading} className="gap-1">
              {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Download audit trail PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <h3 className="font-semibold text-sm mb-1">Approval chain</h3>

          <StageRow
            label="1. Submitted by Trainer"
            approvedAt={doc.submitted_at}
            approver={trainer}
            signatureUrl={null}
            stampUrl={null}
          />
          <StageRow
            label="2. HOD Approval"
            approvedAt={doc.hod_approved_at}
            approver={doc.hod_approved_by ? profiles.get(doc.hod_approved_by) : null}
            signatureUrl={doc.hod_signature_url}
            stampUrl={doc.hod_stamp_url}
          />
          <StageRow
            label="3. DP Academics Approval"
            approvedAt={doc.dp_approved_at}
            approver={doc.dp_approved_by ? profiles.get(doc.dp_approved_by) : null}
            signatureUrl={doc.dp_signature_url}
            stampUrl={doc.dp_stamp_url}
          />
          <StageRow
            label="4. IQA Archive"
            approvedAt={doc.archived_at}
            approver={doc.iqa_archived_by ? profiles.get(doc.iqa_archived_by) : null}
            signatureUrl={doc.iqa_signature_url}
            stampUrl={doc.iqa_stamp_url}
          />

          {doc.status === 'REJECTED' && doc.rejection_reason && (
            <div className="mt-4 p-3 rounded bg-destructive/10 border border-destructive/30">
              <p className="text-xs font-semibold text-destructive">Rejection reason</p>
              <p className="text-sm mt-1">{doc.rejection_reason}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground text-center">Document ID: {doc.id}</p>
    </div>
  );
}
