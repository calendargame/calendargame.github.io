// tests/browser/support/serveBuild — serves the finished site in `dist` for the browser lane
// (playwright.config.ts's `webServer`). `vite preview` is the server: static files, under the base
// the build was made for, which is what GitHub Pages does with them. It refuses to start on a
// missing or stale build, so the lane fails with the reason instead of testing the wrong files.
// Beside it, on the same origin, the older build of support/oldSite at `<base>old/` - built first if
// this machine does not have it yet.
import { readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { preview } from 'vite'
import { ROOT, HOST, PORT, assertBuildIsCurrent, builtBase } from './builtSite.js'
import { OLD_PATH, ensureOldSite } from './oldSite.js'

let oldDir
try {
  assertBuildIsCurrent()
  oldDir = ensureOldSite()
} catch (error) {
  console.error(error.message)
  process.exit(1)
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}
const OLD_BASE = `${builtBase()}${OLD_PATH}`
// The older build's files, as Pages would serve them: a path is its file, a folder its index.html.
const oldSite = {
  name: 'lane-old-site',
  configurePreviewServer(server) {
    server.middlewares.use((req, res, next) => {
      const path = decodeURIComponent((req.url ?? '').split('?')[0])
      if (!path.startsWith(OLD_BASE)) return next()
      let file = normalize(join(oldDir, path.slice(OLD_BASE.length)))
      if (!file.startsWith(oldDir + sep) && file !== oldDir) return next()
      try {
        if (statSync(file).isDirectory()) file = join(file, 'index.html')
        const body = readFileSync(file)
        res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
        res.end(body)
      } catch {
        res.statusCode = 404
        res.end()
      }
    })
  },
}

await preview({
  root: ROOT,
  base: builtBase(),
  logLevel: 'warn',
  plugins: [oldSite],
  preview: { host: HOST, port: PORT, strictPort: true },
})
