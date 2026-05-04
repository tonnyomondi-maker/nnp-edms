import { ExternalLink, Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import { useSignedDocUrl } from '@/hooks/useSignedDocUrl';

interface DocPreviewLinkProps {
  fileRef: string | null | undefined;
  /** Tailwind size variant — defaults to compact pill matching DocumentCard */
  variant?: 'pill' | 'button';
  label?: string;
}

/**
 * Renders a "View PDF" link that lazily fetches a signed URL for a private
 * storage object. Shows a friendly loader while fetching and a Retry button
 * on failure.
 */
export function DocPreviewLink({ fileRef, variant = 'pill', label = 'View PDF' }: DocPreviewLinkProps) {
  const { url, loading, error, reload } = useSignedDocUrl(fileRef);

  if (!fileRef) return null;

  const baseClass =
    variant === 'pill'
      ? 'flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-muted hover:bg-muted/70 transition-colors text-[10px] font-medium'
      : 'inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-border bg-background hover:bg-muted text-xs font-medium';

  if (loading) {
    return (
      <span className={`${baseClass} text-muted-foreground`} aria-busy="true">
        <Loader2 className="w-3 h-3 animate-spin" /> Loading…
      </span>
    );
  }

  if (error) {
    return (
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); reload(); }}
        className={`${baseClass} text-destructive hover:text-destructive`}
        title={error}
      >
        <AlertCircle className="w-3 h-3" /> Preview failed
        <RefreshCw className="w-3 h-3" />
      </button>
    );
  }

  if (!url) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={baseClass}
    >
      {label} <ExternalLink className="w-2.5 h-2.5" />
    </a>
  );
}
