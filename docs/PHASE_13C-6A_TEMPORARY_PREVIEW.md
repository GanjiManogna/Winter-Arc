# Temporary Phase 13C-6A preview route

`/migration-preview` is a development-only route (`import.meta.env.DEV`) for the user to open manually in the browser profile that owns their local Winter Arc data and authenticated Supabase session. It is not linked from application navigation and is absent from production routing.

The page calls `createMigrationPreview()` against the current `winterArc.progress.v1` key, obtains the displayed identity from `AuthProvider`, checks that raw storage value is byte-for-byte the same before and after the preview, and shows aggregate counts plus validation issues only. The migration service performs the allowed authenticated cloud-program read. There is no import button or call to `importToCloud()`; the page reports zero cloud writes.

This route and page are temporary developer verification code. Remove the route, page, stylesheet, and this note after the real preview has been reviewed. Do not use the page to import data; that requires the separate Phase 13C-6B authorization.
