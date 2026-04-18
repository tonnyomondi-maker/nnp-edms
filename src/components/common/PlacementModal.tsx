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

const SIG_BOX = { w: 0.22, h: 0.05 };   // fraction of page
const STAMP_BOX = { w: 0.12, h: 0.085 };

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

  // Default placement bottom-area on the rendered page
  const [sig, setSig] = useState<Box>({ x: 0.06, y: 0.85, ...SIG_BOX });
  const [stamp, setStamp] = useState<Box>({ x: 0.34, y: 0.83, ...STAMP_BOX });
  const [drag, setDrag] = useState<{ which: 'sig' | 'stamp'; offX: number; offY: number } | null>(null);

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
        setPageNum(doc.numPages); // default last page
      } catch (e) {
        console.error('PDF load failed', e);
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, pdfUrl]);

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

  const onPointerDown = (which: 'sig' | 'stamp') => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = (e.currentTarget.parentElement as HTMLDivElement).getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    const box = which === 'sig' ? sig : stamp;
    setDrag({ which, offX: fx - box.x, offY: fy - box.y });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    const setter = drag.which === 'sig' ? setSig : setStamp;
    setter((b) => ({
      ...b,
      x: Math.min(1 - b.w, Math.max(0, fx - drag.offX)),
      y: Math.min(1 - b.h, Math.max(0, fy - drag.offY)),
    }));
  };

  const onPointerUp = () => setDrag(null);

  const handleConfirm = (useDefault: boolean) => {
    if (useDefault) {
      onConfirm(null);
    } else {
      onConfirm({
        page: pageNum,
        sigX: sig.x,
        sigY: sig.y,
        stampX: stamp.x,
        stampY: stamp.y,
      });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Position your {stage} signature & stamp</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Drag the boxes to your preferred position, or click <strong>Use default</strong> to stamp the bottom of the last page.
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
          <span className="text-muted-foreground">Drag boxes • Sig (blue) • Stamp (amber)</span>
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
            {/* Signature draggable box */}
            <div
              onPointerDown={onPointerDown('sig')}
              className="absolute border-2 border-primary bg-primary/15 cursor-move flex items-center justify-center select-none"
              style={{
                left: `${sig.x * 100}%`, top: `${sig.y * 100}%`,
                width: `${sig.w * 100}%`, height: `${sig.h * 100}%`,
                touchAction: 'none',
              }}
            >
              <img src={signatureUrl} alt="sig" className="max-w-full max-h-full object-contain pointer-events-none" />
            </div>
            {/* Stamp draggable box */}
            <div
              onPointerDown={onPointerDown('stamp')}
              className="absolute border-2 border-accent-foreground bg-accent cursor-move flex items-center justify-center select-none"
              style={{
                left: `${stamp.x * 100}%`, top: `${stamp.y * 100}%`,
                width: `${stamp.w * 100}%`, height: `${stamp.h * 100}%`,
                touchAction: 'none',
              }}
            >
              <img src={stampUrl} alt="stamp" className="max-w-full max-h-full object-contain pointer-events-none" />
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
