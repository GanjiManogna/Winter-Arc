# Winter Arc

**A calm 92-day journey of daily rituals, reflection, and rest.**

Winter Arc helps you build a steady routine through small daily commitments. Track your progress, look back on your journey, and make the experience your own with custom habits.

[Open Winter Arc](https://winter-arc-three-gilt.vercel.app)

## Screenshots

### Landing page

![Winter Arc landing page with the 92-day journey introduction](docs/screenshots/landing-page.png)

### Connection and rest

![Winter Arc connection and sleep feature cards](docs/screenshots/connection-and-rest.png)

## What you can do

- Follow a 92-day program with a daily progress view.
- Track daily rituals, including measurable habits such as water and steps.
- Create custom boolean or measurable habits.
- Review your progress in Journey and History, with daily, weekly, and monthly analysis.
- Write weekly and monthly reflections.
- Track sleep without counting it as a completed ritual.
- Sign in to use account features, and optionally enable web push reminders.
- Install the app as a PWA on supported devices, with an offline app shell.

## Tech stack

- React 19, Vite 8, and React Router 7
- Supabase Auth and PostgreSQL for account features
- Vercel for hosting
- Web App Manifest, service worker, and Web Push APIs
- Node.js test runner and ESLint

## Run locally

### Requirements

- Node.js 20.19+ or 22.12+
- npm

### Install and start

```bash
git clone https://github.com/GanjiManogna/Winter-Arc.git
cd Winter-Arc
npm install
cp .env.example .env.local
npm run dev
```

Vite will print the local address, usually `http://localhost:5173`.

The app can run without Supabase configuration for local-first use. To enable Supabase-backed authentication and account features, set the values below in `.env.local`:

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase publishable/anon key for the browser client |
| `VITE_VAPID_PUBLIC_KEY` | Public VAPID key for browser push subscriptions (optional) |

Never put a Supabase service-role key, database password, or other private secret in a `VITE_` variable. Vite embeds these values in browser code. Keep server-side notification secrets in the Supabase Edge Function environment.

## Useful commands

```bash
npm run dev      # Start the development server
npm run build    # Create a production build in dist/
npm run preview  # Preview the production build locally
npm run lint     # Run ESLint
npm test         # Run the Node.js test suite
```

## Project layout

```text
src/
  auth/          Authentication and route access
  components/    Pages and interface components
  data/          Rituals, progress, analysis, and repositories
  notifications/ Browser notification support
  pwa/           Service worker registration
supabase/
  functions/     Edge Functions
  migrations/    Database schema migrations
tests/           Node.js tests
docs/            Architecture and project notes
```

## Data and privacy

Winter Arc supports local progress storage and account-based features. Account-owned database records are protected with Supabase Row Level Security. The service worker caches the app shell; it does not cache authenticated API responses. Do not commit `.env.local` or private credentials.

## License

No license has been added yet. Contact the repository owner before reusing or redistributing this project.
