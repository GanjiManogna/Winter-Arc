# Winter Arc v1 — Project Snapshot

**Release status: WINTER ARC v1 — COMPLETE**

This document is a read-only product and architecture snapshot. It records the current repository structure and the latest Vercel production deployment confirmed by the CLI in this workspace. It does not authorize or describe an unverified live database inspection.

## 1. Production URL

- Production alias: [https://winter-arc-three-gilt.vercel.app](https://winter-arc-three-gilt.vercel.app)
- Project: `winter-arc`

## 2. Main features

- A 92-day Winter Arc program with day/date progress.
- An atmospheric landing page, Promise interaction, display-name personalization, and public entry flow.
- Daily rituals with boolean, measurable, and informational tracking.
- Today, Journey, History, daily/weekly/monthly analysis, and reflection pages.
- Account authentication and account-owned cloud data, with existing local data/repository support.
- Custom Habits, Sleep Tracker, Friends Challenge, and opt-in web push reminders.
- Installable PWA with app-shell offline support.

## 3. Routes

| Route | Purpose | Access |
| --- | --- | --- |
| `/` | Landing page | Public |
| `/login` | Email/password login | Public |
| `/signup` | Account registration | Public |
| `/today` | Today dashboard | Authenticated |
| `/journey` | Arc journey and period accordions | Authenticated |
| `/history` | Historical progress and analysis | Authenticated |
| `/ritual/:ritualId` | Built-in or custom ritual detail, including `/ritual/read` and `/ritual/sleep-tracker` | Authenticated |
| `/challenge` | Friends Challenge list | Authenticated |
| `/challenge/create` | Create a challenge | Authenticated |
| `/challenge/join` | Join a challenge | Authenticated |
| `/challenge/:challengeId` | Challenge detail | Authenticated |
| `/reminders` | Notification settings | Authenticated |
| `/settings/notifications` | Notification settings alias | Authenticated |

Vercel rewrites app paths to `index.html` for client-side route handling. Migration preview/import routes are development-only and are not included in production routing.

## 4. Technology stack

- React 19 and Vite 8.
- React Router 7 for client-side navigation.
- Supabase JavaScript client for Auth and authenticated database access.
- Supabase PostgreSQL, Row Level Security (RLS), database functions, and Edge Functions.
- Vercel for production hosting.
- Web App Manifest, service worker, and Web Push APIs for PWA behavior.
- Node's built-in test runner and ESLint 10.

## 5. Supabase architecture

- The browser client reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from Vite configuration. These are public client configuration; privileged keys must remain server-side.
- Supabase Auth user UUIDs establish account identity. User-owned rows are protected with RLS and ownership constraints.
- `cloudRepository.js` maps authenticated account data to the application progress model. Local repository/storage paths remain available for the established signed-out and fallback behavior.
- The account data lifecycle isolates loaded progress by account and handles account changes and cloud loading.
- Notification dispatch runs in a Supabase Edge Function; database scheduling and server-side secrets are separate from browser configuration.

## 6. Authentication flow

- Signup and login use Supabase email/password Auth; signup stores a display name in user metadata.
- The landing page remains public. A signed-out Begin action routes to authentication. Successful authentication returns to `/`; the user then chooses Begin to enter `/today`.
- Authenticated app routes are wrapped in `RequireAuth`; while session initialization is unresolved, protected content is not rendered. Signed-out access redirects to `/login`.
- Sign out uses Supabase Auth and returns to the public landing page. It does not delete local or cloud progress.

## 7. Ritual system

The built-in ritual catalog is defined in `src/data/rituals.js`; `ritualStatus.js` derives status and completion semantics. Current rituals are:

1. Wake Up Early
2. Apply Sunscreen (SPF)
3. Drink Enough Water
4. 10,000 Steps
5. Workout / Exercise
6. Healthy Meals
7. No Junk Food
8. Read / Learn
9. Meditate / Journal
10. Sleep On Time
11. Wash Face + Moisturize
12. Sleep Tracker (informational)

Measurable rituals retain their numeric values and target-based status rules. Healthy Meals tracks three meal states and completes at the established threshold. Sunscreen retains application timestamps and counts the ritual once its completion condition is met. Sleep Tracker is informational and excluded from ritual completion totals.

## 8. Sleep Tracker

Sleep Tracker is reachable at `/ritual/sleep-tracker` and also appears as a sleep summary on the landing experience. The daily model can retain explicit sleep and wake times; duration is derived across midnight when both times are valid. Legacy/manual sleep-hour values remain supported for historical compatibility. Sleep remains separate from pass/fail completion totals and is available in History/analysis.

## 9. Custom Habits

Users can create boolean or measurable habits. Habit identity and definitions are persisted through the current repository architecture. Date-specific ritual snapshots preserve the definition that applied historically, including archived habits, so later edits/additions do not rewrite past definitions and totals.

## 10. Friends Challenge

Friends Challenge supports creating, joining, listing, reading, leaving, and ending challenges. Supabase RPCs return privacy-filtered member/progress data; the frontend uses aggregate progress and does not expose private ritual details. Challenge routes are authenticated. The data layer uses the `winter_arc_challenges` and `winter_arc_challenge_members` tables with RLS and owner/member-scoped RPCs.

## 11. Notifications

- The Reminders page stores account-owned notification preferences and device push subscriptions.
- Categories include Morning, Water, Sunscreen, Evening, and Bedtime; a customizable weekly reminder is also supported.
- Browser subscription uses the public VAPID key. The Supabase dispatcher uses server-side VAPID/dispatch configuration and scheduled execution.
- `public/sw.js` handles notification display, occurrence-specific Sunscreen tags, and safe click destinations. Private/authenticated API data is excluded from service-worker caching.

## 12. PWA and icon setup

- Manifest: `public/manifest.webmanifest`; display mode is standalone.
- Service worker: `public/sw.js`, registered by `src/pwa/registerServiceWorker.js` in production.
- Icon assets in `public/icons/` use the supplied Winter Arc botanical artwork at 32, 192, and 512 pixel sizes, with 192/512 maskable variants.
- `index.html` references the 32px favicon and 192px Apple touch icon. The manifest references the standard and maskable 192/512 icons. The service worker caches the app shell and icon files.
- The PWA shell can fall back to its cached app document offline; authenticated API responses are not cached.

## 13. Landing page structure

The Landing experience is composed as:

**Hero → Friends + Sleep → Idea → Four Journey Moments → Promise → Personal Story + Final CTA → Footer**

The Hero has browser-local time-aware atmosphere, Arc day/date information, and its celestial/mountain visual treatment. Friends Challenge and Sleep summaries are privacy/account-aware. The Promise reflects the actual Arc lifecycle. The personal creator story and CTA share one continuous ending section.

## 14. Important database migrations

The repository's ordered migrations are:

| Migration | Purpose |
| --- | --- |
| `20261002120000_winter_arc_owned_data.sql` | Arc programs, dated daily ritual entries, ritual snapshots, custom habit identities/definitions, weekly/monthly reflections, indexes, ownership constraints, and RLS. |
| `20261002130000_notification_foundation.sql` | Notification preferences and push subscriptions, timezone validation, subscription RPCs, indexes, and owner-scoped RLS. |
| `20261002140000_notification_delivery.sql` | Delivery event/claim structure, delivery indexes, required extensions, RLS, and dispatcher invocation function. |
| `20261003100000_notification_sunscreen_weekly.sql` | Sunscreen/weekly preference and delivery-category/uniqueness support. |
| `20261003110000_notification_water_category.sql` | Adds Water to allowed notification delivery categories. |
| `20261004100000_sleep_explicit_times.sql` | Nullable `sleep_time` and `wake_time` daily-entry fields and format/ritual constraints. |
| `20261004110000_friends_challenge_v1.sql` | Challenge/member tables, indexes, RLS policies, private progress helper, and public challenge RPCs. |

Per the earlier hosted verification and migration-history reconciliation phase, the existing schema migrations were reconciled in the remote ledger and the Friends Challenge migration was applied. This summary does not replace checking the live Supabase migration ledger before future schema work.

## 15. Known warnings and issues

- Full ESLint has a known existing `react-hooks/set-state-in-effect` error at `src/components/CustomHabitModal.jsx:20`.
- Vite production builds pass but warn that the main JavaScript bundle exceeds 500 kB after minification.
- Vercel reports package funding notices during remote builds; these do not fail deployment.
- The latest recorded tests in this workspace were 212/212 passing. Re-run checks before a future release.

## 16. Production deployment record

Latest successful deployment confirmed by the Vercel CLI in this workspace:

- Status: `READY`, target `production`
- Project: `winter-arc` under `manognaganji-2666`
- Production alias: [https://winter-arc-three-gilt.vercel.app](https://winter-arc-three-gilt.vercel.app)
- Deployment URL: [https://winter-lz1md5g59-manognaganji-2666.vercel.app](https://winter-lz1md5g59-manognaganji-2666.vercel.app)
- Deployment ID: `dpl_DAgWapXHwz92jbZoyfSSCJ7TVnNe`
- Vercel inspection: [deployment details](https://vercel.com/manognaganji-2666/winter-arc/DAgWapXHwz92jbZoyfSSCJ7TVnNe)

This is the last deployment identifier confirmed in the task record. The creator signature was subsequently corrected in the local source to `— Manogna Ganji` without a recorded redeployment in this workspace. Unless a later deployment was made outside this task, production may still show the prior signature. Verify the Vercel deployment history before treating that copy correction as live.

## 17. Safe future v1.1 ideas

These are suggestions only, not committed scope:

- Add end-to-end smoke tests for account entry, protected direct routes, ritual writes, and PWA install paths.
- Add self-service account data export and deletion with explicit confirmation and server-side ownership checks.
- Improve offline/pending-sync status visibility and exercise account switching under interrupted connectivity.
- Split large route bundles to reduce the Vite chunk warning, after measuring the effect on PWA startup.
- Add privacy-safe notification delivery diagnostics and a device-reminder troubleshooting view.
- Resolve the known Custom Habit modal lint issue in a separately scoped maintenance change.

---

**WINTER ARC v1 — COMPLETE**
