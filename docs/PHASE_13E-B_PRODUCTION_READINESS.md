# Phase 13E-B — Notification Production Readiness

**Purpose:** repository and deployment readiness review only. No hosted Supabase changes, migrations, Vault writes, cron setup, function deployment, permission prompt, or push send was performed for this review.

**Conclusion:** the repository contains the end-to-end Web Push implementation, but production delivery is **not verified and is not ready to enable** from the available evidence. In this workspace, `.env.local` exists, but it has no `VITE_VAPID_PUBLIC_KEY` entry. Hosted database, Edge Function, secrets, Vault values, cron state, production VAPID configuration, and actual device delivery could not be inspected. Existing phase documentation records that the notification migrations were not applied and the dispatcher was not deployed/tested; re-confirm those facts in Supabase before acting.

## 1. Existing components

| Component | Repository status | Hosted status | Action required |
| --- | --- | --- | --- |
| Protected Reminders page at `/settings/notifications` | Present in `src/components/NotificationSettingsPage.jsx`; route in `src/App.jsx` | Unknown | Confirm deployment contains this revision; test signed-in account |
| Preference and browser subscription service | Present in `src/notifications/notificationService.js` | Unknown | Configure matching public VAPID key, then verify opt-in against deployed schema |
| Push subscription and preference schema/RPCs | Defined in `20261002130000_notification_foundation.sql` | Prior phase docs say not applied; live state unknown | Review prerequisites, then apply once through approved migration workflow |
| Delivery ledger, dispatcher hook, and cron schedule | Defined in `20261002140000_notification_delivery.sql` | Prior phase docs say not applied; live state unknown | Review extension availability and schedule only after the base schema is confirmed |
| `notification-dispatcher` Edge Function | Source and a separate dashboard bundle exist | Prior phase docs say not deployed; live state unknown | Choose one deployment source, deploy, configure secrets and gateway JWT setting |
| Service worker push/click handlers | Present in `public/sw.js`; `/sw.js` registered at root in production | Production worker version unknown | Confirm deployed worker update and exercise on supported installed PWA |
| Browser public VAPID configuration | `.env.example` contains an empty `VITE_VAPID_PUBLIC_KEY`; no local entry was found in `.env.local` | Production value unknown | Set the VAPID public key in the production frontend build environment and redeploy |
| Automated notification tests | Present in `tests/notification-foundation.test.js` and `tests/notification-dispatcher.test.js` | Not applicable | Run locally; tests mock push delivery and do not prove live delivery |

## 2. End-to-end flow and dependencies

1. An authenticated user opens Reminders and explicitly enables notifications.
2. The client checks secure context, Notification/Service Worker/PushManager support, authenticated identity, and the public VAPID key. Permission is requested only from the explicit enable action.
3. With permission granted, the existing root service worker creates or reuses a Web Push subscription. The client sends the endpoint and browser encryption keys to `claim_push_subscription`; the RPC associates it with the authenticated account. The client then saves account-owned preferences.
4. Every minute, `pg_cron` calls `invoke_notification_dispatcher()`. That database function reads three values from Supabase Vault and calls the Edge Function through `pg_net`.
5. The Edge Function authenticates the service request using `x-dispatch-secret`, reads preferences and active subscriptions with a server-only service-role key, calculates due local times, claims a per-device delivery ledger row, and sends an encrypted Web Push message with the VAPID credentials.
6. The browser push service delivers the event to the installed browser/PWA. `public/sw.js` accepts only known category identifiers and displays fixed generic copy; it does not display user progress or personal ritual data.
7. Clicking the notification navigates to `/today` (the dispatcher payload currently uses `/today`). The worker permits only `/today` or a safe `/ritual/:id` path. If the user is signed out, the app auth guard routes them to login; after login, the current login flow does not restore the original ritual destination.

Dependencies: authenticated Supabase account; applied schema/RPCs and RLS; browser permission and support; matching client/server VAPID key pair; active subscription; enabled account and category preferences; deployed function with secrets; function gateway configured to permit the cron's non-JWT request; working `pg_cron`, `pg_net`, and Vault; network access and valid push endpoint; deployed PWA/service worker.

## 3. Database and ownership

Two notification migrations exist and are intended in order:

1. `supabase/migrations/20261002130000_notification_foundation.sql`
   - Creates `push_subscriptions` and `notification_preferences`.
   - Uses `auth.users` ownership, a unique push endpoint, and owner-scoped RLS policies. Anonymous/public table access is revoked.
   - Adds timezone validation and the authenticated `claim_push_subscription` and `deactivate_push_subscription` RPCs. Claiming prevents endpoint reassignment unless the existing encryption keys match; deactivation requires the endpoint/key tuple.
2. `supabase/migrations/20261002140000_notification_delivery.sql`
   - Enables `pg_cron`, `pg_net`, and Supabase Vault extensions; creates `notification_delivery_events`, its owner-read RLS policy, service-role-only write access, and a composite subscription/owner constraint.
   - Defines `invoke_notification_dispatcher()` and schedules the named one-minute job `winter-arc-notification-dispatcher`.

The migrations have not been executed or tested against the hosted project's existing schema in this review. Do not treat them as safe to replay: the foundation migration creates triggers/policies and contains non-idempotent DDL. Before applying, confirm the Phase 13C owned-data prerequisites, inspect the actual migration history and existing objects, confirm extension availability/permissions, review the SQL, take/confirm a recoverable backup, and use the project's approved migration process. Apply each migration only once after that review, in timestamp order. No migration was applied in this phase.

RLS/ownership are defined in SQL, not proven live. After setup, verify RLS is enabled on all three tables; normal authenticated users can access only their own preferences/subscriptions and read only their own delivery events; clients cannot write delivery events; RPC execute grants are limited as intended; and the dispatcher uses the service-role credential only server-side. Verify duplicate endpoint rejection and stale-subscription cleanup against the live database without displaying endpoints or keys.

## 4. Edge Function, gateway authentication, and deployment source

Function: `notification-dispatcher`.

Required runtime variables read by `index.ts` and `dashboard-entrypoint.ts`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (secret; server-side only)
- `NOTIFICATION_DISPATCH_SECRET` (at least 32 characters)
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY` (secret)
- `VAPID_SUBJECT` (valid `mailto:` or HTTPS contact URI)

The SQL cron hook sends a publishable/anon project key in the `apikey` header and the shared secret in `x-dispatch-secret`. It sends **no user JWT / Authorization bearer token**. The handler does not validate a Supabase user JWT; it validates the custom dispatch secret and then uses its server-side service-role client. Current Supabase authorization documentation says the gateway accepts publishable/secret API keys in the `apikey` header for compatibility when `verify_jwt` is enabled, but that API key alone is not caller authentication. For this service-to-service pattern, configure this function with `verify_jwt = false` (or the equivalent deployment setting) and rely on the handler's high-entropy `x-dispatch-secret` validation; then confirm the live request reaches the handler and rejects an incorrect/missing secret. The previous phase note's `--no-verify-jwt` recommendation is consistent with this setup. No `supabase/config.toml` or hosted function configuration exists here to prove the live setting. Never expose the custom secret or service-role key. See [Supabase authorization headers](https://supabase.com/docs/guides/functions/auth-headers) and [function configuration](https://supabase.com/docs/guides/functions/function-configuration).

There are two possible sources for deployment: the modular `index.ts` (imports shared dispatcher code via relative path and uses the pinned `deno.json`) and the self-contained `dashboard-entrypoint.ts`. They duplicate dispatcher logic. Select one source and verify it matches the reviewed version; do not deploy both as independent implementations or assume they remain in sync. The local phase notes describe dashboard deployment. Confirm Supabase's current deployment mechanism and gateway setting in the project before deployment.

## 5. Scheduling, Vault, and timezone behavior

The delivery migration schedules `winter-arc-notification-dispatcher` with `* * * * *` (once per minute), calling `select public.invoke_notification_dispatcher();`. It first unschedules a job of the same name, so applying/re-running the migration has schedule side effects. The hook is inert if any required Vault value is missing.

Create these exact Vault secret names, with values entered only through an approved secure dashboard/SQL workflow:

- `notification_project_url` — Supabase project base URL.
- `notification_publishable_key` — project publishable/anon key used for the gateway `apikey` header; never a service-role key.
- `notification_dispatch_secret` — the same high-entropy value configured as the Edge Function's `NOTIFICATION_DISPATCH_SECRET`.

The dispatcher compares stored `HH:MM` to the current local time using each preference's IANA timezone. The scheduler is minute-based and has no catch-up: a delayed/missed minute is skipped. DST gap times do not occur; repeated local times are deduplicated by the unique delivery identity. Global preferences plus category preferences must be enabled.

## 6. Web Push key placement and environment variables

Generate one VAPID pair for the production application:

- Public key: `VITE_VAPID_PUBLIC_KEY` in the frontend build environment. This is intentionally public and is embedded into browser code. The same public value is `VAPID_PUBLIC_KEY` in Edge Function secrets.
- Private key: `VAPID_PRIVATE_KEY` in Edge Function secrets only. Never use a `VITE_` variable, `.env.example`, client bundle, or repository file.
- Subject: `VAPID_SUBJECT` in Edge Function secrets.

`.env.example` contains only the empty public VAPID placeholder (plus empty Supabase client placeholders). `.gitignore` excludes `.env`, `.env.*`, and `*.local`, while allowing `.env.example`. A name-only check found no `VITE_VAPID_PUBLIC_KEY` entry in this workspace's `.env.local`; values were not read or printed. No private VAPID or service-role value was inspected or exposed in the browser-source scan during this task. Production Vercel values are not accessible here and remain unverified.

## 7. Frontend and service-worker behavior

- Preferences default to globally disabled and all categories disabled; default times are 07:00, 12:00, 08:00, 19:00, and 22:00 in the detected IANA timezone.
- Permission is never prompted on page load. A denied/not-granted permission leaves notifications disabled and does not create a subscription or preference cloud write through the enable flow.
- If the public VAPID key is absent, push enable is unavailable, but users may still save preferences. Current workspace has no local public key configured.
- Turning global notifications off saves `enabled=false` before deactivating/unsubscribing this device. Other devices remain subscribed but should be suppressed by the global preference. Verify the deployed dispatcher checks the latest preference before every send (the repository implementation does).
- Sign-out attempts to deactivate and unsubscribe the current device before Supabase sign-out. Account changes trigger best-effort deactivation/unsubscribe. Cleanup failures do not prevent sign-out; therefore verify the live subscription is inactive and account switching does not leave an old endpoint active.
- A permission later revoked in browser/OS settings is not proactively synchronized to the database. Delivery may fail until the user returns and disables/re-enables or the provider reports an invalid endpoint. The UI/service currently does not continuously monitor permission revocation.
- The worker accepts only known category IDs, fixed generic content, and safe same-origin destination paths. Malformed/unrecognized JSON is ignored. It does not put account data in the notification or cache private APIs.
- The dispatcher sends only morning, evening, and bedtime. Water and sunscreen preferences are saved but are not dispatched. It is time-based and does not suppress a reminder based on that day's ritual completion.

## 8. Production safety and failure handling

- **Wrong account:** database owner scoping, RPC ownership checks, preference-owner filtering, and matching subscription owner checks are present. Confirm live RLS and verify with two separate test accounts/devices.
- **Duplicate subscriptions:** unique endpoint constraint and reuse of an existing browser subscription are present. Confirm migration/live constraint and test reinstall/resubscribe behavior.
- **Disable/sign-out/account switch:** client cleanup is best-effort; the global preference suppresses all devices, while unsubscribing affects the current one. A network failure can leave an old cloud subscription active, so verify cleanup and retain a manual stale-row recovery procedure.
- **Expired endpoints:** HTTP 404/410 marks only the matching owner/subscription inactive and records `invalid`; other errors record `failed`.
- **Duplicate delivery:** a unique ledger claim is inserted before send, providing at-most-once behavior per user/date/category/local time/device. A duplicate invocation does not send again.
- **Delivery failure:** non-404/410 failures are recorded as failed; there is no automatic retry. A timeout/provider ambiguity or crash after claim can lose that occurrence. `accepted` means the push service accepted the request, not that the OS displayed it.
- **Frequency:** one-minute schedule plus one occurrence per category/local minute/device; no catch-up. Only three categories dispatch. Push payload copy is generic.
- **Credential handling:** the VAPID private key, service-role key, and shared dispatch secret must exist only in protected Edge secrets/Vault as appropriate. The browser receives only the public VAPID key and Supabase publishable client key.

## 9. Exact manual production setup (not performed)

1. In the correct Supabase project, confirm project identity, Phase 13C schema/migration history, backup/restore readiness, and current notification objects. Review both SQL files and required extension availability/permissions. Resolve any pre-existing object or migration-history mismatch before applying anything.
2. Generate a production VAPID key pair. Keep the private key in a secure secret manager and use it only for Edge secrets. Set the public key as `VITE_VAPID_PUBLIC_KEY` in the production frontend environment. Confirm that the browser build's public key matches the server pair; redeploy the frontend after setting it.
3. Through the approved database migration workflow, apply `20261002130000_notification_foundation.sql` once, then `20261002140000_notification_delivery.sql` once. Do not re-run either just to “make sure”; inspect migration history and SQL effects first.
4. Deploy `notification-dispatcher` from one reviewed source (`index.ts` bundle or dashboard entrypoint). Configure its gateway JWT verification **off** because the cron request contains no user JWT. Retain and test the handler's `x-dispatch-secret` validation. Confirm deployed source/version and runtime compatibility.
5. Set Edge Function secrets: `NOTIFICATION_DISPATCH_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; confirm `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are available from the Supabase Edge runtime or configure them securely if required. Never put privileged values in the Vite frontend.
6. Add the three exact Vault values from §5. Enter them securely; do not place values in logs, chat, committed SQL, or screenshots.
7. Verify that the named cron job exists and is enabled with the one-minute schedule. Check sanitized invocation status, function logs, and aggregate counts only. Do not print request headers, endpoint strings, subscription keys, Vault values, or secret values.
8. Verify RLS, grants, RPC permissions, and ownership using two controlled accounts before any real notification test. Confirm account A cannot read account B's rows and normal clients cannot write delivery ledger records.

## 10. Exact manual verification (after explicit production approval)

1. Use a dedicated test account and an installed supported PWA/browser with OS notification permission enabled. Sign in and open Reminders; confirm capability and the public key are configured before opting in.
2. Explicitly enable on one test device. Confirm the UI reports granted/connected and confirm exactly one active `push_subscriptions` row for the signed-in owner without displaying its endpoint or encryption keys.
3. Enable one dispatched category (morning/evening/bedtime), set its time to a controlled future minute in the saved timezone, and save. Water/sunscreen are not valid delivery tests in this implementation.
4. After the configured minute, check one sanitized ledger row for the expected owner/category/device and the provider accepted status, then check the test device. Reinvoke only in a controlled safe test to confirm the same occurrence is deduplicated and no second delivery occurs.
5. Click the notification and confirm it opens Winter Arc at `/today`. Test while signed out: the protected page must not display before the login redirect.
6. Turn notifications off; verify global `enabled=false`, current-device unsubscribe/deactivation, and no delivery to any device for the account. Sign out and verify current-device deactivation. Sign into a second test account on the same browser and verify it cannot receive or inspect the first account's data/notifications.
7. In a controlled test subscription, exercise provider 404/410 cleanup; separately test browser permission revocation, offline cleanup, malformed payload, and a transient provider failure. Confirm documented at-most-once/no-retry behavior and ensure tests do not use real personal accounts.

Do not run these real-device/production steps until the owner approves production notification setup. No push was sent during this phase.

## 11. Repository validation and current readiness

The repository already contains the core client, SQL, Edge Function, scheduler, worker, and mocked automated tests. It is **repository-ready for the next manually approved configuration/verification stage**, subject to reviewing migration safety and selecting a single Edge deployment source. It is **not evidenced as production-ready** until hosted migrations, function configuration, secrets, Vault, cron, production VAPID config, RLS, and a controlled real-device delivery are verified.

Local validation for this review: full `npm test` **143 passed, 0 failed**; `npm run build` **passed** (Vite emitted the existing >500 kB minified-chunk advisory); targeted ESLint across notification UI/service, auth lifecycle integration, service worker, notification tests, and both dispatcher entrypoints **passed**. These tests mock the push sender and do not validate Supabase hosted state or device delivery.

The project has no `.git` directory in this checkout, so this review could not use `git status` to verify prior user changes. Only this readiness document was intentionally created. No application source, migration, dependency, worker, auth, cloud-sync, or ritual behavior was changed. Full automated tests, production build, and targeted ESLint results are reported in the task completion message.

## 12. References

- [Supabase: Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)
- [Supabase: Function Configuration](https://supabase.com/docs/guides/functions/function-configuration)
- [Supabase: Edge Function Secrets](https://supabase.com/docs/guides/functions/secrets)
- [Supabase: Database Migrations](https://supabase.com/docs/guides/deployment/database-migrations)
