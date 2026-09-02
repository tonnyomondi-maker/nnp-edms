import { useState } from 'react';
import { AlertCircle, Download, ExternalLink, Eye, FileWarning, Loader2, RefreshCw } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useSignedDocUrl } from '@/hooks/useSignedDocUrl';

interface DocPreviewDialogProps {
  fileRef: string | null | undefined;
  /** Shown in the dialog header */
  title?: string;
  variant?: 'pill' | 'button';
  label?: string;
}

/**
 * Mobile-friendly in-app PDF viewer. Approvers can read the document before
 * verifying/reviewing/approving without leaving the queue. The signed URL (or
 * Google Drive blob) is only fetched once the dialog is opened.
 */
export function DocPreviewDialog({ fileRef, title = 'Document preview', variant = 'pill', label = 'View' }: DocPreviewDialogProps) {
  const [open, setOpen] = useState(false);
  const { url, loading, error, reload } = useSignedDocUrl(fileRef, { enabled: open });

  const baseClass =
    variant === 'pill'
      ? 'flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-muted hover:bg-muted/70 transition-colors text-[10px] font-medium'
      : 'inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-border bg-background hover:bg-muted text-xs font-medium';

  if (!fileRef) {
    return (
      <span
        className={`${baseClass} text-muted-foreground cursor-not-allowed opacity-70`}
        title="No file is attached to this document — the trainer must upload it again."
      >
        <FileWarning className="w-3 h-3" /> No file
      </span>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={baseClass}>
        <Eye className="w-3 h-3" /> {label}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[100vw] sm:max-w-4xl w-full h-[92vh] p-0 gap-0 flex flex-col">
          <DialogHeader className="px-4 py-3 border-b border-border">
            <DialogTitle className="text-sm truncate pr-8">{title}</DialogTitle>
          </DialogHeader>

          <div className="flex-1 min-h-0 bg-muted/40">
            {loading && (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" /> Loading document…
              </div>
            )}
            {!loading && error && (
              <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
                <AlertCircle className="w-6 h-6 text-destructive" />
                <p className="text-sm text-destructive">{error}</p>
                <button
                  type="button"
                  onClick={reload}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-border bg-background hover:bg-muted text-xs font-medium"
                >
                  <RefreshCw className="w-3 h-3" /> Retry
                </button>
              </div>
            )}
            {!loading && !error && url && (
              <iframe src={url} title={title} className="w-full h-full border-0" />
            )}
          </div>

          {url && (
            <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-border">
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-border bg-background hover:bg-muted text-xs font-medium"
              >
                <ExternalLink className="w-3 h-3" /> Open in new tab
              </a>
              <a
                href={url}
                download
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 text-xs font-medium"
              >
                <Download className="w-3 h-3" /> Download
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
