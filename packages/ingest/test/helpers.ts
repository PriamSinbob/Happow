import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
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

/** A recorded page from the extract package's fixtures. */
export const page = (name: string) =>
  readFileSync(new URL(`../../extract/test/fixtures/${name}`, import.meta.url), 'utf8');

/** Serves the recorded pages by URL; anything else is a 404, like a vanished event page. */
export function site(pages: Record<string, string | { status: number }>) {
  const requested: string[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    const body = pages[url];
    if (body === undefined) return new Response('not found', { status: 404 });
    if (typeof body !== 'string') return new Response('', { status: body.status });
    const type = url.endsWith('.txt') ? 'text/plain' : 'text/html; charset=utf-8';
    return new Response(body, { status: 200, headers: { 'content-type': type } });
  });
  return { fetch: fetchMock as unknown as typeof fetch, requested };
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
