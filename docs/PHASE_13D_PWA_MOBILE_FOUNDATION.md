# Phase 13D — PWA + Mobile App Foundation

## PWA setup

Winter Arc now declares a Web App Manifest at `/manifest.webmanifest`, uses the app name and short name `Winter Arc`, launches at `/` in standalone mode, and requests portrait orientation. The existing React/Vite application remains the only application shell; no native wrapper or routing rewrite was added.

The document head includes a mobile viewport with `viewport-fit=cover`, theme/description metadata, and iOS standalone metadata. The shared app header accounts for top and horizontal safe-area insets on notched devices. Existing page bottom padding remains in place for the home-indicator area; page dimensions and content widths were not normalized.

## Icons

The existing favicon was a generic Vite mark, so it was replaced with an icon derived from Winter Arc's current star, sunrise, and mountain visual language. The manifest includes 192×192 and 512×512 PNG icons, plus maskable variants at both sizes. A matching scalable SVG is used for the favicon. An Apple touch icon link points to the 192px PNG.

## Service worker and caching

`/sw.js` is a small hand-written service worker served from the public root. It precaches the app shell, manifest, and app icons. It caches only same-origin `/assets/` resources and the explicitly listed public icon files, and only for script, style, font, or image requests. Other resource destinations are network-only.

Cross-origin requests, authorization-bearing requests, non-GET requests, and paths for auth, REST, storage, and functions APIs are excluded. In particular, Supabase responses, auth tokens, cloud progress, reflections, and account-specific records are not placed in Cache Storage. Navigations are network-first and fall back to the cached `index.html` shell when offline. The app shell can load offline, but authenticated cloud data can remain unavailable; no offline write queue or delayed merge was added.

The worker does not call `skipWaiting()` or `clients.claim()` and does not force a reload when a new worker installs. The browser's normal waiting/activation lifecycle avoids interrupting an open session or save. The registration is production-only and failure is non-blocking.

## Routing, authentication, and deployment

All existing BrowserRouter routes remain unchanged. Vite development/preview serves the SPA fallback for refreshed client routes. A production static host must also rewrite application navigation paths to `index.html` while leaving real static files and API paths intact; this is required for direct refreshes of `/today`, `/history`, `/journey`, `/ritual/...`, `/login`, and `/signup`.

Authentication continues through the existing `AuthProvider` and Supabase client. The service worker neither handles auth responses nor stores credentials. Supabase's existing browser session persistence and cloud ownership/RLS architecture remain the source of truth in authenticated mode. This change does not alter cloud/local fallback or conflict handling.

## Mobile and accessibility checks

- Existing responsive page sizing and ritual identities are preserved.
- The shared navigation already provides 44px minimum link targets; History month controls and relevant Journey controls also meet the 44px minimum. Ritual water, stepper, completion, and form controls retain their existing responsive rules.
- The HTML viewport includes safe-area support. The shared header applies safe top/side insets; existing generous page-bottom gutters remain unchanged.
- Existing visible focus styles, input labels, reduced-motion rules, and non-color state cues were left intact.
- No new animation, component, or styling system was introduced.

The source-level mobile review covered the responsive rules and touch controls at the requested 360px, 390px, and 430px widths, plus tablet/desktop breakpoints. A live device/browser pass is still needed to confirm rendered overflow, keyboard interaction, and safe-area behavior.

## Tests and validation

`tests/pwa-foundation.test.js` verifies manifest metadata, raster icon dimensions and maskable entries, viewport metadata, conservative service-worker caching rules, service-worker registration, existing routes, and continued auth-provider wiring.

The required manual checks remain:

1. Navigate and refresh every route on desktop and mobile.
2. Inspect 360px, 390px, 430px, tablet, and desktop widths for horizontal overflow.
3. Install through a supported browser and verify the name, icon, and standalone launch.
4. Test login, reload/session persistence, logout, account switching, and a cloud write in the installed app.
5. Verify the cached shell opens offline, without attempting cloud writes.

Vite preview served the root, `/today`, `/history`, `/journey`, `/ritual/read`, `/login`, `/signup`, the manifest, the service worker, and a raster icon with HTTP 200. This confirms the configured Vite SPA fallback locally. The installed-PWA, physical-device, offline-network, and two-account safety checks were not run in this coding environment; the production host's rewrite behavior must still be confirmed after deployment.

Build output may retain Vite's existing warning that the main JavaScript chunk exceeds 500 kB; this phase does not perform a broad bundle-splitting rewrite.
