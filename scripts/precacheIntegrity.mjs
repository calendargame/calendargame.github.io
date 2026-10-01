// scripts/precacheIntegrity.mjs — the round-7 class, closed at BUILD TIME (round 11).
//
// THE CLASS: an asset whose precache REVISION does not track its shipped BYTES. Workbox decides
// whether a client must re-download a precached file by comparing revisions, never by comparing
// content — so a file whose bytes changed while its revision did not is invisible to every client
// that already has the old copy. It stays cached forever. Round 7 shipped exactly that (the gray
// staging icons inherited the purple source files' md5), and NOTHING anywhere caught it: before
// this module, `grep -rniE "precache|revision" tests/ scripts/ .github/` returned nothing at all.
// It is also the one class the update DETECTOR is blind to by construction — the detector can
// see that the deploy differs, but the applier hands the stale revision straight back — which is
// why this guard is what makes that feature honest rather than merely confident.
//
// THE CHECK: for every precache entry in the generated dist/sw.js that carries a revision, that
// revision must equal the md5 of the file actually sitting in dist at that URL. Workbox computes
// revisions as md5 hex, and vite.config.js's testIconVariant rewrites some of them by hand — this
// verifies the result rather than trusting either. Entries with `revision: null` are skipped by
// design: those are the content-hash-named build assets (assets/index-<hash>.js), where the URL
// itself IS the fingerprint and a byte change necessarily renames the file.
//
// Wired as a build-FAILING vite plugin (vite.config.js, last of the post plugins so it sees the
// final bytes after every rewrite), not as a CI step: a check that lives in the workflow file only
// runs where the workflow runs, and a local `npm run build` could still produce a broken artifact.
// The parsing + comparison halves below are pure and exported so tests/precacheIntegrity.test.js
// can drive them with synthetic input, including the failure the class is named after.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Pull the precache manifest out of a generated service worker. Workbox emits it as the argument
// of precacheAndRoute([...]) — minified in our build (`{url:"index.html",revision:"6623…"}`), so
// this tolerates both quoted and bare keys, either field order, and arbitrary whitespace. Entries
// contain no nested braces, so a flat {…} scan over the array text is exact.
// Throws when there is no manifest at all: a checker that silently passes on a service worker it
// could not read would be worse than no checker, because it would look like coverage.
export function parsePrecacheManifest(swSource) {
  const open = swSource.indexOf('precacheAndRoute(')
  if (open === -1) throw new Error('precache-integrity: no precacheAndRoute(...) call in sw.js')
  const start = swSource.indexOf('[', open)
  if (start === -1) throw new Error('precache-integrity: precacheAndRoute has no array argument')
  let depth = 0
  let end = -1
  for (let i = start; i < swSource.length; i++) {
    const c = swSource[i]
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end === -1) throw new Error('precache-integrity: unterminated precache manifest array')
  const body = swSource.slice(start + 1, end)
  const entries = []
  for (const object of body.match(/\{[^{}]*\}/g) ?? []) {
    const url = object.match(/["']?url["']?\s*:\s*"((?:[^"\\]|\\.)*)"/)
    const revision = object.match(/["']?revision["']?\s*:\s*(?:null|"([0-9a-fA-F]*)")/)
    if (!url || !revision) continue
    entries.push({ url: url[1], revision: revision[1] ?? null })
  }
  if (entries.length === 0) throw new Error('precache-integrity: precache manifest is empty')
  return entries
}

// Compare each revisioned entry against the bytes it names. `readEntry(url)` returns the file's
// contents as a Buffer/Uint8Array, or null when there is no such file — a precached URL that does
// not exist in the output is its own failure (the client would 404 on install and the whole
// precache would fail), so it is reported rather than skipped.
export function checkPrecacheRevisions(entries, readEntry) {
  const problems = []
  let checked = 0
  let hashless = 0
  for (const { url, revision } of entries) {
    if (revision === null) {
      hashless++
      continue
    }
    checked++
    const bytes = readEntry(url)
    if (bytes === null) {
      problems.push({ url, expected: revision, actual: null })
      continue
    }
    const actual = createHash('md5').update(bytes).digest('hex')
    if (actual !== revision) problems.push({ url, expected: revision, actual })
  }
  return { checked, hashless, problems }
}

// Format a report for a build failure. Kept here (not in the plugin) so the exact wording a broken
// build prints is itself testable.
export function describePrecacheProblems(problems) {
  return problems
    .map(({ url, expected, actual }) =>
      actual === null
        ? `  ${url} — precached but MISSING from the build output (revision ${expected})`
        : `  ${url} — sw.js says revision ${expected}, the shipped file hashes to ${actual}`,
    )
    .join('\n')
}

// The filesystem half: read dist/sw.js, check every entry against dist. Returns the same shape as
// checkPrecacheRevisions. Throws if sw.js is unreadable — a PWA build with no service worker is a
// broken build, not a build with nothing to check.
export function verifyDistPrecache(distDir) {
  let swSource
  try {
    swSource = readFileSync(join(distDir, 'sw.js'), 'utf8')
  } catch {
    throw new Error(`precache-integrity: cannot read ${join(distDir, 'sw.js')}`)
  }
  return checkPrecacheRevisions(parsePrecacheManifest(swSource), (url) => {
    try {
      return readFileSync(join(distDir, url))
    } catch {
      return null
    }
  })
}
