import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const rootDir = process.cwd();
const publicDir = path.join(rootDir, 'public');
const distDir = path.join(rootDir, 'dist');

fs.mkdirSync(publicDir, { recursive: true });
fs.mkdirSync(distDir, { recursive: true });

const rootIndex = path.join(rootDir, 'index.html');
const publicIndex = path.join(publicDir, 'index.html');
const distIndex = path.join(distDir, 'index.html');

if (fs.existsSync(rootIndex)) {
  const html = fs.readFileSync(rootIndex, 'utf-8');
  fs.writeFileSync(publicIndex, html, 'utf-8');
  fs.writeFileSync(distIndex, html, 'utf-8');
}

const healthPayload = JSON.stringify({
  status: 'STATIC_BUILD_READY',
  app: 'modular-pos-monorepo',
  version: '2.2.0-admin-auth',
  stage: 'MVP_FOUNDATION',
  databaseChecked: false,
  vercelReady: true,
  builtAt: new Date().toISOString()
}, null, 2);

fs.writeFileSync(path.join(publicDir, 'health.json'), healthPayload, 'utf-8');
fs.writeFileSync(path.join(distDir, 'health.json'), healthPayload, 'utf-8');

console.log('✔ Modular POS Vercel static bundle prepared in public/ and dist/');

// Only browser-safe configuration is emitted. Service-role credentials stay server-side.
const appConfig = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
  key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '',
};
fs.writeFileSync(path.join(publicDir, 'app-config.js'), `window.MODULAR_POS_CONFIG = ${JSON.stringify(appConfig)};\n`, 'utf-8');
for (const name of ['account.html', 'app-config.js', 'assets']) {
  fs.cpSync(path.join(publicDir, name), path.join(distDir, name), { recursive: true });
}

// A complete shell is installed atomically. New workers wait for old tabs to close.
const shellFiles = ['account.html', 'app-config.js', 'assets/account.mjs', 'assets/auth-client.mjs',
  'assets/sales.mjs', 'assets/offline-store.mjs', 'assets/offline-review.mjs', 'assets/staff-access.mjs', 'assets/pwa.mjs', 'service-worker.js'];
const shellHash = createHash('sha256');
for (const file of shellFiles) shellHash.update(file).update(fs.readFileSync(path.join(publicDir, file)));
const worker = fs.readFileSync(path.join(publicDir, 'service-worker.js'), 'utf8')
  .replace('__BUILD_ID__', shellHash.digest('hex').slice(0, 20));
fs.writeFileSync(path.join(publicDir, 'sw.js'), worker);
fs.writeFileSync(path.join(distDir, 'sw.js'), worker);
