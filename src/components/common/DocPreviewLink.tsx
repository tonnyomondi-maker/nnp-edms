import { DocPreviewDialog } from './DocPreviewDialog';

interface DocPreviewLinkProps {
  fileRef: string | null | undefined;
  /** Tailwind size variant — defaults to compact pill matching DocumentCard */
  variant?: 'pill' | 'button';
  label?: string;
  title?: string;
}

/**
 * "View" action for a document. Opens an in-app, mobile-friendly PDF viewer
 * (Google Drive or Storage backed). When the document has no file attached it
 * renders a clear "No file" state instead of silently disappearing.
 */
export function DocPreviewLink({ fileRef, variant = 'pill', label = 'View', title }: DocPreviewLinkProps) {
  return <DocPreviewDialog fileRef={fileRef} variant={variant} label={label} title={title} />;
}
