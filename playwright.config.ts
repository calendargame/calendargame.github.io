// THE BROWSER LANE — real-browser layout tests (`npm run test:browser`), in Chromium AND WebKit.
//
// Vitest's DOM tests run in jsdom, which lays nothing out and paints nothing: no widths, no
// wrapping, no scrollbars, no fonts. Every layout rule the app has was therefore proved once, by
// hand, in a browser, and then held only by a jsdom test of the classes it was built from. This
// lane is where those proofs live now: tests/browser/*.browser.ts, run against the finished site.
// tests/browser/support/app.ts is where to start reading — how to add a test, how to debug one, and
// the one rule for what a test here may assert.
//
// ⚠ THE FILES ARE NAMED *.browser.ts ON PURPOSE. Vitest collects *.test.* and *.spec.* and nothing
// else, so it never picks one of these up, and this lane collects *.browser.ts and nothing else —
// two suites in one `tests` folder with no ignore list to keep in step.
import { defineConfig } from '@playwright/test'
import { HOST, PORT, builtBase } from './tests/browser/support/builtSite.js'

const CI = Boolean(process.env.CI)

export default defineConfig({
  testDir: 'tests/browser',
  testMatch: '**/*.browser.ts',
  outputDir: 'test-results',
  // A file's tests are independent (each opens its own page on its own storage), so they run side
  // by side. Capped, not left at one worker per core: a browser per core on a big laptop starves
  // every one of them, and a starved browser is how a layout test comes to time out.
  fullyParallel: true,
  workers: CI ? 2 : 4,
  // `test.only` left in by accident would quietly skip the rest of the lane; in CI that is a failure.
  forbidOnly: CI,
  // ⚠ ONE RETRY IN CI, AND NEVER A SILENT ONE. This lane gates the deploy (.github/workflows/
  // deploy.yml says why), so a single stall on a shared runner must not be able to cost a version
  // number — but a test that only passes the second time is a defect in the test or the app. So the
  // retry records a trace, the run lists the test as FLAKY, and the workflow uploads the trace and
  // raises a warning on the run. Locally there is no retry at all: a failure is looked at.
  retries: CI ? 1 : 0,
  reporter: CI
    ? [['github'], ['list'], ['json', { outputFile: 'test-results/report.json' }]]
    : 'list',
  // ⚠ GENEROUS ON PURPOSE, AND NOT A CLAIM ABOUT SPEED. Nothing in this lane asserts how FAST the
  // app does anything, so a wait that takes longer on a loaded machine is not a failure — and the
  // one unexplained first-attempt failure this lane has had came in a run that took half as long
  // again as usual, on a laptop busy with something else. Playwright's stock five seconds for a
  // wait (the splash gone, a list open) is a stopwatch nobody asked for; fifteen costs nothing when
  // the thing arrives, and only delays the report of something that never will. The sweeps (a
  // hundred and forty window widths in one test) set their own larger budget on top.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    // The trailing slash matters: a test opens './', which is this address whatever base the build
    // was made for ('/' for the live site, '/<repo>/' for the test site).
    baseURL: `http://${HOST}:${PORT}${builtBase()}`,
    trace: CI ? 'on-first-retry' : 'retain-on-failure',
    // ── ONE FIXED WORLD, so a measurement means the same thing on every run and every machine.
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    colorScheme: 'dark',
    // Reduce Motion on: every decorative animation is instant (the app's --motion-scale), so
    // nothing is in flight when a test measures. A test about motion itself would have to turn it
    // back on — and see the rule in support/app.ts before writing one.
    reducedMotion: 'reduce',
    // The service worker is kept out. It is the one part of the site that can reload a page on its
    // own (an update applied on open) and that answers requests from a cache instead of from the
    // files under test; neither belongs in a layout measurement. src/sw.ts's registration is told
    // "no" by the browser and the app carries on, exactly as it does where workers are unsupported.
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
    // Chromium again, with scrollbars that TAKE ROOM. Headless Chromium hides them and Playwright's
    // WebKit draws them over the content, so in the two projects above a scrolling list is as wide
    // inside as out — and the rules about what a scrollbar may not do to a row would pass without
    // ever meeting one. Windows and most Linux desktops draw this kind; tests that are about it
    // carry the @classic-scrollbar tag and run here as well.
    {
      name: 'chromium-classic-scrollbar',
      grep: /@classic-scrollbar/,
      use: {
        browserName: 'chromium',
        launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] },
      },
    },
  ],
  // The finished site, served as it will be served. Never a server that was already running: the
  // lane starts its own and stops it, so what it measured is what `dist` held. Beside it, the older
  // build the lane keeps (support/oldSite) — built before the server starts the first time a machine
  // runs the lane, which takes a few minutes, hence the long wait for the server; once it is built the
  // server is up in seconds.
  webServer: {
    command: 'node tests/browser/support/serveBuild.js',
    url: `http://${HOST}:${PORT}${builtBase()}`,
    reuseExistingServer: false,
    timeout: 900_000,
  },
})
