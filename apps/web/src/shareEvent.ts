import type { Language, NearbyEvent } from '@happow/core';
import qrcode from 'qrcode-generator';
import { formatDay, formatTime } from './format';

/** "Title · Sat 31 Oct 19:00 · Venue": the short text sent with a shared link (M9 §3). */
export function shareText(ev: NearbyEvent, lang: Language): string {
  return [
    ev.title,
    `${formatDay(ev.startAt, ev.timezone, lang)} ${formatTime(ev.startAt, ev.timezone, lang)}`,
    ev.venue?.name,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Whether this browser can hand an image file to the share sheet (for Stories and the like). */
export function canShareFiles(): boolean {
  try {
    const probe = new File([new Uint8Array(1)], 'happow.png', { type: 'image/png' });
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/** The event's preview card (the Worker draws it, M9 §2) as a file to share. */
export async function previewFile(id: string): Promise<File> {
  const res = await fetch(`/e/${encodeURIComponent(id)}/preview.png`);
  if (!res.ok) throw new Error(`preview ${res.status}`);
  return new File([await res.blob()], 'happow.png', { type: 'image/png' });
}

/**
 * A QR code for a link, drawn on the device (no server call): the module count and one SVG path
 * of its dark squares, with medium error correction so a printed flyer still scans.
 */
export function qrPath(text: string): { size: number; d: string } {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return { size, d };
}
