import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getProtectedRouteAccess } from '../src/auth/routeAccess.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('protected route access waits for auth initialization without allowing content', () => {
  assert.equal(getProtectedRouteAccess({ loading: true, isAuthenticated: false }), 'loading');
  assert.equal(getProtectedRouteAccess({ loading: true, isAuthenticated: true }), 'loading');
});

test('protected routes allow an authenticated user and redirect a signed-out user', () => {
  assert.equal(getProtectedRouteAccess({ loading: false, isAuthenticated: true }), 'allow');
  assert.equal(getProtectedRouteAccess({ loading: false, isAuthenticated: false }), 'redirect');
});

test('app groups every personal route behind the auth guard and leaves public entry routes outside it', async () => {
  const app = await read('../src/App.jsx');
  const vercel = await read('../vercel.json');
  assert.match(app, /<Route element={<RequireAuth \/>}>[\s\S]*?<\/Route>/);
  assert.match(app, /if \(access === "loading"\) return null/);
  assert.match(app, /if \(access === "redirect"\) return <Navigate to="\/login" replace \/>/);

  for (const route of ['/today', '/ritual/:ritualId', '/journey', '/history', '/reminders', '/settings/notifications']) {
    assert.ok(app.indexOf(`<Route path="${route}"`) > app.indexOf('<Route element={<RequireAuth />}>'));
  }
  for (const route of ['/', '/login', '/signup']) {
    assert.match(app, new RegExp(`<Route\\s+path="${route.replaceAll('/', '\\/')}"`));
  }
  assert.match(vercel, /"source"\s*:\s*"\/\(\.\*\)"/);
  assert.match(vercel, /"destination"\s*:\s*"\/index\.html"/);
});

test('sign out appears only for authenticated users on the landing navigation and returns to the landing page', async () => {
  const header = await read('../src/components/AppHeader.jsx');
  const today = await read('../src/components/TodayDashboard.jsx');
  const landing = await read('../src/components/LandingPage.jsx');
  const css = await read('../src/App.css');
  assert.doesNotMatch(header, /signOut|Sign out/);
  assert.match(landing, /import \{ signOut \} from "\.\.\/auth\/authService\.js"/);
  assert.match(landing, /\{isAuthenticated \? \([\s\S]*?className="landing-signout"/);
  assert.match(landing, /await signOut\(\)/);
  assert.match(landing, /navigate\("\/", \{ replace: true \}\)/);
  assert.match(landing, /signOutError \? <span className="landing-signout-error" role="alert">/);
  const navbar = landing.indexOf('<nav className="landing-nav"');
  const begin = landing.indexOf('className="nav-button"', navbar);
  const signout = landing.indexOf('className="landing-signout"', begin);
  const navbarEnd = landing.indexOf('</nav>', navbar);
  assert.ok(navbar >= 0 && begin > navbar && signout > begin && navbarEnd > signout);
  assert.doesNotMatch(today, /signOut|Sign out|today-account-action/);
  for (const page of ['JourneyPage.jsx', 'HistoryPage.jsx', 'NotificationSettingsPage.jsx', 'RitualPage.jsx']) {
    const source = await read(`../src/components/${page}`);
    assert.doesNotMatch(source, /Sign out/);
  }
  assert.doesNotMatch(await read('../src/components/AppHeader.css'), /arc-account-action|flex-wrap:\s*wrap/);
  assert.match(css, /\.landing-signout\s*\{[\s\S]*?min-height: 44px;/);
  assert.match(css, /\.nav-actions\s*\{[\s\S]*?display: flex;[\s\S]*?gap: 12px;/);
});

test('weekly and monthly Save reflection controls remain in the page markup below their fields', async () => {
  const journey = await read('../src/components/JourneyPage.jsx');
  const css = await read('../src/components/JourneyPage.css');
  assert.equal((journey.match(/className="reflection-save-button"/g) || []).length, 2);
  const monthlyMarkup = journey.slice(journey.lastIndexOf("monthly-intention-block"));
  const monthlyTextarea = monthlyMarkup.indexOf("<textarea");
  const monthlyTextareaEnd = monthlyMarkup.indexOf("/>", monthlyTextarea);
  const monthlyButton = monthlyMarkup.indexOf('className="reflection-save-button"', monthlyTextareaEnd);
  assert.ok(monthlyTextarea >= 0 && monthlyTextareaEnd > monthlyTextarea);
  assert.ok(monthlyButton > monthlyTextareaEnd);
  assert.match(monthlyMarkup.slice(monthlyButton, monthlyButton + 400), /"Save reflection"/);
  assert.match(css, /\.reflection-save-button\s*\{[\s\S]*?display: block;[\s\S]*?min-height: 44px;/);
});

test('landing Begin actions send signed-out users to login and defer initialization through the protected guard', async () => {
  const landing = await read('../src/components/LandingPage.jsx');
  assert.match(landing, /const beginRoute = isAuthenticated \|\| authLoading \? "\/today" : "\/login"/);
  assert.equal((landing.match(/to=\{beginRoute\}/g) || []).length, 4);
});

test('authenticated auth-page visits and successful login/signup return to the landing page', async () => {
  const authPage = await read('../src/components/AuthPage.jsx');
  assert.match(authPage, /if \(isAuthenticated\)[\s\S]*?<Navigate to="\/" replace \/>/);
  assert.match(authPage, /signIn\(/);
  assert.match(authPage, /signUp\(/);
  assert.match(authPage, /if \(result\.data\?\.session\)\s*\{\s*navigate\("\/", \{ replace: true \}\)/);
  assert.match(authPage, /const result = isSignup\s*\? await signUp\([\s\S]*?: await signIn\([\s\S]*?if \(result\.data\?\.session\)/);
});
