/**
 * Moderator sign-in with Supabase Auth magic links, over plain fetch (no SDK in the bundle).
 * Sessions live in sessionStorage: closing the browser signs the moderator out.
 */
const KEY = 'happow:session';

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email: string | null;
}

const env = () => {
  const { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key } = import.meta.env;
  return url && key ? { url: url.replace(/\/$/, ''), key } : null;
};

export const authAvailable = () => env() !== null;

function save(s: Session | null) {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
}

export function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function emailFromJwt(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.email === 'string' ? payload.email : null;
  } catch {
    return null;
  }
}

/**
 * Supabase returns to `<app>/#access_token=…&refresh_token=…` after the magic link. Take the
 * tokens out of the URL before anything else reads the hash, and land on the moderation screen.
 */
export function captureAuthRedirect(): void {
  const h = window.location.hash;
  if (!h.includes('access_token=')) return;
  const p = new URLSearchParams(h.slice(1));
  const accessToken = p.get('access_token');
  const refreshToken = p.get('refresh_token');
  if (accessToken && refreshToken) {
    save({
      accessToken,
      refreshToken,
      expiresAt: Date.now() + Number(p.get('expires_in') ?? 3600) * 1000,
      email: emailFromJwt(accessToken),
    });
  }
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${window.location.search}#/moderate`,
  );
}

export async function sendMagicLink(email: string): Promise<boolean> {
  const e = env();
  if (!e) return false;
  const redirect = `${window.location.origin}${window.location.pathname}`;
  const res = await fetch(`${e.url}/auth/v1/otp?redirect_to=${encodeURIComponent(redirect)}`, {
    method: 'POST',
    headers: { apikey: e.key, 'content-type': 'application/json' },
    // Only existing users: moderators are invited in Supabase, nobody signs up here.
    body: JSON.stringify({ email, create_user: false }),
  });
  return res.ok;
}

/** A valid access token, refreshed when it is about to expire; null when signed out. */
export async function accessToken(): Promise<string | null> {
  const s = loadSession();
  if (!s) return null;
  if (s.expiresAt - Date.now() > 60_000) return s.accessToken;
  const e = env();
  if (!e) return null;
  const res = await fetch(`${e.url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: e.key, 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: s.refreshToken }),
  });
  if (!res.ok) {
    save(null);
    return null;
  }
  const t = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  save({
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Date.now() + t.expires_in * 1000,
    email: emailFromJwt(t.access_token),
  });
  return t.access_token;
}

export function signOut(): void {
  save(null);
}
