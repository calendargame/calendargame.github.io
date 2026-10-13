// tests/browser/support/serveBuild — serves the finished site in `dist` for the browser lane
// (playwright.config.ts's `webServer`). `vite preview` is the server: static files, under the base
// the build was made for, which is what GitHub Pages does with them. It refuses to start on a
// missing or stale build, so the lane fails with the reason instead of testing the wrong files.
import { preview } from 'vite'
import { ROOT, HOST, PORT, assertBuildIsCurrent, builtBase } from './builtSite.js'

try {
  assertBuildIsCurrent()
} catch (error) {
  console.error(error.message)
  process.exit(1)
}

await preview({
  root: ROOT,
  base: builtBase(),
  logLevel: 'warn',
  preview: { host: HOST, port: PORT, strictPort: true },
})
