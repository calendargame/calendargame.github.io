// sentryRelease.mjs — READABLE ERROR REPORTS: the release a build reports, and whether it uploads its
// source maps (Round 27, Q2). Wired into vite.config.js (the `__SENTRY_RELEASE__` define, the
// sentryVitePlugin, `build.sourcemap`); pure, with git injected, so every rule below is unit-tested
// (tests/sentryRelease.test.js) — the buildNumber.mjs precedent.
//
// ── WHY THIS EXISTS. From June to October 2026 every error report this app sent was unreadable — a
// minified stack (`nl(assets/index)`) and no release — because the upload was written but never ran:
// it was gated on SENTRY_AUTH_TOKEN, and deploy.yml never handed the build that secret. Nothing failed
// and nothing said so. So the rule here is the opposite of "skip quietly": a deploy build that cannot
// upload FAILS, by name (see sentryUploadPlan).
//
// ── THE RELEASE NAME: `calendar-game@<version>+<first 12 of the commit>`. The version is what the
// owner reads in the app (the changelog panel), so a report names a build he can recognise; the
// commit makes it exact even in the one case the version alone could not — two different commits
// carrying one version on the two sites (each site's ledger only refuses a number IT has shipped).
// The SAME name on both sites for one commit is right: it is one release, deployed twice, and the
// site a report came from is its `environment` ('production' / 'staging', src/sites.ts).
// ONE VALUE, BOTH ENDS: the client sets it explicitly (sentryClient's init, from the define) and the
// plugin uploads under it (`release.name`) — rather than the plugin injecting its own guess (by
// default GITHUB_SHA) into every chunk and the client hoping to find it.

/** `git rev-parse HEAD` — exported so the test asserts the exact argv. */
export const GIT_COMMIT_ARGS = ['rev-parse', 'HEAD']

/** What dev and Vitest report as (they never report: src/observability starts only on the sites). */
export const DEV_RELEASE = 'calendar-game@dev'

/**
 * The commit a build is made from, as 40 hex digits; throws rather than guess.
 * @param {(args: string[]) => string} git runs git with the given argv and returns its stdout.
 */
export const readCommit = (git) => {
  let out
  try {
    out = String(git(GIT_COMMIT_ARGS)).trim()
  } catch (err) {
    throw new Error(
      `sentry-release: could not run git (${GIT_COMMIT_ARGS.join(' ')}) — ${err.message}`,
    )
  }
  if (!/^[0-9a-f]{40}$/.test(out))
    throw new Error(
      `sentry-release: git ${GIT_COMMIT_ARGS.join(' ')} gave ${JSON.stringify(out)}, not a commit`,
    )
  return out
}

/** The release a build of `version` from `commit` reports, and uploads its source maps under. */
export const releaseName = (version, commit) => `calendar-game@${version}+${commit.slice(0, 12)}`

/**
 * Whether this build uploads its source maps to Sentry — and, for a deploy build that cannot, the
 * error that stops it.
 *   • A DEPLOY BUILD — `vite build` inside GitHub Actions, which only ever builds one of the two sites
 *     (vite.config's siteBuiltFor refuses any other repository) — MUST upload. Without the token it
 *     throws: a deploy that ships unreadable reports is the failure this file exists to end, and the
 *     token being absent is always ours to fix (the secret, or the workflow not passing it).
 *   • ANY OTHER BUILD — a laptop's — never uploads, token or not: it is not a deploy, and a release in
 *     Sentry for a build nobody can visit would only muddy the list.
 * @param {{ command: string, githubActions: string | undefined, token: string | undefined }} env
 * @returns {boolean} true when the build uploads
 */
export const sentryUploadPlan = ({ command, githubActions, token }) => {
  if (command !== 'build' || githubActions !== 'true') return false
  if (!token)
    throw new Error(
      'sentry-upload: this is a deploy build (GitHub Actions) and SENTRY_AUTH_TOKEN is not set, so ' +
        'its source maps cannot reach Sentry and every error report from it would be unreadable. ' +
        'Nothing has been published. Check that the repository has the secret SENTRY_AUTH_TOKEN ' +
        "(Settings > Secrets and variables > Actions) and that deploy.yml's 'Build the site' step " +
        'still passes it (env: SENTRY_AUTH_TOKEN). See scripts/sentryRelease.mjs.',
    )
  return true
}

/**
 * The error a failed upload (or release step) stops the build with. Every failure stops it, the
 * outage of Sentry's own service included — weighed in vite.config.js beside the plugin.
 * @param {unknown} err what the Sentry plugin raised
 */
export const uploadFailure = (err) =>
  new Error(
    'sentry-upload: the source-map upload to Sentry failed, so this build stops rather than ship ' +
      'error reports nobody can read. Nothing has been published and no version is spent. If ' +
      "Sentry itself is down (status.sentry.io), use 'Re-run failed jobs' once it is back; if the " +
      'token was refused (401/403), replace the SENTRY_AUTH_TOKEN secret. What Sentry said: ' +
      (err instanceof Error ? err.message : String(err)),
  )
