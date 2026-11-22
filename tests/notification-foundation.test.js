import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import {
  NOTIFICATION_CATEGORIES,
  defaultNotificationPreferences,
  deactivateCurrentDeviceSubscription,
  deactivateDeviceAfterAccountChange,
  detectNotificationCapabilities,
  enableNotifications,
  isValidIanaTimezone,
  loadNotificationSettings,
  saveNotificationPreferences,
  validateNotificationPreferences,
} from '../src/notifications/notificationService.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

function fakeClient(userId = 'account-a', { preferenceData = null, queryError = null, rpcError = null } = {}) {
  const calls = { queries: 0, rpcs: [], upserts: [] };
  const client = {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }) },
    from(table) {
      assert.equal(table, 'notification_preferences');
      return {
        select() {
          return { eq() { return { maybeSingle: async () => {
            calls.queries += 1;
            return { data: preferenceData, error: queryError };
          } }; } };
        },
        upsert: async (row, options) => {
          calls.upserts.push({ row, options });
          return { error: null };
        },
      };
    },
    rpc: async (name, args) => {
      calls.rpcs.push({ name, args });
      return { data: null, error: rpcError };
    },
  };
  return { client, calls };
}

function browser({ permission = 'default', subscription = null } = {}) {
  let subscribeCalls = 0;
  const pushSubscription = subscription || {
    endpoint: 'https://push.example/subscription/unique',
    toJSON: () => ({ keys: { p256dh: 'p'.repeat(32), auth: 'a'.repeat(16) } }),
    unsubscribe: async () => true,
  };
  const registration = {
    active: true,
    pushManager: {
      getSubscription: async () => subscription,
      subscribe: async () => { subscribeCalls += 1; return pushSubscription; },
    },
  };
  const navigatorRef = {
    serviceWorker: {
      getRegistration: async () => registration,
      register: async () => registration,
      ready: Promise.resolve(registration),
    },
  };
  const windowRef = {
    Notification: { permission, requestPermission: async () => permission },
    PushManager: function PushManager() {},
    isSecureContext: true,
    location: { hostname: 'winterarc.example' },
  };
  return { navigatorRef, windowRef, registration, pushSubscription, getSubscribeCalls: () => subscribeCalls };
}

const PUBLIC_KEY = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAh';

test('capability detection describes support and permission without requesting permission', () => {
  let requested = 0;
  const supported = detectNotificationCapabilities({
    windowRef: { Notification: { permission: 'default', requestPermission: () => { requested += 1; } }, PushManager: {}, isSecureContext: true },
    navigatorRef: { serviceWorker: {} },
    publicKeyConfigured: true,
  });
  assert.equal(supported.supported, true);
  assert.equal(supported.permission, 'default');
  assert.equal(requested, 0);
  const unsupported = detectNotificationCapabilities({ windowRef: null, navigatorRef: null });
  assert.equal(unsupported.supported, false);
  assert.equal(unsupported.permission, 'unavailable');
});

test('preference defaults include separate category times and a valid IANA timezone', () => {
  const preferences = defaultNotificationPreferences('Asia/Kolkata');
  assert.equal(preferences.timezone, 'Asia/Kolkata');
  assert.equal(preferences.enabled, false);
  assert.deepEqual(NOTIFICATION_CATEGORIES.map(({ id }) => preferences[`${id}_enabled`]), [false, false, false, false, false]);
  assert.equal(preferences.morning_time, '07:00');
  assert.equal(preferences.weekly_enabled, false);
  assert.equal(preferences.weekly_day, null);
  assert.equal(preferences.weekly_time, '');
  assert.equal(preferences.weekly_name, '');
  assert.equal(isValidIanaTimezone('America/Los_Angeles'), true);
  assert.equal(isValidIanaTimezone('Mars/Olympus'), false);
  assert.equal(validateNotificationPreferences({ ...preferences, timezone: 'not/a-zone' }), 'Choose a valid timezone.');
});

test('loading settings is authenticated and never requests notification permission', async () => {
  let requests = 0;
  const { client, calls } = fakeClient();
  const env = browser();
  env.windowRef.Notification.requestPermission = async () => { requests += 1; return 'granted'; };
  const result = await loadNotificationSettings({ client, expectedUserId: 'account-a', ...env, publicKeyConfigured: true });
  assert.equal(result.error, null);
  assert.equal(result.preferences.enabled, false);
  assert.equal(calls.queries, 1);
  assert.equal(requests, 0);
});

test('account mismatch blocks notification preference reads and writes', async () => {
  const { client, calls } = fakeClient('account-b');
  const loaded = await loadNotificationSettings({ client, expectedUserId: 'account-a' });
  const saved = await saveNotificationPreferences(defaultNotificationPreferences('UTC'), { client, expectedUserId: 'account-a' });
  assert.match(loaded.error, /account changed/i);
  assert.match(saved.error, /account changed/i);
  assert.equal(calls.queries, 0);
  assert.equal(calls.upserts.length, 0);
});

test('denied permission creates no subscription and makes no cloud writes', async () => {
  let permissionRequests = 0;
  const { client, calls } = fakeClient();
  const env = browser();
  env.windowRef.Notification.requestPermission = async () => { permissionRequests += 1; return 'denied'; };
  const result = await enableNotifications(defaultNotificationPreferences('UTC'), {
    client, expectedUserId: 'account-a', ...env, publicVapidKey: PUBLIC_KEY,
  });
  assert.match(result.error, /blocked/i);
  assert.equal(permissionRequests, 1);
  assert.equal(env.getSubscribeCalls(), 0);
  assert.equal(calls.rpcs.length, 0);
  assert.equal(calls.upserts.length, 0);
});

test('unauthenticated enable cannot prompt, subscribe, or write notification data', async () => {
  let permissionRequests = 0;
  const { client, calls } = fakeClient(null);
  const env = browser();
  env.windowRef.Notification.requestPermission = async () => { permissionRequests += 1; return 'granted'; };
  const result = await enableNotifications(defaultNotificationPreferences('UTC'), {
    client, ...env, publicVapidKey: PUBLIC_KEY,
  });
  assert.match(result.error, /sign in/i);
  assert.equal(permissionRequests, 0);
  assert.equal(env.getSubscribeCalls(), 0);
  assert.equal(calls.rpcs.length, 0);
  assert.equal(calls.upserts.length, 0);
});

test('explicit enable claims one device subscription and stores preferences for authenticated owner', async () => {
  const { client, calls } = fakeClient('account-b');
  const env = browser({ permission: 'granted' });
  const result = await enableNotifications(defaultNotificationPreferences('Asia/Kolkata'), {
    client, expectedUserId: 'account-b', ...env, publicVapidKey: PUBLIC_KEY,
  });
  assert.equal(result.error, null);
  assert.equal(env.getSubscribeCalls(), 1);
  assert.deepEqual(calls.rpcs.map(({ name }) => name), ['claim_push_subscription']);
  assert.equal(calls.rpcs[0].args.p_endpoint, 'https://push.example/subscription/unique');
  assert.equal(calls.upserts[0].row.user_id, 'account-b');
  assert.equal(calls.upserts[0].row.timezone, 'Asia/Kolkata');
  assert.equal(calls.upserts[0].row.enabled, true);
  assert.deepEqual(calls.upserts[0].options, { onConflict: 'user_id' });
});

test('existing device subscription refresh uses the same endpoint claim without subscribing twice', async () => {
  const env = browser({ permission: 'granted' });
  env.registration.pushManager.getSubscription = async () => env.pushSubscription;
  const { client, calls } = fakeClient();
  await enableNotifications(defaultNotificationPreferences('UTC'), {
    client, expectedUserId: 'account-a', ...env, publicVapidKey: PUBLIC_KEY,
  });
  assert.equal(env.getSubscribeCalls(), 0);
  assert.equal(calls.rpcs.length, 1);
  assert.equal(calls.rpcs[0].name, 'claim_push_subscription');
});

test('sign-out deactivates only the current browser subscription before local unsubscribe', async () => {
  let unsubscribed = false;
  const sub = {
    endpoint: 'https://push.example/subscription/unique',
    toJSON: () => ({ keys: { p256dh: 'p'.repeat(32), auth: 'a'.repeat(16) } }),
    unsubscribe: async () => { unsubscribed = true; return true; },
  };
  const env = browser({ subscription: sub });
  env.registration.pushManager.getSubscription = async () => sub;
  const { client, calls } = fakeClient('account-a');
  const result = await deactivateCurrentDeviceSubscription({ client, expectedUserId: 'account-a', navigatorRef: env.navigatorRef });
  assert.equal(result.error, null);
  assert.equal(result.deviceSubscribed, false);
  assert.equal(unsubscribed, true);
  assert.deepEqual(calls.rpcs.map(({ name }) => name), ['deactivate_push_subscription']);
  assert.equal(calls.rpcs[0].args.p_endpoint, sub.endpoint);
});

test('account switch releases and unsubscribes the existing device without claiming it for the new account', async () => {
  let unsubscribed = false;
  const sub = {
    endpoint: 'https://push.example/subscription/unique',
    toJSON: () => ({ keys: { p256dh: 'p'.repeat(32), auth: 'a'.repeat(16) } }),
    unsubscribe: async () => { unsubscribed = true; return true; },
  };
  const env = browser({ subscription: sub });
  env.registration.pushManager.getSubscription = async () => sub;
  const { client, calls } = fakeClient('account-b');
  await deactivateDeviceAfterAccountChange({ client, navigatorRef: env.navigatorRef });
  assert.equal(unsubscribed, true);
  assert.deepEqual(calls.rpcs.map(({ name }) => name), ['deactivate_push_subscription']);
});

test('timezone and category preferences persist under the authenticated account ID', async () => {
  const { client, calls } = fakeClient('account-b');
  const preferences = { ...defaultNotificationPreferences('Europe/Paris'), water_enabled: true, water_time: '13:45' };
  const result = await saveNotificationPreferences(preferences, { client, expectedUserId: 'account-b' });
  assert.equal(result.error, null);
  assert.equal(calls.upserts[0].row.user_id, 'account-b');
  assert.equal(calls.upserts[0].row.timezone, 'Europe/Paris');
  assert.equal(calls.upserts[0].row.water_enabled, true);
  assert.equal(calls.upserts[0].row.water_time, '13:45:00');
});

test('weekly reminder requires user-selected name, weekday, and time without a hardcoded schedule', async () => {
  const defaults = defaultNotificationPreferences('Asia/Kolkata');
  assert.match(validateNotificationPreferences({ ...defaults, weekly_enabled: true }), /day/i);
  assert.match(validateNotificationPreferences({ ...defaults, weekly_enabled: true, weekly_day: 6 }), /time/i);
  assert.match(validateNotificationPreferences({ ...defaults, weekly_enabled: true, weekly_day: 6, weekly_time: '18:00' }), /name/i);
  assert.match(validateNotificationPreferences({ ...defaults, weekly_enabled: true, weekly_day: 8, weekly_time: '18:00', weekly_name: 'Reminder' }), /day/i);
  assert.match(validateNotificationPreferences({ ...defaults, weekly_enabled: true, weekly_day: 6, weekly_time: '18:00', weekly_name: 'x'.repeat(81) }), /80 characters/i);

  const { client, calls } = fakeClient('account-a');
  const prefs = {
    ...defaults,
    sunscreen_time: '11:45',
    weekly_enabled: true,
    weekly_day: 6,
    weekly_time: '18:00',
    weekly_name: 'Medicine',
  };
  const result = await saveNotificationPreferences(prefs, { client, expectedUserId: 'account-a' });
  assert.equal(result.error, null);
  assert.equal(calls.upserts[0].row.weekly_enabled, true);
  assert.equal(calls.upserts[0].row.weekly_day, 6);
  assert.equal(calls.upserts[0].row.weekly_time, '18:00:00');
  assert.equal(calls.upserts[0].row.weekly_name, 'Medicine');
  assert.equal(calls.upserts[0].row.sunscreen_time, '11:45:00');
});

test('migration enforces RLS, owner policies, unique endpoint and authenticated lifecycle RPCs', async () => {
  const migration = await read('../supabase/migrations/20261002130000_notification_foundation.sql');
  for (const table of ['push_subscriptions', 'notification_preferences']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`${table}_select_own`));
    assert.match(migration, new RegExp(`${table}_insert_own`));
    assert.match(migration, new RegExp(`${table}_update_own`));
  }
  assert.match(migration, /auth\.uid\(\).*user_id/s);
  assert.match(migration, /endpoint text not null unique/);
  assert.match(migration, /function public\.claim_push_subscription/);
  assert.match(migration, /function public\.deactivate_push_subscription/);
  assert.match(migration, /pg_catalog\.pg_timezone_names/);
  assert.match(migration, /security definer\s+set search_path = ''/);
  assert.match(migration, /grant execute on function public\.claim_push_subscription[\s\S]*to authenticated/);
  assert.doesNotMatch(migration, /service_role/i);
});

test('service worker only displays fixed copy for incoming push events and does not add scheduling/cache behavior', async () => {
  const worker = await read('../public/sw.js');
  assert.match(worker, /addEventListener\('push'/);
  assert.match(worker, /registration\.showNotification/);
  assert.match(worker, /addEventListener\('notificationclick'/);
  assert.match(worker, /PUSH_NOTIFICATIONS\[payload\?\.category\]/);
  assert.doesNotMatch(worker, /setInterval|setTimeout|periodicSync|supabase/i);
  assert.match(worker, /const APP_SHELL/);
  assert.match(worker, /function isPrivateOrDynamic/);
  assert.match(worker, /PRIVATE_API_PATHS/);
  assert.match(worker, /sunscreen: \{ title: 'Winter Arc ✦', body: 'Time to reapply your sunscreen\.'/);
  assert.match(worker, /weekly: \{ title: 'Winter Arc ✦', body: 'Your weekly reminder is here\.'/);
  assert.match(worker, /path === '\/settings\/notifications'/);
  assert.match(worker, /function safeNotificationPath/);
  assert.match(worker, /Notification\?\.permission !== 'granted'/);
  assert.match(worker, /if \(category !== 'sunscreen'\) return `winter-arc-\$\{category\}`/);
  assert.match(worker, /const tag = await notificationTag\(payload\.category, payload\)/);
  assert.doesNotMatch(worker, /skipWaiting\s*\(/);
});

test('Sunscreen tags are occurrence-specific and deterministic while other category tags stay unchanged', async () => {
  const worker = await read('../public/sw.js');
  const listeners = {};
  const shown = [];
  const self = {
    addEventListener: (name, listener) => { listeners[name] = listener; },
    Notification: { permission: 'granted' },
    registration: { showNotification: async (title, options) => { shown.push({ title, ...options }); } },
    location: { origin: 'https://winter-arc.test' },
  };
  runInNewContext(worker, { self, URL, Response, crypto: webcrypto, TextEncoder, Uint8Array, caches: {}, fetch: () => {} });

  const dispatchPush = async (payload) => {
    let pending;
    listeners.push({
      data: { json: () => payload },
      waitUntil: (promise) => { pending = promise; },
    });
    await pending;
  };
  const base = { category: 'sunscreen', path: '/ritual/sunscreen', timezone: 'Asia/Kolkata' };
  const first = { ...base, localDate: '2026-10-03', scheduledTime: '13:15:00' };
  const second = { ...base, localDate: '2026-10-03', scheduledTime: '16:15:00' };
  await dispatchPush(first);
  await dispatchPush(first);
  await dispatchPush(second);
  await dispatchPush({ ...first, timezone: 'Asia/Tokyo' });
  for (const category of ['morning', 'evening', 'bedtime', 'weekly']) {
    await dispatchPush({ category, path: '/today' });
  }

  const sunscreen = shown.slice(0, 4);
  assert.equal(sunscreen[0].tag, sunscreen[1].tag, 'same scheduled occurrence reuses its tag');
  assert.notEqual(sunscreen[0].tag, sunscreen[2].tag, 'different interval gets its own tag');
  assert.notEqual(sunscreen[0].tag, sunscreen[3].tag, 'timezone-distinct occurrence gets its own tag');
  assert.ok(sunscreen.every(({ tag }) => /^winter-arc-sunscreen-[a-f0-9]{24}$/.test(tag)));
  assert.ok(sunscreen.every(({ tag }) => !tag.includes('Asia') && !tag.includes('2026') && !tag.includes('user')));
  assert.equal(sunscreen[0].data.path, '/ritual/sunscreen');
  assert.equal(sunscreen[0].body, 'Time to reapply your sunscreen.');
  assert.deepEqual(shown.slice(4).map(({ tag }) => tag), [
    'winter-arc-morning', 'winter-arc-evening', 'winter-arc-bedtime', 'winter-arc-weekly',
  ]);
});

test('configuration contains only public VAPID placeholder and no frontend privileged key', async () => {
  const envExample = await read('../.env.example');
  const service = await read('../src/notifications/notificationService.js');
  const auth = await read('../src/auth/authService.js');
  assert.match(envExample, /^VITE_VAPID_PUBLIC_KEY=$/m);
  assert.doesNotMatch(envExample, /PRIVATE|SERVICE_ROLE|SECRET/);
  assert.match(service, /VITE_VAPID_PUBLIC_KEY/);
  assert.doesNotMatch(service, /VITE_.*PRIVATE|SERVICE_ROLE/i);
  assert.match(auth, /deactivateCurrentDeviceSubscription/);
  assert.ok(auth.indexOf('deactivateCurrentDeviceSubscription') < auth.indexOf('supabase.auth.signOut()'));
});

test('notification settings route is inside the existing authenticated route group and linked from app navigation', async () => {
  const app = await read('../src/App.jsx');
  const header = await read('../src/components/AppHeader.jsx');
  assert.match(app, /<Route element={<RequireAuth \/>}>[\s\S]*path="\/settings\/notifications"/);
  assert.match(header, /<NavLink to="\/settings\/notifications">Reminders<\/NavLink>/);
});
