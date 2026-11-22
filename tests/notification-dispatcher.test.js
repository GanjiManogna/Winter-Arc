import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  deliveryIdentity,
  dispatchDueNotifications,
  dueNotificationEvents,
  isAllowedPushEndpoint,
  localClockAt,
  pushPayload,
  sunscreenDueNotificationEvents,
  weeklyDueNotificationEvents,
} from '../supabase/functions/_shared/notificationDispatcher.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const fixedNow = new Date('2026-10-02T01:30:00.000Z');

function preference(userId, overrides = {}) {
  return {
    user_id: userId,
    enabled: true,
    timezone: 'Asia/Kolkata',
    morning_enabled: true,
    morning_time: '07:00:00',
    water_enabled: false,
    water_time: '12:00:00',
    evening_enabled: false,
    evening_time: '19:00:00',
    bedtime_enabled: false,
    bedtime_time: '22:00:00',
    sunscreen_enabled: false,
    weekly_enabled: false,
    weekly_day: null,
    weekly_time: null,
    ...overrides,
  };
}

function subscription(id, userId, overrides = {}) {
  return {
    id,
    user_id: userId,
    endpoint: `https://fcm.googleapis.com/${id}`,
    p256dh: `p256dh-${id}`,
    auth_key: `auth-${id}`,
    active: true,
    ...overrides,
  };
}

function mockClient({ preferences = [], subscriptions = [], dailyEntries = [] } = {}) {
  const records = [];
  const tables = { notification_preferences: preferences, push_subscriptions: subscriptions, daily_ritual_entries: dailyEntries };
  let nextId = 0;
  const calls = { sends: [], updates: [], inserted: [] };

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.action = 'select';
      this.payload = null;
      this.rangeBounds = null;
      this.comparisonFilters = [];
    }
    select() { return this; }
    insert(payload) { this.action = 'insert'; this.payload = payload; return this; }
    update(payload) { this.action = 'update'; this.payload = payload; return this; }
    eq(field, value) { this.filters.push([field, value]); return this; }
    gte(field, value) { this.comparisonFilters.push([field, 'gte', value]); return this; }
    lte(field, value) { this.comparisonFilters.push([field, 'lte', value]); return this; }
    range(start, end) { this.rangeBounds = [start, end]; return this; }
    matches(row) {
      return this.filters.every(([field, value]) => row[field] === value)
        && this.comparisonFilters.every(([field, operation, value]) => operation === 'gte' ? row[field] >= value : row[field] <= value);
    }
    async maybeSingle() { return this.execute(true); }
    then(resolve, reject) { return this.execute(false).then(resolve, reject); }
    async execute(single) {
      if (this.action === 'select') {
        let data = (tables[this.table] || []).filter((row) => this.matches(row));
        if (this.rangeBounds) data = data.slice(this.rangeBounds[0], this.rangeBounds[1] + 1);
        return { data: single ? data[0] || null : data, error: null };
      }
      if (this.action === 'insert') {
        const duplicate = records.some((row) => (
          row.user_id === this.payload.user_id
          && row.local_date === this.payload.local_date
          && row.category === this.payload.category
          && row.scheduled_time === this.payload.scheduled_time
          && row.scheduled_timezone === this.payload.scheduled_timezone
          && row.subscription_id === this.payload.subscription_id
        ));
        if (duplicate) return { data: null, error: { code: '23505' } };
        const row = { ...this.payload, id: `delivery-${++nextId}` };
        records.push(row);
        calls.inserted.push(row);
        return { data: single ? { id: row.id } : [row], error: null };
      }
      const row = (tables[this.table] || records).find((item) => this.matches(item));
      if (row) {
        Object.assign(row, this.payload);
        calls.updates.push({ table: this.table, row, payload: this.payload });
      }
      return { data: row || null, error: null };
    }
  }

  return {
    records,
    calls,
    client: { from: (table) => new Query(table) },
  };
}

test('only enabled global and category preferences due in the stored local minute are eligible', () => {
  const due = dueNotificationEvents(preference('user-a'), fixedNow);
  assert.deepEqual(due.map(({ category, localDate, scheduledTime }) => ({ category, localDate, scheduledTime })), [
    { category: 'morning', localDate: '2026-10-02', scheduledTime: '07:00:00' },
  ]);
  assert.deepEqual(dueNotificationEvents(preference('user-a', { enabled: false }), fixedNow), []);
  assert.deepEqual(dueNotificationEvents(preference('user-a', { morning_enabled: false }), fixedNow), []);
  assert.deepEqual(dueNotificationEvents(preference('user-a', { morning_time: '08:00:00' }), fixedNow), []);
});

test('Water is eligible only when enabled and its saved local minute matches', () => {
  const enabled = preference('user-a', {
    morning_enabled: false,
    water_enabled: true,
    water_time: '07:00:00',
  });
  assert.deepEqual(dueNotificationEvents(enabled, fixedNow), [{
    userId: 'user-a',
    category: 'water',
    localDate: '2026-10-02',
    scheduledTime: '07:00:00',
    timezone: 'Asia/Kolkata',
  }]);
  assert.deepEqual(dueNotificationEvents({ ...enabled, water_enabled: false }, fixedNow), []);
  assert.deepEqual(dueNotificationEvents({ ...enabled, water_time: '07:01:00' }, fixedNow), []);
  assert.deepEqual(pushPayload('water'), { category: 'water', path: '/today' });
});

test('adding Water preserves the existing Morning, Evening, and Bedtime category behavior', () => {
  const saved = preference('user-a', {
    evening_enabled: true,
    evening_time: '07:00:00',
    bedtime_enabled: true,
    bedtime_time: '07:00:00',
  });
  assert.deepEqual(dueNotificationEvents(saved, fixedNow).map(({ category }) => category), [
    'morning', 'evening', 'bedtime',
  ]);
});

test('timezone calculation uses local wall time across both daylight-saving transitions', () => {
  assert.deepEqual(localClockAt(new Date('2026-03-08T12:00:00Z'), 'America/New_York'), {
    localDate: '2026-03-08', localTime: '08:00',
  });
  assert.deepEqual(localClockAt(new Date('2026-11-01T13:00:00Z'), 'America/New_York'), {
    localDate: '2026-11-01', localTime: '08:00',
  });
  assert.equal(localClockAt(fixedNow, undefined), null);
  assert.equal(localClockAt(fixedNow, 'Mars/Olympus'), null);
  assert.deepEqual(dueNotificationEvents(preference('user-a', { timezone: null }), fixedNow), []);
});

test('Sunscreen interval starts from the latest valid application and becomes due after three hours', () => {
  const saved = preference('user-a', { sunscreen_enabled: true });
  const first = [{ entry_date: '2026-10-02', application_times: ['2026-10-02T01:30:30.000Z'] }];
  const dueAt = new Date('2026-10-02T04:30:30.000Z');
  assert.deepEqual(sunscreenDueNotificationEvents(saved, first, dueAt), [{
    userId: 'user-a', category: 'sunscreen', localDate: '2026-10-02', scheduledTime: '10:00:00', timezone: 'Asia/Kolkata',
  }]);
  assert.deepEqual(sunscreenDueNotificationEvents(saved, first, new Date('2026-10-02T04:29:59.000Z')), []);
  assert.deepEqual(sunscreenDueNotificationEvents({ ...saved, sunscreen_enabled: false }, first, dueAt), []);
  assert.deepEqual(sunscreenDueNotificationEvents({ ...saved, enabled: false }, first, dueAt), []);
  assert.deepEqual(sunscreenDueNotificationEvents(saved, [], dueAt), []);
});

test('Sunscreen ignores malformed and future timestamps and anchors to the latest valid application', () => {
  const saved = preference('user-a', { sunscreen_enabled: true });
  const entries = [{ entry_date: '2026-10-02', application_times: [
    'not-a-timestamp', '2026-10-02', '2026-10-02T02:00:00.000Z', '2026-10-02T08:00:00.000Z', 42,
  ] }];
  assert.deepEqual(sunscreenDueNotificationEvents(saved, entries, new Date('2026-10-02T04:59:59.000Z')), []);
  const due = sunscreenDueNotificationEvents(saved, entries, new Date('2026-10-02T05:00:00.000Z'));
  assert.equal(due[0]?.scheduledTime, '10:30:00');
});

test('Sunscreen suppresses the 7 PM cutoff and never catches up a missed minute', () => {
  const saved = preference('user-a', { sunscreen_enabled: true });
  const entries = [{ application_times: ['2026-10-02T10:00:00.000Z'] }];
  assert.deepEqual(sunscreenDueNotificationEvents(saved, entries, new Date('2026-10-02T13:30:00.000Z')), []);
  assert.deepEqual(sunscreenDueNotificationEvents(saved, entries, new Date('2026-10-02T13:31:00.000Z')), []);
  const beforeDue = [{ application_times: ['2026-10-02T01:30:00.000Z'] }];
  assert.deepEqual(sunscreenDueNotificationEvents(saved, beforeDue, new Date('2026-10-02T04:31:00.000Z')), []);
});

test('Sunscreen uses saved timezone date across device date boundaries and handles DST elapsed intervals', () => {
  const india = preference('user-a', { sunscreen_enabled: true });
  const adjacentDeviceDate = [{ entry_date: '2026-10-01', application_times: ['2026-10-02T01:30:00.000Z'] }];
  assert.equal(sunscreenDueNotificationEvents(india, adjacentDeviceDate, new Date('2026-10-02T04:30:00.000Z')).length, 1);
  const newYork = preference('user-b', { sunscreen_enabled: true, timezone: 'America/New_York' });
  const dstEntry = [{ application_times: ['2026-03-08T05:00:00.000Z'] }];
  const dstDue = sunscreenDueNotificationEvents(newYork, dstEntry, new Date('2026-03-08T08:00:00.000Z'));
  assert.equal(dstDue[0]?.scheduledTime, '04:00:00');
});

test('weekly reminder is due only on the selected saved-timezone weekday and minute', () => {
  const saved = preference('user-a', { weekly_enabled: true, weekly_day: 6, weekly_time: '18:00:00' });
  assert.equal(weeklyDueNotificationEvents(saved, new Date('2026-10-03T12:30:00.000Z')).length, 1);
  assert.deepEqual(weeklyDueNotificationEvents(saved, new Date('2026-10-03T12:31:00.000Z')), []);
  assert.deepEqual(weeklyDueNotificationEvents({ ...saved, weekly_day: 7 }, new Date('2026-10-03T12:30:00.000Z')), []);
  assert.deepEqual(weeklyDueNotificationEvents({ ...saved, weekly_enabled: false }, new Date('2026-10-03T12:30:00.000Z')), []);
  assert.equal(weeklyDueNotificationEvents({ ...saved, timezone: 'America/Los_Angeles', weekly_time: '05:30:00' }, new Date('2026-10-03T12:30:00.000Z')).length, 1);
});

test('weekly daylight-saving gap never invents a reminder at a nonexistent local time', () => {
  const skippedTime = preference('user-a', {
    timezone: 'America/New_York', weekly_enabled: true, weekly_day: 7, weekly_time: '02:30:00',
  });
  assert.deepEqual(weeklyDueNotificationEvents(skippedTime, new Date('2026-03-08T07:30:00.000Z')), []);
  const repeatedTime = { ...skippedTime, weekly_time: '01:30:00' };
  assert.equal(weeklyDueNotificationEvents(repeatedTime, new Date('2026-11-01T05:30:00.000Z')).length, 1);
  assert.equal(weeklyDueNotificationEvents(repeatedTime, new Date('2026-11-01T06:30:00.000Z')).length, 1);
});

test('the repeated fall-back wall-clock minute is claimed only once per local date and device', async () => {
  const repo = mockClient({
    preferences: [preference('user-a', { timezone: 'America/New_York', morning_time: '01:30:00' })],
    subscriptions: [subscription('device-a', 'user-a')],
  });
  const firstFold = new Date('2026-11-01T05:30:00Z');
  const secondFold = new Date('2026-11-01T06:30:00Z');
  const delivered = [];
  const sendPush = async (_sub, payload) => { delivered.push(payload); return { statusCode: 201 }; };
  const first = await dispatchDueNotifications({ client: repo.client, sendPush, now: firstFold });
  const repeated = await dispatchDueNotifications({ client: repo.client, sendPush, now: secondFold });
  assert.equal(first.accepted, 1);
  assert.equal(repeated.duplicate, 1);
  assert.equal(delivered.length, 1);
  assert.equal(repo.records[0].local_date, '2026-11-01');
});

test('delivery identity is deterministic per user, local occurrence, category, timezone, slot and device', () => {
  const event = { userId: 'u-1', localDate: '2026-10-02', category: 'morning', scheduledTime: '07:00:00', timezone: 'Asia/Kolkata', subscriptionId: 's-1' };
  assert.equal(deliveryIdentity(event), deliveryIdentity({ ...event }));
  assert.notEqual(deliveryIdentity(event), deliveryIdentity({ ...event, subscriptionId: 's-2' }));
  assert.notEqual(deliveryIdentity(event), deliveryIdentity({ ...event, localDate: '2026-10-03' }));
  assert.notEqual(deliveryIdentity(event), deliveryIdentity({ ...event, timezone: 'Asia/Tokyo' }));
});

test('database delivery ledger prevents duplicate sends on repeated dispatcher invocations', async () => {
  const repo = mockClient({ preferences: [preference('user-a')], subscriptions: [subscription('device-a', 'user-a')] });
  const sendPush = async (sub, payload) => {
    repo.calls.sends.push({ sub, payload });
    return { statusCode: 201 };
  };
  const first = await dispatchDueNotifications({ client: repo.client, sendPush, now: fixedNow });
  const second = await dispatchDueNotifications({ client: repo.client, sendPush, now: fixedNow });
  assert.equal(first.accepted, 1);
  assert.equal(second.duplicate, 1);
  assert.equal(repo.calls.sends.length, 1);
  assert.equal(repo.records[0].state, 'accepted');
});

test('Water delivery claims use the shared per-user occurrence/device deduplication', async () => {
  const repo = mockClient({
    preferences: [preference('user-a', { morning_enabled: false, water_enabled: true, water_time: '07:00:00' })],
    subscriptions: [subscription('device-a', 'user-a')],
  });
  const sendPush = async (_sub, payload) => {
    repo.calls.sends.push(payload);
    return { statusCode: 201 };
  };

  const first = await dispatchDueNotifications({ client: repo.client, sendPush, now: fixedNow });
  const repeated = await dispatchDueNotifications({ client: repo.client, sendPush, now: fixedNow });

  assert.equal(first.accepted, 1);
  assert.equal(repeated.duplicate, 1);
  assert.equal(repo.records.length, 1);
  assert.deepEqual(repo.records[0], {
    user_id: 'user-a',
    subscription_id: 'device-a',
    local_date: '2026-10-02',
    category: 'water',
    scheduled_time: '07:00:00',
    scheduled_timezone: 'Asia/Kolkata',
    state: 'accepted',
    response_status: 201,
    attempted_at: fixedNow.toISOString(),
    id: 'delivery-1',
  });
  assert.deepEqual(repo.calls.sends, [{ category: 'water', path: '/today' }]);
});

test('preference pagination includes enabled accounts beyond the first page', async () => {
  const preferences = Array.from({ length: 501 }, (_, index) => preference(`user-${index}`));
  const repo = mockClient({ preferences, subscriptions: [] });
  const result = await dispatchDueNotifications({
    client: repo.client,
    sendPush: async () => { throw new Error('no subscriptions should be delivered'); },
    now: fixedNow,
  });
  assert.equal(result.skipped, 501);
  assert.equal(repo.records.length, 0);
});

test('each active device receives its own once-only event', async () => {
  const repo = mockClient({
    preferences: [preference('user-a')],
    subscriptions: [subscription('android', 'user-a'), subscription('desktop', 'user-a')],
  });
  const result = await dispatchDueNotifications({
    client: repo.client,
    sendPush: async (sub) => { repo.calls.sends.push(sub.id); return { statusCode: 201 }; },
    now: fixedNow,
  });
  assert.equal(result.accepted, 2);
  assert.deepEqual(repo.calls.sends.sort(), ['android', 'desktop']);
  assert.equal(new Set(repo.records.map((row) => row.subscription_id)).size, 2);
});

test('Sunscreen sends to every active device, claims once under concurrency, and never writes ritual entries', async () => {
  const entry = { user_id: 'user-a', entry_date: '2026-10-01', ritual_id: 'sunscreen', application_times: ['2026-10-02T01:30:30.000Z'] };
  const repo = mockClient({
    preferences: [preference('user-a', { morning_enabled: false, sunscreen_enabled: true })],
    subscriptions: [subscription('android', 'user-a'), subscription('desktop', 'user-a')],
    dailyEntries: [entry],
  });
  const now = new Date('2026-10-02T04:30:30.000Z');
  const sendPush = async (_sub, payload) => { repo.calls.sends.push(payload); return { statusCode: 201 }; };
  const [first, concurrent] = await Promise.all([
    dispatchDueNotifications({ client: repo.client, sendPush, now }),
    dispatchDueNotifications({ client: repo.client, sendPush, now }),
  ]);
  assert.equal(first.accepted + concurrent.accepted, 2);
  assert.equal(first.duplicate + concurrent.duplicate, 2);
  assert.equal(repo.records.filter(({ category }) => category === 'sunscreen').length, 2);
  assert.ok(repo.calls.sends.every(({ category, path }) => category === 'sunscreen' && path === '/ritual/sunscreen'));
  assert.deepEqual(entry.application_times, ['2026-10-02T01:30:30.000Z']);
  assert.equal(repo.calls.updates.some(({ table }) => table === 'daily_ritual_entries'), false);
});

test('weekly reminders recur per selected weekday/time and never include the settings name in push data', async () => {
  const repo = mockClient({
    preferences: [preference('user-a', { morning_enabled: false, weekly_enabled: true, weekly_day: 6, weekly_time: '18:00:00', weekly_name: 'Personal reminder' })],
    subscriptions: [subscription('android', 'user-a'), subscription('desktop', 'user-a')],
  });
  const sendPush = async (_sub, payload) => { repo.calls.sends.push(payload); return { statusCode: 201 }; };
  const firstWeek = await dispatchDueNotifications({ client: repo.client, sendPush, now: new Date('2026-10-03T12:30:00.000Z') });
  const repeated = await dispatchDueNotifications({ client: repo.client, sendPush, now: new Date('2026-10-03T12:30:00.000Z') });
  const nextWeek = await dispatchDueNotifications({ client: repo.client, sendPush, now: new Date('2026-10-10T12:30:00.000Z') });
  assert.equal(firstWeek.accepted, 2);
  assert.equal(repeated.duplicate, 2);
  assert.equal(nextWeek.accepted, 2);
  assert.equal(repo.records.filter(({ category }) => category === 'weekly').length, 4);
  assert.ok(repo.calls.sends.every(({ category, path }) => category === 'weekly' && path === '/settings/notifications'));
  assert.ok(repo.calls.sends.every((payload) => !JSON.stringify(payload).includes('Personal reminder')));
});

test('permanently invalid push deactivates only its own subscription', async () => {
  const repo = mockClient({
    preferences: [preference('user-a')],
    subscriptions: [subscription('expired', 'user-a'), subscription('still-valid', 'user-a')],
  });
  const result = await dispatchDueNotifications({
    client: repo.client,
    sendPush: async (sub) => {
      if (sub.id === 'expired') throw Object.assign(new Error('gone'), { statusCode: 410 });
      return { statusCode: 201 };
    },
    now: fixedNow,
  });
  assert.equal(result.invalid, 1);
  assert.equal(result.accepted, 1);
  assert.equal(repo.calls.updates.filter(({ table, payload }) => table === 'push_subscriptions' && payload.active === false).length, 1);
  assert.equal(repo.records.find((row) => row.subscription_id === 'expired').state, 'invalid');
});

test('server query and defensive owner check prevent cross-account delivery', async () => {
  const repo = mockClient({
    preferences: [preference('account-a'), preference('account-b')],
    subscriptions: [subscription('a-device', 'account-a'), subscription('b-device', 'account-b')],
  });
  const result = await dispatchDueNotifications({
    client: repo.client,
    sendPush: async (sub) => { repo.calls.sends.push(sub); return { statusCode: 201 }; },
    now: fixedNow,
  });
  assert.equal(result.accepted, 2);
  assert.deepEqual(repo.records.map(({ user_id, subscription_id }) => [user_id, subscription_id]), [
    ['account-a', 'a-device'], ['account-b', 'b-device'],
  ]);
  assert.ok(repo.calls.sends.every((sub) => sub.user_id === 'account-a' || sub.user_id === 'account-b'));
});

test('only the approved categories produce minimal payloads', () => {
  assert.deepEqual(pushPayload('morning'), { category: 'morning', path: '/today' });
  assert.deepEqual(pushPayload('evening'), { category: 'evening', path: '/today' });
  assert.deepEqual(pushPayload('bedtime'), { category: 'bedtime', path: '/today' });
  assert.deepEqual(pushPayload('sunscreen'), { category: 'sunscreen', path: '/ritual/sunscreen' });
  assert.deepEqual(pushPayload('sunscreen', {
    localDate: '2026-10-03', scheduledTime: '13:15:00', timezone: 'Asia/Kolkata',
  }), {
    category: 'sunscreen', path: '/ritual/sunscreen',
    localDate: '2026-10-03', scheduledTime: '13:15:00', timezone: 'Asia/Kolkata',
  });
  assert.deepEqual(pushPayload('weekly'), { category: 'weekly', path: '/settings/notifications' });
  assert.equal(pushPayload('custom-habit'), null);
});

test('server only sends to known public Web Push service origins', () => {
  assert.equal(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/a'), true);
  assert.equal(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/a'), true);
  assert.equal(isAllowedPushEndpoint('https://web.push.apple.com/a'), true);
  assert.equal(isAllowedPushEndpoint('https://127.0.0.1/admin'), false);
  assert.equal(isAllowedPushEndpoint('https://attacker.example/'), false);
  assert.equal(isAllowedPushEndpoint('https://fcm.googleapis.com:444/'), false);
});

test('delivery migration uses per-device uniqueness, owner foreign key, and private server grants', async () => {
  const migration = await read('../supabase/migrations/20261002140000_notification_delivery.sql');
  assert.match(migration, /pg_constraint[\s\S]*push_subscriptions_id_user_id_key[\s\S]*UNIQUE \(id, user_id\)/);
  assert.match(migration, /if existing_constraint_definition is null then[\s\S]*add constraint push_subscriptions_id_user_id_key unique \(id, user_id\)/);
  assert.match(migration, /unique \(user_id, local_date, category, scheduled_time, subscription_id\)/);
  assert.match(migration, /foreign key \(subscription_id, user_id\)/);
  assert.match(migration, /push_subscriptions_endpoint_provider_check/);
  assert.match(migration, /alter table public\.notification_delivery_events enable row level security/);
  assert.match(migration, /notification_delivery_events_select_own/);
  assert.match(migration, /grant select, insert, update on table public\.notification_delivery_events to service_role/);
  assert.match(migration, /cron\.schedule/);
  assert.match(migration, /vault\.decrypted_secrets/);
  assert.match(migration, /x-dispatch-secret/);
});

test('additive migration preserves old rows and expands preferences, categories, and timezone-aware claims', async () => {
  const migration = await read('../supabase/migrations/20261003100000_notification_sunscreen_weekly.sql');
  assert.match(migration, /add column weekly_enabled boolean not null default false/);
  assert.match(migration, /add column weekly_day smallint/);
  assert.match(migration, /add column weekly_time time/);
  assert.match(migration, /add column weekly_name text/);
  assert.match(migration, /Monday=1 through Sunday=7/);
  assert.match(migration, /weekly_day between 1 and 7/);
  assert.match(migration, /'sunscreen', 'weekly'/);
  assert.match(migration, /unique \(user_id, local_date, category, scheduled_time, scheduled_timezone, subscription_id\)/);
  assert.match(migration, /sunscreen_time is retained|sunscreen_time.*compatibility/i);
  assert.doesNotMatch(migration, /delete from public\.notification_delivery_events/i);
  assert.doesNotMatch(migration, /drop policy|disable row level security/i);
});

test('Water category migration replaces only the category check and preserves existing history/security constraints', async () => {
  const migration = await read('../supabase/migrations/20261003110000_notification_water_category.sql');
  assert.match(migration, /begin;[\s\S]*alter table public\.notification_delivery_events[\s\S]*drop constraint if exists notification_delivery_events_category_check[\s\S]*add constraint notification_delivery_events_category_check[\s\S]*'morning', 'evening', 'bedtime', 'sunscreen', 'weekly', 'water'[\s\S]*commit;/i);
  assert.equal((migration.match(/drop constraint/gi) || []).length, 1);
  assert.doesNotMatch(migration, /drop policy|disable row level security|delete from|update public\.|insert into|notification_delivery_events_once_per_device_key/i);
});

test('dispatcher ignores client user IDs, authorizes with a server secret, and confines privileged keys to the function', async () => {
  const functionSource = await read('../supabase/functions/notification-dispatcher/index.ts');
  const packageConfig = await read('../supabase/functions/notification-dispatcher/deno.json');
  const webWorker = await read('../public/sw.js');
  assert.match(functionSource, /x-dispatch-secret/);
  assert.match(functionSource, /NOTIFICATION_DISPATCH_SECRET/);
  assert.match(functionSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(functionSource, /VAPID_PRIVATE_KEY/);
  assert.match(functionSource, /dispatchDueNotifications/);
  assert.doesNotMatch(functionSource, /request\.json\(\)|user_id\s*:/);
  assert.match(packageConfig, /web-push@3\.6\.7/);
  assert.doesNotMatch(webWorker, /SERVICE_ROLE|VAPID_PRIVATE|DISPATCH_SECRET/i);
  assert.match(webWorker, /morning: \{ title: 'Winter Arc/);
  assert.match(webWorker, /evening: \{ title: 'Winter Arc/);
  assert.match(webWorker, /bedtime: \{ title: 'Winter Arc/);
  assert.match(webWorker, /sunscreen: \{ title: 'Winter Arc ✦', body: 'Time to reapply your sunscreen\.'/);
  assert.match(webWorker, /weekly: \{ title: 'Winter Arc ✦', body: 'Your weekly reminder is here\.'/);
  assert.match(webWorker, /path === '\/settings\/notifications'/);
  assert.match(webWorker, /payload\?\.category/);
  assert.match(webWorker, /if \(category !== 'sunscreen'\) return `winter-arc-\$\{category\}`/);
  assert.match(webWorker, /const tag = await notificationTag\(payload\.category, payload\)/);
});

test('Dashboard deployment entrypoint bundles the shared dispatcher with direct pinned imports and unchanged handler', async () => {
  const dashboardSource = await read('../supabase/functions/notification-dispatcher/dashboard-entrypoint.ts');
  const localFunction = await read('../supabase/functions/notification-dispatcher/index.ts');
  const sharedDispatcher = await read('../supabase/functions/_shared/notificationDispatcher.js');
  const localHandler = localFunction.slice(localFunction.indexOf('function constantTimeEqual(')).trim();
  const dashboardHandler = dashboardSource.slice(dashboardSource.indexOf('function constantTimeEqual(')).trim();

  assert.match(dashboardSource, /from 'npm:@supabase\/supabase-js@2\.117\.2'/);
  assert.match(dashboardSource, /from 'npm:web-push@3\.6\.7'/);
  assert.doesNotMatch(dashboardSource, /from ['"](?:\.\.?\/|@supabase\/supabase-js|web-push)/);
  assert.ok(dashboardSource.includes(sharedDispatcher.trim()));
  const temporaryDiagnosticLines = [
    "  let diagnosticStage = 'handler_started';\n",
    "    diagnosticStage = 'client_creation_started';\n",
    "    diagnosticStage = 'client_created';\n",
    "    diagnosticStage = 'vapid_initialization_started';\n",
    "    diagnosticStage = 'vapid_initialized';\n",
    "    diagnosticStage = 'dispatch_started';\n",
    "    diagnosticStage = 'dispatch_completed';\n",
  ];
  let normalizedDashboardHandler = dashboardHandler;
  for (const diagnosticLine of temporaryDiagnosticLines) {
    assert.equal(normalizedDashboardHandler.split(diagnosticLine).length - 1, 1);
    normalizedDashboardHandler = normalizedDashboardHandler.replace(diagnosticLine, '');
  }

  const vapidValidationDiagnostic = `    const isUrlSafeBase64WithoutPadding = (value) => (
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
`;
  assert.equal(normalizedDashboardHandler.split(vapidValidationDiagnostic).length - 1, 1);
  normalizedDashboardHandler = normalizedDashboardHandler.replace(vapidValidationDiagnostic, '');

  const diagnosticCatch = `  } catch (error) {
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
  }`;
  const originalCatch = `  } catch {
    console.error(JSON.stringify({ event: 'notification_dispatch_failed', reason: 'internal_error' }));
    return json({ error: 'dispatch_failed' }, 500);
  }`;
  assert.equal(normalizedDashboardHandler.split(diagnosticCatch).length - 1, 1);
  normalizedDashboardHandler = normalizedDashboardHandler.replace(diagnosticCatch, originalCatch);

  assert.equal(normalizedDashboardHandler, localHandler);
  assert.doesNotMatch(dashboardSource, /onStage/);
  assert.match(dashboardSource, /NOTIFICATION_DISPATCH_SECRET/);
  assert.match(dashboardSource, /x-dispatch-secret/);
  assert.match(dashboardSource, /SUPABASE_SERVICE_ROLE_KEY/);
});

test('no service-role, private VAPID or dispatcher secret is present in browser modules', async () => {
  const clientService = await read('../src/notifications/notificationService.js');
  const supabaseClient = await read('../src/lib/supabase.js');
  const browserFiles = `${clientService}\n${supabaseClient}`;
  assert.doesNotMatch(browserFiles, /SUPABASE_SERVICE_ROLE_KEY|VAPID_PRIVATE_KEY|NOTIFICATION_DISPATCH_SECRET/);
  assert.match(clientService, /VITE_VAPID_PUBLIC_KEY/);
});
