// defineConfig is imported from 'vitest/config' (a superset re-export of vite's own) so
// the single config serves BOTH `vite build`/`vite dev` (which ignore the `test` key) and
// Vitest (which reads it). The react plugin is shared, giving test files the same JSX
// transform as the app. Build behavior is unchanged by this import swap.
import { defineConfig } from 'vitest/config'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { VitePWA } from 'vite-plugin-pwa'
import { visualizer } from 'rollup-plugin-visualizer'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { copyFileSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
// The two names the app and the build must agree on, defined once in the module that reads them at
// runtime (see the long note there for why the detector has this shape at all). Vite bundles its
// own config file, relative TypeScript imports included, so this is a real single source rather
// than a copy kept in step by hand.
import { BUILD_ID_FILE, BUILD_ID_META, isBuildId } from './src/lib/updateCheck.ts'
import { verifyDistPrecache, describePrecacheProblems } from './scripts/precacheIntegrity.mjs'
// The changelog data itself, imported (not read as text) for the deploy-stamp guard below — same
// mechanism as the updateCheck import above, so the guard sees the real array rather than a regex's
// opinion of it. src/changelog.ts has no imports of its own and does nothing at module scope, so
// pulling it into the config graph is inert.
import { CHANGELOG } from './src/changelog.ts'
import { checkChangelogStamp, describeChangelogStampMismatch } from './scripts/changelogStamp.mjs'
import { readBuildNumber } from './scripts/buildNumber.mjs'

// Ceiling on Vitest's worker pool — see the long note at `test.maxWorkers` below for why the
// uncapped default is dangerous rather than merely slow. Clamped to at most 8 and never above what
// the machine would have chosen anyway, so this can only lower the worker count on a big machine.
// ⚠ THE FLOOR IS 2, NOT 1, AND THAT IS DELIBERATE. The hazard this cap exists for is too MANY
// workers exhausting memory, which a small machine cannot suffer from — so squeezing a 2-core CI
// runner down to a single worker would halve its throughput to solve a problem it never had.
// `ubuntu-latest` is 4 vCPU for public repos today (→ 3 workers here), but runner specs change
// without notice and the deploy gate runs on whatever GitHub provides, so the floor is what keeps
// this from quietly becoming a CI slowdown the day that number moves.
const MAX_TEST_WORKERS = Math.max(2, Math.min(8, availableParallelism() - 1))

// GitHub Pages serves the org ROOT page `calendargame.github.io` (and its custom domain
// calendargame.app) from '/', but every PROJECT repo's Pages site from '/<repo>/'. CI sets
// GITHUB_REPOSITORY="owner/repo", so deriving the base from it lets ONE codebase deploy correctly to
// BOTH the live repo and the staging repo (currently `test_version`) — and it stays correct even if
// the staging repo is renamed later, with no code change. Local builds have no GITHUB_REPOSITORY → '/'.
const pagesBase = (repository) => {
  const repo = (repository || '').split('/')[1] || ''
  return repo && repo !== 'calendargame.github.io' ? `/${repo}/` : '/'
}

// True only for the live production repo's CI build. Used to inject the Cloudflare Web Analytics
// beacon on PRODUCTION ONLY (calendargame.app) — not the staging repo, not local/dev builds — so our
// own testing never pollutes the real visitor numbers.
const isLiveRepo = (repository) => (repository || '').endsWith('/calendargame.github.io')

// Cloudflare Web Analytics: privacy-first, cookieless page analytics (no consent banner needed).
// The site is DNS-only (not proxied through Cloudflare), so Cloudflare can't auto-collect — we inject
// the manual beacon into the built index.html. The token is PUBLIC (it ships in the page HTML for
// every visitor), so it's fine in source. Remove this plugin + its conditional below to drop analytics.
// ⚠ The token below must be the value from Cloudflare's "Enable with JS Snippet installation" snippet —
// NOT the dashboard site ID (the /web-analytics/edit/<id> value). Using the site ID was the original B1
// bug: beacons sent fine but Cloudflare silently dropped them all (zero data). Fixed 2026-06-06.
const cfWebAnalytics = () => ({
  name: 'cf-web-analytics-beacon',
  transformIndexHtml: (html) =>
    html.replace(
      '</head>',
      `  <script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "f9c4758b29d04e02ad0e757ae824a4b5"}'></script>\n</head>`,
    ),
})

// Boot-splash first-paint unblock (the boot-splash fix, batch item h). Vite injects the bundled
// stylesheet into index.html as a classic render-blocking <link rel="stylesheet">, and a pending head
// stylesheet blocks FIRST PAINT of the entire document — including the fully-inline-styled #boot
// splash that exists precisely to cover that wait. This transform rewrites the injected link (matched
// by PATTERN — the hashed filename is never hardcoded; every attribute, incl. crossorigin and the
// base-prefixed href, is preserved, so it's correct for both the live '/' and staging '/<repo>/'
// bases) into the standard preload-swap: first paint is unblocked, and once the CSS file has loaded
// the link swaps itself into a real stylesheet and signals the app (window.__cssReady + a window
// 'app-css-ready' event). App's boot effect waits for that signal before removing #boot — the module
// script precedes the link so it is NOT CSSOM-blocked, meaning on a service-worker-cached load React
// can commit before the CSS applies (an unstyled flash if #boot left early). onerror signals too: if
// the stylesheet genuinely fails, an unstyled app beats an eternal splash. A <noscript> copy of the
// original blocking link keeps no-JS rendering styled. Runs in DEFAULT (non-post) transform order so
// VitePWA's Workbox precaches the TRANSFORMED index.html. Build-only (dev serves CSS through the JS
// module graph — there's no stylesheet link to swap). Exported for tests/bootCssPreload.test.js.
export const swapBlockingStylesheet = (html) =>
  html.replace(
    /<link rel="stylesheet"([^>]*)>/,
    (link, attrs) =>
      `<link rel="preload" as="style"${attrs} onload="this.onload=null;this.rel='stylesheet';window.__cssReady=true;window.dispatchEvent(new Event('app-css-ready'))" onerror="window.__cssReady=true;window.dispatchEvent(new Event('app-css-ready'))"><noscript>${link}</noscript>`,
  )
const bootCssPreload = () => ({
  name: 'boot-css-preload',
  apply: 'build',
  transformIndexHtml: swapBlockingStylesheet,
})

// Test/staging gets a GRAY visual variant (the live site stays purple) so the two are distinguishable
// at a glance — the installed-app + browser-tab icons, AND the link-preview (OG) card. The gray assets
// are pre-generated + committed in design/icons/test-build/ (by build-icons.mjs + build-og.mjs) — NOT
// in public/, so they never ship to live. For non-live builds this plugin, AFTER VitePWA (enforce
// 'post'), does two things:
//   (1) copies the gray assets over the build OUTPUT so the site SERVES gray everywhere — favicon,
//       apple-touch, the PWA manifest icons, and og-image.jpg (same filenames → index.html + the
//       manifest references are unchanged);
//   (2) CORRECTS the service-worker precache revision for each. vite-plugin-pwa hashes the SOURCE
//       public/ (purple) file for includeAssets/manifest-icon revisions — computed OUTSIDE workbox
//       manifestTransforms' reach — so a gray asset would otherwise inherit the PURPLE file's md5 as its
//       revision. Workbox then sees the SAME revision as the previous/live purple SW and treats it as
//       unchanged → it keeps serving the cached PURPLE asset (the gray never shows). Rewriting the
//       revision in sw.js to the GRAY file's md5 makes Workbox re-fetch the gray asset.
// (The og:image / og:url META is rewritten to the staging URL separately — see testOgMeta below.)
// Build-only; non-live only (staging + local). Live is entirely untouched (normal purple precache).
// (Owner: distinguish test from live, 2026-06-13.)
// The repo root — this config's own directory. Was written out inline at each of the three uses
// below until the version read (a fourth) made a name worth having.
const ROOT = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(ROOT, 'public')
const TEST_ICON_DIR = join(ROOT, 'design', 'icons', 'test-build')
const TEST_VARIANT_FILES = [
  'favicon.svg',
  'favicon-32x32.png',
  'apple-touch-icon.png',
  'pwa-64x64.png',
  'pwa-192x192.png',
  'pwa-512x512.png',
  'maskable-icon-512x512.png',
  'og-image.jpg', // the link-preview card
]
const md5 = (buf) => createHash('md5').update(buf).digest('hex')
const testIconVariant = () => {
  let outDir = 'dist'
  return {
    name: 'test-icon-variant',
    apply: 'build',
    enforce: 'post', // run after VitePWA writes sw.js so we can correct its precache revisions
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      // {purpleMd5 -> grayMd5} for each asset: the revision vite-plugin-pwa wrote (md5 of the purple
      // source) -> the actual gray file's md5. Also serve the gray assets.
      const revMap = {}
      for (const f of TEST_VARIANT_FILES) {
        const grayPath = join(TEST_ICON_DIR, f)
        if (!existsSync(grayPath)) continue
        copyFileSync(grayPath, join(outDir, f)) // (1) serve gray
        const pubPath = join(PUBLIC_DIR, f)
        if (existsSync(pubPath)) revMap[md5(readFileSync(pubPath))] = md5(readFileSync(grayPath))
      }
      // (2) rewrite the precache revisions in the generated SW so Workbox re-fetches the gray assets.
      for (const sf of readdirSync(outDir)) {
        if (sf !== 'sw.js' && !/^workbox-.*\.js$/.test(sf)) continue
        const p = join(outDir, sf)
        let s = readFileSync(p, 'utf8')
        let changed = false
        for (const [purple, gray] of Object.entries(revMap)) {
          if (purple !== gray && s.includes(purple)) {
            s = s.split(purple).join(gray)
            changed = true
          }
        }
        if (changed) writeFileSync(p, s)
      }
    },
  }
}
// Non-live builds: point the OG/Twitter card + canonical URL at the STAGING path so a shared staging
// link previews the GRAY card (testIconVariant serves the gray og-image.jpg there). index.html hard-
// codes the live apex (https://calendargame.app/...); on staging the page lives under the repo base
// (e.g. /test_version/), so rewrite https://calendargame.app/ → https://calendargame.app<base>. Base-
// driven, so it stays correct if the staging repo is renamed. Live build: not applied (purple, apex).
const testOgMeta = (base) => ({
  name: 'test-og-meta',
  transformIndexHtml: (html) =>
    html.replaceAll('https://calendargame.app/', `https://calendargame.app${base}`),
})

// Every file in a finished build, as forward-slash paths relative to it. Sorted + separator-
// normalized so the identity below is a property of the OUTPUT, not of the machine that produced it.
const distFiles = (dir, prefix = '') =>
  readdirSync(join(dir, prefix), { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? distFiles(dir, prefix ? `${prefix}/${e.name}` : e.name)
        : [prefix ? `${prefix}/${e.name}` : e.name],
    )
    .sort()

// buildIdentity (Q7, round 11) — gives every build an identity the running app can compare against
// the deployed one, which is what makes "Check for updates" a check instead of an unconditional
// reload. src/lib/updateCheck.ts carries the full reasoning for the design; the mechanics here:
//
//   1. HASH the finished build — every file in dist, icons and all. Source maps are excluded (no
//      build produces one today, and if the Sentry upload below is ever switched on they are
//      uploaded then deleted, so they are never shipped either way) and the identity file itself
//      does not exist yet. Path AND bytes go into the hash, so a pure RENAME is a different build too.
//   2. INJECT <meta name="cg-build"> into dist/index.html. That is how the running app knows which
//      build it is: the document it was parsed from says so. Nothing is written into the hashed
//      JS/CSS assets — those carry their content hash in their FILENAME and are precached with
//      `revision: null`, so a client that already has assets/index-<hash>.js would never re-fetch
//      it however much its bytes changed. Editing one after the fact is the one thing this plugin
//      must never do.
//   3. WRITE dist/build-id.txt with the same id. Workbox's globPatterns are js/wasm/css/html, so a
//      .txt is not precached — the file is network-only by construction, which is exactly what the
//      detector needs and why offline reads as "No connection" rather than as a verdict.
//   4. REWRITE index.html's precache revision to match the bytes step 2 produced. Without this the
//      injected meta would be invisible to every client that already had the page cached, and the
//      running id would be frozen at whatever build it first installed — the update check would
//      then report an update forever and never be able to clear it. (precacheIntegrity below
//      verifies this rewrite landed, exactly as it verifies testIconVariant's.)
//
// The id is a pure function of the pre-injection output, and the post-injection output is a pure
// function of the id — so two builds are byte-identical if and only if their ids match, which is
// the property the whole feature rests on.
//
// ⚠ WHAT THE AUTO-STAMP (Q1, round 16) CHANGED, and it is worth knowing: the deploy stamp is now
// the build clock, so it is inside the main bundle and different for every build. Two builds of the
// SAME COMMIT are therefore no longer byte-identical and no longer share an id — verified, twice in
// a row, ids 65bdb2bc… then 38f41c4a…. The property above is untouched (the outputs genuinely do
// differ), and so is the detector's correctness: a re-deploy of the same commit really does put a
// different artifact on the site, with a different "Last Updated" and a differently-named bundle,
// so reporting it as an update is true rather than a false positive. What is gone is the old
// coincidence that a no-op re-deploy reported nothing. Nothing depends on that coincidence.
//
// enforce:'post' AND last in the plugin array: it must see
// the FINAL bytes, after VitePWA has written sw.js and after testIconVariant has swapped in the
// gray staging icons and corrected their revisions.
const buildIdentity = () => {
  let outDir = 'dist'
  return {
    name: 'build-identity',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      const hash = createHash('sha256')
      for (const rel of distFiles(outDir)) {
        if (rel.endsWith('.map')) continue
        hash.update(rel)
        hash.update('\0')
        hash.update(readFileSync(join(outDir, rel)))
        hash.update('\0')
      }
      const id = hash.digest('hex')
      // The runtime refuses an id it does not recognise as a token (updateCheck's BUILD_ID_TOKEN),
      // so a build that produced an unrecognisable one would ship a permanently dead check. Fail
      // here instead — the two ends of that agreement are asserted against each other.
      if (!isBuildId(id)) throw new Error(`build-identity: computed an unusable build id (${id})`)

      const indexPath = join(outDir, 'index.html')
      const html = readFileSync(indexPath, 'utf8')
      if (!html.includes('</head>'))
        throw new Error(
          'build-identity: dist/index.html has no </head> to inject the build id into',
        )
      writeFileSync(
        indexPath,
        html.replace('</head>', `  <meta name="${BUILD_ID_META}" content="${id}">\n</head>`),
      )
      writeFileSync(join(outDir, BUILD_ID_FILE), `${id}\n`)

      const swPath = join(outDir, 'sw.js')
      const sw = readFileSync(swPath, 'utf8')
      const entry = sw.match(/\{[^{}]*"index\.html"[^{}]*\}/)
      if (!entry)
        throw new Error('build-identity: no index.html entry in the sw.js precache manifest')
      const indexMd5 = md5(readFileSync(indexPath))
      const fixed = entry[0].replace(
        /(["']?revision["']?\s*:\s*")[0-9a-fA-F]+(")/,
        `$1${indexMd5}$2`,
      )
      if (fixed === entry[0])
        throw new Error("build-identity: could not rewrite index.html's precache revision")
      writeFileSync(swPath, sw.replace(entry[0], fixed))
    },
  }
}

// precacheIntegrity (Q10b, round 11) — the round-7 class made unshippable. Fails the BUILD when any
// precache revision in the generated sw.js disagrees with the md5 of the file actually sitting in
// dist, which is the only thing that decides whether a client ever re-downloads that file. The
// check itself lives in scripts/precacheIntegrity.mjs (pure + unit-tested); this is just its wiring.
// Last of all, so it audits the final artifact — including both plugins above that rewrite
// revisions by hand.
const precacheIntegrity = () => {
  let outDir = 'dist'
  return {
    name: 'precache-integrity',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      const { checked, hashless, problems } = verifyDistPrecache(outDir)
      if (problems.length > 0)
        throw new Error(
          `precache-integrity: ${problems.length} precached file(s) whose revision does not match the shipped bytes.\n` +
            `${describePrecacheProblems(problems)}\n` +
            `A stale revision means Workbox never re-downloads that file — clients keep the old copy forever.`,
        )
      console.log(
        `✅ Precache integrity OK: ${checked} revision(s) match their shipped bytes ` +
          `(${hashless} content-hash-named entries need none).`,
      )
    },
  }
}

// ── THE DEPLOY STAMP (round 16, Q1) ───────────────────────────────────────────────────────────
// src/deployStamp.ts used to carry a hand-typed date that somebody bumped before every push, which
// made it a GUESS at when the deploy would land rather than a record of when it did (round 14
// stamped 2:00 AM and went live later than that). BUILD_TIME is the real thing: the clock at the
// moment this config is evaluated, injected below as __BUILD_TS__ and read by deployStamp.ts.
// Module scope, so ONE instant serves the whole build — the value handed to `define` and the value
// the guard checks the changelog against are the same object, and cannot drift apart mid-build.
const BUILD_TIME = new Date()

// What DEV AND TESTS see instead. Deliberately a frozen sentinel, not the clock, for two reasons.
// (1) DETERMINISM: the suite mounts the app hundreds of times, the ⚙ panel renders this value as
// "Last Updated", and the build-change detection compares it against localStorage — a value that
// moved every run would make any test that ever touched it pass or fail by the hour, and would make
// the ones that exist today (which capture the stamp at runtime rather than asserting it) quietly
// vacuous. (2) HONESTY: a dev server is not a deploy, and stamping one with the current time would
// print a "Last Updated" that never corresponded to anything shipped. The epoch is unmistakably not
// a deploy date, which is the point — nobody can mistake a dev build for a released one. A dev
// server therefore renders `Last Updated: 12/31/1969 16:00` in Pacific (verified in a real browser
// against `npm run dev`); that is this sentinel showing through, not a bug.
// ⚠ In dev, Vite does NOT substitute defines into the served source — it assigns them onto
// globalThis from /@vite/env, which /@vite/client imports ahead of the app module. So the served
// deployStamp.ts still literally reads `new Date(__BUILD_TS__)` and resolves at runtime. Checked in
// the browser rather than assumed: __BUILD_TS__ is the sentinel, the splash clears, the console is
// clean, and the boot stamp lands in localStorage.
// ⚠ This is the ONLY value the app ever sees outside `vite build`; there is no fallback path in
// deployStamp.ts, so if this define ever stopped being applied the app would fail loudly at module
// load (a ReferenceError on __BUILD_TS__) rather than silently show a wrong date.
const DEV_BUILD_TS = '1970-01-01T00:00:00.000Z'

// ── THE SEMANTIC VERSION (2026-08-10) ─────────────────────────────────────────────────────────
// Read from package.json's `version` field — the standard home, and the ONLY copy: injected below
// as __APP_VERSION__ and read by src/appVersion.ts, which carries the scheme (what a MAJOR/MINOR/
// PATCH means here, and who assigns it). readFileSync rather than an import assertion so the value
// is plain data at config time in every Node this repo will meet, with no JSON-module flag involved.
// Unlike the deploy stamp there is no dev sentinel: this is committed data, not a clock, so dev,
// Vitest and a real build all see the one true value — which is also what lets a test compare what
// the app renders against package.json itself rather than against a literal.
const APP_VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
// Three dotted numbers or nothing ships. `define` substitutes raw expression text, so a missing or
// misspelled field would inject the token `undefined` and the changelog panel would render
// "vundefined" — plausible enough to reach a screen, which is precisely the class of failure the
// build-identity and deploy-stamp guards exist to prevent. Module scope, so it fails on any command.
if (!/^\d+\.\d+\.\d+$/.test(APP_VERSION ?? ''))
  throw new Error(
    `app-version: package.json's "version" is ${JSON.stringify(APP_VERSION)}, which is not a ` +
      `MAJOR.MINOR.PATCH version. Every deploy bumps exactly one of the three — see src/appVersion.ts.`,
  )

// ── THE SILENT BUILD NUMBER (2026-08-10) ──────────────────────────────────────────────────────
// Derived ONLY for a real `vite build`, from git, by scripts/buildNumber.mjs (which refuses a
// shallow checkout and throws rather than ever returning 0). Dev and Vitest get this frozen
// sentinel instead — the DEV_BUILD_TS reasoning exactly: a number that changed with every commit
// would make any test that touched it either brittle or vacuous, and neither a dev server nor a
// test run is a build. 0 therefore means "not a build" and can mean nothing else, since the real
// path fails loudly instead of producing it. Nothing renders it today; see src/appVersion.ts for
// what it is for and how a future round would surface it.
const DEV_BUILD_NUMBER = 0
const buildNumber = () =>
  readBuildNumber((args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }))

// changelogStamp (Q1 half 2) — the other half of taking the stamp out of human hands. Automating
// only the stamp would replace a step somebody remembers with a divergence nobody watches, so the
// build now FAILS unless the newest entry in src/changelog.ts is dated the same PACIFIC calendar day
// BUILD_TIME lands on. The conversion and the wording live in scripts/changelogStamp.mjs (pure +
// unit-tested, including both sides of both midnights and both offsets); this is its wiring.
// ⚠ configResolved, NOT buildStart, AND THAT IS LOAD-BEARING — it was written as buildStart first
// and the failing build proved it wrong. Throwing from buildStart aborts the bundle but rolldown
// still runs every other plugin's closeBundle, and precacheIntegrity's then fails on the half-
// written dist and REPLACES the reported error: `npm run build` exited 1 with a message about
// Workbox revisions and no mention of the changelog at all. A guard whose whole point is to say
// what to do must not be maskable by a later hook, so it runs before the bundler exists — nothing
// has been produced yet, so no closeBundle can run and no second error can be raised. It is also
// the fastest failure available INSIDE a build: a mis-dated changelog costs a second rather than a
// full bundle. ⚠ That is a claim about `vite build`, not about the deploy: CI runs the whole
// test/lint/format/typecheck gate before it ever reaches the build step, so in CI this guard would
// have fired minutes late. deploy.yml therefore runs the same pure check as its FIRST step (see
// scripts/checkChangelogDate.mjs); this plugin stays the authority, because a check that lives only
// in the workflow cannot gate a local `npm run build`.
// NO MODE IS EXEMPT, deliberately — `npm run analyze` is a `vite build` that writes a complete,
// uploadable dist, so exempting it would leave a hole in the one place a guard must not have one.
// The cost is that an analyze run on a day whose changelog is not current fails with deploy advice
// you did not ask for; the fix in that case is the same one-line edit, or just deploy.
//
// ⚠ THE CONSTRAINT THIS IMPOSES ON RE-DEPLOYS, WRITTEN DOWN RATHER THAN DISCOVERED. The rule is
// EQUALITY against the build clock's Pacific day and BUILD_TIME is taken fresh every build, so
// re-running an unchanged commit on a LATER Pacific day fails — and three ordinary things do
// exactly that: deploy.yml's workflow_dispatch button, GitHub's "Re-run all jobs" (including after
// a `concurrency: cancel-in-progress` cancellation), and the owner's two-repo ritual when staging
// goes out one evening and live the next morning. In every case the fix is a real commit that
// re-dates the newest entry; there is no escape hatch, and adding one for workflow_dispatch is an
// OPEN OWNER DECISION (round 16 review). Do NOT relax the rule to `entry <= today` to make the
// symptom go away: the equality is what makes a MISSING entry impossible, which is the whole point.
const changelogStamp = () => ({
  name: 'changelog-stamp',
  apply: 'build',
  configResolved() {
    const result = checkChangelogStamp(CHANGELOG, BUILD_TIME)
    if (!result.ok) throw new Error(describeChangelogStampMismatch(result))
    console.log(
      `✅ Changelog stamp OK: newest entry ${result.found} matches this build's Pacific date ` +
        `(stamped ${result.stamp}).`,
    )
  },
})

// The PWA web app manifest, handed to VitePWA below. Module-scope + exported (the
// swapBlockingStylesheet precedent) so tests/webManifest.test.js can pin the BUILT manifest's
// keys without running a build — vite-plugin-pwa JSON-serializes these entries into
// dist/manifest.webmanifest as-is (it only adds the base-derived start_url/scope + lang), so
// every key:value pinned here is a byte sequence the built manifest ships.
export const webManifest = {
  name: 'Calendar Game',
  short_name: 'Calendar Game',
  description: 'A mobile-first trainer for fast mental day-of-the-week calculation.',
  theme_color: '#0d1117',
  background_color: '#0d1117',
  display: 'standalone',
  // The portrait lock's Android half (Q11): a manifest orientation hard-locks every Android
  // INSTALL to portrait at the OS level (it only binds in the installed standalone context —
  // browser tabs rotate freely everywhere). iOS parses + ignores the key (harmless); there the
  // in-app rotate-back overlay takes over (main.tsx RotateOverlay). The manifest revision
  // change rides the normal SW update path. Pinned by tests/webManifest.test.js.
  orientation: 'portrait',
  icons: [
    { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
    { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
    { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
    {
      src: 'maskable-icon-512x512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ],
}

export default defineConfig(({ command, mode }) => ({
  // Dev/preview serve from '/'. A production `vite build` derives its base from the repo it builds
  // in (see pagesBase above): '/' for the live org page, '/<repo>/' for the staging project repo.
  base: command === 'build' ? pagesBase(process.env.GITHUB_REPOSITORY) : '/',
  // Sentry tree-shaking flags (Current Work C1): compile OUT debug logging and all performance-
  // tracing code paths from the lazy error-reporting chunk (we use Sentry for errors only — see
  // src/observability/). This + the static named imports in src/observability/sentryClient.ts keep
  // Session Replay (rrweb), Tracing, and Profiling out of the bundle. The string 'false' is inserted
  // as the raw token `false` (Vite define = raw expression substitution).
  define: {
    __SENTRY_DEBUG__: 'false',
    __SENTRY_TRACING__: 'false',
    // The deploy stamp (Q1, round 16 — see BUILD_TIME / DEV_BUILD_TS above). A real `vite build`
    // gets the instant it started; dev and Vitest get the frozen sentinel. JSON.stringify because
    // `define` substitutes RAW EXPRESSION TEXT, so the quotes have to be part of the value.
    // Base-independent by construction: this is a timestamp, not a URL, so the live '/' build and
    // the staging '/<repo>/' build stamp identically (each with its own build's clock).
    __BUILD_TS__: JSON.stringify(command === 'build' ? BUILD_TIME.toISOString() : DEV_BUILD_TS),
    // The semantic version + the silent build number (see both blocks above). Same mechanism as the
    // stamp, one line each, so there is no second way to get a build-time constant into the app.
    // JSON.stringify for the version because it is a string and `define` substitutes RAW EXPRESSION
    // TEXT; String() for the number because a number's raw text is the number.
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    // buildNumber() shells out to git, so it is called ONLY on the build branch — a dev server start
    // and every Vitest config load stay process-free.
    __BUILD_NUMBER__: String(command === 'build' ? buildNumber() : DEV_BUILD_NUMBER),
  },
  // React Compiler — automatic memoization (Stage D2). @vitejs/plugin-react v6 is Rolldown/oxc-based
  // and dropped its old `babel` option, so the compiler runs through @rolldown/plugin-babel fed the
  // plugin's `reactCompilerPreset()`. Defaults are exactly what we want: compilationMode 'infer'
  // (compiles components/hooks), target React 19 (imports react/compiler-runtime), and client-only
  // (the preset's applyToEnvironmentHook). All 40 react-hooks violations were fixed first so every
  // component is compiler-safe to optimize.
  plugins: [
    // First in the array to read first, not for timing: it hooks configResolved, so it already runs
    // ahead of every build regardless of position (see the long note at changelogStamp above for why
    // that hook and not buildStart). apply:'build' makes it inert in dev and under Vitest, where
    // there is no deploy to date.
    changelogStamp(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    // PWA (Stage D3): installable + fully offline. vite-plugin-pwa generates the web app
    // manifest + a Workbox service worker that precaches the whole build (so the app runs
    // with no network). registerType 'prompt' + injectRegister null (Q3): a newly-deployed SW
    // INSTALLS but WAITS — it does NOT silently activate + reload mid-session. We register the SW
    // ourselves with a direct navigator.serviceWorker.register() (src/sw.ts — the plugin's
    // virtual:pwa-register client helper, and the workbox-window chunk behind it, were dropped in
    // round 12; only the GENERATOR half of this plugin is load-bearing now) and apply a waiting
    // update on the NEXT launch,
    // behind the "Updating…" screen (App's boot effect messages the waiting worker directly with
    // {type:'SKIP_WAITING'} — a handler generateSW ships natively — and reloads once on
    // controllerchange). This makes updates land cleanly + visibly on open instead of a silent reload,
    // and a background registration.update() fetches the next version so it's ready to apply next launch.
    // start_url/scope are derived from Vite `base`, so this is correct for both the live root (/)
    // and the staging project base (/<repo>/). Icons live in public/ (generated
    // from the W5 master by design/icons/build-icons.mjs); apple-touch + favicon are precached
    // via includeAssets and linked (incl. the dark variant) in index.html.
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['apple-touch-icon.png', 'favicon.svg', 'favicon-32x32.png'],
      // The iOS launch frames (public/apple-splash-*.png, one per iPhone size class — generated by
      // design/icons/build-splash.mjs) must NOT be precached: iOS fetches its one matching frame at
      // Add-to-Home-Screen time, outside the service worker, so precaching all ~14 (~1.2 MB) would
      // bloat every visitor's offline cache with images the browser never reads from it. Workbox's
      // default globPatterns (**/*.{js,wasm,css,html}) doesn't match PNGs today; this pins the
      // exclusion explicitly so no future globPatterns widening can ever precache them. (User
      // globIgnores REPLACES the default, so the stock node_modules ignore is restated.)
      workbox: { globIgnores: ['**/node_modules/**/*', '**/apple-splash-*.png'] },
      manifest: webManifest,
      // The SW never runs in dev (keeps HMR clean) — offline is verified against a production
      // build via `vite preview`.
      devOptions: { enabled: false },
    }),
    // Boot-splash first-paint unblock (see swapBlockingStylesheet above): swap the injected
    // render-blocking stylesheet link to a self-applying preload that signals the app when the CSS
    // is in. Build-only via apply:'build'; all builds (live + staging + local) get it.
    bootCssPreload(),
    // Gray test/staging visual variant — non-live builds only (staging + local); the live build keeps
    // the purple public/ assets. testIconVariant (enforce:'post', after VitePWA so sw.js exists) swaps
    // the gray icons + OG card into the output + fixes their precache revisions; testOgMeta points the
    // OG/canonical meta at the staging URL so a shared staging link previews the gray card.
    ...(command === 'build' && !isLiveRepo(process.env.GITHUB_REPOSITORY)
      ? [testIconVariant(), testOgMeta(pagesBase(process.env.GITHUB_REPOSITORY))]
      : []),
    // Cloudflare Web Analytics beacon — PRODUCTION build only (see cfWebAnalytics + isLiveRepo above),
    // so the staging repo and local/dev builds never report and the real numbers stay clean.
    ...(command === 'build' && isLiveRepo(process.env.GITHUB_REPOSITORY) ? [cfWebAnalytics()] : []),
    // Bundle analysis (Stage E2): `npm run analyze` (= `vite build --mode analyze`) emits an
    // interactive treemap to dist/stats.html so we can see what's in the JS bundle and catch
    // surprise bloat as the app grows. Gated on the 'analyze' mode so it NEVER runs in a normal
    // or CI build — zero effect on the shipped output.
    ...(mode === 'analyze'
      ? [
          visualizer({
            filename: 'dist/stats.html',
            template: 'treemap',
            gzipSize: true,
            brotliSize: true,
            title: 'Calendar Game — bundle',
          }),
        ]
      : []),
    // Sentry source-map upload (Current Work C1b) — WIRED BUT NEVER YET ACTIVE. Read this before
    // trusting a stack trace.
    //
    // WHAT IT WOULD DO: make crash stack traces READABLE (real file/line, not minified gibberish) by
    // uploading the source maps to Sentry, matched to events by injected debug IDs so the lazy SDK
    // chunk resolves too, then DELETING them from dist so they're never publicly served.
    //
    // WHAT ACTUALLY HAPPENS TODAY: nothing. The branch below requires process.env.SENTRY_AUTH_TOKEN,
    // and .github/workflows/deploy.yml has no `env:` block anywhere and passes no secret to the build
    // step — so the token has never been present in ANY build, CI included. This plugin has therefore
    // never run once: no source maps uploaded, no debug IDs injected, no release created. The
    // `build.sourcemap` gate below reads the same variable, so no .map files are generated either.
    // Every Sentry event this project has ever received is minified. (The comment here used to claim
    // the opposite — that CI uploads hidden source maps — which was never true; corrected round 12.)
    //
    // TO TURN IT ON: create a Sentry auth token with project-releases write scope, add it as a
    // repository secret named SENTRY_AUTH_TOKEN in BOTH the live and the staging repo, and pass it to
    // the build step in .github/workflows/deploy.yml (`env: SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}`).
    // The secret has to exist first, so the workflow is deliberately left untouched here. Local builds
    // (no token) skip the plugin cleanly either way.
    //
    // Must be last (processes the final output). org/project slugs are public, not secret. telemetry off.
    ...(command === 'build' && process.env.SENTRY_AUTH_TOKEN
      ? [
          sentryVitePlugin({
            org: 'ts-6a',
            project: 'javascript-react',
            authToken: process.env.SENTRY_AUTH_TOKEN,
            sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
            telemetry: false,
          }),
        ]
      : []),
    // LAST, and in this order (both enforce:'post', so among post plugins the array order is the
    // run order): buildIdentity must see the final bytes of every earlier rewrite, and
    // precacheIntegrity must audit the artifact after buildIdentity's own rewrite. See both above.
    buildIdentity(),
    precacheIntegrity(),
  ],
  // Generate hidden source maps ONLY when we're uploading them to Sentry. 'hidden' emits the .map
  // files but omits the //# sourceMappingURL comment from the shipped JS, so browsers never fetch
  // them and they aren't referenced; the Sentry plugin above uploads then deletes them. Gated on the
  // SAME variable as that plugin, deliberately: maps must never be emitted with nothing to consume
  // and delete them. Since no build has ever had SENTRY_AUTH_TOKEN (see the plugin note above), this
  // has always resolved to `false` — no .map file has ever been produced by CI or locally. (.map
  // files would not count toward the JS size budget anyway; the size script globs *.js only.)
  build: {
    sourcemap: process.env.SENTRY_AUTH_TOKEN ? 'hidden' : false,
  },
  test: {
    // Pure-logic tests run in Node (Vitest's default environment). DOM characterization
    // tests (Stage C, Step 6) opt into jsdom per-file via `// @vitest-environment jsdom`.
    // setupFiles run before every test file is imported, in that file's environment, so
    // the jsdom API stubs in tests/setup/dom.js are guaranteed in place before the app
    // module loads. The stubs are window-guarded, so this file is inert under Node and the
    // existing pure-logic tests are unaffected (they only gain jest-dom matchers on expect).
    setupFiles: ['./tests/setup/dom.js'],
    // Don't run the CSS pipeline (Tailwind/PostCSS) for tests — characterization tests
    // import the app (which imports index.css) but assert on behavior/markup, never styles.
    // Skipping CSS keeps the harness fast and removes a moving part. (This is Vitest's
    // default, set explicitly to document intent.)
    css: false,
    // Generous per-test budget (default is 5s). GitHub Actions runners spike under load, and a
    // load-induced slowdown of a compute-heavy test (e.g. the 100k-generation date-gen fuzz) once
    // transiently failed the "Run tests" deploy gate on the production runner while the SAME commit
    // passed on staging + locally. 20s gives ample headroom without masking a genuinely-hung test;
    // the heavy fuzz profiles (tests/engine/fuzz) set their own larger budget on top of this.
    testTimeout: 20000,
    // ── Worker cap. Vitest's forks pool defaults to one worker per core, and every DOM file in
    // this suite builds a full jsdom document, so on a 32-core / 16 GB laptop the default spawns
    // ~32 jsdom workers against ~0.5 GB of headroom each. Under that pressure the run does not
    // fail loudly — it fails in the WORST possible shape: workers time out or never start, the
    // files they owned are silently never collected, and Vitest prints a summary line like
    // "Test Files 47 passed (47) / Tests 575 passed (575)" beside a NON-ZERO exit code. A third
    // of the suite vanishes and the printed line reads green. Three separate reviewers hit this
    // on the same machine (EXIT 1 on consecutive runs; EXIT 0 the moment concurrency was capped),
    // and the runs that failed failed on 20s load timeouts, never on an assertion.
    //
    // The cap is a CEILING, never a floor: it is derived from the machine's own parallelism and
    // clamped to 8, so it can only ever LOWER the worker count. On a 2-core CI runner this
    // resolves to 1 and nothing changes; on the 32-core laptop it resolves to 8. Measured cost of
    // the cap on that laptop: none worth naming (the run is dominated by per-file jsdom setup,
    // not by scheduling).
    //
    // ⚠ COROLLARY FOR ANY DEPLOY GATE, HUMAN OR SCRIPTED: trust the EXIT CODE and the collected
    // file/test COUNT. Never read the "N passed" line as proof the suite ran.
    //
    // These are the VITEST 4 spellings. The pre-4 form was `poolOptions.forks.{minForks,maxForks}`,
    // which v4 removed — and removed LOOSELY: it is accepted without error, does nothing at all,
    // and says so only in a DEPRECATED line above the run summary. A cap written that way is a
    // no-op that looks like a fix. (Found exactly that way, on the first run after writing it.)
    minWorkers: 1,
    maxWorkers: MAX_TEST_WORKERS,
  },
}))
