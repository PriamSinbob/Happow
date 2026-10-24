import { afterDay, type PlanId } from '@happow/core';
import { api } from './api';
import { accessToken } from './auth';
import { region } from './config';

/** The admin's endpoints (M8 §2 "How codes reach people", §4 "Grants"): admin role only. */

/** GET /api/admin/code-requests, oldest first. */
export interface CodeRequest {
  id: string;
  email: string;
  locale: string;
  createdAt: string;
  /** When a code was last made for it; null until then. */
  generatedAt: string | null;
  existingUser: boolean;
}

/** POST /api/admin/code-requests/:id/generate: the code and the email to send by hand. */
export interface ReadyEmail {
  email: string;
  locale: string;
  code: string;
  link: string;
  subject: string;
  body: string;
  mailto: string;
}

/** GET /api/admin/grants, newest first. */
export interface Grant {
  id: string;
  email: string;
  plan: PlanId;
  source: 'manual' | 'trial' | 'purchase';
  provider: string | null;
  startsAt: string;
  /** Null = no end. */
  endsAt: string | null;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
  active: boolean;
}

const call = async <T>(path: string, options: Parameters<typeof api>[1] = {}) =>
  api<T>(`admin/${path}`, { ...options, token: await accessToken() });

export const listCodeRequests = () => call<CodeRequest[]>('code-requests');

export const generateCode = (id: string) =>
  call<ReadyEmail>(`code-requests/${encodeURIComponent(id)}/generate`, { method: 'POST' });

export const deleteCodeRequest = (id: string) =>
  call<void>(`code-requests/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const listGrants = () => call<Grant[]>('grants');

export const addGrant = (grant: { email: string; endsAt: string | null; note?: string }) =>
  call<Grant>('grants', { body: grant });

export const endGrant = (id: string) =>
  call<void>(`grants/${encodeURIComponent(id)}`, { method: 'DELETE' });

/**
 * A grant's end from the last day it should work ("2026-12-31"): midnight after it in the region's
 * time zone, as the promotion ends (core `earlyAccessEnd`). `planLastDay` shows it back.
 */
export const grantEndsAt = (lastDay: string): string | null =>
  afterDay(lastDay, region.timezone)?.toISOString() ?? null;

/** Active grants first, each group in the server's order (newest first). */
export const activeFirst = (grants: readonly Grant[]): Grant[] => [
  ...grants.filter((g) => g.active),
  ...grants.filter((g) => !g.active),
];
