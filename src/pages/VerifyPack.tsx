// Public landing page for a verifier-pack link. Anonymous — the token in the
// URL is the sole credential. Verifiers can download the ZIP and record
// per-document review decisions (Approved / Query / Rejected + notes).

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Loader2, ShieldCheck, Download, AlertCircle,
  CheckCircle2, HelpCircle, XCircle, Save,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

interface Meta {
  department: string; session_year: number; session_term: string;
  document_count: number; excluded_count: number;
  included_document_types: string[] | null; include_text_only_fallbacks: boolean;
  verifier: { id: string; full_name: string; email: string } | null;
}
interface DocRow {
  id: string; file_name: string | null; document_type: string;
  unit_code: string | null; unit_name: string | null;
  hod_approved_at: string | null; dp_approved_at: string | null;
  archived_at: string | null; text_only: boolean;
}
interface Review {
  document_id: string; decision: 'APPROVED' | 'QUERY' | 'REJECTED';
  notes: string | null; reviewed_at: string; verifier_id: string | null;
}
type Decision = 'APPROVED' | 'QUERY' | 'REJECTED';

export default function VerifyPack() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const verifierId = params.get('v');
  const [meta, setMeta] = useState<Meta | null>(null);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [reviews, setReviews] = useState<Record<string, Review>>({});
  const [drafts, setDrafts] = useState<Record<string, { decision: Decision | ''; notes: string }>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!token) { setError('Missing token'); setLoading(false); return; }
    (async () => {
      try {
        const qs = `token=${encodeURIComponent(token)}${verifierId ? `&v=${verifierId}` : ''}`;
        const [mRes, lRes] = await Promise.all([
          fetch(`${SUPABASE_URL}/functions/v1/download-verification-pack?${qs}&meta=1`),
          fetch(`${SUPABASE_URL}/functions/v1/download-verification-pack?${qs}&list=1`),
        ]);
        const mData = await mRes.json();
        if (!mRes.ok) throw new Error(mData.error || 'Invalid link');
        setMeta(mData);
        const lData = await lRes.json();
        if (lRes.ok) {
          setDocs(lData.documents || []);
          const rmap: Record<string, Review> = {};
          const dmap: Record<string, { decision: Decision | ''; notes: string }> = {};
          ((lData.reviews as Review[]) || []).forEach((r) => {
            // Prefer this verifier's own review if v is set; else last write wins
            if (!verifierId || r.verifier_id === verifierId) rmap[r.document_id] = r;
          });
          (lData.documents as DocRow[] || []).forEach((d) => {
            const existing = rmap[d.id];
            dmap[d.id] = { decision: existing?.decision ?? '', notes: existing?.notes ?? '' };
          });
          setReviews(rmap);
          setDrafts(dmap);
        }
      } catch (e) { setError((e as Error).message); }
      finally { setLoading(false); }
    })();
  }, [token, verifierId]);

  const startDownload = () => {
    setDownloading(true);
    const qs = `token=${encodeURIComponent(token)}${verifierId ? `&v=${verifierId}` : ''}`;
    window.location.href = `${SUPABASE_URL}/functions/v1/download-verification-pack?${qs}`;
    setTimeout(() => setDownloading(false), 4000);
  };

  const setDraft = (id: string, patch: Partial<{ decision: Decision | ''; notes: string }>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] || { decision: '', notes: '' }), ...patch } }));
  };

  const saveReview = async (id: string) => {
    const d = drafts[id];
    if (!d || !d.decision) { toast.error('Choose a decision first'); return; }
    setSaving((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/verifier-review-submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token, verifier_id: verifierId || null,
          document_id: id, decision: d.decision, notes: d.notes,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Save failed');
      setReviews((prev) => ({
        ...prev,
        [id]: { document_id: id, decision: d.decision as Decision, notes: d.notes, reviewed_at: new Date().toISOString(), verifier_id: verifierId },
      }));
      toast.success('Review saved');
    } catch (e) {
      toast.error('Save failed', { description: (e as Error).message });
    } finally { setSaving((prev) => ({ ...prev, [id]: false })); }
  };

  const decisionButton = (id: string, val: Decision, Icon: typeof CheckCircle2, label: string, tone: string) => (
    <Button
      type="button"
      size="sm"
      variant={drafts[id]?.decision === val ? 'default' : 'outline'}
      className={`h-7 gap-1 ${drafts[id]?.decision === val ? tone : ''}`}
      onClick={() => setDraft(id, { decision: val })}
    >
      <Icon className="w-3 h-3" /> {label}
    </Button>
  );

  return (
    <div className="min-h-screen p-4 bg-background">
      <div className="max-w-3xl mx-auto space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="w-5 h-5 text-primary" /> Verification pack
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {loading && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Validating link…</div>}
            {error && (
              <div className="flex items-start gap-2 text-destructive">
                <AlertCircle className="w-4 h-4 mt-0.5" />
                <div><p className="font-medium">Link unavailable</p><p className="text-xs">{error}</p></div>
              </div>
            )}
            {meta && (
              <>
                <div className="flex flex-wrap gap-2 items-center">
                  <Badge variant="secondary">{meta.department}</Badge>
                  <Badge variant="outline">{meta.session_year} · {meta.session_term}</Badge>
                  <Badge variant="outline">{meta.document_count} documents</Badge>
                  {meta.excluded_count > 0 && <Badge variant="outline">{meta.excluded_count} excluded (text-only)</Badge>}
                  {meta.verifier && <Badge className="ml-auto">Reviewing as {meta.verifier.full_name}</Badge>}
                </div>
                <Button onClick={startDownload} disabled={downloading || meta.document_count === 0} className="w-full gap-1">
                  {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  Download verification pack (ZIP)
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {docs.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Per-document review</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {docs.map((d) => {
                const saved = reviews[d.id];
                const draft = drafts[d.id] || { decision: '', notes: '' };
                return (
                  <div key={d.id} className="border rounded p-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-medium">{d.document_type}</span>
                      {d.unit_code && <Badge variant="outline">{d.unit_code}</Badge>}
                      {d.text_only && <Badge variant="outline">text-only</Badge>}
                      <span className="text-muted-foreground truncate">{d.file_name}</span>
                      {saved && (
                        <Badge variant="secondary" className="ml-auto">
                          Saved · {saved.decision}
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {decisionButton(d.id, 'APPROVED', CheckCircle2, 'Approve', 'bg-green-600 hover:bg-green-600/90')}
                      {decisionButton(d.id, 'QUERY', HelpCircle, 'Query', 'bg-amber-500 hover:bg-amber-500/90')}
                      {decisionButton(d.id, 'REJECTED', XCircle, 'Reject', '')}
                    </div>
                    <Textarea
                      rows={2}
                      placeholder="Notes (optional)"
                      value={draft.notes}
                      onChange={(e) => setDraft(d.id, { notes: e.target.value })}
                    />
                    <div className="flex justify-end">
                      <Button size="sm" onClick={() => saveReview(d.id)} disabled={saving[d.id] || !draft.decision} className="h-7 gap-1">
                        {saving[d.id] ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                        Save review
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
