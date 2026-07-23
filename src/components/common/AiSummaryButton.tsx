import { useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface Props {
  documentId: string;
  size?: 'sm' | 'default';
}

interface AiReview {
  summary?: string;
  detectedSections?: string[];
  missingItems?: string[];
  suggestedVerdict?: 'approve' | 'return' | 'reject';
  suggestedRejectionReason?: string;
  raw?: string;
}

export function AiSummaryButton({ documentId, size = 'sm' }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [review, setReview] = useState<AiReview | null>(null);

  const run = async () => {
    setOpen(true);
    setLoading(true);
    setReview(null);
    try {
      const { data, error } = await supabase.functions.invoke('ai-approval-summary', { body: { documentId } });
      if (error) throw error;
      setReview(data as AiReview);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: 'AI review unavailable', description: msg, variant: 'destructive' });
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button size={size} variant="outline" onClick={run} className="gap-1">
        <Sparkles className="w-3.5 h-3.5" /> AI review
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> AI review (advisory)</DialogTitle>
            <DialogDescription>Independent CBET/CDACC checklist. Advisory only — the approval decision stays with you.</DialogDescription>
          </DialogHeader>
          {loading && <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>}
          {review && (
            <div className="space-y-3 text-sm">
              {review.summary && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground">Summary</p>
                  <p>{review.summary}</p>
                </div>
              )}
              {review.detectedSections && review.detectedSections.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground">Detected sections</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {review.detectedSections.map(s => <Badge key={s} variant="secondary">{s}</Badge>)}
                  </div>
                </div>
              )}
              {review.missingItems && review.missingItems.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-destructive">Missing / issues</p>
                  <ul className="list-disc pl-5 mt-1 text-xs">
                    {review.missingItems.map(m => <li key={m}>{m}</li>)}
                  </ul>
                </div>
              )}
              {review.suggestedVerdict && (
                <div className="pt-2 border-t">
                  <p className="text-xs font-semibold">Suggested verdict</p>
                  <Badge variant={review.suggestedVerdict === 'approve' ? 'default' : review.suggestedVerdict === 'return' ? 'outline' : 'destructive'}>
                    {review.suggestedVerdict.toUpperCase()}
                  </Badge>
                  {review.suggestedRejectionReason && (
                    <p className="text-xs mt-2 italic">"{review.suggestedRejectionReason}"</p>
                  )}
                </div>
              )}
              {!review.summary && review.raw && <pre className="text-xs whitespace-pre-wrap">{review.raw}</pre>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
