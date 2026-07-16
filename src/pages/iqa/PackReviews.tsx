// IQA / Super Admin — read-only summary of verifier reviews for a single pack.

import { useEffect, useState } from 'react';
import { Navigate, useParams, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowLeft, CheckCircle2, AlertCircle, XCircle } from 'lucide-react';

interface Review {
  id: string; document_id: string; verifier_id: string | null;
  decision: 'APPROVED' | 'QUERY' | 'REJECTED'; notes: string | null; reviewed_at: string;
}
interface Doc { id: string; file_name: string | null; document_type: string; unit_code: string | null }
interface Verifier { id: string; full_name: string; email: string }
interface Pack { id: string; department: string; session_year: number; session_term: string }

const decoIcon = {
  APPROVED: <CheckCircle2 className="w-4 h-4 text-green-600" />,
  QUERY: <AlertCircle className="w-4 h-4 text-amber-500" />,
  REJECTED: <XCircle className="w-4 h-4 text-destructive" />,
};

export default function PackReviews() {
  const { packId = '' } = useParams();
  const { currentUser, activeRole, loading } = useAuth();
  const [pack, setPack] = useState<Pack | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [docs, setDocs] = useState<Record<string, Doc>>({});
  const [verifiers, setVerifiers] = useState<Record<string, Verifier>>({});
  const [loadingData, setLoadingData] = useState(false);

  const canUse = !loading && currentUser && (activeRole === 'IQA' || activeRole === 'SUPER_ADMIN');

  useEffect(() => {
    if (!canUse || !packId) return;
    (async () => {
      setLoadingData(true);
      // deno-lint-ignore no-explicit-any
      const sb: any = supabase;
      const { data: p } = await sb.from('verification_packs').select('id, department, session_year, session_term').eq('id', packId).maybeSingle();
      setPack(p as Pack | null);
      const { data: rs } = await sb.from('verifier_reviews').select('*').eq('pack_id', packId).order('reviewed_at', { ascending: false });
      const rvs = (rs as Review[]) || [];
      setReviews(rvs);
      const docIds = Array.from(new Set(rvs.map((r) => r.document_id)));
      const vIds = Array.from(new Set(rvs.map((r) => r.verifier_id).filter(Boolean) as string[]));
      if (docIds.length) {
        const { data: ds } = await sb.from('documents').select('id, file_name, document_type, unit_code').in('id', docIds);
        const map: Record<string, Doc> = {};
        (ds as Doc[] | null || []).forEach((d) => { map[d.id] = d; });
        setDocs(map);
      }
      if (vIds.length) {
        const { data: vs } = await sb.from('verifiers').select('id, full_name, email').in('id', vIds);
        const map: Record<string, Verifier> = {};
        (vs as Verifier[] | null || []).forEach((v) => { map[v.id] = v; });
        setVerifiers(map);
      }
      setLoadingData(false);
    })();
  }, [canUse, packId]);

  if (loading) return null;
  if (!currentUser) return <Navigate to="/auth" replace />;
  if (!canUse) return <Navigate to="/" replace />;

  const counts = reviews.reduce(
    (acc, r) => { acc[r.decision]++; return acc; },
    { APPROVED: 0, QUERY: 0, REJECTED: 0 } as Record<Review['decision'], number>,
  );

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center gap-2">
        <Button asChild size="sm" variant="ghost" className="gap-1">
          <Link to="/iqa/verifier-packs"><ArrowLeft className="w-4 h-4" /> Back</Link>
        </Button>
      </div>
      <PageHeader title="Verifier reviews" subtitle={pack ? `${pack.department} · ${pack.session_year} ${pack.session_term}` : ''} />

      <Card>
        <CardHeader><CardTitle className="text-base">Summary</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3 text-xs">
          <Badge variant="secondary" className="gap-1">{decoIcon.APPROVED} Approved: {counts.APPROVED}</Badge>
          <Badge variant="secondary" className="gap-1">{decoIcon.QUERY} Queries: {counts.QUERY}</Badge>
          <Badge variant="secondary" className="gap-1">{decoIcon.REJECTED} Rejected: {counts.REJECTED}</Badge>
          <span className="text-muted-foreground ml-auto">Total: {reviews.length}</span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Reviews</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {loadingData && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          {!loadingData && reviews.length === 0 && <p className="text-xs text-muted-foreground">No reviews yet.</p>}
          {reviews.map((r) => {
            const d = docs[r.document_id];
            const v = r.verifier_id ? verifiers[r.verifier_id] : null;
            return (
              <div key={r.id} className="border rounded p-3 text-xs space-y-1">
                <div className="flex items-center gap-2">
                  {decoIcon[r.decision]}
                  <span className="font-medium">{d?.document_type ?? 'Document'}{d?.unit_code ? ` · ${d.unit_code}` : ''}</span>
                  <span className="text-muted-foreground truncate">{d?.file_name}</span>
                  <span className="ml-auto text-muted-foreground">{new Date(r.reviewed_at).toLocaleString()}</span>
                </div>
                <p className="text-muted-foreground">
                  Reviewer: {v ? `${v.full_name} (${v.email})` : 'Anonymous'}
                </p>
                {r.notes && <p className="italic whitespace-pre-wrap">{r.notes}</p>}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
