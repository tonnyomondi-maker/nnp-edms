// Retry button for a failed Google Drive mirror. Only rendered when:
//   - syncStatus === 'failed'  AND
//   - the active role is IQAO or SUPER_ADMIN
// This concentrates retry traffic on the archival role and hides the button
// entirely once the mirror succeeds.

import { useState } from 'react';
import { Loader2, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { getEdgeFunctionErrorMessage } from '@/lib/edgeFunctionError';

interface Props {
  documentId: string;
  syncStatus?: string | null;
  lastError?: string | null;
  size?: 'sm' | 'default';
  onSynced?: () => void;
}

export function RetryDriveSyncButton({ documentId, syncStatus, lastError, size = 'sm', onSynced }: Props) {
  const { activeRole } = useAuth();
  const [busy, setBusy] = useState(false);

  // Hide entirely unless the mirror failed AND we're the archival role.
  if (syncStatus !== 'failed') return null;
  if (activeRole !== 'IQA' && activeRole !== 'SUPER_ADMIN') return null;

  const handleRetry = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('gdrive-upload', { body: { documentId } });
      const errMsg = (error || (data as { error?: string })?.error)
        ? await getEdgeFunctionErrorMessage(error, data, 'Google Drive sync failed')
        : '';
      if (errMsg) {
        toast.error('Google Drive sync failed', { description: errMsg });
      } else {
        const link = (data as { webViewLink?: string })?.webViewLink;
        toast.success('Mirrored to Google Drive', {
          description: link ? 'File available in Drive.' : undefined,
          action: link ? { label: 'Open', onClick: () => window.open(link, '_blank', 'noopener') } : undefined,
        });
        onSynced?.();
      }
    } catch (e) {
      toast.error('Google Drive sync failed', { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const btn = (
    <Button size={size} variant="outline" onClick={handleRetry} disabled={busy} className="gap-1">
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
      Retry Drive sync
    </Button>
  );

  if (!lastError) return btn;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild><span className="inline-flex">{btn}</span></TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">Last error: {lastError}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
