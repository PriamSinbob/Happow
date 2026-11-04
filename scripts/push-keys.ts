/**
 * Makes the VAPID key pair for web push (M10 §4). Prints the private key as one line of JSON:
 * put it in the Worker's secret VAPID_PRIVATE_KEY (and in .env for `pnpm dev`). The public key is
 * worked out from it at /api/push/key, so nothing goes into config. Keep the key: replacing it
 * stops every existing subscription, and people would have to set their reminders again.
 */
import { generateKeyPairSync } from 'node:crypto';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
console.log(JSON.stringify(privateKey.export({ format: 'jwk' })));
