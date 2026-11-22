# Phase 13E-A — Winter Arc Notification Architecture Audit

**Audit date:** 2026-10-03  
**Scope:** read-only code audit and this document only. No application, service-worker, auth, storage, database, or dependency changes were made in this audit.

## Executive summary

The repository already contains substantial notification work from later 13E phases. The existing UI can save account-owned preferences and, when configured, request Web Push permission and link a browser subscription to the signed-in account. The root service worker already handles push receipt and click navigation. Repository migrations define preference, subscription, and delivery tables, and a Supabase Edge Function/`pg_cron` sender is prepared locally.

That means the previous version of this document was stale: it described notifications as entirely unimplemented. The current audit corrects that description. The 13E-B and 13E-C records say their migrations were **not applied to hosted Supabase**, and they report no real push delivery or Edge Function runtime test. I cannot inspect the production Supabase dashboard, Vercel environment, function deployment settings, Vault, or cron state from this workspace. The user's report that Android notifications are enabled establishes OS capability, but does not by itself verify this application's registered subscription or server delivery.

**Recommendation:** retain the prepared Supabase-backed Web Push + Edge Function + scheduled `pg_cron` architecture. Before calling it production-ready, verify hosted migration/deployment state, JWT gateway configuration, secrets, cron execution, and a real Android delivery/account-switch test. Do not create another notification schema or parallel scheduler before that readiness check.

## 1. Current architecture findings

- Client: React 19 + Vite, React Router, and `@supabase/supabase-js` for Supabase Auth/Postgres access.
- Identity: `AuthProvider` initializes from the existing Supabase session and listens to auth-state events. Supabase JS owns browser session persistence; there is no second auth system.
- Protected routes include Today, History, Journey, ritual pages, the developer migration tools, and `/settings/notifications`. `/`, `/login`, and `/signup` remain public.
- The cloud repository scopes account records by authenticated identity and the database's RLS policies. Local storage and the local repository still exist as a separate existing mode/fallback; this audit did not alter them.
- The notification settings page is already in the app header as **Reminders**. It is account-protected, and the settings copy says settings do not send notifications yet.
- No notification-related dependency is in the frontend `package.json`. The prepared Edge Function pins `web-push` 3.6.7 in its own `deno.json` npm import.

## 2. Existing PWA and service worker

- `public/manifest.webmanifest` uses standalone display and root scope.
- `src/pwa/registerServiceWorker.js` registers `/sw.js` in production with scope `/`.
- `public/sw.js` precaches the app shell and public icons; navigations are network-first with cached `index.html` fallback. Only allow-listed same-origin static resources are cached. Cross-origin, authorization-bearing, non-GET, and known Supabase API paths are excluded.
- The existing worker now also has `push` and `notificationclick` listeners. Push payload categories map to fixed generic copy in the worker. Click paths are allow-listed to `/today` or a simple `/ritual/:id` route; other paths go to `/today`.
- The worker does not create local timers or schedule reminders. It only displays a notification after a push event and granted browser permission. It does not cache push payloads or subscription data.
- There is no `skipWaiting()` or `clients.claim()` call. New workers follow the ordinary waiting/activation lifecycle rather than forcing a reload.
- A notification click while signed out opens the protected destination, which the route guard redirects to `/login`. The current login flow sends a successful login to `/today`, rather than returning to the original ritual route.

Web Push is a transport, not a clock: closed-app delivery requires a server to send to the subscription and a supported browser/OS to accept and display the message. See [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API), [MDN Notifications API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API), and [Apple Web Push documentation](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers). Apple documents Web Push for Home Screen web apps on iOS/iPadOS 16.4 and later.

## 3. Authentication, ownership, and lifecycle

`src/notifications/notificationService.js` verifies the current user with `auth.getUser()` and checks an expected user ID supplied by the UI before preference/subscription operations. Preferences are queried by `user_id`; subscription status checks the current browser endpoint against that user's row. The database migrations add RLS owner policies and narrowly defined subscription claim/deactivation RPCs.

The subscription is device/browser-specific; preferences are account-wide. A globally unique endpoint is intended to prevent duplicate ownership. `claim_push_subscription` refreshes an existing endpoint and restricts transfer to a requester presenting matching subscription keys. The dispatcher additionally selects active subscriptions by the preference's user ID and validates the owner before sending.

The existing `signOut()` function tries server deactivation and local `PushSubscription.unsubscribe()` before Supabase sign-out. `AuthProvider` also schedules device deactivation when it observes an in-session user identity change. Other devices for the same account are not intentionally removed.

Limitations to retain in the implementation plan:

- Offline sign-out/account switching cannot confirm server cleanup immediately. Local unsubscribe is attempted, but a failed cleanup can leave a stale server row until it is reclaimed, deactivated, or receives a permanent provider failure.
- The identity-change cleanup is asynchronous and cannot run when an account transition occurs outside a live page context. The generic payload avoids revealing ritual content, but live multi-account/device testing remains necessary to prove that an old device binding is promptly removed.
- Browser permission revocation, push endpoint expiration, and service-worker subscription changes are not guaranteed to notify the app immediately. The settings page can re-check browser state when opened; 404/410 sender responses deactivate stale rows.
- The dispatcher stores one delivery row per account/category/local time/device. The database's uniqueness constraint is the duplicate-send boundary.

## 4. Current Winter Arc data model relevant to reminders

- Built-in rituals and targets are defined in `src/data/rituals.js`. Their daily completion/value semantics are separate from notification preferences.
- Cloud daily values live in owner-scoped `daily_ritual_entries`; custom habits have owner-scoped stable records and versioned definitions.
- Sunscreen's ordered `application_times` array is part of the daily entry. It is the existing application-event record if a future reminder needs to reference an application; a second sunscreen event store is unnecessary.
- Sleep On Time is a regular daily ritual entry. Sleep Tracker is informational and does not represent completion. Neither sleep record currently drives the dispatcher.
- The separate local repository still uses `winterArc.progress.v1`; it contains entries, custom habits, dated ritual snapshots, and weekly/monthly reflections. Notification preferences/subscriptions are cloud-only in the current notification service; the audit found no notification `localStorage` queue.
- Account-owned notification data in the prepared migrations consists of:
  - `notification_preferences`: one row per user with global enable, IANA timezone, and enabled/time pairs for morning, water, sunscreen, evening, and bedtime.
  - `push_subscriptions`: per-endpoint owner, endpoint, `p256dh`/`auth` encryption keys, active/revoked state, and timestamps.
  - `notification_delivery_events`: per-user/device/local-date/category/time delivery ledger with `claimed`, `accepted`, `invalid`, or `failed` states.

The current dispatcher does **not** read daily ritual entries, sunscreen application times, sleep data, or custom habits. It is a time-based reminder sender, not a habit-completion-aware engine. In this prepared code it dispatches only morning, evening, and bedtime; water and sunscreen controls exist in preferences/UI but are not eligible dispatcher categories.

## 5. Existing notification code and operational status

The repository contains:

1. `src/components/NotificationSettingsPage.jsx` and its styles for permissions, preferences, and device status.
2. `src/notifications/notificationService.js` for capability checks, timezone validation, authenticated preference reads/writes, permission request, subscription claim, and deactivation.
3. `public/sw.js` push receipt and click handlers.
4. `supabase/migrations/20261002130000_notification_foundation.sql` for preferences, subscriptions, RLS, timezone validation, and claim/deactivate RPCs.
5. `supabase/migrations/20261002140000_notification_delivery.sql` for the delivery ledger, `pg_cron`/`pg_net`/Vault integration, and a minute cron job.
6. `supabase/functions/notification-dispatcher/index.ts` plus `_shared/notificationDispatcher.js` for server delivery, and a separate self-contained `dashboard-entrypoint.ts` deployment bundle.
7. `tests/notification-foundation.test.js` and `tests/notification-dispatcher.test.js` for unit/static behavior.

The prior 13E-B/C documentation says both notification migrations are prepared locally but **not applied to hosted Supabase**, and says the function was not deployed/runtime-tested and no real push was sent. Those are repository-recorded status claims, not a live database query. This audit did not connect to the hosted project, Vercel, Supabase Dashboard, Vault, or a device, so current remote status remains unverified.

The repository has no `supabase/config.toml`. The cron request contains an `apikey` and a custom `x-dispatch-secret`, but no user JWT. The Edge Function verifies that custom secret in its handler. Therefore, the deployed function's API-gateway JWT verification must be configured consistently with the deployment notes (disabled for this service-to-service endpoint while retaining the strong handler secret); the local repository alone cannot confirm that setting. Confirm that the source entrypoint and Dashboard bundle have the same security fixes before deploying either.

## 6. Notification options considered

| Option | Works while app is closed? | Backend/subscription | Fit and limitations |
| --- | --- | --- | --- |
| **A. Browser/local notification** | No dependable scheduled delivery from a closed PWA. Timers only work while a page remains active and background execution is browser-controlled. | No sender; a local timer still needs client execution. | Lowest complexity, but per-device-only and unreliable for reminders that should arrive when closed. No separate local notification scheduler was found in this app. |
| **B. Web Push + service worker** | Yes, where the platform/browser accepts push and wakes the worker; still best-effort. | Requires a server sender and a stored push subscription. | The transport already exists in the worker. It does not decide when to send and requires careful endpoint/key ownership and lifecycle handling. |
| **C. Supabase-backed preferences/scheduling** | Preferences or a database cron alone cannot show a system notification. | Reuses Supabase preferences; a push sender/subscription is still required. | Preference, ledger, and cron migration code already exists. Avoid a second scheduling store or per-user cron job. |
| **D. Supabase Edge Functions + Web Push** | Yes, subject to push-service, network, permission, and OS behavior. | Prepared Edge Function sender, VAPID, owner-scoped subscription/preferences, and scheduled dispatcher. | Best fit and already the repository's prepared architecture. It keeps private VAPID/service credentials server-side and reuses Supabase ownership. Its hosted deployment/runtime still needs proof. |
| **E. Hosted push vendor** | Usually, through Web Push integrations. | Vendor subscription/sending service plus account mapping. | Could reduce operations later but adds a vendor, cost/privacy review, another dependency, and reconciliation with the current Supabase model. No clear reason to add it now. |

Supabase documents `pg_cron` with `pg_net` for scheduled Edge Function calls and Vault for invocation secrets: [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions), [Supabase Cron](https://supabase.com/docs/guides/cron), [Supabase Vault](https://supabase.com/docs/guides/database/vault).

## 7. Recommendation and scheduling model

Keep **Supabase-backed Web Push using the existing Edge Function dispatcher and server-side minute scheduler** as the first production architecture. It best fits the existing React/Vite PWA, Supabase Auth, RLS, and device-owned subscription model. Do not implement browser timers as a fallback for reminders expected while the app is closed.

Use a hybrid schedule:

- User-configurable local wall-clock times stored with an IANA timezone (already represented in `notification_preferences`).
- Server-side due evaluation and delivery (already represented by the prepared dispatcher/cron migration).
- Begin with broad, opt-in time windows such as morning/evening/bedtime, with conservative frequency and a global off switch. Existing defaults are 07:00, 12:00, 08:00, 19:00, and 22:00, but all categories are disabled by default.
- Treat exact-minute cron evaluation as best-effort. The current dispatcher can miss a reminder if delayed past the matching minute; no catch-up or automatic retry is implemented. The ledger intentionally favors at-most-once sends over uncertain duplicate retries.
- Keep water/sunscreen reminder categories disabled until dispatch behavior and safe, low-frequency UX are explicitly verified. Current dispatch does not use daily completion or sunscreen application data.
- Any future event-aware reminder should query only the signed-in owner's cloud data server-side and use the existing daily entries; do not duplicate habit progress into notification-only tables. Never infer medical timing advice from the app's sunscreen data.

Notification copy should remain optional and calm. Use no streak pressure, guilt, missed-day language, escalation, or sensitive personal details on a lock screen.

## 8. Proposed data model status

The minimal conceptual model is already present as local SQL migrations; no new tables are recommended before confirming their hosted status. Keep preferences account-wide, subscriptions per device/endpoint, and delivery idempotency per device/occurrence.

Current limits to consider before broad rollout: the delivery ledger has no bounded retry schedule/attempt counter, and failed or uncertain sends are not automatically retried. `accepted` means the push provider accepted the request, not that Android/iOS displayed it. Current timezone comparisons use an exact local minute; delayed execution misses the occurrence. No new local mutation queue is appropriate.

## 9. Permission and user experience

The existing behavior follows a good consent boundary: browsing settings does not request permission; the permission/subscription request happens after an explicit Enable action, and missing capabilities/public VAPID configuration block enabling. Preferences can still be saved while push setup is unavailable. The UI distinguishes permission, this device's subscription, timezone, and global/category preferences.

Keep permission opt-in explicit and never request it at app launch, login, or installation. Explain what categories and times do before prompting. If permission is denied/revoked, leave server preferences clearly distinguishable from actual device capability and do not repeatedly prompt. Preserve generic notification payloads.

## 10. Account/device safety requirements

- Associate each endpoint with one authenticated `user_id`, and retain global endpoint uniqueness.
- Keep the VAPID private key, service-role key, and dispatcher secret server-side only. The frontend may contain only the public VAPID key.
- Keep subscription endpoints and encryption keys out of logs, analytics, notification payloads, and service-worker caches.
- Deactivate only this device on sign-out or account switch; do not unsubscribe other devices. Handle offline cleanup as uncertain and clean stale endpoints after provider 404/410 responses.
- Re-check global/category preferences and owner/subscription association at send time; never accept caller-provided user IDs to choose recipients.
- Keep RLS on. The delivery function's service-role client is server-only and must retain explicit user/subscription filters.
- Verify in a controlled two-account test that an old subscription cannot receive reminders after switching accounts, including a restart/reopen scenario.

## 11. Recommended next implementation phases

The source already contains what older plans called 13E-B and 13E-C. Do not repeat those implementations. The next work should be a **deployment readiness and controlled delivery verification phase**:

1. Confirm whether the two notification migrations are applied remotely; review RLS/RPCs and cron/Vault job state without exposing endpoint/key values.
2. Confirm the deployed `notification-dispatcher` entrypoint, Edge Function secret values, API-gateway JWT setting, cron authentication, and matching public/private VAPID configuration.
3. Run one controlled Android PWA opt-in and test delivery, click behavior, disable, sign-out, account switch, stale endpoint handling, and duplicate invocation. Keep actual delivery results distinct from automated tests.
4. After that passes, decide whether to enable the existing morning/evening/bedtime categories gradually. Consider water/sunscreen only as a later, separate product decision.

## 12. Risks and limitations

- Web Push is best-effort. Browser/OS permission, background restrictions, network, battery settings, and push-provider availability affect delivery. Apple documents Home Screen PWA Web Push support beginning with iOS/iPadOS 16.4; platform behavior still needs device verification.
- This audit cannot confirm deployment state or run a real push. Earlier 13E-B/C docs say migrations were not applied and no send was tested; verify that statement against the live project before relying on it.
- The repository carries two dispatcher entrypoints (shared-import source and self-contained Dashboard bundle); deployment can drift unless the deployed copy is identified and kept in sync.
- Cron invocation needs correct gateway JWT configuration because the SQL caller authenticates with a publishable `apikey` plus the custom dispatch secret, not a user JWT. Verify the production function setting and handler check together.
- Exact-minute due matching can miss a reminder; at-most-once de-duplication also means uncertain/failed sends are not retried.
- Permission revocation and device subscription changes may not be immediately reflected until the settings page is revisited or a push send fails.
- Automated dispatcher tests mock Web Push. They do not prove hosted SQL, Edge Runtime package compatibility, cron invocation, Android system display, or cross-account device isolation.

## 13. Files inspected

- PWA: `public/manifest.webmanifest`, `public/sw.js`, `src/pwa/registerServiceWorker.js`, `src/main.jsx`, `vite.config.js`, `index.html`.
- Auth/routes: `src/auth/AuthProvider.jsx`, `src/auth/authService.js`, `src/auth/useAuth.js`, `src/App.jsx`, `src/components/AuthPage.jsx`.
- Notification client/UI: `src/notifications/notificationService.js`, `src/components/NotificationSettingsPage.jsx`, `src/components/NotificationSettingsPage.css`, `src/components/AppHeader.jsx`.
- Ritual and persistence model: `src/data/rituals.js`, `src/data/ritualStatus.js`, `src/data/storage.js`, `src/data/cloud/cloudRepository.js`, cloud reconstruction/account lifecycle modules, and the owned-data migration.
- Notification backend: `supabase/migrations/20261002130000_notification_foundation.sql`, `supabase/migrations/20261002140000_notification_delivery.sql`, `supabase/functions/_shared/notificationDispatcher.js`, both dispatcher entrypoints, and `deno.json`.
- Tests/deployment references: notification foundation/dispatcher tests, `.env.example`, `package.json`, the 13E-B/C docs, 13C-9 sync doc, and 13D PWA doc.

## 14. Validation and changes

This audit updates this document only. No application behavior changed; no database migration was created or modified; no dependency, notification event, auth/session, service-worker, cloud-sync, localStorage, or ritual behavior was changed by the audit. Existing notification code and migrations described above predate this audit.

Validation results are recorded in the Phase 13E-A completion report. The live migration/deployment state and real notification behavior require access to the hosted Supabase/Vercel configuration and an authenticated installed device.
