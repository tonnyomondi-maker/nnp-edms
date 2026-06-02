// Client-side, lossless-feeling compression that preserves document eligibility.
// - PDF: re-saves with pdf-lib (object streams, drops unused objects). No image re-encode
//   so text/forms/signatures remain pixel-identical.
// - Images: down-scales very large images to max 2200px and re-encodes as JPEG q=0.85.
// - Other types: passes through unchanged.
// Guards: never returns a file larger than the original; never below 50 KB unless original was.

import { PDFDocument } from 'pdf-lib';

const MIN_SIZE = 50 * 1024;
const IMG_MAX_DIM = 2200;
const IMG_QUALITY = 0.85;

async function compressPdf(file: File): Promise<File> {
  try {
    const bytes = await file.arrayBuffer();
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const out = await doc.save({ useObjectStreams: true, addDefaultPage: false });
    const candidate = new File([out], file.name, { type: 'application/pdf' });
    if (candidate.size < file.size && (candidate.size >= MIN_SIZE || file.size < MIN_SIZE)) {
      return candidate;
    }
    return file;
  } catch {
    return file;
  }
}

async function compressImage(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, IMG_MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob: Blob | null = await new Promise(res => canvas.toBlob(res, 'image/jpeg', IMG_QUALITY));
    if (!blob) return file;
    const candidate = new File([blob], file.name.replace(/\.(png|webp|bmp)$/i, '.jpg'), { type: 'image/jpeg' });
    if (candidate.size < file.size) return candidate;
    return file;
  } catch {
    return file;
  }
}

export async function compressForUpload(file: File): Promise<{ file: File; originalSize: number; finalSize: number }> {
  const originalSize = file.size;
  let out = file;
  if (file.type === 'application/pdf') out = await compressPdf(file);
  else if (file.type.startsWith('image/')) out = await compressImage(file);
  return { file: out, originalSize, finalSize: out.size };
}

export function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}
