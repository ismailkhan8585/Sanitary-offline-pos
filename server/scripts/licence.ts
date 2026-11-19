/**
 * Vendor tool (never shipped to shops).
 *   npx tsx scripts/licence.ts keys                 → creates vendor-keys/ (run once; KEEP THE PRIVATE KEY SAFE)
 *   npx tsx scripts/licence.ts sign <HARDWARE-ID> [days]  → prints a licence key (no days = forever)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { makeLicenceKey } from '../src/lib/licence';

const dir = path.resolve(__dirname, '../../vendor-keys');
const [cmd, hwid, days] = process.argv.slice(2);

if (cmd === 'keys') {
  if (fs.existsSync(path.join(dir, 'licence-private.pem'))) throw new Error('Keys already exist. Never replace them: old licences would stop working.');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'licence-private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
  fs.writeFileSync(path.join(dir, 'licence-public.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
  console.log('Keys written to', dir, '\nPut this public key in server/src/lib/licence.ts:\n');
  console.log(publicKey.export({ type: 'spki', format: 'pem' }));
} else if (cmd === 'sign' && hwid) {
  const privateKey = fs.readFileSync(path.join(dir, 'licence-private.pem'), 'utf8');
  const expires = days ? Date.now() + Number(days) * 86_400_000 : 0;
  console.log(makeLicenceKey(privateKey, hwid.trim().toUpperCase(), expires));
} else {
  console.log('Usage: npx tsx scripts/licence.ts keys | sign <HARDWARE-ID> [days]');
}
