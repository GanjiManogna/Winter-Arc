import { supabase } from "../lib/supabase.js";

export const NOTIFICATION_CATEGORIES = [
  { id: "morning", label: "Morning", defaultTime: "07:00" },
  { id: "water", label: "Water", defaultTime: "12:00" },
  { id: "sunscreen", label: "Sunscreen", defaultTime: "08:00" },
  { id: "evening", label: "Evening", defaultTime: "19:00" },
  { id: "bedtime", label: "Bedtime", defaultTime: "22:00" },
];

const PUBLIC_VAPID_KEY = import.meta.env?.VITE_VAPID_PUBLIC_KEY?.trim() || "";

export function getBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function defaultNotificationPreferences(timezone = getBrowserTimezone()) {
  return {
    enabled: false,
    timezone,
    weekly_enabled: false,
    weekly_day: null,
    weekly_time: "",
    weekly_name: "",
    ...Object.fromEntries(NOTIFICATION_CATEGORIES.flatMap(({ id, defaultTime }) => [
      [`${id}_enabled`, false],
      [`${id}_time`, defaultTime],
    ])),
  };
}

export function isValidIanaTimezone(timezone) {
  if (typeof timezone !== "string" || !timezone.trim() || timezone.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export function validateNotificationPreferences(preferences) {
  if (!preferences || typeof preferences !== "object") return "Notification settings are invalid.";
  if (!isValidIanaTimezone(preferences.timezone)) return "Choose a valid timezone.";
  if (typeof preferences.enabled !== "boolean") return "Notification settings are invalid.";
  for (const { id } of NOTIFICATION_CATEGORIES) {
    if (typeof preferences[`${id}_enabled`] !== "boolean") return "Notification settings are invalid.";
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(preferences[`${id}_time`] || "")) {
      return "Choose a valid time for each reminder.";
    }
  }
  if (typeof preferences.weekly_enabled !== "boolean") return "Notification settings are invalid.";
  if (preferences.weekly_enabled) {
    if (!Number.isInteger(preferences.weekly_day) || preferences.weekly_day < 1 || preferences.weekly_day > 7) {
      return "Choose a day for your weekly reminder.";
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(preferences.weekly_time || "")) {
      return "Choose a time for your weekly reminder.";
    }
    if (typeof preferences.weekly_name !== "string" || !preferences.weekly_name.trim() || preferences.weekly_name.trim().length > 80) {
      return "Enter a reminder name of up to 80 characters.";
    }
  } else {
    if (preferences.weekly_day != null && (!Number.isInteger(preferences.weekly_day) || preferences.weekly_day < 1 || preferences.weekly_day > 7)) {
      return "Choose a valid day for your weekly reminder.";
    }
    if (preferences.weekly_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(preferences.weekly_time)) {
      return "Choose a valid time for your weekly reminder.";
    }
    if (preferences.weekly_name && (typeof preferences.weekly_name !== "string" || preferences.weekly_name.trim().length > 80)) {
      return "Enter a reminder name of up to 80 characters.";
    }
  }
  return null;
}

export function detectNotificationCapabilities({
  windowRef = typeof window === "undefined" ? null : window,
  navigatorRef = typeof navigator === "undefined" ? null : navigator,
  publicKeyConfigured = Boolean(PUBLIC_VAPID_KEY),
} = {}) {
  const notificationAvailable = Boolean(windowRef?.Notification);
  const secureContext = Boolean(windowRef?.isSecureContext)
    || windowRef?.location?.hostname === "localhost"
    || windowRef?.location?.hostname === "127.0.0.1";
  const serviceWorkerAvailable = Boolean(navigatorRef?.serviceWorker);
  const pushManagerAvailable = Boolean(windowRef?.PushManager);
  return {
    notificationAvailable,
    permission: notificationAvailable ? windowRef.Notification.permission : "unavailable",
    serviceWorkerAvailable,
    pushManagerAvailable,
    secureContext,
    publicKeyConfigured,
    supported: notificationAvailable && serviceWorkerAvailable && pushManagerAvailable && secureContext,
  };
}

async function authenticatedUser(client) {
  if (!client) return { user: null, error: "Cloud notifications are unavailable." };
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user?.id) return { user: null, error: "Sign in to manage notification settings." };
  return { user: data.user, error: null };
}

export async function loadNotificationSettings({
  client = supabase,
  expectedUserId,
  navigatorRef = typeof navigator === "undefined" ? null : navigator,
  windowRef = typeof window === "undefined" ? null : window,
  publicKeyConfigured = Boolean(PUBLIC_VAPID_KEY),
} = {}) {
  if (!client) return { error: "Cloud notifications are unavailable." };
  const { user, error } = await authenticatedUser(client);
  if (error || (expectedUserId && user?.id !== expectedUserId)) {
    return { error: error || "Your account changed. Reload notification settings." };
  }

  const { data, error: queryError } = await client
    .from("notification_preferences")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (queryError) return { error: "Notification settings could not be loaded." };

  const capabilities = detectNotificationCapabilities({ windowRef, navigatorRef, publicKeyConfigured });
  let deviceSubscribed = false;
  if (navigatorRef?.serviceWorker && capabilities.supported) {
    try {
      const registration = await navigatorRef.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager?.getSubscription?.() || null;
      if (subscription) {
        const { data: ownedSubscription, error: subscriptionError } = await client
          .from("push_subscriptions")
          .select("id,active")
          .eq("user_id", user.id)
          .eq("endpoint", subscription.endpoint)
          .maybeSingle();
        deviceSubscribed = !subscriptionError && Boolean(ownedSubscription?.active);
      }
    } catch {
      deviceSubscribed = false;
    }
  }

  return {
    error: null,
    userId: user.id,
    preferences: data
      ? {
          ...defaultNotificationPreferences(data.timezone || getBrowserTimezone()),
          ...data,
          ...Object.fromEntries(NOTIFICATION_CATEGORIES.map(({ id }) => [
            `${id}_time`, typeof data[`${id}_time`] === "string" ? data[`${id}_time`].slice(0, 5) : "",
          ])),
          weekly_time: typeof data.weekly_time === "string" ? data.weekly_time.slice(0, 5) : "",
          weekly_name: typeof data.weekly_name === "string" ? data.weekly_name : "",
        }
      : defaultNotificationPreferences(),
    capabilities,
    deviceSubscribed,
  };
}

function preferenceRow(preferences, userId) {
  const validationError = validateNotificationPreferences(preferences);
  if (validationError) throw new Error(validationError);
  return {
    user_id: userId,
    enabled: preferences.enabled,
    timezone: preferences.timezone,
    ...Object.fromEntries(NOTIFICATION_CATEGORIES.flatMap(({ id }) => [
      [`${id}_enabled`, preferences[`${id}_enabled`]],
      [`${id}_time`, `${preferences[`${id}_time`]}:00`],
    ])),
    weekly_enabled: preferences.weekly_enabled,
    weekly_day: preferences.weekly_day,
    weekly_time: preferences.weekly_time ? `${preferences.weekly_time}:00` : null,
    weekly_name: preferences.weekly_name?.trim() || null,
    updated_at: new Date().toISOString(),
  };
}

export async function saveNotificationPreferences(preferences, {
  client = supabase,
  expectedUserId,
} = {}) {
  if (!client) return { error: "Cloud notifications are unavailable." };
  let row;
  try {
    const { user, error } = await authenticatedUser(client);
    if (error || (expectedUserId && user?.id !== expectedUserId)) {
      return { error: error || "Your account changed. Reload notification settings." };
    }
    row = preferenceRow(preferences, user.id);
  } catch (error) {
    return { error: error.message || "Notification settings are invalid." };
  }

  try {
    const { error } = await client.from("notification_preferences").upsert(row, { onConflict: "user_id" });
    return error ? { error: "Notification settings could not be saved." } : { error: null };
  } catch {
    return { error: "Notification settings could not be saved." };
  }
}

function decodeVapidKey(encoded) {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const raw = atob(padded);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function subscriptionKeys(subscription) {
  const json = subscription.toJSON();
  return {
    endpoint: subscription.endpoint,
    p256dh: json.keys?.p256dh,
    authKey: json.keys?.auth,
  };
}

async function getExistingServiceWorker(navigatorRef) {
  let registration = await navigatorRef.serviceWorker.getRegistration("/");
  if (!registration) registration = await navigatorRef.serviceWorker.register("/sw.js", { scope: "/" });
  if (!registration.active && !registration.waiting && !registration.installing) {
    registration = await navigatorRef.serviceWorker.ready;
  }
  return registration;
}

export async function enableNotifications(preferences, {
  client = supabase,
  expectedUserId,
  navigatorRef = typeof navigator === "undefined" ? null : navigator,
  windowRef = typeof window === "undefined" ? null : window,
  requestPermission = () => windowRef.Notification.requestPermission(),
  publicVapidKey = PUBLIC_VAPID_KEY,
} = {}) {
  if (!client) return { error: "Cloud notifications are unavailable." };
  const { user, error } = await authenticatedUser(client);
  if (error || (expectedUserId && user?.id !== expectedUserId)) {
    return { error: error || "Your account changed. Reload notification settings." };
  }
  const capabilities = detectNotificationCapabilities({ windowRef, navigatorRef, publicKeyConfigured: Boolean(publicVapidKey) });
  if (!capabilities.supported) return { error: "Notifications are not available in this browser or connection." };
  if (!publicVapidKey) return { error: "Push setup is not complete yet. Your preferences can still be saved." };
  const validationError = validateNotificationPreferences({ ...preferences, enabled: true });
  if (validationError) return { error: validationError };

  let permission = windowRef.Notification.permission;
  if (permission === "default") {
    try {
      permission = await requestPermission();
    } catch {
      return { error: "Notification permission could not be requested." };
    }
  }
  if (permission !== "granted") {
    return { error: permission === "denied" ? "Notification permission is blocked in browser settings." : "Notification permission was not granted." };
  }

  let subscription;
  try {
    const registration = await getExistingServiceWorker(navigatorRef);
    subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeVapidKey(publicVapidKey),
      });
    }
    const keys = subscriptionKeys(subscription);
    if (!keys.endpoint || !keys.p256dh || !keys.authKey) throw new Error("Push subscription keys are unavailable.");

    const { error: claimError } = await client.rpc("claim_push_subscription", {
      p_endpoint: keys.endpoint,
      p_p256dh: keys.p256dh,
      p_auth_key: keys.authKey,
    });
    if (claimError) throw new Error("The device could not be linked to this account.");

    const saved = await saveNotificationPreferences({ ...preferences, enabled: true }, { client, expectedUserId: user.id });
    if (saved.error) {
      await client.rpc("deactivate_push_subscription", {
        p_endpoint: keys.endpoint, p_p256dh: keys.p256dh, p_auth_key: keys.authKey,
      });
      await subscription.unsubscribe();
      return saved;
    }
    return { error: null, permission, deviceSubscribed: true };
  } catch (failure) {
    if (subscription) {
      const keys = subscriptionKeys(subscription);
      await client.rpc("deactivate_push_subscription", {
        p_endpoint: keys.endpoint, p_p256dh: keys.p256dh, p_auth_key: keys.authKey,
      }).catch(() => {});
      await subscription.unsubscribe().catch(() => false);
    }
    return { error: failure?.message || "Notifications could not be enabled." };
  }
}

export async function deactivateCurrentDeviceSubscription({
  client = supabase,
  expectedUserId,
  navigatorRef = typeof navigator === "undefined" ? null : navigator,
} = {}) {
  if (!navigatorRef?.serviceWorker) return { error: null, deviceSubscribed: false };
  const registration = await navigatorRef.serviceWorker.getRegistration("/").catch(() => null);
  const subscription = await registration?.pushManager?.getSubscription?.().catch(() => null);
  if (!subscription) return { error: null, deviceSubscribed: false };
  const { user, error } = await authenticatedUser(client);
  if (error || (expectedUserId && user?.id !== expectedUserId)) {
    await subscription.unsubscribe().catch(() => false);
    return { error: error || "Your account changed; device cleanup was skipped.", deviceSubscribed: false };
  }

  const keys = subscriptionKeys(subscription);
  const { error: revokeError } = await client.rpc("deactivate_push_subscription", {
    p_endpoint: keys.endpoint,
    p_p256dh: keys.p256dh,
    p_auth_key: keys.authKey,
  });
  await subscription.unsubscribe().catch(() => false);
  return revokeError
    ? { error: "This device was disconnected, but cloud cleanup could not be confirmed.", deviceSubscribed: false }
    : { error: null, deviceSubscribed: false };
}

export async function deactivateDeviceAfterAccountChange({
  client = supabase,
  navigatorRef = typeof navigator === "undefined" ? null : navigator,
} = {}) {
  if (!navigatorRef?.serviceWorker) return;
  const registration = await navigatorRef.serviceWorker.getRegistration("/").catch(() => null);
  const subscription = await registration?.pushManager?.getSubscription?.().catch(() => null);
  if (!subscription) return;
  const keys = subscriptionKeys(subscription);
  if (client) {
    await client.rpc("deactivate_push_subscription", {
      p_endpoint: keys.endpoint,
      p_p256dh: keys.p256dh,
      p_auth_key: keys.authKey,
    }).catch(() => {});
  }
  await subscription.unsubscribe().catch(() => false);
}
