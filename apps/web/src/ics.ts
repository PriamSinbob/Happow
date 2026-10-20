import type { HappowEvent } from '@happow/core';

/** 20261024T180000Z */
function icsDate(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** RFC 5545 TEXT escaping. */
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Lines longer than 75 octets continue on the next line, indented by one space. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** A single-event iCalendar file for "Add to calendar". */
export function eventToIcs(ev: HappowEvent, url: string, now = new Date()): string {
  const location = [ev.venue?.name, ev.venue?.address].filter(Boolean).join(', ');
  const description = [ev.description, url].filter(Boolean).join('\n\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Happow//Happening Now//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${esc(ev.id)}@happow`,
    `DTSTAMP:${icsDate(now.toISOString())}`,
    `DTSTART:${icsDate(ev.startAt)}`,
    `DTEND:${icsDate(ev.endAt)}`,
    `SUMMARY:${esc(ev.title)}`,
    ...(location ? [`LOCATION:${esc(location)}`] : []),
    `GEO:${ev.point.lat.toFixed(6)};${ev.point.lng.toFixed(6)}`,
    ...(description ? [`DESCRIPTION:${esc(description)}`] : []),
    `URL:${url}`,
    ...(ev.status === 'cancelled' ? ['STATUS:CANCELLED'] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function downloadIcs(ev: HappowEvent, url: string): void {
  const blob = new Blob([eventToIcs(ev, url)], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${ev.title.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 60) || 'event'}.ics`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
