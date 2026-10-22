// scripts/versionLedger.mjs — THE VERSION BUMP GUARD (2026-08-10). Decides whether the version
// about to be deployed has ever been deployed to THIS site before, and refuses the deploy if it has.
// Wired as the first step of .github/workflows/deploy.yml via scripts/checkVersionLedger.mjs, and
// again in its `record` job — which, once every check has passed, writes the ledger it reads. Read src/appVersion.ts alongside
// this — that file carries the versioning scheme, this one enforces its one absolute rule:
//
//     ★ EVERY DEPLOY BUMPS EXACTLY ONE NUMBER, NEVER ZERO.
//       The owner's words: "no consecutive deploys should EVER have the same version number,
//       that's critical."
//
// ════════════════════════════════════════════════════════════════════════════════════════════════
// WHY GIT TAGS, AND WHY NOTHING ELSE WORKS. Four designs were built up and adversarially attacked
// before this one; the record of the three that died is in PROJECT.md's version-bump-guard entry,
// and the single fact that killed all of them is worth stating here because it is not obvious:
//
//   ★★ A DEPLOY DOES NOT REQUIRE A NEW COMMIT. GitHub's "Re-run all jobs" republishes the same
//      commit, and since round 16 made DEPLOY_TS the BUILD clock, that rebuild is a genuinely
//      different artifact — different build id, differently-named bundle, a different "Last
//      Updated", and every player told an update is waiting. So any guard that asks "did the code
//      change since last time?" (diff against HEAD~1, diff against github.event.before, derive the
//      version from the commit count) is STRUCTURALLY BLIND to it: two real, different builds go
//      out wearing one number and the guard sees nothing to complain about.
//
// Only a record written BY THE DEPLOY can see that, and a git tag is the cheapest durable record
// available: it lives in the repository the deploy just built for, it needs no network call of its
// own (the checkout already fetched it), no secret, no new file, and no service that can be down.
//
// ⚠ WHY NOT "compare against what the site is serving" — the direction that looked most natural.
// GitHub Pages' CDN strips the query string from its cache key, so the usual cache-buster does not
// bust it: measured 2026-08-10, `build-id.txt?cg=<brand-new-nonce>` returned `X-Cache: HIT` under
// `Cache-Control: max-age=600`. A stale read produces a FALSE PASS — it would wave through exactly
// the duplicate it exists to catch — and it puts a network dependency inside the deploy gate, which
// can then fail for reasons that have nothing to do with the code. (The same measurement is why
// src/lib/updateCheck.ts now documents a ceiling on how fresh "Check for updates" can be.)
//
// PER-REPOSITORY, AND THAT IS CORRECT RATHER THAN A LIMITATION. Tags are not shared between the two
// repos, so each site keeps its own ledger and each build tags only the repo it is building for.
// Staging has had far more deploys than production, so the two ledgers SHOULD differ — and the
// owner's own argument settles the design: if a staging-only push did not consume a number, the next
// staging deploy would have to go BACKWARD to match production, which the strictly-greater rule
// below refuses. Every push that reaches either site consumes a version number. A skipped number
// costs nothing; a repeated one is the whole thing being prevented.
//
// STRICTLY GREATER, NOT MERELY DIFFERENT. Refusing only an exact repeat would still allow a
// downgrade, and a version that can go down cannot answer "which build is newer". Strictly greater
// delivers more than was asked for: no version is ever used twice on a site, ever.
//
// ⚠⚠ AN EMPTY LEDGER IS A FAILURE, NOT A PASS — THE MOST IMPORTANT LINE IN THIS FILE. If this guard
// treated "no tags found" as "nothing to collide with", then a checkout that did not fetch tags
// would sail through silently on every deploy forever, and nothing would look broken. That is
// precisely the shallow-clone trap scripts/buildNumber.mjs exists to prevent, in new clothes: a
// wrong answer that is entirely plausible. So the ledger must be NON-EMPTY to pass. The repository
// is seeded with one real tag before this guard ever runs (`git tag v2.19.0 50ba020`, pushed to both
// remotes), which makes "empty" mean "I cannot see the ledger" and nothing else.
//
// PURE BY CONSTRUCTION, the buildNumber.mjs / changelogStamp.mjs pattern: this module takes plain
// DATA and returns a verdict. It never runs git and never reads a file, so every branch below is
// unit-tested (tests/versionLedger.test.js) with no git process, no fixture repo and no tags to
// arrange. The wiring is the handful of lines in checkVersionLedger.mjs that cannot be subtly wrong.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// The git invocation, exported so the test asserts the exact argv rather than paraphrasing it. It is
// passed as an ARRAY to execFile, never through a shell, so `v*` reaches git as git's own pattern
// and is never expanded by the shell into filenames that happen to start with v.
export const GIT_TAG_ARGS = ['tag', '--list', 'v*']

// The shared prefix on every failure, matching vite.config.js's existing `app-version:` throw so the
// two halves of the same rule announce themselves the same way.
const FAIL = 'app-version'

/**
 * Parse a `vMAJOR.MINOR.PATCH` tag, or a bare `MAJOR.MINOR.PATCH` version.
 *
 * Deliberately strict: anything else returns null and is IGNORED rather than guessed at, so a
 * `v2.19.0-rc.1` or a stray `vintage` tag can never be mistaken for a released version. The
 * three parts are compared as NUMBERS below, which is the whole reason a regex is not enough —
 * lexically "2.9.0" sorts after "2.10.0", and that inversion is exactly how a duplicate would slip
 * past a naive string comparison.
 *
 * @param {string} text a tag name or version string.
 * @returns {number[] | null} [major, minor, patch], or null if it is not one.
 */
export const parseVersion = (text) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(text).trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

// ⚠ THE VERSION IS HELD TO A STRICTER TEST THAN A TAG, AND THE ASYMMETRY IS THE POINT. A TAG may
// wear a leading `v` and the whitespace git hands back, because that is genuinely what git prints.
// A VERSION may not: it is committed data, and — decisively — it is the string that BECOMES a git
// ref. Accepting `v2.21.0` here would tag `vv2.21.0`, which `git tag --list v*` still matches but
// parseVersion refuses, so that version would land in `ignored` and be INVISIBLE to every later
// run: the same version could then deploy twice, which is the one thing this file exists to stop.
// (Found by an adversarial review that drove it end-to-end in a throwaway repo, not by reasoning.)
// This is byte-identical to the test vite.config.js applies to the same field, deliberately — the
// two halves of one rule must not disagree about what is valid, and THIS is the half that decides
// a ref, so it must be at least as strict as the other. It is now exactly as strict.
export const VERSION_RE = /^\d+\.\d+\.\d+$/

/**
 * Compare two parsed versions component by component.
 *
 * @returns {number} negative if a < b, 0 if equal, positive if a > b.
 */
export const compareVersions = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

/**
 * Is this version safe to deploy to a site whose ledger holds `tags`?
 *
 * @param {{version: string, tags: string[]}} input the version from package.json, and every tag git
 *   reported. Unparseable tags are counted and ignored; see `ignored` in the result.
 * @returns {{ok: boolean, reason: string, version: string, highest: string|null,
 *   considered: number, ignored: string[]}} `reason` is one of 'ok', 'bad-version', 'empty-ledger',
 *   'already-shipped', 'downgrade' — a discriminator the message formatter switches on, so the
 *   wording and the verdict cannot drift apart.
 */
export const checkVersionLedger = ({ version, tags }) => {
  const list = Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter(Boolean) : []
  const ignored = list.filter((t) => parseVersion(t) === null)
  const parsed = list.map(parseVersion).filter(Boolean)
  // `tag` is null on every failing path: the ref is only ever derived from a version that PASSED,
  // so there is no branch on which the workflow could read a tag name for a rejected version.
  const base = { version: String(version ?? ''), considered: parsed.length, ignored, tag: null }

  // Checked HERE rather than left to vite.config.js, because this guard deliberately runs before
  // `npm ci` — vite does not exist yet when this speaks. The RAW string is tested, not a trimmed
  // one: whitespace around a version is exactly as invalid as a `v`, and for the same reason.
  const mine = VERSION_RE.test(String(version ?? '')) ? parseVersion(version) : null
  if (!mine) return { ...base, ok: false, reason: 'bad-version', highest: null }

  // Fail closed: see the ⚠⚠ note in the header. "No tags" cannot be distinguished from "no tags
  // VISIBLE", and only one of those two is safe.
  if (parsed.length === 0) return { ...base, ok: false, reason: 'empty-ledger', highest: null }

  const top = parsed.reduce((a, b) => (compareVersions(a, b) >= 0 ? a : b))
  const highest = top.join('.')
  const delta = compareVersions(mine, top)
  // The CANONICAL ref, rebuilt from the parsed numbers rather than concatenated onto the raw input.
  // The workflow consumes this whole string, so there is no place left where a `v` and a version
  // are glued together outside the validated path.
  if (delta > 0) return { ...base, ok: true, reason: 'ok', highest, tag: `v${mine.join('.')}` }
  return { ...base, ok: false, reason: delta === 0 ? 'already-shipped' : 'downgrade', highest }
}

/**
 * The failure message, co-located with the verdict so the exact words a broken build prints are
 * themselves under test.
 *
 * Written for a reader who is NOT a programmer and who is looking at a red deploy at 2am with no
 * idea which knob is theirs: it names the one file to open, gives both possible edits with the rule
 * for choosing between them, and pre-answers the one objection that will actually occur ("but I DID
 * bump it").
 *
 * @param {ReturnType<typeof checkVersionLedger>} r
 * @returns {string}
 */
export const describeVersionLedgerFailure = (r) => {
  // A PASSING result has no failure to describe, and the switch below would otherwise fall through
  // and hand back the already-shipped text — a confident, plausible, completely wrong sentence. That
  // is the shape this whole file exists to refuse, so it refuses it here too.
  if (r.reason === 'ok')
    throw new Error(
      `versionLedger: describeVersionLedgerFailure was called on a PASSING result (${r.version}). ` +
        `There is nothing to describe; the caller should not have reached this.`,
    )

  const bump = (v) => {
    const p = parseVersion(v)
    if (!p) return ['a higher version', 'a higher version']
    return [`${p[0]}.${p[1] + 1}.0`, `${p[0]}.${p[1]}.${p[2] + 1}`]
  }
  const tail = (from) => {
    const [minor, patch] = bump(from)
    return (
      `\n  Fix: open package.json, raise "version", commit, and push again.\n` +
      `      • a player would notice something new  ->  MINOR:  ${from} -> ${minor}\n` +
      `      • only fixes, or nothing visible at all ->  PATCH:  ${from} -> ${patch}\n` +
      `\n  ⚠ IF YOU ARE SURE YOU ALREADY BUMPED IT, an earlier run already claimed this number.\n` +
      `    WHICH of the two things below happened decides what to do, and they need OPPOSITE\n` +
      `    actions — read this before touching package.json again:\n` +
      `      • THE SITE WENT LIVE with it. The number is spent. Bump again, as above.\n` +
      `      • THE BUILD SUCCEEDED BUT PUBLISHING FAILED. The finished site is still sitting\n` +
      `        there and the number is NOT spent. In the Actions tab press "Re-run failed\n` +
      `        jobs", which re-runs only the publishing step. Do NOT press "Re-run all jobs":\n` +
      `        that re-runs this check, which will stop you again — and bumping would cost a\n` +
      `        pointless version plus a changelog edit for a deploy that changed nothing.\n` +
      `    A SKIPPED NUMBER COSTS NOTHING. A REPEATED ONE IS WHAT THIS CHECK EXISTS TO STOP.\n` +
      `\n  CONTEXT: every build tags this repository v<version> just before the site is published,\n` +
      `  so the tag list IS the record of what has shipped here (scripts/versionLedger.mjs).\n` +
      `  Never create or delete v-tags by hand — the deploy owns them.`
    )
  }

  if (r.reason === 'bad-version')
    return (
      `${FAIL}: package.json's "version" is ${JSON.stringify(r.version)}, which is not a ` +
      `MAJOR.MINOR.PATCH version.\n` +
      `  Every deploy bumps exactly one of the three — see src/appVersion.ts for what each means.`
    )

  if (r.reason === 'empty-ledger')
    return (
      `${FAIL}: this repository has NO version tags at all, so there is no record of what has\n` +
      `already shipped here — and this check refuses to pass on a ledger it cannot read.\n` +
      (r.ignored?.length
        ? `  (${r.ignored.length} tag(s) were found but are not versions: ${r.ignored.slice(0, 5).join(', ')})\n`
        : '') +
      `\n  There are exactly two causes, and they need opposite fixes:\n` +
      `    1. THE SEED TAG IS MISSING. Every repository that deploys this app needs one real tag to\n` +
      `       start from. Create it on the last commit that went live, and push it:\n` +
      `           git tag v<the version that is already live> <that commit>\n` +
      `           git push <this repo's remote> v<that version>\n` +
      `    2. THE CHECKOUT DID NOT FETCH TAGS. .github/workflows/deploy.yml must keep\n` +
      `           - uses: actions/checkout@v4\n` +
      `             with:\n` +
      `               fetch-depth: 0     # full history AND tags\n` +
      `       (the default, fetch-depth: 1, fetches neither.)\n` +
      `\n  This is deliberately fatal rather than a shrug: if "no tags" were treated as "nothing to\n` +
      `  collide with", cause 2 would pass silently on every deploy forever and nothing would look\n` +
      `  broken — the same trap scripts/buildNumber.mjs refuses a shallow clone to avoid.`
    )

  if (r.reason === 'downgrade')
    return (
      `${FAIL}: this deploy is version ${r.version}, which is LOWER than v${r.highest}, already\n` +
      `deployed to this site. Versions only ever go up.\n` +
      `    this repository has already published, at the highest:   v${r.highest}\n` +
      `    package.json says this deploy is:                         ${r.version}\n` +
      `\n  A version that can go down cannot answer "which build is newer", which is most of the\n` +
      `  reason to have one.` +
      tail(r.highest)
    )

  return (
    `${FAIL}: version ${r.version} has already been deployed to this site.\n` +
    `    this repository has already published, at the highest:   v${r.highest}\n` +
    `    package.json says this deploy is:                         ${r.version}\n` +
    `\n  A version is a promise that two builds wearing the same number ARE the same build.\n` +
    `  Sending ${r.version} out twice breaks the only question the number can answer.` +
    tail(r.highest)
  )
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE LOCKFILE'S COPY OF THE VERSION (round 24). package.json's "version" is the one that counts —
// the build injects it and the tags record it — but package-lock.json carries npm's own mirror of
// it in TWO places (its top-level "version" and the root package's, `packages[""].version`), and a
// bump made by editing package.json alone leaves that mirror behind. It sat at 2.22.1 for five
// versions: harmless to the build (`npm ci` checks the dependencies against each other, not this
// number), and a wrong answer to anyone or anything that read the app's version off the lockfile.
//
// WHY A CHECK, AND NOT "STOP CARRYING IT THERE". Deleting the two lines is the smaller diff and
// does not last: npm writes them back from package.json on the very next `npm install`, so the
// lockfile would silently grow a version again the first time a dependency changed — and from then
// on it would go stale exactly as before. The mirror is npm's, so the durable answer is to hold it
// to what it mirrors. Every npm command that touches it already agrees with this check; only a
// hand edit of package.json can part them, and that is the edit this catches.
//
// WHERE IT RUNS. Twice, on purpose: in tests/versionLedger.test.js against the two real files, so
// the local gate and CI's test step both stop a bump that reached only one of them; and from
// scripts/checkVersionLedger.mjs as part of the deploy's first step, before `npm ci`, so it costs
// two seconds there rather than a full gate. Pure like the rest of this module: it is handed the
// two parsed files' data and reads nothing itself.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Does package-lock.json name the same app version as package.json, in both places it keeps one?
 * A missing copy is a mismatch too — the file npm writes always has both, so one that is absent
 * means the lockfile is not the one this check thinks it is reading.
 *
 * @param {{version: string, lock: unknown}} input package.json's version, and package-lock.json
 *   parsed.
 * @returns {{ok: boolean, version: string, found: unknown[]}} `found` is what the lockfile says, in
 *   file order: [its top-level "version", `packages[""].version`].
 */
export const checkLockfileVersion = ({ version, lock }) => {
  const found = [lock?.version, lock?.packages?.['']?.version]
  return { ok: found.every((v) => v === version), version: String(version ?? ''), found }
}

/**
 * The failure message for a lockfile that names another version — written, like the one above, for a
 * reader who is not a programmer and is looking at a red deploy.
 *
 * @param {ReturnType<typeof checkLockfileVersion>} r
 * @returns {string}
 */
export const describeLockfileMismatch = (r) => {
  if (r.ok)
    throw new Error(
      `versionLedger: describeLockfileMismatch was called on a PASSING result (${r.version}). ` +
        `There is nothing to describe; the caller should not have reached this.`,
    )
  const says = r.found.map((v) => (typeof v === 'string' ? v : 'nothing')).join(' and ')
  return (
    `${FAIL}: package.json says this app is version ${r.version}, but package-lock.json says ${says}.\n` +
    `  package.json is the one that counts — it is the number the site shows. package-lock.json\n` +
    `  keeps npm's own copy of it in two places near its top, and raising the version by editing\n` +
    `  package.json alone leaves that copy behind.\n` +
    `\n  Fix (either one), then commit BOTH files and push again:\n` +
    `      • run   npm install --package-lock-only   — it rewrites the copy and nothing else; or\n` +
    `      • open package-lock.json and change the two "version" lines near the top (the third\n` +
    `        line of the file, and the one just under  "": {  ) to "${r.version}".\n` +
    `\n  ⚠ Do NOT use  npm version  for this: it also creates a v-tag, and the deploy owns those.`
  )
}
