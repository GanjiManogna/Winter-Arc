# PHASE 13E-C-MANUAL — Hosted Supabase Verification Checklist

This checklist extracts the current repository's Phase 13E-C setup record. It does not authorize hosted changes or delivery. Hosted state was not verified during Phase 13E-C. Do not infer that a database object is absent when a check cannot be completed.

For every item, **Safe to proceed** refers only to performing the stated verification. Applying a migration, configuring delivery, or enabling a scheduler requires all listed preconditions and the appropriate phase approval.

## 1. Supabase project verification

- **Where to go:** Supabase Dashboard, project selector, then the project dashboard for Winter Arc.
- **What to check:** Confirm this is the intended Winter Arc project before inspecting schema, migrations, functions, secrets, or schedules. Project identity and the exact dashboard navigation for confirming it are **Not specified by the current repository documentation — stop and verify before proceeding.**
- **Exact SQL/command:** None is specified for project identity verification.
- **Expected result:** The intended project is identified unambiguously; no hosted state is assumed from the local files.
- **What NOT to do:** Do not apply SQL or change settings while project identity is uncertain. Do not paste project secrets into chat, logs, SQL history, or screenshots.
- **Safe to proceed:** Yes, read-only identity verification only. Stop if the project cannot be positively identified.

## 2. Existing notification migrations

- **Where to go:** Supabase Dashboard migration history and SQL Editor; compare with these repository files:
  - `supabase/migrations/20261002130000_notification_foundation.sql`
  - `supabase/migrations/20261002140000_notification_delivery.sql`
- **What to check:** Determine whether each exact migration has already been applied. Review existing hosted objects before any migration action. The first migration creates preferences/subscriptions, owner-scoped RLS, indexes, a timezone trigger, and subscription lifecycle RPCs. The second depends on the first, enables `pg_cron`, `pg_net`, and Vault, creates delivery-ledger objects, and schedules a one-minute dispatcher job. The first has unguarded object creation; neither should be blindly replayed.
- **Exact SQL/command:** No migration-history query or hosted SQL inspection query is supplied by the current repository documentation. **Not specified by the current repository documentation — stop and verify before proceeding.** Use the approved project migration workflow only after confirming migration history and conflicts.
- **Expected result:** Each migration is clearly classified as already applied or not applied, and existing objects agree with the migration's assumptions. The delivery migration is known to create a live scheduler.
- **What NOT to do:** Do not rerun either migration “to make sure.” Do not apply the delivery migration during this checklist; it has no explicit disabled/test mode and can send when its Vault values are configured.
- **Safe to proceed:** Yes, read-only review. Migration application is not authorized by this checklist; stop if status or compatibility is uncertain.

## 3. Hosted database/RLS verification

- **Where to go:** Supabase Dashboard SQL Editor and the project's schema/table/policy views.
- **What to check:** Confirm hosted existence and definitions for `notification_preferences`, `push_subscriptions`, and, only if the delivery migration was previously applied, `notification_delivery_events`. Verify Phase 13C owned-data prerequisites first. Compare live RLS, grants, policies, indexes, triggers, RPCs, constraints, and foreign keys with the repository migrations. Use two controlled accounts to verify owner isolation.
- **Exact SQL/command:** The repository document provides no catalog SQL or account-test SQL. **Not specified by the current repository documentation — stop and verify before proceeding.** Do not execute SQL copied from elsewhere as though it were this project's documented verification query.
- **Expected result:** Preferences and subscriptions are owner-scoped by `auth.uid() = user_id`; delivery events (if present) are owner-readable and client write access is revoked; the dispatcher has the intended server-side access; endpoint uniqueness and delivery ownership/uniqueness constraints match the migrations. Live status must be recorded as verified, not inferred from source.
- **What NOT to do:** Do not weaken RLS or grants to make a check pass. Do not display subscription endpoints, `p256dh`/`auth` keys, or personal data. Do not claim hosted RLS is verified based only on static SQL.
- **Safe to proceed:** Yes, read-only inspection and controlled-account access checks. Stop and resolve any mismatch before applying migrations or enabling delivery.

## 4. VAPID key generation requirements

- **Where to go:** A private local terminal and a secure secret manager accessible only to the project owner.
- **What to check:** The existing documentation says one stable VAPID key pair is used for future delivery. The local setup has no public key configured; no pair was generated in Phase 13E-C. The CLI dependency is not installed as a root project dependency.
- **Exact SQL/command:** The documented upstream `web-push` CLI form is `web-push generate-vapid-keys --json`. It outputs both keys, including the private key. Do not run in a terminal/session that records output. The repository does not specify a secure output-redirection or key custody command. **Not specified by the current repository documentation — stop and verify before proceeding.**
- **Expected result:** One stable pair is created and stored securely; public/private values are matched. Only the public value is copied into browser/Vercel configuration. The private value remains server-side.
- **What NOT to do:** Do not run the key command through a logged/shared session; do not paste, print, commit, or send the private key; never use a `VITE_` prefix for it. Do not assume `npx web-push` works from the project root.
- **Safe to proceed:** Key generation is deferred from this documentation-only checklist. Proceed only when a private generation/custody method is ready and key generation is approved.

## 5. Vercel public VAPID environment variable

- **Where to go:** Vercel project settings for the Winter Arc frontend, environment variables.
- **What to check:** The frontend reads `VITE_VAPID_PUBLIC_KEY`. Set only the public key, and make sure it matches the public half configured server-side as `VAPID_PUBLIC_KEY`. The exact Vercel project name/environment selection and dashboard click path are **Not specified by the current repository documentation — stop and verify before proceeding.**
- **Exact SQL/command:** No Vercel CLI command is specified. The variable name is `VITE_VAPID_PUBLIC_KEY`.
- **Expected result:** Production frontend configuration has the matching public key, then the frontend is rebuilt/redeployed so the browser bundle receives it.
- **What NOT to do:** Do not enter `VAPID_PRIVATE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, or `NOTIFICATION_DISPATCH_SECRET` into any Vite variable or browser environment. Do not redeploy with an unverified key pair.
- **Safe to proceed:** Read-only verification is safe. Adding the public key and redeploying are deferred until a key pair exists and setup is approved.

## 6. Supabase server-side secrets/Vault

- **Where to go:** Supabase Dashboard Edge Function Secrets and Supabase Vault. Exact dashboard click paths are **Not specified by the current repository documentation — stop and verify before proceeding.**
- **What to check:** Edge runtime values expected by the dispatcher:
  - `NOTIFICATION_DISPATCH_SECRET` (at least 32 characters)
  - `VAPID_PUBLIC_KEY`
  - `VAPID_PRIVATE_KEY`
  - `VAPID_SUBJECT`
  - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (documented as Supabase Edge runtime-provided; confirm availability)

  Exact Vault names read by the SQL hook:
  - `notification_project_url`
  - `notification_publishable_key`
  - `notification_dispatch_secret`

  The Vault dispatch secret must match `NOTIFICATION_DISPATCH_SECRET`; the Vault publishable key is for the `apikey` header and must not be a service-role key.
- **Exact SQL/command:** No secret-setting SQL or command is supplied by the current repository documentation. **Not specified by the current repository documentation — stop and verify before proceeding.**
- **Expected result:** Server-only credentials stay in Supabase; the frontend receives only the public VAPID key and its existing public Supabase client config. No secrets are created in this phase.
- **What NOT to do:** Do not create the three dispatch Vault values yet. With all three present, the scheduled hook can invoke delivery. Never print secret values or put them in committed SQL, browser variables, screenshots, or chat.
- **Safe to proceed:** Read-only name/availability checks only. Secret creation is deferred until controlled delivery is approved.

## 7. Edge Function deployment requirements

- **Where to go:** Supabase Dashboard Edge Functions (or the approved deployment workflow for this project). Exact project deployment method and dashboard path are **Not specified by the current repository documentation — stop and verify before proceeding.**
- **What to check:** Function name is `notification-dispatcher`. The repository contains two possible entrypoints: `supabase/functions/notification-dispatcher/index.ts` with a shared import, and `dashboard-entrypoint.ts` as a self-contained copy. Choose and verify one source so deployed behavior matches the reviewed code. Confirm required secrets from section 6 are present before deploy.
- **Exact SQL/command:** No exact deployment command is supplied by the current repository documentation. **Not specified by the current repository documentation — stop and verify before proceeding.**
- **Expected result:** If deployment is later approved, the hosted function's name and version correspond to one reviewed entrypoint and it can read its server-side configuration. No deployment occurred in 13E-C.
- **What NOT to do:** Do not deploy from an unverified source or test by sending a valid production dispatch request. Do not rewrite/duplicate the function.
- **Safe to proceed:** Read-only source/deployment-state inspection only. Deployment is deferred.

## 8. Dispatcher authentication requirements

- **Where to go:** Supabase Edge Function configuration and sanitized function logs; repository source at `supabase/functions/notification-dispatcher/index.ts` and `dashboard-entrypoint.ts`.
- **What to check:** The SQL request is POST `{}` with `apikey` and `x-dispatch-secret`, and has no user JWT/Authorization bearer token. The handler checks the shared secret (minimum 32 characters); a missing/incorrect secret returns 401. The repository documentation recommends `verify_jwt = false` for this service-to-service pattern and retaining handler-side shared-secret validation. Confirm current hosted gateway setting before deployment.
- **Exact SQL/command:** The setting name is `verify_jwt = false`; no repository-specific deployment command to set it is provided. **Not specified by the current repository documentation — stop and verify before proceeding.**
- **Expected result:** The gateway permits the intended service request to reach the handler, the handler rejects an invalid/missing dispatch secret, and only a request with the correct secret can enter dispatch. A valid production dispatch test is prohibited until 13E-D.
- **What NOT to do:** Do not rely on the `apikey` alone as caller authentication. Do not disable JWT verification without retaining the custom secret check. Do not issue a valid secret-bearing dispatch request now.
- **Safe to proceed:** Read-only setting inspection is safe. Live authentication testing is deferred; only an approved later test may invoke the function.

## 9. pg_cron / pg_net requirements

- **Where to go:** Supabase Database Extensions and scheduled jobs views.
- **What to check:** The delivery migration requires `pg_cron`, `pg_net`, and Supabase Vault. The hosted project must support these extensions. No hosted extension or job status was verified in 13E-C.
- **Exact SQL/command:** Extension names are `pg_cron`, `pg_net`, and `supabase_vault`; exact SQL to inspect extensions is not supplied. **Not specified by the current repository documentation — stop and verify before proceeding.**
- **Expected result:** Required extension support and any existing job state are understood before considering the delivery migration.
- **What NOT to do:** Do not install extensions, apply the delivery migration, or create a parallel scheduler during this checklist.
- **Safe to proceed:** Read-only dashboard inspection is safe. Enabling extensions is deferred until delivery is approved.

## 10. Scheduler configuration requirements

- **Where to go:** Supabase Database scheduled jobs/`pg_cron`, plus the deployed Edge Function and Vault configuration.
- **What to check:** The repository migration schedules job `winter-arc-notification-dispatcher` with cron expression `* * * * *` (every minute). `pg_net` posts to `/functions/v1/notification-dispatcher`; the SQL function reads project URL, publishable key, and dispatch secret from Vault. Due times are evaluated in each preference's IANA timezone. The scheduler has no explicit disabled/test flag; when all three Vault values exist, it can invoke delivery.
- **Exact SQL/command:** Exact schedule expression: `* * * * *`. No separate safe scheduler-creation SQL/command is provided outside the migration. **Not specified by the current repository documentation — stop and verify before proceeding.**
- **Expected result:** If and when approved, exactly the named job and target are verified, with the documented one-minute cadence and Vault-backed headers. Do not configure it during this checklist.
- **What NOT to do:** Do not create or enable the scheduler now; do not add all three dispatch Vault values; do not trigger a real dispatcher run.
- **Safe to proceed:** Read-only inspection of existing jobs is safe. Creating/enabling the schedule is not safe before the approved controlled-delivery phase.

## 11. Security checks

- **Where to go:** Supabase table/policy/grant/function views, Edge Function secrets/settings, Vercel environment settings, and repository files.
- **What to check:**
  - Own-account policies for preferences and subscriptions; owner-read-only policy and client write denial for delivery events.
  - `claim_push_subscription` and `deactivate_push_subscription` are authenticated lifecycle RPCs; endpoint uniqueness is present.
  - Dispatcher reads only the owner's active subscriptions and delivery rows are tied to the same subscription owner.
  - Service-role and VAPID private keys remain server-side; the browser only gets the public VAPID key.
  - Push content is generic and does not include user progress.
  - Sign-out/account-switch cleanup is best-effort; 404/410 endpoints are deactivated; permission revocation is not proactively synchronized; other failures are not retried.
- **Exact SQL/command:** No repository-documented SQL is provided for live policy/grant checks or the two-account isolation test. **Not specified by the current repository documentation — stop and verify before proceeding.**
- **Expected result:** Live checks match the static migration design; two controlled accounts cannot read or mutate each other's notification data; no private credential reaches the client.
- **What NOT to do:** Do not weaken RLS or grants; do not expose endpoints, encryption keys, private VAPID values, service-role credentials, or shared secrets.
- **Safe to proceed:** Read-only checks and controlled account isolation checks are safe. Stop on any ownership/security mismatch.

## 12. What must NOT be enabled yet

- **Where to go:** Supabase SQL Editor, Vault, Edge Function configuration, scheduled jobs, Vercel settings, and Reminders page.
- **What to check:** Keep the delivery migration, all three dispatcher Vault values, valid dispatch invocation, cron schedule, permission prompt, browser subscription, and real delivery inactive until the explicitly approved 13E-D controlled-device phase.
- **Exact SQL/command:** None. Do not run the delivery migration or any send/test command.
- **Expected result:** No production dispatcher invocation and no user notification is possible from setup performed under this checklist. The delivery migration currently creates the one-minute scheduler, and completed Vault configuration makes its hook active.
- **What NOT to do:** Do not send a real notification, invoke the dispatcher with a valid secret, activate a reminder schedule, or test against real user subscriptions.
- **Safe to proceed:** Yes to documenting and checking current state. No to enabling delivery.

## 13. Final readiness checklist for PHASE 13E-D

- **Where to go:** Review this checklist alongside `docs/PHASE_13E-C_SUPABASE_NOTIFICATION_SETUP.md` and record verified results from the Supabase/Vercel dashboards.
- **What to check:** Every hosted item is verified, matching VAPID configuration and server-side secret placement are understood, deployment/auth/scheduler requirements are documented, and 13E-D has explicit authorization for a dedicated controlled device/account.
- **Exact SQL/command:** No 13E-D execution command is specified by the current repository documentation — stop and verify before proceeding.
- **Expected result:** 13E-D starts only after the hosted state is confirmed and the user approves a controlled real-device test. The final checkbox is not a claim that readiness has already been achieved.
- **What NOT to do:** Do not mark ready while any hosted item is unverified, and do not send a real notification as part of this checklist.
- **Safe to proceed:** Verification only. 13E-D delivery is deferred until the checklist is actually complete and separately approved.

## Completion checklist

[ ] Hosted schema verified  
[ ] Notification migrations verified  
[ ] RLS verified  
[ ] VAPID configuration understood  
[ ] Vercel public key configured  
[ ] Server-side secrets understood  
[ ] Edge Function requirements verified  
[ ] Scheduler requirements verified  
[ ] No real notification sent  
[ ] Ready for 13E-D controlled device test
