import { createClient } from '@supabase/supabase-js';
import { sendNotification, setVapidDetails } from 'web-push';
import { dispatchDueNotifications } from '../_shared/notificationDispatcher.js';

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

  try {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    const result = await dispatchDueNotifications({
      client: admin,
      now: new Date(),
      sendPush: async (subscription, payload) => sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth_key },
      }, JSON.stringify(payload), { TTL: 1800, urgency: 'normal' }),
    });

    console.log(JSON.stringify({ event: 'notification_dispatch_complete', ...result }));
    if (result.error) return json({ error: result.error }, 503);
    return json({ ok: true, ...result });
  } catch {
    console.error(JSON.stringify({ event: 'notification_dispatch_failed', reason: 'internal_error' }));
    return json({ error: 'dispatch_failed' }, 500);
  }
});
