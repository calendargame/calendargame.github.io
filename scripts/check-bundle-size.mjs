// Bundle-size budget (Stage E2) — guards against accidental bloat.
//
// Sums the gzipped size of the built app JS (dist/assets/*.js) and fails if it exceeds the
// budget below. This catches a surprise regression (e.g. importing a large library) before it
// ships. It is NOT a no-growth rule: when growth is intentional, bump BUDGET_TOTAL_JS_GZIP_KB
// deliberately — that one-line change is the conscious "yes, the app got bigger" decision, and
// shows up in the diff/PR. Dependency-free (Node's built-in zlib), so CI needs nothing extra.
//
// Why gzip level 9 + sum-of-files: GitHub Pages serves each asset compressed independently, so
// the realistic transfer cost is the sum of each file's own gzip. Level 9 = the smallest gzip
// (a stable, reproducible yardstick). The number won't match Vite's build log exactly (Vite
// reports its own gzip estimate) — that's fine; what matters is a consistent line in the sand.
import { readFileSync, readdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

// Budget for the total app JS, gzipped (KB). Baseline at set time: 119.92 KB measured here
// (Stage E0/E2, 2026-06-05, React Compiler ON; Vite's own log says ~124 KB — different gzip
// method). ~15 KB / ~12% headroom is deliberate: enough for normal iteration, tight enough to
// catch a surprise dependency. Bump this consciously as the app grows — a sudden jump toward it
// means an unexpected import; run `npm run analyze` first.
const BUDGET_TOTAL_JS_GZIP_KB = 135

const ASSETS_DIR = 'dist/assets'

let files
try {
  files = readdirSync(ASSETS_DIR).filter((f) => f.endsWith('.js'))
} catch {
  console.error(`check-bundle-size: cannot read ${ASSETS_DIR} — run "npm run build" first.`)
  process.exit(1)
}
if (files.length === 0) {
  console.error(`check-bundle-size: no .js files in ${ASSETS_DIR} — did the build run?`)
  process.exit(1)
}

let totalGzipKb = 0
console.log(`Bundle size check — app JS in ${ASSETS_DIR}:`)
for (const f of files.sort()) {
  const raw = readFileSync(join(ASSETS_DIR, f))
  const gzipKb = gzipSync(raw, { level: 9 }).length / 1024
  totalGzipKb += gzipKb
  console.log(`  ${f.padEnd(28)} ${gzipKb.toFixed(2).padStart(8)} KB gzip  (${(raw.length / 1024).toFixed(1)} KB raw)`)
}

console.log('')
const total = totalGzipKb.toFixed(2)
if (totalGzipKb > BUDGET_TOTAL_JS_GZIP_KB) {
  console.error(
    `❌ Bundle-size budget EXCEEDED: total app JS is ${total} KB gzip > ${BUDGET_TOTAL_JS_GZIP_KB} KB budget.\n` +
      `   If this growth is intentional, bump BUDGET_TOTAL_JS_GZIP_KB in scripts/check-bundle-size.mjs.\n` +
      `   If it was unexpected, run "npm run analyze" to see what grew.`,
  )
  process.exit(1)
}
console.log(
  `✅ Bundle size OK: total app JS ${total} KB gzip ≤ ${BUDGET_TOTAL_JS_GZIP_KB} KB budget ` +
    `(${(BUDGET_TOTAL_JS_GZIP_KB - totalGzipKb).toFixed(1)} KB headroom).`,
)
