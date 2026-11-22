import { useEffect, useState } from "react";
import AppHeader from "./AppHeader.jsx";
import { useAuth } from "../auth/useAuth.js";
import {
  NOTIFICATION_CATEGORIES,
  defaultNotificationPreferences,
  getBrowserTimezone,
  loadNotificationSettings,
  saveNotificationPreferences,
  enableNotifications,
  deactivateCurrentDeviceSubscription,
} from "../notifications/notificationService.js";
import "./NotificationSettingsPage.css";

function permissionLabel(capabilities) {
  if (!capabilities?.notificationAvailable) return "Unavailable in this browser";
  if (capabilities.permission === "granted") return "Allowed";
  if (capabilities.permission === "denied") return "Blocked in browser settings";
  return "Not requested";
}

export default function NotificationSettingsPage() {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState(() => defaultNotificationPreferences(getBrowserTimezone()));
  const [capabilities, setCapabilities] = useState(null);
  const [deviceSubscribed, setDeviceSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadedUserId, setLoadedUserId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    const userId = user?.id;
    if (!userId) return () => { active = false; };
    loadNotificationSettings({ expectedUserId: userId }).then((result) => {
      if (!active) return;
      if (!result.error) {
        setPreferences(result.preferences);
        setCapabilities(result.capabilities);
        setDeviceSubscribed(result.deviceSubscribed);
        setMessage("");
      } else {
        setMessage(result.error);
      }
      setLoadedUserId(userId);
      setLoading(false);
    });
    return () => { active = false; };
  }, [user?.id]);

  const updatePreference = (key, value) => {
    setPreferences((current) => ({ ...current, [key]: value }));
    setMessage("");
  };

  const save = async () => {
    setSaving(true);
    const result = await saveNotificationPreferences(preferences, { expectedUserId: user?.id });
    setMessage(result.error || "Your reminder preferences are saved.");
    setSaving(false);
  };

  const toggleNotifications = async () => {
    setSaving(true);
    setMessage("");
    if (!preferences.enabled) {
      const result = await enableNotifications(preferences, { expectedUserId: user?.id });
      if (!result.error) {
        setPreferences((current) => ({ ...current, enabled: true }));
        setCapabilities((current) => ({ ...current, permission: result.permission }));
        setDeviceSubscribed(true);
        setMessage("Notifications are enabled for this account and device.");
      } else {
        setMessage(result.error);
        setCapabilities((current) => current ? ({
          ...current,
          permission: typeof window !== "undefined" && window.Notification
            ? window.Notification.permission
            : current.permission,
        }) : current);
      }
    } else {
      const next = { ...preferences, enabled: false };
      const saved = await saveNotificationPreferences(next, { expectedUserId: user?.id });
      if (saved.error) {
        setMessage(saved.error);
      } else {
        setPreferences(next);
        const cleanup = await deactivateCurrentDeviceSubscription({ expectedUserId: user?.id });
        setDeviceSubscribed(false);
        setMessage(cleanup.error || "Notifications are off. Other devices remain connected to this account.");
      }
    }
    setSaving(false);
  };

  return (
    <main className="arc-placeholder notification-settings-page">
      <AppHeader />
      <section className="arc-placeholder-inner notification-settings-inner" aria-labelledby="notification-settings-title">
        <header className="notification-hero">
          <svg className="notification-hero-motif" viewBox="0 0 120 104" fill="none" aria-hidden="true" focusable="false">
            <path d="M68 13a34 34 0 1 0 31 51A32 32 0 0 1 68 13Z" />
            <path d="M88 22v8m-4-4h8M36 21v6m-3-3h6m18 61v7m-3-3h6" />
            <circle cx="91" cy="72" r="9" />
            <path d="M91 68v5m0 3h.01" />
          </svg>
          <h1 id="notification-settings-title">Reminders</h1>
          <p className="copy">Let the right moments find you.</p>
        </header>

        {loading || loadedUserId !== user?.id ? <p className="notification-status" role="status">Loading your settings…</p> : (
          <>
            <div className="notification-summary">
              <span>Browser permission</span>
              <strong>{permissionLabel(capabilities)}</strong>
              <span>Device subscription</span>
              <strong>{deviceSubscribed ? "Connected" : "Not connected"}</strong>
              <span>Timezone</span>
              <strong>{preferences.timezone}</strong>
            </div>

            <button
              className="notification-toggle"
              type="button"
              aria-pressed={preferences.enabled}
              disabled={saving || (!preferences.enabled && (!capabilities?.supported || !capabilities?.publicKeyConfigured))}
              onClick={toggleNotifications}
            >
              {preferences.enabled ? "Turn notifications off" : "Enable notifications"}
            </button>

            {!capabilities?.publicKeyConfigured && (
              <p className="notification-note">Push setup is not complete on this deployment yet. You can still save your reminder preferences.</p>
            )}

            <div className="notification-categories">
              {NOTIFICATION_CATEGORIES.map(({ id, label }) => (
                <div className="notification-category" key={id}>
                  <label className="notification-category-toggle">
                    <input
                      type="checkbox"
                      checked={preferences[`${id}_enabled`]}
                      onChange={(event) => updatePreference(`${id}_enabled`, event.target.checked)}
                    />
                    <span>{label}</span>
                  </label>
                  {id === "sunscreen" ? (
                    <p className="notification-category-description">
                      Remind me to reapply sunscreen every 3 hours after my first application, until 7 PM.
                    </p>
                  ) : (
                    <label className="notification-time-label">
                      <span>{label} time</span>
                      <input
                        type="time"
                        value={preferences[`${id}_time`]}
                        onChange={(event) => updatePreference(`${id}_time`, event.target.value)}
                      />
                    </label>
                  )}
                </div>
              ))}
            </div>
            <section className="notification-weekly" aria-labelledby="weekly-reminder-title">
              <label className="notification-category-toggle notification-weekly-toggle">
                <input
                  type="checkbox"
                  checked={preferences.weekly_enabled}
                  onChange={(event) => updatePreference("weekly_enabled", event.target.checked)}
                />
                <span id="weekly-reminder-title">Want a weekly reminder?</span>
              </label>
              <p className="notification-category-description">Repeats every week. Your reminder name appears here in settings only, not in the notification.</p>
              <div className="notification-weekly-fields">
                <label className="notification-time-label notification-weekly-name">
                  <span>Reminder name</span>
                  <input
                    type="text"
                    maxLength={80}
                    value={preferences.weekly_name || ""}
                    onChange={(event) => updatePreference("weekly_name", event.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label className="notification-time-label">
                  <span>Day</span>
                  <select
                    value={preferences.weekly_day ?? ""}
                    onChange={(event) => updatePreference("weekly_day", event.target.value ? Number(event.target.value) : null)}
                  >
                    <option value="">Choose a day</option>
                    <option value="1">Monday</option>
                    <option value="2">Tuesday</option>
                    <option value="3">Wednesday</option>
                    <option value="4">Thursday</option>
                    <option value="5">Friday</option>
                    <option value="6">Saturday</option>
                    <option value="7">Sunday</option>
                  </select>
                </label>
                <label className="notification-time-label">
                  <span>Time</span>
                  <input
                    type="time"
                    value={preferences.weekly_time || ""}
                    onChange={(event) => updatePreference("weekly_time", event.target.value)}
                  />
                </label>
              </div>
            </section>
            <button className="notification-save" type="button" disabled={saving} onClick={save}>
              {saving ? "Saving…" : "Save preferences"}
            </button>
          </>
        )}
        {message && <p className="notification-status" role="status">{message}</p>}
        <p className="notification-note">Reminder times use your saved IANA timezone. Sunscreen intervals start from your latest valid application. Weekly reminders repeat on the selected local day and time.</p>
      </section>
    </main>
  );
}
