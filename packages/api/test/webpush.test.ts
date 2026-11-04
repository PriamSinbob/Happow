import {
  createECDH,
  createDecipheriv,
  createHmac,
  createVerify,
  generateKeyPairSync,
} from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  b64url,
  encryptPayload,
  fromB64url,
  importEcdh,
  sendPush,
  vapidHeader,
  vapidKey,
} from '../src/webpush';

/** M10 slice D: Web Push encryption (RFC 8291) and VAPID (RFC 8292). */

// RFC 8291 §5, "Push Message Encryption Example".
const rfc = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic:
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  /** The example's ciphertext: the record after salt, record size, key id length and key id. */
  ciphertext: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ',
};

/** An independent decryption with Node's crypto, as a browser would do it. */
function decrypt(body: Uint8Array, uaPrivate: string, uaPublic: string, auth: string): string {
  const b = Buffer.from(body);
  const salt = b.subarray(0, 16);
  const idlen = b[20]!;
  const asPublic = b.subarray(21, 21 + idlen);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(fromB64url(uaPrivate)));
  const shared = ecdh.computeSecret(asPublic);
  const h = (key: Buffer, data: Buffer) => createHmac('sha256', key).update(data).digest();
  const expand = (prk: Buffer, info: Buffer, n: number) =>
    h(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, n);
  const ikm = expand(
    h(Buffer.from(fromB64url(auth)), shared),
    Buffer.concat([Buffer.from('WebPush: info\0'), Buffer.from(fromB64url(uaPublic)), asPublic]),
    32,
  );
  const prk = h(salt, ikm);
  const cek = expand(prk, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = expand(prk, Buffer.from('Content-Encoding: nonce\0'), 12);
  const record = b.subarray(21 + idlen);
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([d.update(record.subarray(0, record.length - 16)), d.final()]);
  expect(plain[plain.length - 1]).toBe(2);
  return plain.subarray(0, plain.length - 1).toString();
}

describe('message encryption (RFC 8291)', () => {
  it('matches the example in RFC 8291 §5', async () => {
    const local = await importEcdh(rfc.asPrivate, rfc.asPublic);
    const body = await encryptPayload(
      new TextEncoder().encode(rfc.plaintext),
      { p256dh: rfc.uaPublic, auth: rfc.auth },
      { local, salt: fromB64url(rfc.salt) },
    );
    expect(b64url(body.slice(0, 16))).toBe(rfc.salt);
    expect([...body.slice(16, 21)]).toEqual([0, 0, 0x10, 0, 65]);
    expect(b64url(body.slice(21, 86))).toBe(rfc.asPublic);
    expect(b64url(body.slice(86))).toBe(rfc.ciphertext);
    expect(decrypt(body, rfc.uaPrivate, rfc.uaPublic, rfc.auth)).toBe(rfc.plaintext);
  });

  it('a fresh message decrypts on the receiving side', async () => {
    const ua = createECDH('prime256v1');
    ua.generateKeys();
    const uaPublic = b64url(ua.getPublicKey());
    const uaPrivate = b64url(ua.getPrivateKey());
    const auth = b64url(crypto.getRandomValues(new Uint8Array(16)));
    const body = await encryptPayload(new TextEncoder().encode('{"title":"Hej"}'), {
      p256dh: uaPublic,
      auth,
    });
    expect(decrypt(body, uaPrivate, uaPublic, auth)).toBe('{"title":"Hej"}');
  });
});

describe('VAPID (RFC 8292)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const secret = JSON.stringify(privateKey.export({ format: 'jwk' }));

  it('signs a JWT for the push service origin that the public key verifies', async () => {
    const key = await vapidKey(secret);
    expect(fromB64url(key.publicKey)).toHaveLength(65);
    const now = new Date('2026-11-04T20:00:00Z');
    const header = await vapidHeader(
      key,
      'https://fcm.googleapis.com/fcm/send/abc',
      'mailto:a@example.org',
      now,
    );
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
    expect(m[4]).toBe(key.publicKey);
    const claims = JSON.parse(Buffer.from(fromB64url(m[2]!)).toString());
    expect(claims).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: now.getTime() / 1000 + 12 * 3600,
      sub: 'mailto:a@example.org',
    });
    const ok = createVerify('SHA256')
      .update(`${m[1]}.${m[2]}`)
      .verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(fromB64url(m[3]!)));
    expect(ok).toBe(true);
  });

  it('rejects a key that is not a P-256 private JWK', async () => {
    await expect(vapidKey('{"kty":"RSA"}')).rejects.toThrow();
  });

  it('posts the encrypted body and reports a gone subscription', async () => {
    const key = await vapidKey(secret);
    const ua = createECDH('prime256v1');
    ua.generateKeys();
    const sub = {
      endpoint: 'https://push.example/sub/1',
      p256dh: b64url(ua.getPublicKey()),
      auth: b64url(crypto.getRandomValues(new Uint8Array(16))),
    };
    const seen: RequestInit[] = [];
    const answer = (status: number) =>
      (async (_url: string | URL | Request, init?: RequestInit) => {
        seen.push(init!);
        return new Response(null, { status });
      }) as typeof fetch;
    const opts = { subject: 'mailto:a@example.org', ttlSeconds: 600, now: new Date() };
    expect(await sendPush(sub, { title: 'x' }, key, { ...opts, fetch: answer(201) })).toBe('sent');
    const h = seen[0]!.headers as Record<string, string>;
    expect(h['content-encoding']).toBe('aes128gcm');
    expect(h.ttl).toBe('600');
    expect(h.authorization).toMatch(/^vapid t=.+, k=/);
    expect(
      decrypt(seen[0]!.body as Uint8Array, b64url(ua.getPrivateKey()), sub.p256dh, sub.auth),
    ).toBe('{"title":"x"}');
    expect(await sendPush(sub, {}, key, { ...opts, fetch: answer(410) })).toBe('gone');
    expect(await sendPush(sub, {}, key, { ...opts, fetch: answer(500) })).toBe('failed');
  });
});
