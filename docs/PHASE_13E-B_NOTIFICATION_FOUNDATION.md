# Phase 13E-B — Notification Foundation

**Status:** client/database foundation implemented locally. No migration has been applied to the hosted Supabase project, and no notification has been sent.

## Schema and ownership

`supabase/migrations/20261002130000_notification_foundation.sql` adds:

- `public.push_subscriptions`: one row per Web Push endpoint, globally unique endpoint, owner `user_id`, endpoint encryption keys, active/revoked state, creation/update timestamps, and last-used timestamp reserved for delivery.
- `public.notification_preferences`: one row per account with global opt-in, IANA timezone, and separate enable/time fields for morning, water, sunscreen, evening, and bedtime.

Both tables enable RLS and use `auth.uid() = user_id` policies for each CRUD operation. Public and anonymous table privileges are revoked. The database derives the preference owner from the authenticated user in the client service. A unique endpoint constraint prevents duplicate device rows. The preference table trigger checks timezone identifiers against PostgreSQL's timezone catalog, in addition to client validation.

Two authenticated-only, `SECURITY DEFINER` RPCs are intentionally narrow. `claim_push_subscription` registers or refreshes an endpoint and only permits an ownership transfer when the endpoint's existing encryption keys match the browser's current subscription. `deactivate_push_subscription` deactivates only the endpoint/key tuple supplied by the device. This supports cleanup after an account switch when the old session is no longer available. Neither RPC sends a notification.

## Client service and account lifecycle

`src/notifications/notificationService.js` isolates capability checks, timezone validation, preference reads/writes, explicit opt-in, subscription registration, and deactivation from React components. Reads/writes require `auth.getUser()` and can verify the expected UI account ID before acting. Local-only/unauthenticated use cannot create cloud subscription or preference rows.

The existing service worker is reused (registering `/sw.js` only when an explicit enable action finds no root registration). Permission is requested only inside the explicit **Enable notifications** action, and only after capability, authentication, and public-key checks. Loading or visiting settings does not request permission. Denied permission leaves the preference off and performs no subscription or cloud write.

`AuthProvider` releases/unsubscribes the current browser device if an authenticated identity changes. The existing `signOut()` service attempts cloud deactivation and local unsubscribe before Supabase sign-out; cleanup failure does not trap the user in the account. Other devices are not unsubscribed when this browser signs out.

## Settings and timezones

The protected `/settings/notifications` route provides the calm reminder settings surface. It shows browser permission, this device's account-owned subscription state, and the stored timezone. Reminder categories and local times can be edited and saved independently from the global switch. The browser's current IANA timezone is the default when no preferences exist, and each time is stored as a local wall-clock time beside that timezone. Timezones are validated against `Intl` before persistence.

The page clearly states that no reminders are scheduled in this phase. If `VITE_VAPID_PUBLIC_KEY` is unset, users can still save their preferences, but push opt-in is unavailable and no permission prompt is shown.

## Service worker and secrets

`public/sw.js` retains its existing install, activation, fetch, and cache behavior. It now listens for `push` and `notificationclick` only. The push handler accepts recognized category identifiers, displays fixed generic copy only for an incoming push event and granted permission, and restricts destinations to `/today` or a simple ritual route. It does not poll, schedule, or create local notifications.

`.env.example` includes `VITE_VAPID_PUBLIC_KEY=`. This is the public application-server key and may be delivered to the browser. The VAPID private key must be created and stored only as a future server-side Edge Function secret/Vault value; no private VAPID key or service-role key was added to frontend code or configuration.

## Intentionally deferred

- No Edge Function sender/dispatcher, cron job, delivery ledger, retries, or scheduled delivery.
- No reminder is sent by the app and no successful push delivery is simulated.
- No Supabase-hosted migration was run; deploy this migration through the reviewed database migration workflow before enabling push in a configured deployment.
- Existing ritual progress, local repository, cloud synchronization, account data, and service-worker cache allowlists were not changed.

Future delivery work must re-check global and category preferences at send time, calculate due instants from local wall-clock time plus IANA timezone (including daylight-saving transitions), deduplicate occurrences, bound retries, suppress stale endpoints, and keep notification payloads generic. VAPID private material and any privileged database credential belong only in server-side secret storage.

## Validation and manual device checks

- Full automated suite: **128 passed, 0 failed**. Foundation tests cover capability/permission behavior, authenticated account matching, duplicate subscription reuse, preference/timezone persistence, RLS migration assumptions, account-switch/sign-out cleanup, and worker event/cache boundaries.
- Production build: **passed**. Vite reports the existing-size class warning for the minified application bundle (>500 kB).
- Targeted ESLint for edited JavaScript/JSX and tests: **passed**. ESLint does not lint CSS in this project configuration.
- Migration validation: static migration/RLS assertions passed as part of the automated suite. A local Supabase CLI/PostgreSQL validator is unavailable in this workspace, and no hosted database migration was applied.
- Privileged-key source scan: no service-role/private VAPID references were found in `src`, `public`, `supabase`, or `.env.example`.
- Manual installed Android PWA checks from the Phase 13E-B request: **not run in this workspace**. In particular, no real permission prompt, hosted subscription row, or physical-device sign-out/account-switch flow was exercised.
- No notification delivery test was performed or expected because there is no dispatcher in this phase.
