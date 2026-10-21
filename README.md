# Calendar Game

A trainer for working out the day of the week of any date in your head. It is a mobile-first,
installable, offline-capable web app (PWA) that runs entirely in the browser and saves progress on
the device. It pairs with the book _Day-of-the-Week Calculation: A Highly Optimized Mental Method_.

- Live site: https://calendargame.app
- Test site: https://test.calendargame.app

## What is in the app

Every page, in the one order everything lists them in (`PAGES` in `src/lib/modes.ts`). The letter
opens the page from the keyboard.

| Page        | Key | What it is                                                                      |
| ----------- | --- | ------------------------------------------------------------------------------- |
| Classic     | K   | The main practice mode: no time pressure, answer at your own pace.              |
| Deduction   | D   | Find the missing day, month, or year of a date, given the rest and its weekday. |
| Flash       | F   | The date is shown briefly (0.1 s to 5.0 s), then hidden.                        |
| MoX         | A   | The mean of your times over a set number of correct solves (2 to 1000).         |
| Blitz       | B   | As many dates as possible before time runs out.                                 |
| Lookup      | L   | The weekday of any AD date.                                                     |
| How to Play | H   | The in-app guide (`src/components/GuidePage.tsx`).                              |

Page ids are saved, so they are permanent: MoX is still `aox` from before its rename.

Also worth knowing before reading the code:

- **Presets.** Several independent copies of the app on one device, each with its own stats, Bests,
  settings, and theme.
- **Amnesic** (per preset: Off, Stats Only, or Full). While you play it changes nothing; when the
  app closes (every window of it), what was played since it was switched on is forgotten.
- **Julian calendar.** Dates on or before October 4, 1582 are Julian when the setting is on (the
  default); every later date is Gregorian.
- **Windows in sync.** Any number of tabs and the installed app can be open at once; each sees the
  others' changes.
- **Changelog.** A plain-words list for players (⚙ → Changelog), kept in `src/changelog.ts`; at
  most ten day-entries, older ones moved to `CHANGELOG-ARCHIVE.md`.

## The two sites

| Site | Address                       | GitHub repository                     | Sentry environment |
| ---- | ----------------------------- | ------------------------------------- | ------------------ |
| Live | https://calendargame.app      | `calendargame/calendargame.github.io` | `production`       |
| Test | https://test.calendargame.app | `calendargame/test_version`           | `staging`          |

Both are defined once in `src/sites.ts`, read by the build and by the app.

- Each is a GitHub Pages site served from the root of its own domain, so they are separate browser
  origins: separate saved data, service workers, and installed apps. The address is the Custom
  domain in that repository's Settings > Pages; there is no CNAME file.
- **A push to `main` is the deploy**, and the only way to deploy (there is no manual run button).
  `.github/workflows/deploy.yml` runs in whichever repository was pushed to. In this working copy
  the remotes are `origin` (test) and `live` (live).
- The build picks its site from the repository it runs in (`siteBuiltFor` in `vite.config.js`); a
  build in any other repository fails. A local build is always the test site's build.
- What differs between the two builds: the live site gets the Cloudflare Web Analytics beacon; the
  test site gets gray icons and a gray link-preview card pointing at its own address (assets in
  `design/icons/test-build/`).
- `src/lib/oldTestSite.ts` clears what the test site's old address (`calendargame.app/test_version/`)
  left on devices.

## Tech stack

- React 19, compiled with the React Compiler (through `@rolldown/plugin-babel`)
- TypeScript, Vite 8, Tailwind CSS 4 (through PostCSS)
- Zustand for state; saved data lives in `localStorage`, and per-window state in `sessionStorage`
- `vite-plugin-pwa` for the manifest and the service worker
- Sentry (`@sentry/react`) for error reports, loaded lazily, errors only
- Vitest (Node, and jsdom per file) for unit and DOM tests; Playwright (Chromium and WebKit) for
  layout tests
- ESLint and Prettier

## Running it locally

Node 24 (what CI uses).

```sh
npm ci
npm run dev        # Vite dev server, http://localhost:5173 by default
```

In dev and in tests the "Last Updated" stamp is frozen at 1970-01-01, and error reporting never
starts (it starts only in a built copy served from one of the two sites' own hostnames).

## Scripts

| Command                | What it does                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `npm run dev`          | Dev server with hot reload.                                                          |
| `npm run build`        | Production build into `dist/` (fails unless the changelog date is today; see below). |
| `npm run size`         | Checks the built JS against the size budget.                                         |
| `npm run lint`         | ESLint.                                                                              |
| `npm run format:check` | Prettier check (`npm run format` fixes).                                             |
| `npm run typecheck`    | `tsc` for the app and for `tests/browser`.                                           |
| `npx vitest run`       | The Vitest suite (same as `npm test`). Add a path to run one file.                   |
| `npm run test:browser` | The Playwright browser lane (below).                                                 |
| `npm run analyze`      | A build with a bundle visualiser.                                                    |

### The browser lane

Vitest's DOM tests run in jsdom, which lays nothing out, so every rule about widths, wrapping,
scrollbars, and what fits where is tested in real browsers instead: `tests/browser/*.browser.ts`,
run by Playwright (`playwright.config.ts`).

- It tests the finished site in `dist/`, the same files a deploy uploads, served by
  `tests/browser/support/serveBuild.js`. It refuses a missing or stale build, so run
  `npm run build` first.
- Projects: `chromium`, `webkit`, and `chromium-classic-scrollbar` (only tests tagged
  `@classic-scrollbar`). A phone-sized viewport (390 x 844), dark theme, reduced motion, Pacific
  time, and service workers blocked.
- Beside the build under test it serves an older build of the app on the same origin
  (`tests/browser/support/oldSite.js`), to test what an older window does to a newer one's saved
  data. It is built once per machine from its own commit (a git worktree) into `.lane-cache/`.
- One-time setup: `npx playwright install chromium webkit`.

## Deploy gates

Every check below must pass, in this order, before anything is published
(`.github/workflows/deploy.yml`).

1. **Version ledger** (`scripts/versionLedger.mjs`). The deploy refuses unless `package.json`'s
   `version` is greater than every `v*` tag in that repository, and unless `package-lock.json`'s
   copy matches. The last step of a passing build writes the `v<version>` tag. Each repository
   keeps its own tags, and a push to either site uses up a number.
   - Bump the version in `package.json`, then run `npm install --package-lock-only`. Never use
     `npm version`, and never create or delete a `v*` tag by hand: the deploy owns them.
2. **Changelog date** (`scripts/changelogStamp.mjs`). The newest entry in `src/changelog.ts` must be
   dated the build's Pacific calendar day. This is part of the build itself, so a local
   `npm run build` fails the same way.
3. **Tests, lint, formatting, and types**: `npm test`, `npm run lint`, `npm run format:check`,
   `npm run typecheck`.
4. **The build**, which also fails when a service-worker precache revision does not match the file
   it describes (`scripts/precacheIntegrity.mjs`).
5. **Sentry source maps: uploaded, never shipped** (`scripts/sentryRelease.mjs`). A deploy build
   (in GitHub Actions) writes hidden source maps, uploads them under the release
   `calendar-game@<version>+<commit>`, and deletes them. The build fails if `SENTRY_AUTH_TOKEN` is missing, if the upload fails, if any
   map is left in `dist/`, or if a bundled script lacks a Sentry debug ID. Local builds make no maps
   and upload nothing.
6. **Size budget** (`scripts/check-bundle-size.mjs`): the gzipped total of `dist/assets/*.js` must
   stay under 350 KB. It is an accident tripwire, not a no-growth rule.
7. **The browser lane**, with one retry; a test that needed its retry is reported as flaky.

Then the site is uploaded, the version tag is written, and a second job publishes to GitHub Pages.
The "Last Updated" stamp (`src/deployStamp.ts`) is the build machine's clock, not typed by hand.

## Where the code lives

| Path                 | What is there                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.tsx`       | The App: the top bar, page switching, keyboard shortcuts, and boot.                                                              |
| `src/modes/`         | The five practice-mode screens and their shared hooks.                                                                           |
| `src/engine/`        | The game engine: a pure reducer (`gameReducer.ts`), stats, streaks, and Bests.                                                   |
| `src/store/`         | Everything saved: settings, progress, presets, Lookup history, and storage health.                                               |
| `src/components/`    | UI pieces: the Settings panel, How to Play, presets, popups, and pickers.                                                        |
| `src/lib/`           | Pure helpers: calendar math (`calendar.ts`), the method's codes (`method.ts`), date generation, the page list, and text fitting. |
| `src/observability/` | Sentry, loaded lazily.                                                                                                           |
| `scripts/`           | Build and deploy checks (version ledger, changelog date, size, precache, Sentry).                                                |
| `tests/`             | Vitest: logic tests in Node, `*.dom.test.*` in jsdom, `engine/` tests, and guard tests.                                          |
| `tests/browser/`     | The Playwright browser lane and its support code.                                                                                |

In `src/store/`, two subsystems are worth reading first:

- **Windows in sync**: every saved doc goes through one door (`syncedDoc.ts`). Before every write,
  and whenever another window writes, it merges with what the device holds and writes only this
  window's own changes on top (`syncCounts.ts`, `syncList.ts`, `syncRecords.ts`), so a window that
  loaded earlier can no longer save over a newer one. `windowSync.ts` decides when a window listens
  and in what order it catches up.
- **Amnesic**: `amnesic.ts` (start there), with `amnesicMode.ts`, `amnesicClose.ts`, and
  `amnesicWindow.ts`.

## Conventions

These are stated in the code's own comments and held by tests where they can be.

- **No preset migration.** Preset 1 _is_ the existing saved data: its stores keep the original,
  un-namespaced `localStorage` keys, and only presets 2 and up get namespaced ones
  (`src/store/presets.ts`). Nothing is ever copied into preset 1.
- **One pool of stats per mode.** Every answer, round, and Best goes into the one saved pool,
  whatever the Amnesic setting; nothing is stored separately (`src/store/progressDoor.ts`,
  `src/store/amnesic.ts`). Displayed MoX and Blitz Bests are read through `src/engine/bestPool.ts`,
  and `tests/bestPoolGuard.test.js` keeps every other read of a Best map to a named list.
- **Reading never rewrites stored data.** Loading a doc writes nothing; an older shape is reshaped
  in memory and saved in today's shape only with the next change. The one documented exception is
  `src/store/julianRange.ts`, which writes a new key once and rewrites nothing existing.
- **The Oxford comma in all app text** ("Off, Stats Only, and Full"), enforced by
  `tests/oxfordCommaGuard.test.js`.
- **Root-cause fixes.** A fix removes the cause, and where a whole class of bug can recur, a guard
  test makes it fail the suite (for example `tests/classGlueGuard.test.js` and
  `tests/themeGuard.test.js`).
- **Formatting.** Prettier formats everything except the files listed in `.prettierignore`, which
  include `src/main.tsx` and `src/index.css` (both hand-formatted).
