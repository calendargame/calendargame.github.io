// syncedDoc.olderBuilds — WHAT THE OLDER BUILDS ON THIS ORIGIN DO TO SAVED DATA AS THE WINDOWS-IN-SYNC
// BUILD LEAVES IT (design-q1-q2.md v4, sections 1 and 18.1, 18.5, 18.9: the facts the merge rests on).
//
// ★ RUN, NOT READ. tests/fixtures/olderBuilds/sync-<build>.json is every write the real app at each
// build (v2.26.0, v2.27.3, v2.28.0 389ebd1, v2.29.0 a54b9f1 — `git archive` copies, `npm ci`, never a
// junction) made to the six saved docs while tests/fixtures/olderBuilds/syncDrive.dom.test.jsx.txt
// drove it over docs carrying this build's sync data: a top-level `sync` envelope, a tag `w` and an
// unknown field `zz` inside the Classic silo and inside two Blitz Best records, Q21's `amnesic` field in
// the settings, an unknown field in the mode prefs, the registry, a preset, a Lookup entry, and a tag
// inside the saved defaults.
// ⚠ ONE FACT THE DESIGN STATED IS FALSE FOR ONE BUILD, and this file is where it was found: v2.26.0
// builds a changed Best record as a SPREAD of the one it held, so the record keeps every unknown field
// — the tag included — while its values change (F-B says "a fresh literal"). round26/part2-issues.md
// #1 says what the door does about it (a tag that names the values it was written with).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const BUILDS = ['v2.26.0', 'v2.27.3', 'v2.28.0', 'v2.29.0']
const recorded = (build) =>
  JSON.parse(readFileSync(resolve(__dirname, `fixtures/olderBuilds/sync-${build}.json`), 'utf8'))
const PROGRESS = 'cg-progress-v1'
const KEY = 'm60|numeric-ymd|random|random|random|1583-10000|true'
const OTHER = 'm30|numeric-ymd|random|random|random|1583-10000|true'
const sets = (writes, key) =>
  writes.filter((w) => w.op === 'set' && w.key === key).map((w) => w.value)
const classicOf = (value) => value.state.stats.classic

describe.each(BUILDS)('%s, as the real build behaved', (build) => {
  const seen = recorded(build)

  it('F-D: it rewrites the progress doc as it boots — and every whole-copy save drops the envelope', () => {
    const boot = sets(seen.boot, PROGRESS)
    expect(boot.length).toBeGreaterThan(0)
    for (const v of boot) expect('sync' in v).toBe(false)
  })

  it('F-A: a silo keeps its tag (and any unknown field) through every answer and an Override at any depth', () => {
    const answers = sets(seen.answers, PROGRESS).map(classicOf)
    expect(answers.map((c) => [c.played, c.good, c.streak])).toEqual([
      [11, 9, 3],
      [12, 10, 4],
      [13, 10, 0],
    ])
    for (const c of answers) expect([c.w, c.zz]).toEqual(['TAG-c', 1])
    // Two cards back (a right answer) Overridden, then Undone: the credit moves, the tag stays.
    const [down] = sets(seen.overrideAtDepth, PROGRESS).map(classicOf)
    const [up] = sets(seen.overrideBack, PROGRESS).map(classicOf)
    expect([down.played, down.good, down.w, down.zz]).toEqual([13, 9, 'TAG-c', 1])
    expect([up.played, up.good, up.w, up.zz]).toEqual([13, 10, 'TAG-c', 1])
  })

  it('F-A: a Reset writes the silo as a literal — the tag and the unknown field are gone, other silos untouched', () => {
    const [after] = sets(seen.reset, PROGRESS)
    expect(classicOf(after)).toEqual({ played: 0, good: 0, streak: 0, best: 0, times: [] })
    expect(after.state.stats.flash.w).toBe('TAG-f')
  })

  it('F-B: a Best record a round does not beat is saved as it was parsed — tag and all', () => {
    const [v] = sets(seen.roundBelow, PROGRESS)
    expect(v.state.blitzBest[KEY]).toMatchObject({ score: 5, streak: 4, w: 1, zz: 1 })
  })

  it('F-B: a record a round beats is a fresh literal — EXCEPT in v2.26.0, which spreads the old one (tag kept)', () => {
    const [v] = sets(seen.roundBeats, PROGRESS)
    const rec = v.state.blitzBest[KEY]
    expect([rec.score, rec.streak]).toEqual([7, 7])
    if (build === 'v2.26.0') expect([rec.w, rec.zz]).toEqual([1, 1])
    else expect([rec.w, rec.zz]).toEqual([undefined, undefined])
    // The record it did not touch keeps its object.
    expect(v.state.blitzBest[OTHER]).toMatchObject({ w: 1, zz: 1 })
  })

  it('F-B (v2.28.0+): writeKept keeps the device envelope, and writes every record the page changed as a fresh literal', () => {
    if (!seen.threeWay) return
    const [beats] = sets(seen.keptBeats, PROGRESS)
    expect('sync' in beats).toBe(true)
    expect(beats.state.blitzBest[KEY].w).toBeUndefined()
    expect(beats.state.blitzBest[OTHER]).toMatchObject({ w: 1 })
    // A later save that changes nothing of that record still writes it again as a literal (V2-F9).
    const [below] = sets(seen.keptBelow, PROGRESS)
    expect('sync' in below).toBe(true)
    expect(below.state.blitzBest[KEY]).toMatchObject({ score: 7, streak: 7 })
    expect(below.state.blitzBest[KEY].w).toBeUndefined()
  })

  it('F-E (v2.28.0+): a Full Reset under a Stats Only saved default REMOVES the doc (here with no middle write)', () => {
    if (!seen.threeWay) return
    const progress = seen.fullResetKept.filter((w) => w.key === PROGRESS)
    expect(progress).toEqual([{ op: 'remove', key: PROGRESS }])
  })

  it('F-C, 18.9: every build drops an unknown settings field — Q21’s Amnesic included — and the envelope', () => {
    const [settings] = sets(seen.settingsSet, 'cg-settings-v1')
    expect(settings.state.saveStats).toBe(false)
    expect(['amnesic' in settings.state, 'zz' in settings.state, 'sync' in settings]).toEqual([
      false,
      false,
      false,
    ])
    const [prefs] = sets(seen.prefsSet, 'cg-modeprefs-v1')
    expect(prefs.state.flashMs).toBe(1000)
    expect(['zz' in prefs.state, 'sync' in prefs]).toEqual([false, false])
  })

  it('F-C: the registry and the Lookup history are rebuilt field by field — nothing rides inside them', () => {
    for (const v of [
      ...sets(seen.rename, 'cg-presets-v1'),
      ...sets(seen.create, 'cg-presets-v1'),
    ]) {
      expect('sync' in v).toBe(false)
      expect('zz' in v.state).toBe(false)
      for (const p of v.state.presets) expect('zz' in p).toBe(false)
    }
    const [lookup] = sets(seen.lookup, 'cg-lookup-v1')
    expect('sync' in lookup).toBe(false)
    expect(lookup.state.history.map((e) => e.id)).toEqual(['b', 'a'])
    for (const e of lookup.state.history) expect('zz' in e).toBe(false)
  })

  it('F-C: Save Defaults rebuilds the snapshot — the tag inside it goes, and the envelope', () => {
    const [v] = sets(seen.saveDefaults, 'cg-userdefaults-v1')
    expect('sync' in v).toBe(false)
    expect('w' in v.state.saved).toBe(false)
  })
})
