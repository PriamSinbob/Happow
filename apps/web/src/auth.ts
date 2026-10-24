/**
 * Sign-in with Supabase Auth over plain fetch (no SDK in the bundle), M8 §2: a 6-digit email
 * code or Google (PKCE). Sessions live in localStorage with refresh-token rotation, so an
 * installed app stays signed in.
 */
import { api } from './api';
import { config } from './config';

const KEY = 'happow:session';
/** The PKCE verifier waits here across the Google redirect (this tab only). */
const VERIFIER = 'happow:pkce';
/** The screen to land on after the Google round trip. */
const LAND = 'happow:land';

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

const listeners = new Set<() => void>();
/** Called whenever the session starts, ends or is replaced by another tab. */
export function onSessionChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
if (typeof window !== 'undefined')
  window.addEventListener('storage', (e) => e.key === KEY && listeners.forEach((fn) => fn()));

function save(s: Session | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
    // Sessions before M8 lived in sessionStorage.
    sessionStorage.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
  listeners.forEach((fn) => fn());
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY);
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

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

function saveTokens(t: TokenResponse) {
  save({
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Date.now() + t.expires_in * 1000,
    email: emailFromJwt(t.access_token),
  });
}

async function gotrue(path: string, body: unknown): Promise<Response> {
  const e = env();
  if (!e) throw new Error('auth not configured');
  return fetch(`${e.url}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: e.key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const appUrl = () => `${window.location.origin}${window.location.pathname}`;

/**
 * Asks for a sign-in code. With manual delivery (until the app has an email sender) the Worker
 * files the request and the owner emails the code by hand; otherwise Supabase sends it.
 */
export async function requestCode(email: string, locale: string): Promise<void> {
  if (config.app.auth.emailDelivery === 'manual') {
    await api('auth/code-request', { body: { email, locale } });
    return;
  }
  const res = await gotrue(`otp?redirect_to=${encodeURIComponent(appUrl())}`, {
    email,
    create_user: true,
  });
  if (!res.ok) throw new Error(`otp ${res.status}`);
}

/** Signs in with the 6-digit code; false when the code is wrong or has expired. */
export async function verifyCode(email: string, code: string): Promise<boolean> {
  const res = await gotrue('verify', { type: 'email', email, token: code });
  if (!res.ok) return false;
  saveTokens((await res.json()) as TokenResponse);
  return true;
}

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/**
 * Starts Google sign-in: PKCE, so the code that comes back is useless without this tab. `landOn`
 * is the screen to come back to (the add form when sign-in started there).
 */
export async function signInWithGoogle(landOn: 'about' | 'add' = 'about'): Promise<void> {
  const e = env();
  if (!e) return;
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  );
  sessionStorage.setItem(VERIFIER, verifier);
  sessionStorage.setItem(LAND, landOn);
  const q = new URLSearchParams({
    provider: 'google',
    redirect_to: appUrl(),
    code_challenge: challenge,
    code_challenge_method: 's256',
  });
  window.location.assign(`${e.url}/auth/v1/authorize?${q}`);
}

/**
 * Takes a sign-in out of the URL before anything else reads it, and lands on About:
 * `#access_token=…` from the link in a code email, or `?code=…` back from Google. Resolves once
 * the Google code has been exchanged (true when a sign-in happened).
 */
export function captureAuthRedirect(): Promise<boolean> {
  const url = new URL(window.location.href);
  const land = (search: string, to = 'about') =>
    window.history.replaceState(null, '', `${url.pathname}${search}#/${to}`);

  if (url.hash.includes('access_token=')) {
    const p = new URLSearchParams(url.hash.slice(1));
    const accessToken = p.get('access_token');
    const refreshToken = p.get('refresh_token');
    if (accessToken && refreshToken)
      saveTokens({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: Number(p.get('expires_in') ?? 3600),
      });
    land(url.search);
    return Promise.resolve(Boolean(accessToken));
  }

  const code = url.searchParams.get('code');
  const failed = url.searchParams.has('error');
  if (!code && !failed) return Promise.resolve(false);
  for (const k of ['code', 'error', 'error_code', 'error_description']) url.searchParams.delete(k);
  let verifier: string | null = null;
  let to = 'about';
  try {
    verifier = sessionStorage.getItem(VERIFIER);
    to = sessionStorage.getItem(LAND) === 'add' ? 'add' : 'about';
    sessionStorage.removeItem(VERIFIER);
    sessionStorage.removeItem(LAND);
  } catch {
    /* storage blocked */
  }
  land(url.search, to);
  if (!code || !verifier) return Promise.resolve(false);
  exchanging = true;
  return gotrue('token?grant_type=pkce', { auth_code: code, code_verifier: verifier })
    .then(async (res) => {
      if (!res.ok) return false;
      saveTokens((await res.json()) as TokenResponse);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      exchanging = false;
    });
}

let exchanging = false;
/** True while a Google code is being exchanged, so the app doesn't show itself signed out. */
export const signInPending = () => exchanging;

let refreshing: Promise<string | null> | null = null;

/** A valid access token, refreshed when it is about to expire; null when signed out. */
export async function accessToken(): Promise<string | null> {
  const s = loadSession();
  if (!s) return null;
  if (s.expiresAt - Date.now() > 60_000) return s.accessToken;
  // One refresh at a time: refresh tokens rotate, so a second parallel refresh would fail.
  refreshing ??= (async () => {
    try {
      const res = await gotrue('token?grant_type=refresh_token', {
        refresh_token: s.refreshToken,
      });
      if (res.status >= 400 && res.status < 500) {
        save(null);
        return null;
      }
      if (!res.ok) return null; // offline or a server error: try again next time
      const t = (await res.json()) as TokenResponse;
      saveTokens(t);
      return t.access_token;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export function signOut(): void {
  save(null);
}
