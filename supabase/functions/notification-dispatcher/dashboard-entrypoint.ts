// Dashboard deployment bundle for function name: notification-dispatcher.
// This is intentionally self-contained: the Dashboard editor cannot resolve
// this repository's per-function deno.json aliases or sibling _shared import.

import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { sendNotification, setVapidDetails } from 'npm:web-push@3.6.7';

export const DISPATCH_CATEGORIES = [
  { id: 'morning', enabledField: 'morning_enabled', timeField: 'morning_time' },
  { id: 'water', enabledField: 'water_enabled', timeField: 'water_time' },
  { id: 'evening', enabledField: 'evening_enabled', timeField: 'evening_time' },
  { id: 'bedtime', enabledField: 'bedtime_enabled', timeField: 'bedtime_time' },
];

function normalizeTime(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${match[1]}:${match[2]}`;
}

export function localClockAt(instant, timezone) {
  if (typeof timezone !== 'string' || !timezone.trim()) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    if (!values.year || !values.month || !values.day || !values.hour || !values.minute) return null;
    return {
      localDate: `${values.year}-${values.month}-${values.day}`,
      localTime: `${values.hour}:${values.minute}`,
    };
  } catch {
    return null;
  }
}

function localWeekdayAt(instant, timezone) {
  try {
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(instant);
    return ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 })[weekday] || null;
  } catch {
    return null;
  }
}

function shiftLocalDate(localDate, days) {
  const date = new Date(`${localDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isValidIsoTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)$/i.test(value)) return false;
  const date = value.slice(0, 10);
  const parsedDate = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(Date.parse(value)) && parsedDate.toISOString().slice(0, 10) === date;
}

export function sunscreenDueNotificationEvents(preference, entries, instant = new Date()) {
  if (!preference || preference.enabled !== true || preference.sunscreen_enabled !== true) return [];
  const local = localClockAt(instant, preference.timezone);
  if (!local) return [];
  const currentMinute = Math.floor(instant.getTime() / 60_000);
  const timestamps = (entries || []).flatMap((entry) => (
    Array.isArray(entry.application_times) ? entry.application_times : []
  ));
  const validToday = timestamps.filter(isValidIsoTimestamp)
    .map((timestamp) => ({ timestamp, time: Date.parse(timestamp) }))
    .filter(({ timestamp, time }) => (
      typeof timestamp === 'string'
      && Number.isFinite(time)
      && time <= instant.getTime()
      && localClockAt(new Date(time), preference.timezone)?.localDate === local.localDate
    ));
  if (validToday.length === 0 || local.localTime >= '19:00') return [];

  const latestApplication = Math.max(...validToday.map(({ time }) => time));
  const due = [];
  // A scheduler run may occur anywhere within its current minute; accept only
  // that single due minute, never a later minute as catch-up.
  for (let occurrence = latestApplication + 3 * 60 * 60 * 1000; occurrence <= instant.getTime() + 60_000; occurrence += 3 * 60 * 60 * 1000) {
    const scheduledAt = new Date(occurrence);
    const scheduledLocal = localClockAt(scheduledAt, preference.timezone);
    if (
      Math.floor(occurrence / 60_000) !== currentMinute
      || scheduledLocal?.localDate !== local.localDate
      || !scheduledLocal?.localTime
      || scheduledLocal.localTime >= '19:00'
    ) continue;
    due.push({
      userId: preference.user_id,
      category: 'sunscreen',
      localDate: scheduledLocal.localDate,
      scheduledTime: `${scheduledLocal.localTime}:00`,
      timezone: preference.timezone,
    });
  }
  return due;
}

export function weeklyDueNotificationEvents(preference, instant = new Date()) {
  if (!preference || preference.enabled !== true || preference.weekly_enabled !== true) return [];
  const local = localClockAt(instant, preference.timezone);
  const scheduledTime = normalizeTime(preference.weekly_time);
  const weekday = localWeekdayAt(instant, preference.timezone);
  if (!local || !scheduledTime || !weekday || preference.weekly_day !== weekday || scheduledTime !== local.localTime) return [];
  return [{
    userId: preference.user_id,
    category: 'weekly',
    localDate: local.localDate,
    scheduledTime: `${scheduledTime}:00`,
    timezone: preference.timezone,
  }];
}

export function isAllowedPushEndpoint(endpoint) {
  if (typeof endpoint !== 'string') return false;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    return host === 'fcm.googleapis.com'
      || host.endsWith('.fcm.googleapis.com')
      || host === 'android.googleapis.com'
      || host === 'push.services.mozilla.com'
      || host.endsWith('.push.services.mozilla.com')
      || host === 'notify.windows.com'
      || host.endsWith('.notify.windows.com')
      || host === 'web.push.apple.com';
  } catch {
    return false;
  }
}

export function dueNotificationEvents(preferences, instant = new Date()) {
  if (!preferences || preferences.enabled !== true) return [];
  const local = localClockAt(instant, preferences.timezone);
  if (!local) return [];
  return DISPATCH_CATEGORIES.flatMap(({ id, enabledField, timeField }) => {
    const scheduledTime = normalizeTime(preferences[timeField]);
    if (preferences[enabledField] !== true || !scheduledTime || scheduledTime !== local.localTime) return [];
    return [{
      userId: preferences.user_id,
      category: id,
      localDate: local.localDate,
      scheduledTime: `${scheduledTime}:00`,
      timezone: preferences.timezone,
    }];
  });
}

export function deliveryIdentity({ userId, localDate, category, scheduledTime, timezone, subscriptionId }) {
  return [userId, localDate, category, scheduledTime, timezone || '', subscriptionId].join(':');
}

export function pushPayload(category, occurrence = null) {
  if (DISPATCH_CATEGORIES.some(({ id }) => id === category)) return { category, path: '/today' };
  if (category === 'sunscreen') return {
    category,
    path: '/ritual/sunscreen',
    ...(occurrence ? {
      localDate: occurrence.localDate,
      scheduledTime: occurrence.scheduledTime,
      timezone: occurrence.timezone,
    } : {}),
  };
  if (category === 'weekly') return { category, path: '/settings/notifications' };
  return null;
}

async function setDeliveryState(client, deliveryId, userId, fields) {
  return client
    .from('notification_delivery_events')
    .update(fields)
    .eq('id', deliveryId)
    .eq('user_id', userId);
}

export async function dispatchDueNotifications({ client, sendPush, now = new Date() }) {
  const counts = { eligible: 0, accepted: 0, duplicate: 0, invalid: 0, failed: 0, skipped: 0 };
  const preferenceFields = [
    'user_id', 'enabled', 'timezone',
    'sunscreen_enabled', 'weekly_enabled', 'weekly_day', 'weekly_time',
    ...DISPATCH_CATEGORIES.flatMap(({ enabledField, timeField }) => [enabledField, timeField]),
  ].join(',');
  const processPreference = async (preference) => {
    let dueEvents = [...dueNotificationEvents(preference, now), ...weeklyDueNotificationEvents(preference, now)];
    if (preference.enabled !== true || !preference.timezone) {
      counts.skipped += 1;
      return;
    }
    if (preference.sunscreen_enabled === true) {
      const local = localClockAt(now, preference.timezone);
      if (local) {
        // Browser entry dates can differ by one calendar day from the saved
        // notification timezone, so scan adjacent dates and qualify timestamps
        // below using the saved IANA timezone itself.
        const { data: entries, error: entriesError } = await client
          .from('daily_ritual_entries')
          .select('entry_date,application_times')
          .eq('user_id', preference.user_id)
          .eq('ritual_id', 'sunscreen')
          .gte('entry_date', shiftLocalDate(local.localDate, -1))
          .lte('entry_date', shiftLocalDate(local.localDate, 1));
        if (entriesError) counts.failed += 1;
        else dueEvents = [...dueEvents, ...sunscreenDueNotificationEvents(preference, entries, now)];
      }
    }
    if (dueEvents.length === 0) return;

    const { data: subscriptions, error: subscriptionError } = await client
      .from('push_subscriptions')
      .select('id,user_id,endpoint,p256dh,auth_key,active')
      .eq('user_id', preference.user_id)
      .eq('active', true);
    if (subscriptionError) {
      counts.failed += 1;
      return;
    }
    const ownedSubscriptions = (subscriptions || []).filter((subscription) => (
      subscription.active === true
      && subscription.user_id === preference.user_id
      && isAllowedPushEndpoint(subscription.endpoint)
      && typeof subscription.p256dh === 'string'
      && typeof subscription.auth_key === 'string'
    ));
    if (ownedSubscriptions.length === 0) {
      counts.skipped += dueEvents.length;
      return;
    }

    for (const event of dueEvents) {
      for (const subscription of ownedSubscriptions) {
        const { data: claim, error: claimError } = await client
          .from('notification_delivery_events')
          .insert({
            user_id: event.userId,
            subscription_id: subscription.id,
            local_date: event.localDate,
            category: event.category,
            scheduled_time: event.scheduledTime,
            scheduled_timezone: event.timezone,
            state: 'claimed',
          })
          .select('id')
          .maybeSingle();

        if (claimError?.code === '23505') {
          counts.duplicate += 1;
          continue;
        }
        if (claimError || !claim?.id) {
          counts.failed += 1;
          continue;
        }
        counts.eligible += 1;

        try {
          const response = await sendPush(subscription, pushPayload(event.category, event));
          const statusCode = Number(response?.statusCode) || 201;
          await setDeliveryState(client, claim.id, event.userId, {
            state: 'accepted',
            response_status: statusCode,
            attempted_at: now.toISOString(),
          });
          await client
            .from('push_subscriptions')
            .update({ last_used_at: now.toISOString(), updated_at: now.toISOString() })
            .eq('id', subscription.id)
            .eq('user_id', event.userId)
            .eq('active', true);
          counts.accepted += 1;
        } catch (deliveryError) {
          const statusCode = Number(deliveryError?.statusCode) || null;
          const permanentlyInvalid = statusCode === 404 || statusCode === 410;
          await setDeliveryState(client, claim.id, event.userId, {
            state: permanentlyInvalid ? 'invalid' : 'failed',
            response_status: statusCode,
            attempted_at: now.toISOString(),
          });
          if (permanentlyInvalid) {
            await client
              .from('push_subscriptions')
              .update({ active: false, revoked_at: now.toISOString(), updated_at: now.toISOString() })
              .eq('id', subscription.id)
              .eq('user_id', event.userId)
              .eq('active', true);
            counts.invalid += 1;
          } else {
            counts.failed += 1;
          }
        }
        // The deterministic database row intentionally prevents an automatic retry
        // after an uncertain provider response; this favors no duplicate sends.
      }
    }
  };

  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data: preferences, error: preferenceError } = await client
      .from('notification_preferences')
      .select(preferenceFields)
      .eq('enabled', true)
      .range(offset, offset + pageSize - 1);
    if (preferenceError) return { ...counts, error: 'preferences_unavailable' };
    for (const preference of preferences || []) await processPreference(preference);
    if ((preferences || []).length < pageSize) break;
  }
  return { ...counts, error: null };
}

function constantTimeEqual(actual, expected) {
  if (!actual || actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const dispatchSecret = Deno.env.get('NOTIFICATION_DISPATCH_SECRET') || '';
  const suppliedSecret = request.headers.get('x-dispatch-secret') || '';
  if (dispatchSecret.length < 32 || !constantTimeEqual(suppliedSecret, dispatchSecret)) {
    return json({ error: 'unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY') || '';
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY') || '';
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') || '';
  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return json({ error: 'dispatcher_not_configured' }, 503);
  }

  let diagnosticStage = 'handler_started';
  try {
    diagnosticStage = 'client_creation_started';
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    diagnosticStage = 'client_created';
    diagnosticStage = 'vapid_initialization_started';
    const isUrlSafeBase64WithoutPadding = (value) => (
      typeof value === 'string'
      && /^[A-Za-z0-9_-]+$/.test(value)
      && value.length % 4 !== 1
    );
    const hasDecodedByteLength = (value, expectedLength) => {
      if (!isUrlSafeBase64WithoutPadding(value)) return false;
      try {
        const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
        const padding = '='.repeat((4 - (base64.length % 4)) % 4);
        return atob(base64 + padding).length === expectedLength;
      } catch {
        return false;
      }
    };
    let subjectUrlValid = false;
    let subjectProtocolAllowed = false;
    try {
      const parsedSubject = new URL(vapidSubject);
      subjectUrlValid = true;
      subjectProtocolAllowed = ['https:', 'mailto:'].includes(parsedSubject.protocol);
    } catch {
      // Keep this diagnostic limited to booleans; never log the subject value.
    }
    console.log(JSON.stringify({
      event: 'vapid_input_validation',
      subjectPresent: Boolean(vapidSubject),
      subjectUrlValid,
      subjectProtocolAllowed,
      publicKeyPresent: Boolean(vapidPublicKey),
      publicKeyUrlSafeBase64: isUrlSafeBase64WithoutPadding(vapidPublicKey),
      publicKeyDecodedLengthIs65: hasDecodedByteLength(vapidPublicKey, 65),
      privateKeyPresent: Boolean(vapidPrivateKey),
      privateKeyUrlSafeBase64: isUrlSafeBase64WithoutPadding(vapidPrivateKey),
      privateKeyDecodedLengthIs32: hasDecodedByteLength(vapidPrivateKey, 32),
    }));
    setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    diagnosticStage = 'vapid_initialized';
    diagnosticStage = 'dispatch_started';
    const result = await dispatchDueNotifications({
      client: admin,
      now: new Date(),
      sendPush: async (subscription, payload) => sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth_key },
      }, JSON.stringify(payload), { TTL: 1800, urgency: 'normal' }),
    });
    diagnosticStage = 'dispatch_completed';

    console.log(JSON.stringify({ event: 'notification_dispatch_complete', ...result }));
    if (result.error) return json({ error: result.error }, 503);
    return json({ ok: true, ...result });
  } catch (error) {
    const knownErrorNames = ['Error', 'TypeError', 'RangeError', 'SyntaxError'];
    const errorType = error instanceof Error && knownErrorNames.includes(error.name)
      ? error.name
      : typeof error;
    console.error(JSON.stringify({
      event: 'notification_dispatch_failed',
      diagnosticStage,
      errorType,
    }));
    return json({ error: 'dispatch_failed' }, 500);
  }
});
