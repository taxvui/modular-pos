import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validatePublicConfig } from './public-config.mjs';

// Validate before touching either output directory; never write privileged keys.
const appConfig = validatePublicConfig({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
  key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '',
}, { allowEmpty: true });

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
fs.writeFileSync(path.join(publicDir, 'app-config.js'), `window.MODULAR_POS_CONFIG = ${JSON.stringify(appConfig)};\n`, 'utf-8');
for (const name of ['account.html', 'app-config.js', 'assets']) {
  fs.cpSync(path.join(publicDir, name), path.join(distDir, name), { recursive: true });
}

// A complete shell is installed atomically. New workers wait for old tabs to close.
const shellFiles = ['account.html', 'app-config.js', 'assets/account.mjs', 'assets/auth-client.mjs',
  'assets/sales.mjs', 'assets/offline-store.mjs', 'assets/offline-review.mjs', 'assets/staff-access.mjs', 'assets/order-history.mjs', 'assets/order-save.mjs', 'assets/shift-history.mjs', 'assets/pwa.mjs', 'service-worker.js'];
const shellHash = createHash('sha256');
for (const file of shellFiles) shellHash.update(file).update(fs.readFileSync(path.join(publicDir, file)));
const buildId = shellHash.digest('hex').slice(0, 20);
const worker = fs.readFileSync(path.join(publicDir, 'service-worker.js'), 'utf8')
  .replace('__BUILD_ID__', buildId);
fs.writeFileSync(path.join(publicDir, 'sw.js'), worker);
fs.writeFileSync(path.join(distDir, 'sw.js'), worker);

// The checker compares actual served bytes to this manifest; it is not a database health claim.
const deploymentFiles = [...shellFiles.filter(name => name !== 'service-worker.js'), 'sw.js', 'health.json'];
const manifest = JSON.stringify({version: 1, buildId, assets: deploymentFiles.map(name => ({
  path: '/' + name, sha256: createHash('sha256').update(fs.readFileSync(path.join(publicDir, name))).digest('hex'),
}))}, null, 2);
for (const target of [publicDir, distDir]) fs.writeFileSync(path.join(target, 'deployment-manifest.json'), manifest);
