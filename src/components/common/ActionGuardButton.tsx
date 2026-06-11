// Wraps a Button with a role/lock guard. If the active role can't perform the
// requested action, the button is disabled and a tooltip explains which role
// is required (or why the system is locked).

import { forwardRef } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useRoleGuard, type DocAction } from '@/hooks/useRoleGuard';
import type { Tables } from '@/integrations/supabase/types';

type Doc = Tables<'documents'>;

interface ActionGuardButtonProps extends ButtonProps {
  action: DocAction;
  doc?: Doc | null;
  /** Override allowed even if guard would block (rare — keep false). */
  forceEnable?: boolean;
}

export const ActionGuardButton = forwardRef<HTMLButtonElement, ActionGuardButtonProps>(function ActionGuardButton(
  { action, doc, forceEnable, disabled, children, onClick, ...rest },
  ref,
) {
  const guard = useRoleGuard();
  const allowed = forceEnable || guard.canActOn(action, doc);
  const reason = allowed ? null : guard.reasonFor(action, doc);
  const finalDisabled = disabled || !allowed;

  const button = (
    <Button
      ref={ref}
      {...rest}
      aria-disabled={finalDisabled}
      disabled={finalDisabled}
      onClick={(e) => { if (!finalDisabled) onClick?.(e); }}
    >
      {children}
    </Button>
  );

  if (!reason) return button;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        {/* Wrap in span so the tooltip still triggers when the button is disabled. */}
        <TooltipTrigger asChild>
          <span className="inline-flex" tabIndex={0}>{button}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">{reason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});
