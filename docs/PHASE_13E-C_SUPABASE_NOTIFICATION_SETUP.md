# Phase 13E-C — Supabase Notification Infrastructure Setup

**Status: prepared locally; hosted setup not performed.** This phase did not apply migrations, alter hosted Supabase/Vercel configuration, generate VAPID keys, deploy an Edge Function, configure Vault or cron, create subscriptions, or send a notification.

## 1. Outcome and blockers

The repository contains the existing account-bound Web Push infrastructure, but this environment could not safely verify the live Supabase schema or migration history. Supabase CLI and Deno are not installed, no `supabase/config.toml` is present, and read-only PostgREST metadata probes using the configured project client failed without a usable database response. The failure does not establish that the hosted tables are absent. No hosted result is claimed.

The local `.env.local` has Supabase client configuration, but it has no non-empty `VITE_VAPID_PUBLIC_KEY` entry. Values in `.env.local` were not printed. No VAPID key pair was generated because this repository has no installed local `web-push` generator workflow; the pinned `web-push` dependency is for the Deno Edge Function. No production Vercel variables, hosted function settings, Supabase secrets/Vault, cron jobs, or hosted RLS state were inspectable here.

The delivery migration creates and schedules `winter-arc-notification-dispatcher` every minute. It is conditionally inert while any of its three Vault values are missing, but the hosted Vault state could not be confirmed, and the migration has no explicit disabled/test mode. Therefore it must not be applied in this phase from this environment. The foundation migration could be applied separately in principle, but without confirming hosted migration history/schema it must also wait to avoid duplicate/conflicting objects.

## 2. Components and exact migrations

| Item | Local status | Hosted status | Decision |
| --- | --- | --- | --- |
| `notification_preferences` | Defined in migration below | Unverified | Do not claim present or absent |
| `push_subscriptions` | Defined in migration below | Unverified | Do not claim present or absent |
| `notification_delivery_events` | Defined in migration below | Unverified | Do not claim present or absent |
| RLS, policies, constraints, RPCs | Defined statically in SQL | Not live-verified | Review/check using the authenticated project and controlled accounts |
| `notification-dispatcher` Edge Function | Existing source and duplicate dashboard bundle | Deployment/version unverified | Do not deploy from this environment |
| `winter-arc-notification-dispatcher` cron | Defined by delivery migration | Job state unverified | Not created here; do not enable before approved controlled delivery |
| VAPID key pair | No key generated | Production values unverified | Generate securely; use public/private placement below |
| Frontend public VAPID key | `.env.example` placeholder only; local value absent | Vercel value unverified | Configure only after production key pair is generated |

The only notification migrations present are:

1. `supabase/migrations/20261002130000_notification_foundation.sql`
2. `supabase/migrations/20261002140000_notification_delivery.sql`

The first migration creates preference/subscription tables, indexes, a timezone trigger, owner-scoped RLS policies, and two authenticated subscription lifecycle RPCs. It is transactional and additive in intent, but it has unguarded table/trigger/policy creation and is not safe to replay blindly.

The second migration depends on the first. It enables `pg_cron`, `pg_net`, and Supabase Vault; creates the delivery ledger and ownership constraint; creates a Vault-backed HTTP invocation function; and replaces/schedules the named every-minute cron job. It includes additive database objects but also has non-idempotent DDL and an operational scheduler side effect. It must not be run until existing hosted objects/migration history are checked and the notification run is explicitly approved.

Neither migration changes unrelated Winter Arc ritual/progress data by design, but that is a source review, not a verified hosted effect. No live tables, policies, foreign keys, indexes, or unrelated Winter Arc tables were verified from this environment.

## 3. Static RLS and ownership review

The SQL definitions specify:

- `push_subscriptions` and `notification_preferences` have RLS enabled and authenticated CRUD policies constrained by `auth.uid() = user_id`; public/anonymous table grants are revoked.
- `claim_push_subscription` is an authenticated `SECURITY DEFINER` function with an empty search path. Endpoint uniqueness prevents duplicate endpoint rows. An ownership transfer is allowed only when the submitted browser encryption keys match the existing endpoint keys.
- `deactivate_push_subscription` is authenticated-only and requires the endpoint plus both browser encryption keys. The server dispatcher filters subscriptions by the preference owner's user ID and verifies owner equality before sending.
- `notification_delivery_events` enables RLS with owner-only reads; authenticated clients have select only, while `service_role` receives select/insert/update. A composite foreign key ties each delivery to a subscription with the same owner; unique identity prevents duplicate per-device scheduled occurrences.
- Edge Function source uses the service-role credential in server runtime only. No service-role or private VAPID variable is referenced from frontend source. The worker displays fixed generic text for recognized categories and does not include user progress in payloads.

These are static source findings only. Live RLS, grants, policies, constraints, and two-account isolation have **not** been verified.

## 4. VAPID configuration

The browser reads only `VITE_VAPID_PUBLIC_KEY` in `src/notifications/notificationService.js`. `.env.example` includes an empty placeholder. A name-only local check found no non-empty VAPID public key in `.env.local`.

Generate one stable VAPID key pair and use it for all future delivery. The upstream `web-push` CLI supports `web-push generate-vapid-keys --json`, but prints both the public and private keys. That command was **not run** here. If used manually, run only in a private terminal without command/session recording, protect its output immediately, and do not paste it into chat or logs. Do not use `npx` from this project expecting `web-push` to be installed at the root; this dependency is pinned only for the Deno function.

Placement:

- Public key: `VITE_VAPID_PUBLIC_KEY` in local `.env.local` for local opt-in testing, and in Vercel's production frontend environment for production. The same public key is Edge secret `VAPID_PUBLIC_KEY`.
- Private key: `VAPID_PRIVATE_KEY` in Supabase Edge Function secrets only. Never put it in any `VITE_` variable, frontend environment, source file, or repository document.
- Subject: `VAPID_SUBJECT` in Edge Function secrets, using a valid `mailto:` or HTTPS contact URI.

After configuring Vercel's public key, rebuild/redeploy the frontend and confirm the deployed browser key matches the Edge Function pair. `.gitignore` excludes `.env`, `.env.*`, and `*.local`, with `.env.example` explicitly allowed.

## 5. Edge Function and request security

Function name: `notification-dispatcher`.

The existing entrypoints are `supabase/functions/notification-dispatcher/index.ts` (modular shared import) and `dashboard-entrypoint.ts` (self-contained dashboard copy). They duplicate dispatch code; select and verify one source for eventual deployment so production does not run stale logic.

The handler accepts POST only, authenticates using `x-dispatch-secret` with at least 32 characters and constant-time character comparison, then reads `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`. Missing runtime configuration returns 503; wrong/missing dispatch secret returns 401; successful dispatch returns aggregate counts. Errors/logs avoid subscription payloads and credential values.

The SQL hook sends POST `{}` with `apikey` (the publishable/anon project key) and `x-dispatch-secret`; it sends no user JWT or `Authorization` bearer token. The Edge handler's custom shared-secret check is the actual caller authentication. Supabase's current docs note API keys in `apikey` can pass the gateway compatibility check, but recommend `verify_jwt = false` for service-to-service calls without a user JWT. Eventual deployment must set the function's JWT verification accordingly and test both valid and invalid dispatch secrets. No hosted gateway setting was verified or changed.

Required Edge secrets/runtime values:

- `NOTIFICATION_DISPATCH_SECRET` — high-entropy shared secret, at least 32 characters.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`.
- Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions; confirm runtime availability. Never put the service-role value in browser config.

## 6. Vault and scheduler requirements

The SQL function reads these exact Vault secret names:

- `notification_project_url`
- `notification_publishable_key`
- `notification_dispatch_secret`

The last value must exactly match Edge secret `NOTIFICATION_DISPATCH_SECRET`. The publishable key is used only in the request's `apikey` header; never store a service-role key here. No Vault values were created or checked in this phase.

Scheduler requirements from the migration:

- `pg_cron` schedules `winter-arc-notification-dispatcher` on `* * * * *`.
- `pg_net` POSTs to `/functions/v1/notification-dispatcher` every minute.
- Supabase Vault supplies the project URL, publishable/anon key, and shared secret.
- Preference due-time matching uses each account's IANA timezone, not the database/server timezone.
- The code sends only morning, evening, and bedtime; water and sunscreen preference toggles are stored but not dispatched.

The migration has no environment flag to hard-disable sends after deployment. Missing Vault data makes the hook return without invoking, but presence of all three values makes it active. Thus do not apply/enable the delivery migration or populate all Vault values until the user explicitly approves the controlled-delivery stage. No schedule was created here.

## 7. Account lifecycle and known limitations

Static review of current client code confirms:

- Sign-in is handled by the existing Supabase auth provider; notification settings require the current account and check the expected user ID.
- Sign-out attempts to deactivate the current server subscription and unsubscribe locally before auth sign-out. Account identity changes trigger best-effort device cleanup.
- Permission is requested only after an explicit enable action. Denial returns without enabling preferences or registering a cloud subscription.
- Missing browser capability or public VAPID key prevents push enable; preferences may still be saved.
- A pre-existing browser subscription is reused rather than creating another; the database's unique endpoint constraint is the server-side duplicate guard.
- Dispatcher provider responses 404/410 mark the matching subscription inactive. Other delivery failures are recorded but not retried.
- Cleanup on sign-out/account change is best-effort; offline/server failure can leave a stale row. Permission revoked outside the app is not proactively synchronized.
- Delivery is at-most-once per device/category/local date/time. Delayed minutes have no catch-up; uncertain failure or crash after claim can lose a reminder. “accepted” means the push provider accepted it, not that the OS displayed it.
- Generic messages avoid personal progress content. There is no daily ritual-completion suppression; dispatcher is time-based.

No concrete source-code blocker was found that requires rewriting the client before infrastructure setup, but live ownership/lifecycle behavior remains unverified.

## 8. Exact remaining manual steps

1. In Supabase Dashboard for the intended project, inspect migration history and current schema. Confirm whether each notification migration has already been applied; inspect existing `push_subscriptions`, `notification_preferences`, policies, functions, constraints, and any `notification_delivery_events` objects. Use the Supabase SQL Editor for read-only catalog queries only at this stage. Do not infer absence from a failed API request.
2. Check that Phase 13C owned-data tables exist and that extension installation (`pg_cron`, `pg_net`, Supabase Vault) is supported for the project. Review migration SQL against the live objects. Take/confirm backup and recovery before changes.
3. Apply `20261002130000_notification_foundation.sql` only if verified unapplied and conflict-free. Apply it once through the approved migration workflow; then verify its tables, policies, grants, trigger, RPCs, indexes, and endpoint uniqueness in Supabase.
4. Do **not** apply `20261002140000_notification_delivery.sql` yet: it creates a live one-minute scheduler and no tested disabled mode exists. Defer this migration until the user authorizes controlled delivery and a safe test setup is ready.
5. Generate one VAPID key pair in a private terminal using a trusted `web-push` installation/workflow; the CLI form is `web-push generate-vapid-keys --json` and its output contains the private key. Do not run where terminal output is recorded. Safely store the pair, add only the public key to ignored `.env.local`, and place the public/private pair plus subject only in the appropriate Edge secrets. Add the public value to Vercel environment settings and redeploy frontend when approved.
6. Before deploying, select one reviewed dispatcher entrypoint and confirm its imports/dependencies. Deploy only after hosted tables exist, JWT gateway behavior is configured for this secret-authenticated endpoint, and the Edge secrets are securely provisioned. Verify function version and invalid-secret rejection without invoking a valid production dispatch.
7. Keep scheduler and Vault dispatch values absent until explicitly approved. When authorized, set the exact three Vault names, apply the delivery migration once, verify the cron job and sanitized invocation logs, then use a dedicated test account/device.
8. Verify RLS using two controlled accounts and inspect delivery rows without revealing endpoint strings or browser encryption keys. Verify one real-device event only in the later approved controlled-delivery phase.

Use the Supabase Dashboard's SQL Editor and project migration workflow; do not paste secret values into SQL history or screenshots. The sources for current setup semantics are [Supabase scheduled Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions), [function authorization headers](https://supabase.com/docs/guides/functions/auth-headers), [function configuration](https://supabase.com/docs/guides/functions/function-configuration), [Edge Function secrets](https://supabase.com/docs/guides/functions/secrets), and the upstream [`web-push` VAPID CLI](https://github.com/web-push-libs/web-push#command-line).

## 9. Readiness for Phase 13E-D

**Not ready yet for controlled real-device delivery.** First confirm hosted schema/migration state and RLS, generate/configure matching VAPID keys, deploy and verify the dispatcher with server-only secrets, and prepare the delivery migration/Vault/cron only under the next explicitly approved controlled test. In particular, do not enable the scheduler now: with complete Vault values it can send to every active, opted-in subscription in the project.

Intentionally not enabled: any live schedule, Vault dispatch values, production dispatcher invocation, permission prompt, device subscription, or real notification. No notification functionality or other app behavior was changed.

## 10. Validation

For this phase, full `npm test` passed (**143 passed, 0 failed**), `npm run build` passed (with the existing Vite advisory for the >500 kB minified bundle), and targeted ESLint passed for notification/auth lifecycle source, service worker, tests, and both dispatcher entrypoints. These local checks do not validate hosted Supabase state or real push delivery. No application source, migration, dependency, service-worker code, auth behavior, cloud sync, or ritual logic was changed.
