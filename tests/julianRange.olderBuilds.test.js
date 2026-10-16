// @vitest-environment jsdom
//
// julianRange.olderBuilds — WHAT THE OLDER BUILDS ON THIS ORIGIN DO TO THE JULIAN-ON YEAR RANGE, and
// what this build then makes of what they left.
//
// Round 26 (Q7) keeps the range used while the Julian Calendar setting is on in a per-preset key no
// older build knows (store/julianRange), and in a saved-defaults snapshot as two extra settings keys.
// ★ RUN, NOT READ: tests/fixtures/olderBuilds/julianRange-<build>.json is what the real store code of
// each build (v2.26.0, the last with settings version 3; v2.28.0; v2.29.0, the live site; v2.29.4 at
// e3e1806, the test site) did when julianRangeDrive.dom.test.jsx.txt drove it over storage in this
// build's shapes — one case per row of the design's interleaving table.
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { usePresets, makePresetRegistryDefaults } from '../src/store/presets.js'
import { sweepDeletedPresetLeftovers } from '../src/store/presetControl.js'
import { useSettings } from '../src/store/settings.js'
import { useUserDefaults, effectiveJulianRangeDefaults } from '../src/store/userDefaults.js'
import { useJulianRange } from '../src/store/julianRange.js'

const BUILDS = ['v2.26.0', 'v2.28.0', 'v2.29.0', 'v2.29.4']
const recorded = (build) =>
  JSON.parse(
    readFileSync(resolve(__dirname, `fixtures/olderBuilds/julianRange-${build}.json`), 'utf8'),
  )
const JR = 'cg-julianrange-v1'
const pairOf = (after, key = JR) => after[key]?.state ?? null
// This build opening what the older build left: the storage exactly as it was, then a page load.
async function openHere(after) {
  localStorage.clear()
  for (const [k, v] of Object.entries(after)) localStorage.setItem(k, JSON.stringify(v))
  for (const s of [usePresets, useSettings, useJulianRange, useUserDefaults])
    await s.persist.rehydrate()
}
const pair = () => [useJulianRange.getState().julianMinY, useJulianRange.getState().julianMaxY]
beforeEach(() => {
  localStorage.clear()
  usePresets.setState(makePresetRegistryDefaults())
})

describe.each(BUILDS)('%s', (build) => {
  const rec = recorded(build)
  it('was recorded from that build', () => expect(rec.build).toBe(build))

  it('row 1: a theme change and Reset Settings there leave the Julian-on pair 1-10000 as it was — and this build opens on it', async () => {
    expect(pairOf(rec.row1.after)).toEqual({ julianMinY: 1, julianMaxY: 10000 })
    expect(rec.row1.after['cg-settings-v1'].state.manualTheme).toBe('dusk') // the reset did run
    await openHere(rec.row1.after)
    expect(pair()).toEqual([1, 10000])
  })
  it('row 2: the range that build edits with Julian on is the Julian-OFF pair; the Julian-on pair is untouched', async () => {
    const s = rec.row2.after['cg-settings-v1'].state
    expect([s.minY, s.maxY, s.useJulian]).toEqual([1500, 1700, true])
    expect(pairOf(rec.row2.after)).toEqual({ julianMinY: 1, julianMaxY: 11582 })
    await openHere(rec.row2.after)
    expect(pair()).toEqual([1, 11582])
    expect([useSettings.getState().minY, useSettings.getState().maxY]).toEqual([1500, 1700])
  })
  it('row 4: merely opening it rewrites nothing of the pair (v2.26.0 re-saves its settings at once, under version 3)', () => {
    expect(pairOf(rec.row4.after)).toEqual({ julianMinY: 5, julianMaxY: 11000 })
    expect(rec.row4.after['cg-settings-v1'].version).toBe(build === 'v2.26.0' ? 3 : 4)
  })
  it('row 5: its preset delete leaves the pair behind, and this build’s cold-open sweep takes it', async () => {
    expect(rec.row5.extra).toEqual({ deleted: true })
    expect(pairOf(rec.row5.after, `${JR}~p2`)).toEqual({ julianMinY: 1900, julianMaxY: 2100 })
    await openHere(rec.row5.after)
    sweepDeletedPresetLeftovers()
    expect(localStorage.getItem(`${JR}~p2`)).toBe(null)
  })
  it('row 6: it calls a preset whose only change is its Julian-on pair untouched (deletes it without asking) — accepted, the staging window only', () => {
    expect(rec.row6.extra).toEqual({ factory: true })
  })
  it('row 8: its defaults manager passes the snapshot’s pair through', () => {
    const saved = rec.row8.after['cg-userdefaults-v1'].state.saved
    expect(saved.prefs.flashMs).toBe(900) // the edit was saved
    expect(effectiveJulianRangeDefaults(saved)).toEqual({ julianMinY: 2, julianMaxY: 11000 })
  })
  it('row 9: its Save Defaults saves the 16 — the pair is then derived from that snapshot’s own range', () => {
    const saved = rec.row9.after['cg-userdefaults-v1'].state.saved
    expect('julianMinY' in saved.settings).toBe(false)
    expect(effectiveJulianRangeDefaults(saved)).toEqual({ julianMinY: 1500, julianMaxY: 1600 })
  })
})
