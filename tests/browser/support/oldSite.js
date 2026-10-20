// tests/browser/support/oldSite — AN OLDER BUILD OF THE APP, SERVED BESIDE THE ONE UNDER TEST, on the
// same origin (design-q1-q2.md v4, 14.4 (14)). Live and the test site share one origin, so a player
// can have a window of each open at once; and every update leaves, for a while, windows of the
// version before it. What those older windows do to the newer ones' saved data is the windows-in-sync
// door's hardest case, and a jsdom test can only replay the bytes an older build was READ to write.
// So the lane keeps a real one: the build that is live while this one is made, at `<base>old/`,
// opened in a page of the same browser context as the build under test.
//
// ★ IT IS BUILT FROM ITS OWN COMMIT, WITH ITS OWN TOOLS. A git worktree of that commit, its own
// `npm ci`, and its own vite.config.js (support/buildOldSite.mjs) - so what is served is what that
// version shipped, byte for byte in its code. ONE thing is left out of its build: its changelog-date
// guard, which refuses a build on any Pacific day but its own entry's - a rule about deploying, not
// part of the app. The base is the lane's own with `old/` on the end.
// ★ ONCE PER MACHINE, NOT PER RUN. The finished site is kept in `.lane-cache/` (gitignored; CI caches
// it under the commit and the base), and built again only when it is missing. A first build takes a
// few minutes, most of it `npm ci`.
// ⚠ MOVING IT ON is a deliberate edit of OLD_SITE below, made when a new version goes live: the pair
// is "the version live while this one is built", so its tests are written against that version's
// screens and its saved shapes.
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ROOT, builtBase } from './builtSite.js'

export const OLD_SITE = { version: 'v2.29.0', commit: 'a54b9f18ec040631eaa2682d8d382eb4e22d8cef' }
/** Where the older build is served, under the lane's base. */
export const OLD_PATH = 'old/'
const CACHE = join(ROOT, '.lane-cache')

/** The folder the older build is kept in - one per base it was built for. */
export const oldSiteDir = () => join(CACHE, `${OLD_SITE.version}${builtBase().replace(/\//g, '_')}`)

/** The older build's folder, built first if it is not there yet. */
export function ensureOldSite() {
  const out = oldSiteDir()
  if (existsSync(join(out, 'index.html'))) return out
  // ★ THE WORKTREE IS MADE IN THE SYSTEM'S TEMP FOLDER, AND REMOVED BY NODE, NOT BY GIT (Round 26
  // review). Under the project folder its node_modules ran past Windows' path limit, and `git
  // worktree remove` — Git for Windows without long paths switched on — failed on the first run with
  // "Filename too long", leaving the copy behind. A short fixed name in the temp folder keeps the
  // paths short, and Node's own removal (which handles long paths on Windows) takes the copy away
  // whatever its depth; `git worktree prune` then forgets it. The same name every time, so a copy a
  // stopped build left behind is found and removed by the next one.
  const tree = join(tmpdir(), 'calendar-game-lane-old')
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, stdio: 'inherit' })
  const removeTree = () => {
    rmSync(tree, { recursive: true, force: true, maxRetries: 5 })
    git('worktree', 'prune')
  }
  removeTree()
  console.log(`browser lane: building ${OLD_SITE.version} for ${builtBase()}${OLD_PATH} (once)`)
  git('worktree', 'add', '--detach', tree, OLD_SITE.commit)
  try {
    // (a command line, not a file and its arguments: on Windows npm is a script the shell runs)
    execSync('npm ci --no-audit --no-fund', { cwd: tree, stdio: 'inherit' })
    execFileSync(
      process.execPath,
      [
        join(ROOT, 'tests', 'browser', 'support', 'buildOldSite.mjs'),
        tree,
        `${builtBase()}${OLD_PATH}`,
        out,
      ],
      { cwd: tree, stdio: 'inherit' },
    )
  } finally {
    removeTree()
  }
  if (!existsSync(join(out, 'index.html')))
    throw new Error(`browser lane: the ${OLD_SITE.version} build left no index.html in ${out}`)
  return out
}
