// tests/browser/support/builtSite — WHAT THE BROWSER LANE IS POINTED AT: the finished site in
// `dist`, the same files a deploy uploads. Shared by playwright.config.ts (which needs the address)
// and serveBuild.js (which serves it), so the two cannot disagree about either fact below.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
export const DIST = join(ROOT, 'dist')
// A port nothing else here uses (vite dev is 5173, vite preview 4173), on the loopback address —
// which is also what keeps error reporting off: observability/sentry does not start there.
export const HOST = '127.0.0.1'
export const PORT = 4317

// Everything a build is made FROM. A file here that is newer than the build means the build is not
// of this tree.
const BUILT_FROM = [
  'src',
  'public',
  'scripts',
  'design/icons/test-build',
  'index.html',
  'vite.config.js',
  'postcss.config.js',
  'package.json',
  'package-lock.json',
]

const newest = (path) => {
  const stat = statSync(path)
  if (!stat.isDirectory()) return { at: stat.mtimeMs, path }
  return readdirSync(path)
    .map((name) => newest(join(path, name)))
    .reduce((a, b) => (b.at > a.at ? b : a), { at: 0, path })
}

const HOW_TO_BUILD =
  'Run `npm run build`, then `npm run test:browser` again. (A build is refused on a day the ' +
  'changelog has no entry for — vite.config.js says why; the lane cannot run against this tree ' +
  'until it builds.)'

/**
 * Throws unless `dist` holds a build of the tree as it is now. The lane tests what ships, so a
 * missing build is an error and so is a stale one — a green run against last week's files proves
 * nothing about this week's.
 */
export function assertBuildIsCurrent() {
  const index = join(DIST, 'index.html')
  if (!existsSync(index))
    throw new Error(`browser lane: there is no build in dist. ${HOW_TO_BUILD}`)
  // index.html is the last thing a build writes (vite.config.js's build-identity plugin).
  const builtAt = statSync(index).mtimeMs
  const source = BUILT_FROM.map((p) => newest(join(ROOT, p))).reduce((a, b) =>
    b.at > a.at ? b : a,
  )
  if (source.at > builtAt)
    throw new Error(
      `browser lane: the build in dist is older than ${relative(ROOT, source.path)}. ${HOW_TO_BUILD}`,
    )
}

/**
 * The path the build expects to be served under: '/' for the live site and for a local build,
 * '/<repo>/' for the test site's. Read off the build itself (the manifest's `scope`, which
 * vite-plugin-pwa writes from Vite's `base`) rather than worked out again here, so the lane serves
 * whichever site CI has just built without knowing the rule that named it.
 */
export function builtBase() {
  try {
    const { scope } = JSON.parse(readFileSync(join(DIST, 'manifest.webmanifest'), 'utf8'))
    if (typeof scope === 'string' && scope.startsWith('/') && scope.endsWith('/')) return scope
  } catch {
    /* no build yet — serveBuild.js is what reports that, in words */
  }
  return '/'
}
