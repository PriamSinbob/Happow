import type { AppConfig } from '@happow/core';

/**
 * The app's own email (M13 §5), behind one interface so the provider is a config choice.
 * Resend first: a plain HTTP API that works from a Worker. Nothing is sent while
 * `email.provider` is "none" or its secret is missing.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  readonly provider: string;
  send(message: EmailMessage): Promise<void>;
}

export class EmailError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Resend (resend.com): POST /emails with a bearer key; 200 answers `{ id }`. */
export function resendSender(opts: {
  key: string;
  from: string;
  endpoint: string;
  fetch?: typeof fetch;
}): EmailSender {
  const doFetch: typeof fetch = (i, init) => (opts.fetch ?? globalThis.fetch)(i, init);
  return {
    provider: 'resend',
    async send(m) {
      const res = await doFetch(opts.endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${opts.key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: opts.from, to: [m.to], subject: m.subject, text: m.text }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new EmailError(res.status, `resend ${res.status}: ${body.message ?? 'error'}`);
      }
    },
  };
}

/** The configured sender, or null while email is off. */
export function emailSender(
  cfg: AppConfig['email'],
  env: Record<string, unknown>,
  fetch?: typeof globalThis.fetch,
): EmailSender | null {
  if (cfg.provider === 'none' || !cfg.from) return null;
  const key = env[cfg.secret];
  if (typeof key !== 'string' || !key) return null;
  return resendSender({ key, from: cfg.from, endpoint: cfg.endpoint, fetch });
}
