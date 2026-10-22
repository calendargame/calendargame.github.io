// scripts/checkChangelogDate.mjs — the changelog-date guard, runnable on its own.
//
// WHY THIS EXISTS SEPARATELY FROM THE PLUGIN. The guard lives in vite.config.js and fails the build
// before the bundler starts, which is the fastest failure available inside `vite build` — but the
// DEPLOY does not start at the build. deploy.yml's quick-checks job runs this in its first seconds,
// before the install, lint, format and typecheck — and the build itself runs in a job of its own,
// alongside the unit tests — so a mis-dated changelog fails the deploy in seconds with the same
// advice, before anything else has been paid for.
//
// ⚠ IT IS NOT THE AUTHORITY, AND MUST NOT BECOME ONE. vite.config.js's changelogStamp plugin stays
// the gate: a check that lives only in the workflow cannot stop a local `npm run build` from
// producing a dist whose two dates disagree, which is precisely the hole the plugin was written to
// close. This is an early WARNING SHOT that happens to be fatal — both call the same pure
// checkChangelogStamp, so they cannot drift.
//
// ⚠ THE TWO CLOCKS ARE MINUTES APART, AND THAT IS ACCEPTED. This step reads the clock when it runs;
// the build reads it again when it runs. Across a Pacific midnight the two can disagree, so this can
// pass and the build still fail (never the reverse in any way that matters — the build is the one
// that gates). Nothing is lost: the build's verdict is the real one and its message says the same
// thing.
//
// Run: `node scripts/checkChangelogDate.mjs` (Node imports src/changelog.ts directly — type
// stripping, Node 24, the same version deploy.yml pins).
import { CHANGELOG } from '../src/changelog.ts'
import { checkChangelogStamp, describeChangelogStampMismatch } from './changelogStamp.mjs'

const result = checkChangelogStamp(CHANGELOG, new Date())
if (!result.ok) {
  console.error(describeChangelogStampMismatch(result))
  process.exit(1)
}
console.log(
  `✅ Changelog stamp OK: newest entry ${result.found} matches today's Pacific date ` +
    `(checked at ${result.stamp}).`,
)
