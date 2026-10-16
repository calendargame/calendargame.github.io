// tests/bestPoolGuard.test.js — EVERY READ OF A MoX OR BLITZ BEST RECORD IN src/ IS ONE THIS LIST NAMES.
//
// The Best shown for a set-up is the best over a POOL of records (engine/bestPool): the set-up's own
// record under its in-effect key, plus every record filed for the same dates under stored values
// before Round 26. So a set-up's own record, `map[key]`, can be LOWER than its Best — and any code that
// reads it as "the Best" is wrong (it would show, sync, withdraw, or compare the wrong number). The
// display reads go through engine/bestPool's door; the only direct reads allowed are the FLOORS — the
// record a round or run rebuilds its own record from when it writes — which must be the key's own
// record, never the pool's (a legacy record is never written, so it can never be a floor).
// A new direct read fails here until it is added below with the reason it is not a display.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = join(__dirname, '..', 'src')
const files = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : []
  })
const MAPS = '(?:bests|aoxBest|blitzBest|suddenBest|suddenAmBest)'
const INDEXED = new RegExp(`\\b${MAPS}\\[`)
const SUBSCRIBED = new RegExp(`useProgress\\(\\(s\\) => s\\.${MAPS}\\)`)

// file → the trimmed source lines allowed to index a Best map, each a floor (a write path).
const FLOORS = {
  'modes/AoxMode.tsx': [
    // the reconcile's floor: the run's own key's record as it stands, less this run
    'const floor = aoxBestWithoutRun(preRunBestRef.current, saved.aoxBest[run.bestKey], runId)',
    // Begin's snapshot of the record the run will rebuild from
    'preRunBestRef.current = bests[bestKey] // the floor its Best is rebuilt from',
  ],
  'modes/BlitzMode.tsx': [
    // roundFloor: the round's own keys' records as they stand, less this round
    'blitz: blitzBestWithoutRound(snap.blitz, saved.blitzBest[snap.blitzBk], roundId),',
    'suddenAm: blitzBestWithoutRound(snap.suddenAm, saved.suddenAmBest[snap.suddenBk], roundId),',
    'sudden: suddenBestWithoutRound(snap.sudden, saved.suddenBest[snap.suddenBk], roundId),',
    // Begin's snapshot of the records the round will rebuild from
    'blitz: blitzBest[blitzBk],',
    'sudden: suddenBest[suddenBk],',
    'suddenAm: suddenAmBest[suddenBk],',
  ],
}

const sources = files(SRC).map((p) => ({
  file: relative(SRC, p).replace(/\\/g, '/'),
  lines: readFileSync(p, 'utf8').split('\n'),
}))
const code = (line) => !/^\s*(\/\/|\*|\{\/\*)/.test(line)

describe('Best records are read for display only through engine/bestPool', () => {
  it('every direct read of a Best map is a named floor', () => {
    const found = {}
    for (const { file, lines } of sources)
      for (const line of lines)
        if (code(line) && INDEXED.test(line)) (found[file] ??= []).push(line.trim())
    expect(found).toEqual(FLOORS)
  })
  it('only the two run screens subscribe to the Best maps, and both show them through the door', () => {
    const subscribers = sources
      .filter(({ lines }) => lines.some((l) => code(l) && SUBSCRIBED.test(l)))
      .map((s) => s.file)
    expect(subscribers.sort()).toEqual(['modes/AoxMode.tsx', 'modes/BlitzMode.tsx'])
    const text = (f) => sources.find((s) => s.file === f).lines.join('\n')
    expect(text('modes/AoxMode.tsx')).toContain('shownAoxBest(bests, bestKey)')
    for (const call of [
      'shownBlitzBest(blitzBest, blitzBk)',
      'shownSuddenBest(suddenBest, suddenBk)',
      'shownBlitzBest(suddenAmBest, suddenBk)',
    ])
      expect(text('modes/BlitzMode.tsx')).toContain(call)
  })
})
