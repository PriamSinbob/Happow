import type { LatLng } from '@happow/core';
import { config } from './config';

/**
 * A poster photo for autofill, shrunk on the device before it leaves it: the long edge
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

/**
 * Where a JPEG photo was taken, from its EXIF GPS tags; null when it has none (most browsers strip
 * the location from photos picked from the gallery, and shrinking drops EXIF, so this reads the
 * original before it is shrunk).
 */
export async function photoPoint(file: Blob): Promise<LatLng | null> {
  try {
    return gpsFromJpeg(new DataView(await file.slice(0, 256 * 1024).arrayBuffer()));
  } catch {
    return null;
  }
}

/** The GPS position in a JPEG's EXIF block. Exported for its test. */
export function gpsFromJpeg(v: DataView): LatLng | null {
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
  let at = 2;
  while (at + 4 <= v.byteLength) {
    const marker = v.getUint16(at);
    const size = v.getUint16(at + 2);
    // APP1 "Exif\0\0".
    if (marker === 0xffe1 && v.getUint32(at + 4) === 0x45786966) return gpsFromTiff(v, at + 10);
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return null;
    at += 2 + size;
  }
  return null;
}

function gpsFromTiff(v: DataView, tiff: number): LatLng | null {
  const little = v.getUint16(tiff) === 0x4949;
  const u16 = (o: number) => v.getUint16(tiff + o, little);
  const u32 = (o: number) => v.getUint32(tiff + o, little);
  /** Entries of the IFD at `o`: tag → offset of its value field. */
  const entries = (o: number) => {
    const out = new Map<number, number>();
    const n = u16(o);
    for (let i = 0; i < n; i++) out.set(u16(o + 2 + i * 12), o + 2 + i * 12 + 8);
    return out;
  };
  const gpsAt = entries(u32(4)).get(0x8825);
  if (gpsAt === undefined) return null;
  const gps = entries(u32(gpsAt));
  const ref = (tag: number) => {
    const o = gps.get(tag);
    return o === undefined ? null : String.fromCharCode(v.getUint8(tiff + o));
  };
  /** Degrees, minutes and seconds, three rationals at the offset the entry points to. */
  const angle = (tag: number) => {
    const o = gps.get(tag);
    if (o === undefined) return null;
    const p = u32(o);
    const r = (i: number) => u32(p + i * 8) / (u32(p + i * 8 + 4) || 1);
    return r(0) + r(1) / 60 + r(2) / 3600;
  };
  const lat = angle(2);
  const lng = angle(4);
  if (lat === null || lng === null || (lat === 0 && lng === 0)) return null;
  const point = {
    lat: ref(1) === 'S' ? -lat : lat,
    lng: ref(3) === 'W' ? -lng : lng,
  };
  return Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180 ? point : null;
}
