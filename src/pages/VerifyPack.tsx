// Public landing page for a verifier-pack download link. No auth required —
// the token in the URL is the sole credential and is validated server-side.

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, ShieldCheck, Download, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

export default function VerifyPack() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [meta, setMeta] = useState<{ department: string; session_year: number; session_term: string; document_count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!token) { setError('Missing token'); setLoading(false); return; }
    (async () => {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/download-verification-pack?token=${encodeURIComponent(token)}&meta=1`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Invalid link');
        setMeta(data);
      } catch (e) { setError((e as Error).message); }
      finally { setLoading(false); }
    })();
  }, [token]);

  const startDownload = () => {
    setDownloading(true);
    window.location.href = `${SUPABASE_URL}/functions/v1/download-verification-pack?token=${encodeURIComponent(token)}`;
    setTimeout(() => setDownloading(false), 4000);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="max-w-lg w-full">
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
              <p><strong>Department:</strong> {meta.department}</p>
              <p><strong>Session:</strong> {meta.session_year} · {meta.session_term}</p>
              <p><strong>Documents:</strong> {meta.document_count} archived</p>
              <p className="text-xs text-muted-foreground">Clicking below downloads a ZIP containing every archived document for this department + an index PDF. Access is logged.</p>
              <Button onClick={startDownload} disabled={downloading || meta.document_count === 0} className="w-full gap-1">
                {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Download verification pack
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
