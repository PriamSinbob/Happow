import { vi } from 'vitest';
import { loadConfig } from '@happow/core';

export const SB = 'https://proj.supabase.co';
export const env = {
  SUPABASE_URL: SB,
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  SUBMITTER_SALT: 'salt',
};
export const config = loadConfig();

export type Rpc = (args: Record<string, unknown>) => { status?: number; body: unknown };
export type User = { id: string; email: string };

/** Accounts by bearer token. */
export const users: Record<string, User> = {
  'user-token': { id: 'u1', email: 'ala@example.org' },
  'mod-token': { id: 'u2', email: 'mod@example.org' },
  'admin-token': { id: 'u3', email: 'owner@example.org' },
};
const roles: Record<string, string> = {
  'mod@example.org': 'moderator',
  'owner@example.org': 'admin',
};

/** What any request needs: no limit hit, staff by email, no grants, nothing used this month. */
const baseRpc: Record<string, Rpc> = {
  rate_limit_hit: () => ({ body: true }),
  staff_role: (a) => ({ body: roles[a.p_email as string] ?? null }),
  grants_active: () => ({ body: [] }),
  usage_get: () => ({ body: { events: 0, autofills: 0 } }),
};

/** Submissions: nobody trusted, no duplicate, the usual reward. */
export const submitRpc: Record<string, Rpc> = {
  contributor_trusted: () => ({ body: false }),
  duplicate_candidates: () => ({ body: { title: 'Pchli targ na Ruskiej', others: [] } }),
  contribution_award: () => ({ body: { kind: 'verified', days: 3, startsAt: null } }),
};

/** Organisers: every event public, nobody an organiser, empty organiser queues. */
export const organiserRpc: Record<string, Rpc> = {
  event_visibility: () => ({ body: 'public' }),
  organiser_at: () => ({ body: false }),
  claims_queue: () => ({ body: [] }),
  edits_queue: () => ({ body: [] }),
  post_reports_queue: () => ({ body: [] }),
};

export const fail =
  (code: string): Rpc =>
  () => ({ status: 400, body: { code, message: code } });

/**
 * Fake Supabase: PostgREST RPCs (`rpc` over the defaults above), GoTrue's /user for `users`, and
 * anything else to `other`, else 404. Records every Supabase request, and RPC calls by name.
 */
export function supabase(
  rpc: Record<string, Rpc> = {},
  opts: {
    users?: Record<string, User>;
    other?: (url: string, init: RequestInit) => Response | undefined;
  } = {},
) {
  const all = { ...baseRpc, ...rpc };
  const known = opts.users ?? users;
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const requests: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const f = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    if (url.startsWith(SB)) {
      const body = init.body ? JSON.parse(String(init.body)) : {};
      requests.push({ method: init.method ?? 'GET', path: url.slice(SB.length), body });
      if (url.startsWith(`${SB}/rest/v1/rpc/`)) {
        const name = url.slice(`${SB}/rest/v1/rpc/`.length);
        calls.push({ name, args: body });
        const h = all[name];
        if (!h) return new Response('{}', { status: 404 });
        const { status = 200, body: out } = h(body);
        // A function returning void: PostgREST answers 204 with no body.
        if (status === 204) return new Response(null, { status });
        return new Response(JSON.stringify(out), { status });
      }
      if (url === `${SB}/auth/v1/user`) {
        const token = new Headers(init.headers).get('authorization')?.replace('Bearer ', '') ?? '';
        const u = known[token];
        return u ? Response.json(u) : new Response('{}', { status: 401 });
      }
    }
    return opts.other?.(url, init) ?? new Response('not found', { status: 404 });
  });
  const call = (name: string) => calls.filter((c) => c.name === name);
  return { fetch: f as unknown as typeof fetch, calls, call, requests };
}

export const req = (path: string, init: { method?: string; token?: string; body?: unknown } = {}) =>
  new Request(`https://happow.example/api/${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.7',
      ...(init.token && { authorization: `Bearer ${init.token}` }),
    },
    ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
  });
