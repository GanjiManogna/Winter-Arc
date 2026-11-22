import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('PWA manifest has install metadata and correctly sized Winter Arc icons', async () => {
  const manifest = JSON.parse(await read('../public/manifest.webmanifest'));
  assert.equal(manifest.name, 'Winter Arc');
  assert.equal(manifest.short_name, 'Winter Arc');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.orientation, 'portrait-primary');
  assert.ok(manifest.theme_color);
  assert.ok(manifest.background_color);
  assert.ok(manifest.description);

  for (const [size, filename] of [[192, 'winter-arc-192.png'], [512, 'winter-arc-512.png']]) {
    const icon = await readFile(new URL(`../public/icons/${filename}`, import.meta.url));
    assert.equal(icon.toString('ascii', 1, 4), 'PNG');
    assert.equal(icon.readUInt32BE(16), size);
    assert.equal(icon.readUInt32BE(20), size);
    assert.ok(manifest.icons.some((entry) => entry.src.endsWith(filename) && entry.sizes === `${size}x${size}`));
  }
  assert.ok(manifest.icons.some((entry) => entry.purpose === 'maskable' && entry.sizes === '512x512'));
});

test('document declares manifest, mobile viewport and standalone iOS metadata', async () => {
  const html = await read('../index.html');
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /apple-touch-icon/);
});

test('service worker caches only the app shell and allow-listed same-origin static assets', async () => {
  const worker = await read('../public/sw.js');
  assert.match(worker, /const APP_SHELL/);
  assert.match(worker, /url\.origin !== self\.location\.origin/);
  assert.match(worker, /request\.headers\.has\('authorization'\)/);
  assert.match(worker, /PRIVATE_API_PATHS/);
  assert.match(worker, /startsWith\('\/assets\/'\)/);
  assert.match(worker, /PUBLIC_STATIC_PATHS\.has/);
  assert.match(worker, /request\.mode === 'navigate'/);
  assert.doesNotMatch(worker, /skipWaiting\s*\(/);
  assert.doesNotMatch(worker, /clients\.claim\s*\(/);
  assert.doesNotMatch(worker, /supabase\.co/);
});

test('production registers the progressive service worker without changing app routes or auth', async () => {
  const registration = await read('../src/pwa/registerServiceWorker.js');
  const main = await read('../src/main.jsx');
  const app = await read('../src/App.jsx');
  const provider = await read('../src/auth/AuthProvider.jsx');
  const client = await read('../src/lib/supabase.js');
  assert.match(registration, /import\.meta\.env\.PROD/);
  assert.match(registration, /navigator\.serviceWorker\.register\('\/sw\.js'/);
  assert.match(main, /registerServiceWorker\(\)/);
  for (const path of ['/', '/today', '/ritual/:ritualId', '/journey', '/history', '/login', '/signup']) {
    assert.ok(app.includes(`path="${path}"`), `missing route ${path}`);
  }
  assert.match(main, /<AuthProvider>/);
  assert.match(provider, /getCurrentSession/);
  assert.match(client, /createClient\(supabaseUrl, supabaseAnonKey\)/);
});
