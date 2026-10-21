// sites.ts — THE TWO SITES THIS APP IS DEPLOYED TO, in one table (Round 27, Q1).
//
// Each is a GitHub Pages site built by .github/workflows/deploy.yml from the same commit, and each is
// served from the ROOT of a domain of its own, so the two are separate browser origins: separate saved
// data, separate service workers, separate installed apps. (Until Round 27 the test site was the
// /test_version/ path of the live domain - one origin, one copy of the data shared by both; a test
// build could touch the owner's real progress. src/lib/oldTestSite.ts clears what that left on devices.)
//
// Read by BOTH ends, so they cannot disagree:
//   • vite.config.js, at build time - which site a CI build is for (from GITHUB_REPOSITORY), and so
//     what differs between the two builds: the analytics beacon (live only), the gray icons and link
//     card (test only), the link card's absolute address.
//   • src/observability, at run time - error reports are sent only from these two hostnames, tagged
//     with the row's environment, so a build served anywhere else (a laptop, a LAN address, a tunnel)
//     never reports as a visitor.
export interface Site {
  /** 'live' or 'test' — how the code names the site. */
  name: 'live' | 'test'
  /** The GitHub repository whose Pages deploy publishes it (CI's GITHUB_REPOSITORY). */
  repository: string
  /** Where it is served. No trailing slash: a base path of '/' is appended where a URL is made. */
  origin: string
  /** The Sentry `environment` its error reports carry. */
  environment: 'production' | 'staging'
}

export const LIVE_SITE: Site = {
  name: 'live',
  repository: 'calendargame/calendargame.github.io',
  origin: 'https://calendargame.app',
  environment: 'production',
}

export const TEST_SITE: Site = {
  name: 'test',
  repository: 'calendargame/test_version',
  origin: 'https://test.calendargame.app',
  environment: 'staging',
}

export const SITES: readonly Site[] = [LIVE_SITE, TEST_SITE]

/** The site served at `hostname`, or null when this is not one of the two. */
export const siteAtHostname = (hostname: string): Site | null =>
  SITES.find((site) => new URL(site.origin).hostname === hostname) ?? null
