import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import webpush from 'web-push';

const localEnvPath = path.join(process.cwd(), '.env.local');
const localEnv = fs.readFileSync(localEnvPath, 'utf8');

let isolatedDbUrl = '';
for (const line of localEnv.split(/\r?\n/)) {
  const m = line.match(/^\s*SPARTA_ISOLATED_TEST_DATABASE_URL\s*=\s*(.*)?\s*$/);
  if (m) {
    isolatedDbUrl = m[1].trim().replace(/^["']|["']$/g, '');
    break;
  }
}

if (!isolatedDbUrl) {
  for (const line of localEnv.split(/\r?\n/)) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.*)?\s*$/);
    if (m && m[1].includes('sparta_siaga_isolated')) {
      isolatedDbUrl = m[1].trim().replace(/^["']|["']$/g, '');
      break;
    }
  }
}

if (!isolatedDbUrl) {
  throw new Error('Confirmed isolated test database URL not found in .env.local');
}

const vapidKeys = webpush.generateVAPIDKeys();
const jwtSecret = crypto.randomBytes(32).toString('hex');
const workerSecret = crypto.randomBytes(32).toString('hex');

const smokeEnv = [
  'NODE_ENV=production',
  'PORT=3004',
  'HOSTNAME=0.0.0.0',
  'NEXT_TELEMETRY_DISABLED=1',
  'NEXT_PUBLIC_APP_NAME=SPARTA SIAGA',
  'NEXT_PUBLIC_APP_URL=https://sparta-alfamart.web.id',
  `DATABASE_URL=${isolatedDbUrl}`,
  'DATABASE_SSL_MODE=require',
  'DATABASE_POOL_MAX=5',
  `JWT_SECRET=${jwtSecret}`,
  `SPARTA_INTERNAL_WORKER_SECRET=${workerSecret}`,
  'PRIVATE_STORAGE_ROOT=/app/storage',
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`,
  `VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`,
  'VAPID_SUBJECT=mailto:admin@sparta-alfamart.web.id',
  ''
].join('\n');

const smokeEnvPath = path.join(process.cwd(), '.env.smoke-test.local');
fs.writeFileSync(smokeEnvPath, smokeEnv, { encoding: 'utf8' });
console.log('Smoke env created successfully at:', smokeEnvPath);
