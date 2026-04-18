import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ApprovalPlacement } from '@/hooks/useDocuments';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

interface PlacementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pdfUrl: string;
  signatureUrl: string;
  stampUrl: string;
  stage: 'HOD' | 'DP' | 'IQA';
  onConfirm: (placement: ApprovalPlacement | null) => void;
}

type Box = { x: number; y: number; w: number; h: number };

const DEFAULT_SIG: Box = { x: 0.06, y: 0.85, w: 0.22, h: 0.05 };
const DEFAULT_STAMP: Box = { x: 0.34, y: 0.83, w: 0.12, h: 0.085 };

const MIN_W = 0.04;
const MIN_H = 0.02;

const storageKey = (stage: string) => `placement:${stage}`;

type Stored = { sig: Box; stamp: Box; page?: number };

function loadStored(stage: string): Stored | null {
  try {
    const raw = localStorage.getItem(storageKey(stage));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.sig || !parsed?.stamp) return null;
    return parsed as Stored;
  } catch {
    return null;
  }
}

function saveStored(stage: string, data: Stored) {
  try {
    localStorage.setItem(storageKey(stage), JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

type DragState =
  | { kind: 'move'; which: 'sig' | 'stamp'; offX: number; offY: number }
  | { kind: 'resize'; which: 'sig' | 'stamp'; startX: number; startY: number; startW: number; startH: number; anchorFx: number; anchorFy: number };

export function PlacementModal({
  open, onOpenChange, pdfUrl, signatureUrl, stampUrl, stage, onConfirm,
}: PlacementModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(1);
  const [rendering, setRendering] = useState(false);
  const [pageSize, setPageSize] = useState({ w: 0, h: 0 });

  const [sig, setSig] = useState<Box>(DEFAULT_SIG);
  const [stamp, setStamp] = useState<Box>(DEFAULT_STAMP);
  const [drag, setDrag] = useState<DragState | null>(null);

  // Load stored placement for this stage when modal opens
  useEffect(() => {
    if (!open) return;
    const stored = loadStored(stage);
    if (stored) {
      setSig(stored.sig);
      setStamp(stored.stamp);
    } else {
      setSig(DEFAULT_SIG);
      setStamp(DEFAULT_STAMP);
    }
  }, [open, stage]);

  useEffect(() => {
    if (!open || !pdfUrl) return;
    let cancelled = false;
    (async () => {
      setRendering(true);
      try {
        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        const doc = await loadingTask.promise;
        if (cancelled) return;
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        const stored = loadStored(stage);
        setPageNum(stored?.page && stored.page <= doc.numPages ? stored.page : doc.numPages);
      } catch (e) {
        console.error('PDF load failed', e);
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, pdfUrl, stage]);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current || !containerRef.current) return;
    let cancelled = false;
    (async () => {
      setRendering(true);
      const page = await pdfDoc.getPage(pageNum);
      if (cancelled) return;
      const containerW = containerRef.current!.clientWidth;
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(2, containerW / baseViewport.width);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext('2d')!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      await page.render({ canvasContext: ctx, viewport }).promise;
      if (!cancelled) {
        setPageSize({ w: viewport.width, h: viewport.height });
        setRendering(false);
      }
    })();
    return () => { cancelled = true; };
  }, [pdfDoc, pageNum]);

  const onMovePointerDown = (which: 'sig' | 'stamp') => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = (e.currentTarget.parentElement as HTMLDivElement).getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    const box = which === 'sig' ? sig : stamp;
    setDrag({ kind: 'move', which, offX: fx - box.x, offY: fy - box.y });
  };

  const onResizePointerDown = (which: 'sig' | 'stamp') => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const box = which === 'sig' ? sig : stamp;
    setDrag({
      kind: 'resize',
      which,
      startX: box.x,
      startY: box.y,
      startW: box.w,
      startH: box.h,
      anchorFx: box.x,
      anchorFy: box.y,
    });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    const setter = drag.which === 'sig' ? setSig : setStamp;

    if (drag.kind === 'move') {
      setter((b) => ({
        ...b,
        x: Math.min(1 - b.w, Math.max(0, fx - drag.offX)),
        y: Math.min(1 - b.h, Math.max(0, fy - drag.offY)),
      }));
    } else {
      // resize from bottom-right corner; anchor stays at top-left
      const newW = Math.min(1 - drag.anchorFx, Math.max(MIN_W, fx - drag.anchorFx));
      const newH = Math.min(1 - drag.anchorFy, Math.max(MIN_H, fy - drag.anchorFy));
      setter((b) => ({ ...b, w: newW, h: newH }));
    }
  };

  const onPointerUp = () => setDrag(null);

  const handleConfirm = (useDefault: boolean) => {
    if (useDefault) {
      onConfirm(null);
    } else {
      saveStored(stage, { sig, stamp, page: pageNum });
      onConfirm({
        page: pageNum,
        sigX: sig.x,
        sigY: sig.y,
        sigW: sig.w,
        sigH: sig.h,
        stampX: stamp.x,
        stampY: stamp.y,
        stampW: stamp.w,
        stampH: stamp.h,
      });
    }
    onOpenChange(false);
  };

  const handleResetDefaults = () => {
    setSig(DEFAULT_SIG);
    setStamp(DEFAULT_STAMP);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Position your {stage} signature & stamp</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Drag to move, drag the bottom-right corner to resize. Your last-used placement for {stage} is remembered.
          </p>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" disabled={pageNum <= 1} onClick={() => setPageNum(p => Math.max(1, p - 1))} className="h-7 px-2">
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <span className="px-2">Page {pageNum} / {numPages}</span>
            <Button size="sm" variant="outline" disabled={pageNum >= numPages} onClick={() => setPageNum(p => Math.min(numPages, p + 1))} className="h-7 px-2">
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={handleResetDefaults} className="h-7 px-2 text-xs">Reset</Button>
            <span className="text-muted-foreground">Sig (blue) • Stamp (amber)</span>
          </div>
        </div>

        <div ref={containerRef} className="flex-1 overflow-auto bg-muted rounded p-3 flex justify-center">
          <div
            className="relative inline-block"
            style={{ width: pageSize.w, height: pageSize.h }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <canvas ref={canvasRef} className="block bg-background shadow" />
            {rendering && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            )}
            {/* Signature draggable + resizable box */}
            <div
              onPointerDown={onMovePointerDown('sig')}
              className="absolute border-2 border-primary bg-primary/15 cursor-move flex items-center justify-center select-none"
              style={{
                left: `${sig.x * 100}%`, top: `${sig.y * 100}%`,
                width: `${sig.w * 100}%`, height: `${sig.h * 100}%`,
                touchAction: 'none',
              }}
            >
              <img src={signatureUrl} alt="sig" className="max-w-full max-h-full object-contain pointer-events-none" />
              <div
                onPointerDown={onResizePointerDown('sig')}
                className="absolute -right-1 -bottom-1 w-3 h-3 bg-primary border border-background cursor-se-resize"
                style={{ touchAction: 'none' }}
              />
            </div>
            {/* Stamp draggable + resizable box */}
            <div
              onPointerDown={onMovePointerDown('stamp')}
              className="absolute border-2 border-accent-foreground bg-accent cursor-move flex items-center justify-center select-none"
              style={{
                left: `${stamp.x * 100}%`, top: `${stamp.y * 100}%`,
                width: `${stamp.w * 100}%`, height: `${stamp.h * 100}%`,
                touchAction: 'none',
              }}
            >
              <img src={stampUrl} alt="stamp" className="max-w-full max-h-full object-contain pointer-events-none" />
              <div
                onPointerDown={onResizePointerDown('stamp')}
                className="absolute -right-1 -bottom-1 w-3 h-3 bg-accent-foreground border border-background cursor-se-resize"
                style={{ touchAction: 'none' }}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="secondary" onClick={() => handleConfirm(true)}>Use default (bottom)</Button>
          <Button onClick={() => handleConfirm(false)}>Confirm placement</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
