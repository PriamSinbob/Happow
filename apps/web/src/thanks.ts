import { api, deviceId } from './api';
import { storage } from './storage';

/**
 * "Thanks" after arriving with GoThere (M12 §6.4): anonymous, once per device and event. The
 * device remembers what it thanked so the button doesn't come back; the server counts each
 * device once anyway. Only the event's adder sees the total.
 */

const KEY = 'thanked';
const KEEP = 200;

function read(): string[] {
  try {
    const list = JSON.parse(storage.get(KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function thanked(eventId: string): boolean {
  return read().includes(eventId);
}

export async function sendThanks(eventId: string): Promise<void> {
  await api('thanks', { body: { deviceId: deviceId(), eventId } });
  storage.set(KEY, JSON.stringify([...read().filter((x) => x !== eventId), eventId].slice(-KEEP)));
}
