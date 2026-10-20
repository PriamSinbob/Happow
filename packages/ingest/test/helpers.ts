import { readFileSync } from 'node:fs';
import { getRegion, loadConfig } from '@happow/core';

export const config = loadConfig();
export const region = getRegion(config);
export const source = (id: string) => {
  const s = config.sources.find((x) => x.id === id);
  if (!s) throw new Error(`no source ${id} in config`);
  return s;
};

export function fixture(path: string): string {
  return readFileSync(new URL(`./fixtures/${path}`, import.meta.url), 'utf8');
}

export interface Call {
  url: string;
  init: RequestInit;
}

/** A fetch that answers from a queue of fixture bodies and records every request. */
export function replayFetch(bodies: string[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...bodies];
  const impl = async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    const body = queue.shift();
    if (body === undefined) throw new Error(`unexpected request ${String(input)}`);
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch: impl as typeof fetch, calls };
}

export const noSleep = async () => {};
