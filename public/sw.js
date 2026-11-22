const CACHE_PREFIX = 'winter-arc-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/winter-arc-32.png',
  '/icons/winter-arc-192.png',
  '/icons/winter-arc-512.png',
  '/icons/winter-arc-maskable-192.png',
  '/icons/winter-arc-maskable-512.png',
];
const PRIVATE_API_PATHS = ['/auth/v1/', '/rest/v1/', '/storage/v1/', '/functions/v1/'];
const STATIC_DESTINATIONS = new Set(['script', 'style', 'font', 'image']);
const PUBLIC_STATIC_PATHS = new Set([
  '/icons/winter-arc-32.png',
  '/icons/winter-arc-192.png',
  '/icons/winter-arc-512.png',
  '/icons/winter-arc-maskable-192.png',
  '/icons/winter-arc-maskable-512.png',
]);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    )),
  );
});

function isPrivateOrDynamic(request, url) {
  if (url.origin !== self.location.origin || request.method !== 'GET') return true;
  if (request.headers.has('authorization') || request.headers.has('range')) return true;
  return PRIVATE_API_PATHS.some((path) => url.pathname.includes(path));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (isPrivateOrDynamic(request, url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => (
        await caches.match('/index.html')
        || Response.error()
      )),
    );
    return;
  }

  if (!STATIC_DESTINATIONS.has(request.destination)) return;
  if (!url.pathname.startsWith('/assets/') && !PUBLIC_STATIC_PATHS.has(url.pathname)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    const cacheControl = response.headers.get('cache-control') || '';
    if (response.ok && response.type === 'basic' && !/no-store|private/i.test(cacheControl)) {
      await cache.put(request, response.clone());
    }
    return response;
  })());
});

const PUSH_NOTIFICATIONS = {
  morning: { title: 'Winter Arc ✦', body: 'Good morning ✦ Ready to begin your Winter Arc?' },
  water: { title: 'Winter Arc', body: 'Pause for a moment of care.' },
  sunscreen: { title: 'Winter Arc ✦', body: 'Time to reapply your sunscreen.' },
  evening: { title: 'Winter Arc', body: 'You made it this far. 🌙 Take a moment to finish what matters.' },
  bedtime: { title: 'Winter Arc', body: 'Time to slow down. 🌙 Give yourself a quiet evening and prepare for rest.' },
  weekly: { title: 'Winter Arc ✦', body: 'Your weekly reminder is here.' },
};

function safeNotificationPath(path) {
  if (path === '/today') return path;
  if (path === '/settings/notifications') return path;
  if (typeof path === 'string' && /^\/ritual\/[a-z0-9-]{1,80}$/i.test(path)) return path;
  return '/today';
}

async function notificationTag(category, payload) {
  if (category !== 'sunscreen') return `winter-arc-${category}`;
  const { localDate, scheduledTime, timezone } = payload || {};
  if (
    typeof localDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)
    || typeof scheduledTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(scheduledTime)
    || typeof timezone !== 'string' || !timezone.trim() || timezone.length > 100
  ) return 'winter-arc-sunscreen';

  const occurrence = `${localDate}|${scheduledTime}|${timezone}`;
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(occurrence));
    const token = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 24);
    return `winter-arc-sunscreen-${token}`;
  } catch {
    let first = 2166136261;
    let second = 2246822519;
    for (let index = 0; index < occurrence.length; index += 1) {
      first = Math.imul(first ^ occurrence.charCodeAt(index), 16777619);
      second = Math.imul(second ^ occurrence.charCodeAt(index), 3266489917);
    }
    const token = `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
    return `winter-arc-sunscreen-${token}`;
  }
}

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    if (self.Notification?.permission !== 'granted') return;
    let payload;
    try {
      payload = event.data?.json();
    } catch {
      return;
    }
    const message = PUSH_NOTIFICATIONS[payload?.category];
    if (!message) return;
    const tag = await notificationTag(payload.category, payload);
    await self.registration.showNotification(message.title, {
      body: message.body,
      icon: '/icons/winter-arc-192.png',
      badge: '/icons/winter-arc-192.png',
      data: { path: safeNotificationPath(payload?.path) },
      tag,
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = safeNotificationPath(event.notification.data?.path);
  event.waitUntil((async () => {
    const target = new URL(path, self.location.origin).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        await client.focus();
        if ('navigate' in client && client.url !== target) await client.navigate(target);
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
