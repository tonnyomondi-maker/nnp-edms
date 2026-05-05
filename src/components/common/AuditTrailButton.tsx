import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { FileDown, Loader2 } from 'lucide-react';

interface AuditTrailButtonProps {
  documentId: string;
  fileNameHint?: string | null;
}

/**
 * Compact pill-style button that calls the `generate-audit-trail` edge
 * function and downloads the returned PDF. Matches DocumentCard pill style.
 */
export function AuditTrailButton({ documentId, fileNameHint }: AuditTrailButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-audit-trail`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
        },
        body: JSON.stringify({ documentId }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `Failed (${res.status})`);
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      const safe = (fileNameHint || documentId).replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40);
      a.download = `audit-trail-${safe}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      toast({
        title: 'Could not download audit trail',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={loading}
      className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-muted hover:bg-muted/70 transition-colors text-[10px] font-medium disabled:opacity-50"
      title="Download audit trail PDF"
    >
      {loading ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <FileDown className="w-2.5 h-2.5" />}
      Audit
    </button>
  );
}
