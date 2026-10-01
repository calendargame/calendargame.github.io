// tests/scrollRegionGuard.test.js — round 7's divergence kill for scroll regions.
// History: the settings popover, the changelog popup, and the Lookup history list each carried
// their own copy of parts of the one scroll treatment (the px-4 scrollbar lane inside the
// scroller, the fade-scroll-* edge masks, the scroll/resize edge listener), and each drifted —
// the changelog shipped without the lane or the fades, Lookup without the lane. The recipe now
// lives ONCE in src/components/scrollRegion.ts (SCROLL_REGION_CLASS / SCROLLER_CORE_CLASS /
// scrollFadeClass / useScrollEdgeState), and this guard makes building a scroller outside it
// UNSHIPPABLE: any raw vertical-overflow utility or style key (overflow-y-auto, overflow-auto,
// overflow-y-scroll, overflow-scroll, camelCase overflowY) anywhere in src markup files or
// index.html — outside the one definition module — fails the suite, listing the exact
// file:line sites. Horizontal scrollers (overflow-x-*) are deliberately out of scope: the lane
// and the top/bottom fades are vertical concepts.
//
// ⚠ THE REAL BOUNDARY, stated straight, because it was described here for two rounds as an
// "index.css exemption" and it never was one in either direction. This guard scans MARKUP —
// src/**/*.{ts,tsx,js,jsx} plus index.html — and its patterns are UTILITY-shaped
// (`overflow-y-auto`, the camelCase `overflowY` style key). A stylesheet is neither: index.css is
// not in the file list at all, and the patterns could not match `overflow-y:auto` if it were,
// because CSS declaration syntax uses a colon. So there was no carve-out to make vacuous.
// It is not being widened to cover CSS syntax either, and that is a decision rather than an
// omission: this file's whole subject is a scroll region built in markup, which is the shape that
// drifted three times and the shape the shared recipe replaces. A pattern that also matched a CSS
// declaration would fire on the PROSE in these files — src/components/CustomSelect.tsx already
// writes "overflow:auto box" in a comment — so it would need a comment stripper, machinery whose
// only new claim is one tests/docScroll.dom already makes about index.css directly ("the
// stylesheet declares no vertical scroller at all"). That file owns the stylesheet half; this one
// owns the markup half; between them the app has no unexamined scroller.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import {
  SCROLLER_CORE_CLASS,
  SCROLL_REGION_CLASS,
  scrollFadeClass,
} from '../src/components/scrollRegion.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Raw vertical-scroller literals: the Tailwind utilities plus the camelCase inline-style key.
const BANNED = [/overflow-(?:y-)?(?:auto|scroll)/g, /overflowY/g]
// The one module allowed to say them — where the tokens are defined.
const DEFINITION = 'src/components/scrollRegion.ts'

const srcFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? srcFiles(join(dir, e.name))
      : /\.(ts|tsx|js|jsx)$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  )

const scanned = [...srcFiles(join(root, 'src')), join(root, 'index.html')]
const rel = (file) => relative(root, file).replace(/\\/g, '/')

const violations = scanned.flatMap((file) =>
  rel(file) === DEFINITION
    ? []
    : readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          BANNED.flatMap((re) => [...line.matchAll(re)]).map(
            (m) => `${rel(file)}:${i + 1} — ${m[0]} (build scrollers from components/scrollRegion)`,
          ),
        ),
)

// Every scroll region must ALSO keep its fades: a className line that takes a shared scroll
// token without calling scrollFadeClass is the half-adopted drift this guard exists to stop.
const tokenLines = scanned.flatMap((file) =>
  rel(file) === DEFINITION
    ? []
    : readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          /className/.test(line) && /SCROLL_REGION_CLASS|SCROLLER_CORE_CLASS/.test(line)
            ? [{ site: `${rel(file)}:${i + 1}`, line }]
            : [],
        ),
)

describe('scroll-region guard (round 7) — every scroll region comes from components/scrollRegion', () => {
  it('scans the real tree (main.tsx and LookupCard.tsx both present — the guard cannot go blind)', () => {
    const names = scanned.map(rel)
    expect(names).toContain('src/main.tsx')
    expect(names).toContain('src/components/LookupCard.tsx')
    expect(names).toContain(DEFINITION)
    expect(names.length).toBeGreaterThan(10)
  })

  it('finds zero raw vertical-scroller literals outside the definition module', () => {
    expect(violations).toEqual([])
  })

  it('the shared tokens ARE the settings recipe: the core plus the px-4 scrollbar lane', () => {
    expect(SCROLLER_CORE_CLASS).toBe('overflow-y-auto overscroll-contain')
    expect(SCROLL_REGION_CLASS).toBe('overflow-y-auto overscroll-contain px-4')
  })

  it('scrollFadeClass covers all four edge states, leading-space idiom included', () => {
    expect(scrollFadeClass(false, true)).toBe('')
    expect(scrollFadeClass(true, true)).toBe(' fade-scroll-top')
    expect(scrollFadeClass(false, false)).toBe(' fade-scroll-bottom')
    expect(scrollFadeClass(true, false)).toBe(' fade-scroll-both')
  })

  it('the tokens are adopted (settings, changelog, lookup, and the app scroller) and every token site keeps its fades', () => {
    const unfaded = tokenLines.filter(({ line }) => !line.includes('scrollFadeClass'))
    expect(unfaded.map(({ site }) => site)).toEqual([])
    expect(
      tokenLines.filter(({ line }) => line.includes('SCROLL_REGION_CLASS')).length,
    ).toBeGreaterThanOrEqual(3)
    expect(
      tokenLines.filter(({ line }) => line.includes('SCROLLER_CORE_CLASS')).length,
    ).toBeGreaterThanOrEqual(1)
  })
})
