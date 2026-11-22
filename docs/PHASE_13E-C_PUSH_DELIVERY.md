# Phase 13E-C — Push Delivery and Scheduling

**Status:** delivery/scheduling code and migrations prepared locally. Neither the 13E-B nor the 13E-C migration has been applied to hosted Supabase. No real push was sent or claimed.

## 1. Architecture

The existing owner-scoped `notification_preferences` and `push_subscriptions` from Phase 13E-B remain the source of truth. A Supabase Edge Function named `notification-dispatcher` checks due preferences, claims an at-most-once delivery row for each active device, and sends encrypted Web Push using the pinned `web-push` package. A `pg_cron` job invokes it each minute through `pg_net`. The authenticated request to the dispatcher is protected by a separate random shared secret held in Edge Function secrets and Supabase Vault.

The Edge Function ignores the request body and accepts no account or user IDs from callers. It uses the server-side Supabase service-role credential only to read eligible records, insert delivery claims, and update the specific delivery/subscription rows. RLS remains enabled; normal clients receive no write privilege on the delivery ledger.

Supabase documents npm imports and Node compatibility in Edge Functions ([dependency guide](https://supabase.com/docs/guides/functions/dependencies)). The Web Push implementation uses the established [`web-push`](https://github.com/web-push-libs/web-push) implementation of VAPID and encrypted Web Push payloads. Its use in the deployed Supabase Edge Runtime has not been live-verified here.

## 2. Notification types

This phase sends only `morning`, `evening`, and `bedtime` reminders. A category is eligible only when both its category flag and the global `enabled` flag are true. Water and sunscreen remain stored preferences but are not dispatched in this phase. Copy is fixed, generic, and defined in `public/sw.js`; user data is never included in payloads.

## 3. Scheduling and timezone behavior

`supabase/functions/notification-dispatcher` evaluates the current instant against each enabled preference's IANA timezone using `Intl.DateTimeFormat`. It compares the resulting local `YYYY-MM-DD` and `HH:mm` with that category's stored local time. Times are not interpreted as server timezone values. Missing or invalid timezone data is skipped; the dispatcher never guesses a timezone.

The cron runs every minute. A reminder is due only during the matching local minute. If the function is delayed past that minute or unavailable, that occurrence is missed; there is no catch-up send. During a repeated fall-back hour, the database uniqueness constraint allows the local date/category/time/device slot only once. A nonexistent spring-forward wall time is naturally skipped.

## 4. Deduplication and delivery state

`notification_delivery_events` stores a deterministic occurrence using `user_id`, `local_date`, `category`, `scheduled_time`, and `subscription_id`. A unique constraint and insert-before-send claim prevent concurrent/repeated dispatcher invocations from sending the same slot twice to one device. Each device has its own row so an account's Android PWA and desktop browser can both receive the reminder.

The ledger states are `claimed`, `accepted`, `invalid`, and `failed`. This is deliberately at-most-once: an uncertain network/provider failure is recorded and not automatically retried, avoiding duplicate notifications when the push service may have accepted the request before a timeout. A crash after a claim and before send can lose that occurrence. `accepted` means the push service accepted the request, not that the operating system displayed it.

## 5. Subscription lifecycle and invalid endpoints

The dispatcher loads active subscriptions filtered by the preference owner's `user_id`, then checks that each row's owner matches again before sending. The delivery table also has a composite owner foreign key to the subscription. Each endpoint is handled independently.

The server and migration accept only HTTPS endpoints on the common FCM, Mozilla Push, Microsoft WNS, and Apple Web Push origins. This prevents a forged subscription row from turning the privileged sender into a general-purpose request proxy. If a supported browser uses another push origin in the future, review and add that exact provider domain to the allowlist before enabling it.

Push service responses `404` and `410` mark only the matching `(subscription_id, user_id)` inactive and set `revoked_at`. Other failures are recorded as failed without automatic retry. Existing sign-out/account-switch cleanup from 13E-B remains in place. A device signed out through the app deactivates its browser subscription; other devices for the same account are not deactivated.

## 6. Required secrets and public configuration

Set these Edge Function values in Supabase's server-side secret store:

- `VAPID_PUBLIC_KEY`: must match the browser's `VITE_VAPID_PUBLIC_KEY`.
- `VAPID_PRIVATE_KEY`: private VAPID credential; never put it in Vite or the repository.
- `VAPID_SUBJECT`: externally valid `mailto:` or HTTPS contact URI.
- `NOTIFICATION_DISPATCH_SECRET`: randomly generated high-entropy value (at least 32 characters), also stored in Vault as `notification_dispatch_secret`.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: server-side function configuration only. Supabase provides these in the Edge runtime; if configuring them manually, keep them in server-side secrets.

The migration's cron hook reads these values from Supabase Vault:

- `notification_project_url`: project base URL, such as `https://<project-ref>.supabase.co`.
- `notification_publishable_key`: public/publishable project key used as the Edge gateway `apikey` header.
- `notification_dispatch_secret`: same shared secret as the Edge Function environment value.

Only the public VAPID key belongs in the client environment. `.env.example` already contains the empty public placeholder. Do not create a `VITE_` variable for any private key or shared dispatcher secret.

## 7. Migrations and deployment steps

The hosted database has not been changed. The hosted project must first receive these migrations, in order:

1. `20261002130000_notification_foundation.sql` (13E-B).
2. `20261002140000_notification_delivery.sql` (this phase).

Review and apply them manually through the approved Supabase migration workflow. The second migration creates the per-device ledger, enables `pg_cron`, `pg_net`, and Vault, and schedules a one-minute job. The job is inert until the three matching Vault values are set.

After review and migration application:

1. Set the Edge Function secrets above and set the production client `VITE_VAPID_PUBLIC_KEY` to the matching public key.
2. Deploy `notification-dispatcher` with Supabase CLI and JWT verification disabled for this service-to-service endpoint, for example `supabase functions deploy notification-dispatcher --project-ref <PROJECT_REF> --no-verify-jwt`. The function checks `x-dispatch-secret` itself on every request. If deploying through the Dashboard, disable gateway JWT verification for this function and retain the handler's shared-secret check.
3. Store the project URL, publishable key, and same dispatch secret in Vault under the names above. The cron will begin invoking the deployed function after all three values exist.
4. Confirm the named cron job is enabled and inspect sanitized function counts/logs; never print Vault or Edge secrets.
5. Confirm the public VAPID key in the installed client exactly matches the server key before testing opt-in.

Supabase documents Vault-backed `pg_cron`/`pg_net` invocation ([Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)) and per-function JWT configuration ([Function Configuration](https://supabase.com/docs/guides/functions/function-configuration)).

## 8. Tests and validation

`tests/notification-dispatcher.test.js` covers eligibility, category/global switches, timezone conversion including both DST transitions, missing timezone behavior, deterministic identities, duplicate invocations, pagination, multiple devices, invalid endpoint cleanup, ownership isolation, provider endpoint allowlisting, payload shape, RLS/migration assumptions, and secret boundaries. Push delivery is mocked; tests do not claim a successful real delivery.

Full test suite: **142 passed, 0 failed**. Targeted ESLint passed for the changed JS/TS source, service worker, config, and tests. Production build passed with the existing-size warning for the minified app bundle (>500 kB). A static scan found no service-role key, private VAPID key, or dispatcher secret in browser source, public assets, or `.env.example`.

The Edge Function's npm dependency is pinned in its local `deno.json`. This workspace has neither Supabase CLI nor Deno/PostgreSQL tooling, so the migrations were statically tested but not executed and the Edge Function was not locally served, Deno-type-checked, or deployed. The migrations were not applied locally or to hosted Supabase.

## 9. Manual verification steps

After manually applying both migrations and configuring/deploying the function:

1. Set the browser public VAPID key to match the server key, then sign into the installed Android PWA.
2. In **Reminders**, explicitly enable notifications and confirm permission and subscription state.
3. Set one category's local time to the next minute and enable it; save preferences.
4. Confirm the account-owned active subscription and preference rows in Supabase without displaying endpoint/key values.
5. Confirm one sanitized `accepted` ledger row and one device notification; invoke the dispatcher again and confirm no second row/send for that slot.
6. Tap the notification and confirm Winter Arc opens at `/today`.
7. Sign out and confirm this device's subscription becomes inactive; confirm another device remains active.
8. In a controlled test only, revoke one endpoint and confirm only that device is deactivated after a `404`/`410` response.

**Not run here:** all physical-device steps, hosted migration application, function deployment, cron execution, and real push delivery.

## 10. Limitations and intentionally excluded work

- Delivery is best-effort and depends on browser support, OS settings, PWA installation state, network access, push-service availability, permission, and subscription validity.
- Minute matching can miss an occurrence if the scheduler is delayed; this phase has no catch-up/retry queue or exact delivery guarantee.
- A provider acceptance response does not prove that a device displayed the notification.
- No water/sunscreen dispatch, custom-habit reminders, event-driven campaigns, delivery analytics UI, Groups/Challenges, screen-time tracking, 90-day conversion, landing-page changes, or reflection UX changes were added.
- No notification permission is requested automatically. No user data or subscription endpoint is cached by the service worker.

## 1. Architecture

The existing owner-scoped `notification_preferences` and `push_subscriptions` from Phase 13E-B remain the source of truth. A Supabase Edge Function named `notification-dispatcher` checks due preferences, claims an at-most-once delivery row for each active device, and sends encrypted Web Push using the pinned `web-push` package. A `pg_cron` job invokes it each minute through `pg_net`. The authenticated request to the dispatcher is protected by a separate random shared secret held in Edge Function secrets and Supabase Vault.

The Edge Function ignores the request body and accepts no account or user IDs from callers. It uses the server-side Supabase service-role credential only to read eligible records, insert delivery claims, and update the specific delivery/subscription rows. RLS remains enabled; normal clients receive no write privilege on the delivery ledger.

Supabase documents npm imports and Node compatibility in Edge Functions ([dependency guide](https://supabase.com/docs/guides/functions/dependencies)). The Web Push implementation uses the established [`web-push`](https://github.com/web-push-libs/web-push) implementation of VAPID and encrypted Web Push payloads. Its use in the deployed Supabase Edge Runtime has not been live-verified here.

## 2. Notification types

This phase sends only `morning`, `evening`, and `bedtime` reminders. A category is eligible only when both its category flag and the global `enabled` flag are true. Water and sunscreen remain stored preferences but are not dispatched in this phase. Copy is fixed, generic, and defined in `public/sw.js`; user data is never included in payloads.

## 3. Scheduling and timezone behavior

`supabase/functions/notification-dispatcher` evaluates the current instant against each enabled preference's IANA timezone using `Intl.DateTimeFormat`. It compares the resulting local `YYYY-MM-DD` and `HH:mm` with that category's stored local time. Times are not interpreted as server timezone values. Missing or invalid timezone data is skipped; the dispatcher never guesses a timezone.

The cron runs every minute. A reminder is due only during the matching local minute. If the function is delayed past that minute or unavailable, that occurrence is missed; there is no catch-up send. During a repeated fall-back hour, the database uniqueness constraint allows the local date/category/time/device slot only once. A nonexistent spring-forward wall time is naturally skipped.

## 4. Deduplication and delivery state

`notification_delivery_events` stores a deterministic occurrence using `user_id`, `local_date`, `category`, `scheduled_time`, and `subscription_id`. A unique constraint and insert-before-send claim prevent concurrent/repeated dispatcher invocations from sending the same slot twice to one device. Each device has its own row so an account's Android PWA and desktop browser can both receive the reminder.

The ledger states are `claimed`, `accepted`, `invalid`, and `failed`. This is deliberately at-most-once: an uncertain network/provider failure is recorded and not automatically retried, avoiding duplicate notifications when the push service may have accepted the request before a timeout. A crash after a claim and before send can lose that occurrence. `accepted` means the push service accepted the request, not that the operating system displayed it.

## 5. Subscription lifecycle and invalid endpoints

The dispatcher loads active subscriptions filtered by the preference owner's `user_id`, then checks that each row's owner matches again before sending. The delivery table also has a composite owner foreign key to the subscription. Each endpoint is handled independently.

Push service responses `404` and `410` mark only the matching `(subscription_id, user_id)` inactive and set `revoked_at`. Other failures are recorded as failed without automatic retry. Existing sign-out/account-switch cleanup from 13E-B remains in place. A device signed out through the app deactivates its browser subscription; other devices for the same account are not deactivated.

## 6. Required secrets and public configuration

Set these Edge Function values in Supabase's server-side secret store:

- `VAPID_PUBLIC_KEY`: must match the browser's `VITE_VAPID_PUBLIC_KEY`.
- `VAPID_PRIVATE_KEY`: private VAPID credential; never put it in Vite or the repository.
- `VAPID_SUBJECT`: externally valid `mailto:` or HTTPS contact URI.
- `NOTIFICATION_DISPATCH_SECRET`: randomly generated high-entropy value (at least 32 characters), also stored in Vault as `notification_dispatch_secret`.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: server-side function configuration only. Supabase provides these in the Edge runtime; if configuring them manually, keep them in server-side secrets.

The migration's cron hook reads these values from Supabase Vault:

- `notification_project_url`: project base URL, such as `https://<project-ref>.supabase.co`.
- `notification_publishable_key`: public/publishable project key used as the Edge gateway `apikey` header.
- `notification_dispatch_secret`: same shared secret as the Edge Function environment value.

Only the public VAPID key belongs in the client environment. `.env.example` already contains the empty public placeholder. Do not create a `VITE_` variable for any private key or shared dispatcher secret.

## 7. Migrations and deployment steps

The hosted database has not been changed. The hosted project must first receive these migrations, in order:

1. `20261002130000_notification_foundation.sql` (13E-B).
2. `20261002140000_notification_delivery.sql` (this phase).

Review and apply them manually through the approved Supabase migration workflow. The second migration creates the per-device ledger, enables `pg_cron`, `pg_net`, and Vault, and schedules a one-minute job. The job is inert until the three matching Vault values are set.

After review and migration application:

1. Set the Edge Function secrets above and set the production client `VITE_VAPID_PUBLIC_KEY` to the matching public key.
2. Deploy `notification-dispatcher` with Supabase CLI and JWT verification disabled for this service-to-service endpoint, for example `supabase functions deploy notification-dispatcher --project-ref <PROJECT_REF> --no-verify-jwt`. The function checks `x-dispatch-secret` itself on every request. If deploying through the Dashboard, disable gateway JWT verification for this function and retain the handler's shared-secret check.
3. Store the project URL, publishable key, and same dispatch secret in Vault under the names above. The cron will begin invoking the deployed function after all three values exist.
4. Confirm the named cron job is enabled and inspect sanitized function counts/logs; never print Vault or Edge secrets.
5. Confirm the public VAPID key in the installed client exactly matches the server key before testing opt-in.

Supabase documents Vault-backed `pg_cron`/`pg_net` invocation ([Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)) and per-function JWT configuration ([Function Configuration](https://supabase.com/docs/guides/functions/function-configuration)).

## 8. Tests and validation

`tests/notification-dispatcher.test.js` covers eligibility, category/global switches, timezone conversion including both DST transitions, missing timezone behavior, deterministic identities, duplicate invocations, multiple devices, invalid endpoint cleanup, ownership isolation, payload shape, RLS/migration assumptions, and secret boundaries. Push delivery is mocked; tests do not claim a successful real delivery.

The Edge Function's npm dependency is pinned in its local `deno.json`. This workspace has neither Supabase CLI nor Deno/PostgreSQL tooling, so the SQL was statically tested but not executed and the Edge Function was not locally served, type-checked, or deployed.

## 9. Manual verification steps

After manually applying both migrations and configuring/deploying the function:

1. Set the browser public VAPID key to match the server key, then sign into the installed Android PWA.
2. In **Reminders**, explicitly enable notifications and confirm permission and subscription state.
3. Set one category's local time to the next minute and enable it; save preferences.
4. Confirm the account-owned active subscription and preference rows in Supabase without displaying endpoint/key values.
5. Confirm one sanitized `accepted` ledger row and one device notification; invoke the dispatcher again and confirm no second row/send for that slot.
6. Tap the notification and confirm Winter Arc opens at `/today`.
7. Sign out and confirm this device's subscription becomes inactive; confirm another device remains active.
8. In a controlled test only, revoke one endpoint and confirm only that device is deactivated after a `404`/`410` response.

**Not run here:** all physical-device steps, hosted migration application, function deployment, cron execution, and real push delivery.

## 10. Limitations and intentionally excluded work

- Delivery is best-effort and depends on browser support, OS settings, PWA installation state, network access, push-service availability, permission, and subscription validity.
- Minute matching can miss an occurrence if the scheduler is delayed; this phase has no catch-up/retry queue or exact delivery guarantee.
- A provider acceptance response does not prove that a device displayed the notification.
- No water/sunscreen dispatch, custom-habit reminders, event-driven campaigns, delivery analytics UI, Groups/Challenges, screen-time tracking, 90-day conversion, landing-page changes, or reflection UX changes were added.
- No notification permission is requested automatically. No user data or subscription endpoint is cached by the service worker.
