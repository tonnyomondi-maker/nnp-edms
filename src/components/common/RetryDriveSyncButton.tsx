// Reusable button that retries mirroring a document to Google Drive when the
// initial sync failed, or opens the mirrored file when sync already succeeded.

import { useState } from 'react';
import { Cloud, CloudOff, ExternalLink, Loader2, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  documentId: string;
  syncStatus?: string | null;
  webViewLink?: string | null;
  lastError?: string | null;
  size?: 'sm' | 'default';
  onSynced?: () => void;
}

export function RetryDriveSyncButton({
  documentId,
  syncStatus,
  webViewLink,
  lastError,
  size = 'sm',
  onSynced,
}: Props) {
  const [busy, setBusy] = useState(false);

  if (syncStatus === 'success' && webViewLink) {
    return (
      <Button
        asChild
        size={size}
        variant="ghost"
        className="text-emerald-700 dark:text-emerald-300 gap-1"
      >
        <a href={webViewLink} target="_blank" rel="noreferrer">
          <Cloud className="w-3.5 h-3.5" />
          Open in Drive
          <ExternalLink className="w-3 h-3" />
        </a>
      </Button>
    );
  }

  const handleRetry = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('gdrive-upload', {
        body: { documentId },
      });
      const errMsg = error?.message || (data as { error?: string })?.error;
      if (errMsg) {
        toast.error('Google Drive sync failed', { description: errMsg });
      } else {
        const link = (data as { webViewLink?: string })?.webViewLink;
        toast.success('Mirrored to Google Drive', {
          description: link ? 'File available in Drive.' : undefined,
          action: link
            ? { label: 'Open', onClick: () => window.open(link, '_blank', 'noopener') }
            : undefined,
        });
        onSynced?.();
      }
    } catch (e) {
      toast.error('Google Drive sync failed', { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const label = syncStatus === 'failed' ? 'Retry Drive sync' : 'Sync to Drive';
  const Icon = syncStatus === 'failed' ? RotateCw : CloudOff;

  const btn = (
    <Button
      size={size}
      variant="outline"
      onClick={handleRetry}
      disabled={busy}
      className="gap-1"
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
      {label}
    </Button>
  );

  if (!lastError) return btn;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">{btn}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          Last error: {lastError}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
