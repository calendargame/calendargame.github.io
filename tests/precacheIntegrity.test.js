// tests/precacheIntegrity.test.js — the round-7 bug CLASS, pinned (round 11).
//
// The class: an asset whose precache revision does not track its shipped bytes. Workbox re-downloads
// a precached file only when its REVISION changes, never on content, so such a file is frozen in
// every client that already has it — which is how round 7 shipped gray staging icons that nobody
// ever saw. Before this, `grep -rniE "precache|revision" tests/ scripts/ .github/` returned nothing:
// the class had zero coverage anywhere in the repo.
//
// scripts/precacheIntegrity.mjs is wired into vite.config.js as a build-FAILING plugin, so the real
// artifact is audited on every build (local and CI alike). What is pinned here is the checker
// itself, against synthetic service workers — including the exact shape of the round-7 failure,
// which is the test that would have caught it.
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import {
  parsePrecacheManifest,
  checkPrecacheRevisions,
  describePrecacheProblems,
} from '../scripts/precacheIntegrity.mjs'

const md5 = (s) => createHash('md5').update(Buffer.from(s)).digest('hex')

// A minified service worker in the exact shape vite-plugin-pwa emits: bare keys, url first.
const swWith = (entries) =>
  `define(["./workbox-2fbc6a65"],function(e){"use strict";self.addEventListener("message",x=>{});` +
  `e.precacheAndRoute([${entries
    .map(
      ({ url, revision }) =>
        `{url:"${url}",revision:${revision === null ? 'null' : `"${revision}"`}}`,
    )
    .join(',')}],{})})`

describe('parsePrecacheManifest', () => {
  it('reads the minified manifest vite-plugin-pwa actually ships', () => {
    expect(
      parsePrecacheManifest(
        swWith([
          { url: 'index.html', revision: 'aaaa' },
          { url: 'assets/index-ABC.js', revision: null },
        ]),
      ),
    ).toEqual([
      { url: 'index.html', revision: 'aaaa' },
      { url: 'assets/index-ABC.js', revision: null },
    ])
  })

  it('also reads quoted keys, the reverse field order, and whitespace', () => {
    // Workbox's own output has varied across versions; the checker must not go quietly blind
    // because a dependency bump reordered two keys.
    const sw = `precacheAndRoute([ { "revision": "bbbb", "url": "favicon.svg" } ])`
    expect(parsePrecacheManifest(sw)).toEqual([{ url: 'favicon.svg', revision: 'bbbb' }])
  })

  it('THROWS rather than passing when there is no manifest to read', () => {
    // A checker that silently succeeds on a service worker it could not parse is worse than none:
    // it looks like coverage while providing zero.
    expect(() => parsePrecacheManifest('self.addEventListener("fetch",()=>{})')).toThrow(
      /no precacheAndRoute/,
    )
    expect(() => parsePrecacheManifest('precacheAndRoute([])')).toThrow(/empty/)
    expect(() => parsePrecacheManifest('precacheAndRoute([{url:"a.png",revision:"x"}')).toThrow(
      /unterminated/,
    )
  })
})

describe('checkPrecacheRevisions', () => {
  // A build where every revision is honest.
  const files = { 'index.html': '<html>one</html>', 'pwa-64x64.png': 'PURPLE-ICON-BYTES' }
  const readEntry = (url) => (url in files ? Buffer.from(files[url]) : null)
  const honest = [
    { url: 'index.html', revision: md5(files['index.html']) },
    { url: 'pwa-64x64.png', revision: md5(files['pwa-64x64.png']) },
    { url: 'assets/index-ABC.js', revision: null },
  ]

  it('passes a build whose revisions match, and counts the content-hash-named entries apart', () => {
    const { checked, hashless, problems } = checkPrecacheRevisions(honest, readEntry)
    expect(problems).toEqual([])
    expect(checked).toBe(2)
    expect(hashless).toBe(1)
  })

  it('CATCHES THE ROUND-7 FAILURE: the icon bytes changed, the revision did not', () => {
    // The exact shape of the shipped bug. Everything about this build looks fine — the service
    // worker is well-formed, the file is present, the deploy succeeded — and every client that
    // already had the old icon would keep it forever.
    const swapped = { ...files, 'pwa-64x64.png': 'GRAY-ICON-BYTES' }
    const { problems } = checkPrecacheRevisions(honest, (url) =>
      url in swapped ? Buffer.from(swapped[url]) : null,
    )
    expect(problems).toEqual([
      {
        url: 'pwa-64x64.png',
        expected: md5(files['pwa-64x64.png']),
        actual: md5(swapped['pwa-64x64.png']),
      },
    ])
    expect(describePrecacheProblems(problems)).toContain('the shipped file hashes to')
  })

  it('reports a precached URL that is not in the build output at all', () => {
    // Not a hash question but the same family: a precache manifest naming a file that is not there
    // fails the whole install, so the client keeps the previous worker and never updates.
    const { problems } = checkPrecacheRevisions([{ url: 'gone.png', revision: 'cccc' }], () => null)
    expect(problems).toEqual([{ url: 'gone.png', expected: 'cccc', actual: null }])
    expect(describePrecacheProblems(problems)).toContain('MISSING from the build output')
  })

  it('never faults a revision:null entry — there the FILENAME is the fingerprint', () => {
    // Content-hash-named assets (assets/index-<hash>.js) legitimately carry no revision: any byte
    // change renames the file. Flagging them would make the guard cry wolf on every build.
    const { checked, hashless, problems } = checkPrecacheRevisions(
      [{ url: 'assets/index-ABC.js', revision: null }],
      () => Buffer.from('anything at all'),
    )
    expect(problems).toEqual([])
    expect(checked).toBe(0)
    expect(hashless).toBe(1)
  })
})
