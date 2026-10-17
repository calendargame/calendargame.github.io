// tests/bestPoolGuard.test.js — EVERY READ OF A MoX OR BLITZ BEST RECORD IN src/ IS ONE THIS LIST NAMES.
//
// The Best shown for a set-up is the best over a POOL of records (engine/bestPool): the set-up's own
// record under its in-effect key, plus every record filed for the same dates under stored values
// before Round 26. So a set-up's own record, `map[key]`, can be LOWER than its Best — and any code that
// reads it as "the Best" is wrong (it would show, sync, withdraw, or compare the wrong number). The
// display reads go through engine/bestPool's door, and nothing else in src/ reads a record by its key: a
// round's result is filed as the round's own figures, never rebuilt from a record. A new direct read
// fails here until it is added below with the reason it is not a display.
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

// file → the trimmed source lines allowed to index a Best map. NONE now: a round or run files its own
// figures on its record (store/screenPool's fileRoundResult) and reads no record to do it - the floors
// these lines once named are gone with the reconciles that rebuilt a record from them.
const FLOORS = {}

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
