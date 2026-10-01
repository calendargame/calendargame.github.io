/// <reference types="vite/client" />

// Build-time constants substituted by vite.config.js's `define`. They are not real globals — the
// bundler replaces the identifier with a literal — so they exist for the type-checker only, and a
// declaration here is what keeps `tsc --noEmit` honest about them.
//
// __BUILD_TS__ — the deploy stamp (round 16): the ISO UTC instant this build started, or the
// frozen 1970 sentinel outside `vite build`. Read in exactly one place, src/deployStamp.ts, which
// explains both halves; declared as `string` rather than a template-literal type because the value
// is produced by Date#toISOString and there is nothing for a narrower type to catch.
declare const __BUILD_TS__: string

// __APP_VERSION__ — the semantic version, read from package.json's `version` field at config time.
// Same in every command: unlike the stamp it is committed data rather than a clock, so dev, Vitest
// and a real build all see the one true value and a test can compare the rendered string against
// package.json itself. Read in exactly one place, src/appVersion.ts, which carries the scheme.
declare const __APP_VERSION__: string

// __BUILD_NUMBER__ — the silent build number: `git rev-list --count HEAD` for a real `vite build`,
// the frozen sentinel 0 everywhere else. Renders nowhere today. Read in exactly one place,
// src/appVersion.ts; derived and guarded by scripts/buildNumber.mjs.
declare const __BUILD_NUMBER__: number
