import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { entitlementsFor, type Entitlements, type PlanId, type PlanSource } from '@happow/core';
import { api, ApiError } from './api';
import {
  accessToken,
  loadSession,
  onSessionChange,
  signInPending,
  signOut as endSession,
} from './auth';
import { config } from './config';
import { storage } from './storage';

/** GET /api/me (M8 §2–§5). */
export interface Me {
  id: string;
  email: string;
  role: 'moderator' | 'admin' | null;
  locale: string | null;
  termsVersion: string | null;
  plan: PlanId;
  planSource: PlanSource | null;
  planEndsAt: string | null;
  /** "Show my name on events I add" and that name (M12 §5.5). */
  showName?: boolean;
  displayName?: string | null;
  entitlements: Entitlements;
  usage: {
    month: string;
    resetsAt: string;
    events: { used: number; limit: number };
    autofill: { used: number; limit: number };
  };
}

export interface Account {
  /** "loading" only while a session exists and /api/me hasn't answered yet. */
  status: 'signedOut' | 'loading' | 'signedIn';
  me: Me | null;
  /** What this person may use now: their plan's, or the anonymous plan's when signed out. */
  entitlements: Entitlements;
  /** Signed in, but the current terms version isn't accepted yet (new account, or new terms). */
  needsTerms: boolean;
  refresh: () => Promise<void>;
  acceptTerms: () => Promise<void>;
  exportData: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  signOut: () => void;
}

const ANONYMOUS = entitlementsFor(config.plans, 'anonymous');
const CACHE = 'me';

/** The last /api/me, so plan-gated settings (the colour preset) don't flash at start-up. */
function cachedMe(): Me | null {
  if (!loadSession()) return null;
  try {
    const raw = storage.get(CACHE);
    return raw ? (JSON.parse(raw) as Me) : null;
  } catch {
    return null;
  }
}

const noop = async () => {};
const SIGNED_OUT: Account = {
  status: 'signedOut',
  me: null,
  entitlements: ANONYMOUS,
  needsTerms: false,
  refresh: noop,
  acceptTerms: noop,
  exportData: noop,
  deleteAccount: noop,
  signOut: () => {},
};

const Ctx = createContext<Account>(SIGNED_OUT);
const RESOLVED = Promise.resolve();

/** Holds the signed-in account. `ready` resolves once a sign-in redirect has been handled. */
export function AccountProvider({
  children,
  ready = RESOLVED,
}: {
  children: ReactNode;
  ready?: Promise<unknown>;
}) {
  const [me, setMe] = useState<Me | null>(cachedMe);
  const [status, setStatus] = useState<Account['status']>(() =>
    loadSession() || signInPending() ? 'loading' : 'signedOut',
  );

  const store = (m: Me | null) => {
    setMe(m);
    storage.set(CACHE, m ? JSON.stringify(m) : '');
  };

  const refresh = useCallback(async () => {
    const token = await accessToken();
    if (!token) {
      store(null);
      setStatus('signedOut');
      return;
    }
    try {
      store(await api<Me>('me', { token }));
      setStatus('signedIn');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        endSession();
        return;
      }
      // Offline or a server error: keep the cached account, if any.
      setStatus(cachedMe() ? 'signedIn' : 'loading');
    }
  }, []);

  useEffect(() => {
    let live = true;
    void ready.then(() => {
      if (live) void refresh();
    });
    const off = onSessionChange(() => {
      if (!loadSession()) {
        store(null);
        setStatus('signedOut');
      } else {
        // A new sign-in is "loading" at once, so a signed-out screen doesn't come back while
        // /api/me answers; a token refresh keeps the account as it is.
        setStatus((s) => (s === 'signedOut' ? 'loading' : s));
        void refresh();
      }
    });
    return () => {
      live = false;
      off();
    };
  }, [ready, refresh]);

  const value = useMemo<Account>(() => {
    const signedIn = status === 'signedIn' && me !== null;
    return {
      status,
      me: signedIn ? me : null,
      // While /api/me loads, the cached plan holds, so a premium colour doesn't flash off.
      entitlements: status !== 'signedOut' && me ? me.entitlements : ANONYMOUS,
      needsTerms: signedIn && me.termsVersion !== config.app.legal.termsVersion,
      refresh,
      acceptTerms: async () => {
        const token = await accessToken();
        await api('me', {
          token,
          method: 'PUT',
          body: { termsVersion: config.app.legal.termsVersion },
        });
        await refresh();
      },
      exportData: async () => {
        const token = await accessToken();
        const res = await fetch('/api/me/export', {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new ApiError(res.status, 'server_error');
        const name =
          /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') ?? '')?.[1] ??
          'happow-account.json';
        const href = URL.createObjectURL(await res.blob());
        Object.assign(document.createElement('a'), { href, download: name }).click();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
      },
      deleteAccount: async () => {
        const token = await accessToken();
        await api('me', { token, method: 'DELETE' });
        endSession();
      },
      signOut: endSession,
    };
  }, [status, me, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAccount = () => useContext(Ctx);

/** Entitlements before the first render (the theme is applied before React starts). */
export const initialEntitlements = (): Entitlements => cachedMe()?.entitlements ?? ANONYMOUS;
