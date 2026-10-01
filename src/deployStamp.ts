// deployStamp.ts — WHEN THIS BUILD WAS DEPLOYED. One constant, and it has its own module because
// two things far apart in the app both read it:
//   • the ⚙ panel's "Last Updated" line (components/SettingsPanel), and
//   • App's build-change detection (src/main.tsx), which compares it against the last-run stamp in
//     localStorage (lib/buildStamp) to light the update breadcrumb and run the Updating flash.
// It used to sit at module scope in src/main.tsx, which is fine while the panel's markup is also in
// main.tsx and impossible once it is not: main.tsx imports the panel, so the panel importing back
// would be a cycle. A leaf module with no imports of its own is the seam that cannot become one.
//
// ★ THIS LINE IS NOT TYPED BY HAND. It used to be, and PROJECT.md's rule 2
// used to say so: every deploy edited a literal date here before pushing. That made the stamp a
// GUESS at when the deploy would land rather than a record of when it did — round 14 stamped 2:00 AM
// and went live later than that. __BUILD_TS__ is now injected by vite.config.js (`define`) and is
// the clock at the moment the build started, so the value cannot be stale, cannot be forgotten, and
// cannot be optimistic. There is nothing to bump before a push.
//
// WHAT DEV AND TESTS SEE: a frozen sentinel, 1970-01-01T00:00:00.000Z — the value vite.config.js
// substitutes for every command that is not `vite build`. A dev server is not a deploy, and a stamp
// that moved every run would make any test that touched it pass or fail by the hour. The epoch is
// unmistakably not a release date, which is the point.
// ★ BUT A DEV SERVER DOES NOT PRINT IT. Drawn as a date the sentinel reads "Last Updated:
// 12/31/1969 16:00" in Pacific, which looks like a broken clock rather than like "this was never
// deployed". So the panel asks BUILD_IS_DEPLOYED (below) and, on a dev server, says so in words:
// "Last Updated: development build". The suite still draws the sentinel as a date — Vitest runs in
// its own mode — because the date line is what ships and what the panel's cases are about.
// (`vite preview` serves the real dist, so it shows the real build's stamp.)
//
// DELIBERATELY NO FALLBACK. `new Date(__BUILD_TS__)` with no `typeof` guard and no default means a
// build that somehow lost the define fails LOUDLY at module load rather than shipping a plausible
// wrong date; the same reasoning as the build-identity guard in vite.config.js. The declaration
// lives in src/vite-env.d.ts.
//
// THE DATE IN THE CHANGELOG CANNOT DISAGREE WITH THIS. The newest entry in src/changelog.ts must be
// dated the PACIFIC calendar day this stamp lands on, and the build FAILS otherwise —
// scripts/changelogStamp.mjs, wired first in vite.config.js's plugin array. Automating the stamp on
// its own would have replaced a step somebody remembered with a divergence nobody watched, so the
// two shipped together.
//
// Stored in UTC; the panel renders it in the viewer's local time, through the same numeric-coercing
// recipe the changelog dates use, so it follows the Date Format setting.
//
// Deliberately NOT re-exported from main.tsx: the observable contract is the localStorage stamp the
// detection writes (tests/buildStamp.dom), never this value, and an export from main.tsx would
// invite a test to assert the constant instead of the behaviour.
// ⚠ THAT WARNING IS ABOUT THE DEPLOY DATE, NOT ABOUT THE SENTINEL. Exactly one case asserts this
// value — tests/changelogStamp pins it to 1970-01-01T00:00:00.000Z — and it is pinning the
// TEST-ENVIRONMENT contract with vite.config.js's `define`, which never moves and which nothing else
// in the suite can see. Without it, a change that let the real clock through under Vitest would make
// every stamp-touching test clock-dependent while all of them stayed green. Don't delete it as an
// instance of the rule above; it is the exception the rule needs.
export const DEPLOY_TS = new Date(__BUILD_TS__)

// Is there a deploy date worth printing? False on a dev server only (Vite's `development` mode):
// true for a real build, and true under Vitest (mode `test`), so every test of the "Last Updated"
// line exercises the line a player sees. In a production build Vite replaces the mode with a
// literal, so this folds to `true` and the dev wording is not shipped.
export const BUILD_IS_DEPLOYED = import.meta.env.MODE !== 'development'
