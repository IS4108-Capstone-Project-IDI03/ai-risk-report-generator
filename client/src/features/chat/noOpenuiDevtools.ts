// Keeps OpenUI's developer tools out of the app (CB-01). In development OpenUI mounts an
// Inspect button, a "deploy your app" prompt and a mascot over every page, loading them
// from a public CDN; it skips that when this flag is already set. Imported first by
// src/main.tsx, before any OpenUI module runs.
// must match the flag in @openuidev/react-lang's devtoolsBootstrap (dist/index.mjs)
;(globalThis as Record<symbol, unknown>)[Symbol.for('openui.devtools.autoMount')] = true
