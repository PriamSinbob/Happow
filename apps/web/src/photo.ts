import { config } from './config';

/**
 * A poster photo for autofill (M12 §4.2), shrunk on the device before it leaves it: the long edge
 * to `extraction.photo.maxEdge` (about the most the model reads without scaling it down itself),
 * as a JPEG, turned the right way up from the photo's own orientation. The original never leaves
 * the phone.
 */

/** The size that fits `max` on the long edge; never enlarged. */
export function fitWithin(width: number, height: number, max: number) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export interface ShrunkPhoto {
  /** Base64, no data: prefix. */
  data: string;
  mediaType: 'image/jpeg';
}

export async function shrinkPhoto(file: Blob): Promise<ShrunkPhoto> {
  const { maxEdge, jpegQuality } = config.app.extraction.photo;
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('encode failed'))),
      'image/jpeg',
      jpegQuality,
    ),
  );
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return { data: url.slice(url.indexOf(',') + 1), mediaType: 'image/jpeg' };
}
