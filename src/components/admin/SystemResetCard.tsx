// Destructive "System Reset" panel, reused across SystemSetup and SystemBackups.
// Wipes documents + audit data via the existing `system-reset` edge function.
// Requires the active role to be SUPER_ADMIN; the safety lock is engaged
// automatically by the function while the reset runs.

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ActionGuardButton } from '@/components/common/ActionGuardButton';
import { Loader2, AlertTriangle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface Props {
  onAfterReset?: () => void;
}

export function SystemResetCard({ onAfterReset }: Props) {
  const todayKey = new Date().toISOString().slice(0, 10);
  const [confirmText, setConfirmText] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastReset, setLastReset] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('audit_logs')
        .select('created_at')
        .eq('action', 'SYSTEM_RESET')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setLastReset((data?.created_at as string) || null);
    })();
  }, []);

  const expected = `RESET ${todayKey}`;
  const canSubmit = acknowledged && confirmText.trim() === expected;

  const handleReset = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('system-reset', {
      body: { confirm: confirmText.trim() },
    });
    setBusy(false);
    if (error || (data as { error?: string })?.error) {
      toast({ title: 'Reset failed', description: error?.message || (data as { error?: string })?.error, variant: 'destructive' });
      return;
    }
    toast({ title: 'System reset complete', description: 'All documents, configs and audit data cleared.' });
    setConfirmText('');
    setAcknowledged(false);
    setLastReset(new Date().toISOString());
    onAfterReset?.();
  };

  return (
    <Card className="border-destructive/60">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2 text-destructive">
          <AlertTriangle className="w-4 h-4" />
          System Reset
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Wipes <strong>all</strong> documents, audit logs, unit configs, teaching assignments and uploaded files.
          User accounts, roles and the Super Admin remain intact. The system safety lock engages automatically
          for the duration of the wipe.
        </p>
        {lastReset && (
          <p className="text-xs text-muted-foreground">
            Last reset: {new Date(lastReset).toLocaleString()}
          </p>
        )}
        <div>
          <Label className="text-xs">Type exactly <code className="bg-muted px-1.5 py-0.5 rounded">{expected}</code></Label>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={expected}
            className="mt-1"
          />
        </div>
        <Label className="flex items-start gap-2 cursor-pointer text-xs">
          <Checkbox checked={acknowledged} onCheckedChange={(v) => setAcknowledged(v === true)} />
          <span>I understand this permanently wipes all documents and audit history.</span>
        </Label>
        <ActionGuardButton
          action="reset"
          variant="destructive"
          disabled={busy || !canSubmit}
          onClick={handleReset}
        >
          {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Permanently reset system
        </ActionGuardButton>
      </CardContent>
    </Card>
  );
}
