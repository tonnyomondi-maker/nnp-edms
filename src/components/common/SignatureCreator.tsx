// Lets approvers create a signature without uploading an image — either by
// drawing on a canvas with finger/stylus/mouse, or by typing their name in
// a handwritten font. The result is exported as a transparent PNG blob the
// caller can upload to the signatures bucket.

import { useEffect, useRef, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Eraser, PenLine, Type as TypeIcon, Save } from 'lucide-react';

const HAND_FONTS: { value: string; label: string }[] = [
  { value: '"Brush Script MT", "Lucida Handwriting", cursive', label: 'Brush Script' },
  { value: '"Lucida Handwriting", "Brush Script MT", cursive', label: 'Lucida Handwriting' },
  { value: '"Segoe Script", "Comic Sans MS", cursive', label: 'Segoe Script' },
  { value: 'cursive', label: 'System cursive' },
];

export interface SignatureCreatorProps {
  defaultName?: string;
  onSave: (blob: Blob) => Promise<void> | void;
  saving?: boolean;
}

export function SignatureCreator({ defaultName = '', onSave, saving }: SignatureCreatorProps) {
  // --- DRAW MODE ---
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  const clearCanvas = () => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
  };

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    // High-DPI canvas
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0f172a';
    }
  }, []);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    const { x, y } = pos(e);
    const ctx = canvasRef.current!.getContext('2d')!;
    ctx.beginPath(); ctx.moveTo(x, y);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const moveDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const { x, y } = pos(e);
    const ctx = canvasRef.current!.getContext('2d')!;
    ctx.lineTo(x, y); ctx.stroke();
  };
  const endDraw = () => { drawing.current = false; };

  const exportDrawn = async (): Promise<Blob | null> => {
    const c = canvasRef.current; if (!c) return null;
    return await new Promise<Blob | null>((res) => c.toBlob((b) => res(b), 'image/png'));
  };

  // --- TYPED MODE ---
  const [typed, setTyped] = useState(defaultName);
  const [font, setFont] = useState(HAND_FONTS[0].value);

  const exportTyped = async (): Promise<Blob | null> => {
    if (!typed.trim()) return null;
    const c = document.createElement('canvas');
    c.width = 600; c.height = 180;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#0f172a';
    ctx.font = `54px ${font}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(typed.trim(), c.width / 2, c.height / 2);
    return await new Promise<Blob | null>((res) => c.toBlob((b) => res(b), 'image/png'));
  };

  const [tab, setTab] = useState<'draw' | 'type'>('draw');

  const handleSave = async () => {
    const blob = tab === 'draw' ? await exportDrawn() : await exportTyped();
    if (!blob) return;
    await onSave(blob);
  };

  return (
    <div className="rounded-md border bg-card">
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'draw' | 'type')}>
        <TabsList className="w-full rounded-b-none">
          <TabsTrigger value="draw" className="flex-1 gap-1"><PenLine className="w-3.5 h-3.5" /> Draw</TabsTrigger>
          <TabsTrigger value="type" className="flex-1 gap-1"><TypeIcon className="w-3.5 h-3.5" /> Type</TabsTrigger>
        </TabsList>
        <TabsContent value="draw" className="p-3 space-y-2">
          <canvas
            ref={canvasRef}
            className="w-full h-32 rounded border bg-white touch-none"
            onPointerDown={startDraw}
            onPointerMove={moveDraw}
            onPointerUp={endDraw}
            onPointerLeave={endDraw}
          />
          <div className="flex items-center justify-between">
            <Button size="sm" variant="ghost" onClick={clearCanvas} className="gap-1 h-7 text-xs">
              <Eraser className="w-3 h-3" /> Clear
            </Button>
            <p className="text-[10px] text-muted-foreground">Use mouse, stylus or finger</p>
          </div>
        </TabsContent>
        <TabsContent value="type" className="p-3 space-y-2">
          <Label className="text-xs">Your name (as it should appear)</Label>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="e.g. Jane Doe" />
          <Label className="text-xs">Handwriting style</Label>
          <Select value={font} onValueChange={setFont}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {HAND_FONTS.map((f) => (
                <SelectItem key={f.label} value={f.value}>
                  <span style={{ fontFamily: f.value }} className="text-base">{f.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div
            className="border rounded bg-white px-3 py-2 text-[34px] leading-none text-slate-900 min-h-[60px] flex items-center justify-center"
            style={{ fontFamily: font }}
          >
            {typed || <span className="text-xs text-muted-foreground italic">Preview</span>}
          </div>
        </TabsContent>
      </Tabs>
      <div className="p-3 border-t flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1">
          <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save signature'}
        </Button>
      </div>
    </div>
  );
}
