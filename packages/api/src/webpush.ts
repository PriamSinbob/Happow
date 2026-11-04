/**
 * Web Push from the Worker (M10 §4, slice D) with WebCrypto only: message encryption as in
 * RFC 8291 (aes128gcm, RFC 8188) and the VAPID signature of RFC 8292. No Node library, so it runs
 * in the Cron Trigger. The private key is a P-256 JWK in the secret named by `push.secret`; the
 * public key the browser needs is worked out from it (GET /api/push/key).
 */

export interface PushSubscriptionKeys {
  endpoint: string;
  /** The browser's P-256 public key, base64url (65 bytes uncompressed). */
  p256dh: string;
  /** The browser's 16-byte auth secret, base64url. */
  auth: string;
}

export interface VapidKey {
  privateKey: CryptoKey;
  /** base64url of the 65-byte uncompressed public point: the applicationServerKey. */
  publicKey: string;
}

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((n, p) => n + p.length, 0)));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey(
    'raw',
    key as Uint8Array<ArrayBuffer>,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data as Uint8Array<ArrayBuffer>));
}

/** HKDF-Extract then one block of HKDF-Expand (enough for every length used here). */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length);
}

/** A P-256 key pair from its raw private scalar and public point (for test vectors). */
export async function importEcdh(privateB64: string, publicB64: string): Promise<CryptoKeyPair> {
  const pub = fromB64url(publicB64);
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: privateB64,
    x: b64url(pub.slice(1, 33)),
    y: b64url(pub.slice(33, 65)),
  };
  return {
    privateKey: await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    ),
    publicKey: await crypto.subtle.importKey(
      'raw',
      pub,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      [],
    ),
  };
}

/**
 * The encrypted body for one subscription (RFC 8291 §3–§4): salt, record size, the server's
 * one-time public key, then the AES-128-GCM record. `local` and `salt` are for test vectors only.
 */
export async function encryptPayload(
  plaintext: Uint8Array,
  sub: Pick<PushSubscriptionKeys, 'p256dh' | 'auth'>,
  opts: { local?: CryptoKeyPair; salt?: Uint8Array } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const local =
    opts.local ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const uaPublic = fromB64url(sub.p256dh);
  const authSecret = fromB64url(sub.auth);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256),
  );
  const ikm = await hkdf(
    authSecret,
    shared,
    concat(enc.encode('WebPush: info\0'), uaPublic, asPublic),
    32,
  );
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // One record: the payload, then the 0x02 delimiter of the last record.
  const record = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      key,
      concat(plaintext, new Uint8Array([2])),
    ),
  );
  const rs = new Uint8Array([0, 0, 0x10, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, record);
}

/** The VAPID key from the secret: a P-256 private JWK (as `pnpm push:keys` prints it). */
export async function vapidKey(secret: string): Promise<VapidKey> {
  const jwk = JSON.parse(secret) as JsonWebKey;
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d || !jwk.x || !jwk.y)
    throw new Error('push key must be a P-256 private JWK');
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: jwk.d, x: jwk.x, y: jwk.y },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const publicKey = b64url(concat(new Uint8Array([4]), fromB64url(jwk.x), fromB64url(jwk.y)));
  return { privateKey, publicKey };
}

/** `Authorization: vapid t=<JWT>, k=<public key>` for one push service (RFC 8292 §2–§3). */
export async function vapidHeader(
  key: VapidKey,
  endpoint: string,
  subject: string,
  now: Date,
): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(
    enc.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        // At most 24 hours ahead; 12 leaves room for clock differences.
        exp: Math.floor(now.getTime() / 1000) + 12 * 3600,
        sub: subject,
      }),
    ),
  );
  const unsigned = `${header}.${claims}`;
  // WebCrypto's ECDSA signature is r || s, which is what JWS ES256 wants.
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key.privateKey,
      enc.encode(unsigned),
    ),
  );
  return `vapid t=${unsigned}.${b64url(sig)}, k=${key.publicKey}`;
}

export type PushOutcome = 'sent' | 'gone' | 'failed';

/**
 * Sends one message. `gone`: the subscription no longer exists (404 or 410) and should be
 * deleted; `failed`: anything else, tried again on the next tick if still due.
 */
export async function sendPush(
  sub: PushSubscriptionKeys,
  payload: unknown,
  key: VapidKey,
  opts: { subject: string; ttlSeconds: number; now: Date; fetch?: typeof fetch },
): Promise<PushOutcome> {
  const body = await encryptPayload(enc.encode(JSON.stringify(payload)), sub);
  const res = await (opts.fetch ?? fetch)(sub.endpoint, {
    method: 'POST',
    headers: {
      authorization: await vapidHeader(key, sub.endpoint, opts.subject, opts.now),
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: String(opts.ttlSeconds),
      urgency: 'high',
    },
    body,
  });
  if (res.status === 404 || res.status === 410) return 'gone';
  return res.ok ? 'sent' : 'failed';
}
