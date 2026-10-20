// tests/browser/support/buildOldSite.mjs — builds an older version of the app from a worktree of its
// commit, with that version's own Vite and its own vite.config.js (support/oldSite says why).
// Run by oldSite.js as `node buildOldSite.mjs <tree> <base> <outDir>`, in <tree>.
//
// Its config is loaded exactly as its own `vite build` loads it, and built with two changes: the
// base and the output folder are the lane's, and the plugin named 'changelog-stamp' is left out - the
// guard that refuses a build on any Pacific day but the one its newest changelog entry names, which an
// old commit can never meet again. Nothing that ends up in the site is touched.
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [tree, base, outDir] = process.argv.slice(2)
const require = createRequire(join(tree, 'package.json'))
const vite = await import(pathToFileURL(require.resolve('vite')).href)
const loaded = await vite.loadConfigFromFile(
  { command: 'build', mode: 'production', isPreview: false, isSsrBuild: false },
  join(tree, 'vite.config.js'),
  tree,
)
if (!loaded) throw new Error(`buildOldSite: no vite.config.js in ${tree}`)
const { config } = loaded
const plugins = (config.plugins ?? []).flat(Infinity)
if (!plugins.some((p) => p && p.name === 'changelog-stamp'))
  throw new Error('buildOldSite: the changelog-date guard was not found by name - check its build')
await vite.build({
  ...config,
  configFile: false,
  root: tree,
  base,
  plugins: plugins.filter((p) => !p || p.name !== 'changelog-stamp'),
  build: { ...config.build, outDir, emptyOutDir: true },
})
