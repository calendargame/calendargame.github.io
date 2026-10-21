// amnesic.olderBuilds — WHAT THE OLDER BUILDS ON THIS ORIGIN MAKE OF THE AMNESIC SETTING AS THIS BUILD
// SAVES IT, AND WHAT THIS BUILD MAKES OF WHAT THEY LEAVE.
//
// Every build on an origin shares its saved data (a tab or the installed app left open across an
// update), so v2.27.3 and v2.26.0 read and write the same saved defaults and the same preset registry this build does. To them Amnesic is a boolean: a switch kept
// on each preset in the registry, put back to `saved.amnesic` at a fresh open. This build made the
// setting three-way and keeps the value in force in each preset's settings (store/settings; design
// 9) — a field those builds never read, and drop on their own save — and every claim it makes about
// staying safe beside those builds rests on what THEY do.
// ★ THAT WAS RUN, NOT READ. tests/fixtures/olderBuilds/amnesic-v2.27.3.json and amnesic-v2.26.0.json
// are what the real app at each tag (fcdcf56, ff506f8) did when amnesicDrive.dom.test.jsx.txt drove
// it over storage in this build's shapes: where one answered question went, what its registry and
// its saved defaults held afterwards. This file holds this build's reader, and its decisions, to
// those records.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { readAmnesicMode, storedAmnesic } from '../src/store/amnesicMode.js'

const recorded = (build) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/olderBuilds/amnesic-${build}.json`, import.meta.url), 'utf8'),
  )

// The device the driver starts each step from holds 3 saved Classic answers; it then answers one.
const SAVED = 3

describe.each(['v2.27.3', 'v2.26.0'])('%s, as the real build behaved', (build) => {
  const seen = recorded(build)

  // ★ THE DECISION THIS RECORD SETTLED: how the three-way value is SPELLED where it is saved. The
  // older build acts on `saved.amnesic` and reads anything but `true` there as "not amnesic".
  describe('a saved default, at the older build’s fresh open', () => {
    for (const mode of ['off', 'stats', 'full'])
      it(`${mode}, in this build's spelling: ${mode === 'off' ? 'it records' : 'it is amnesic — the guest is NOT recorded'}`, () => {
        const s = seen[`freshOpen:${mode}`]
        // This build's spelling is what the driver put on the device.
        expect([s.savedAfter.amnesic, s.savedAfter.amnesicMode]).toEqual([
          storedAmnesic(mode).amnesic,
          storedAmnesic(mode).amnesicMode,
        ])
        expect(s.flag).toBe(mode !== 'off')
        if (mode === 'off') expect([s.permanentPlayed, s.sessionPlayed]).toEqual([SAVED + 1, null])
        // Stats Only reads as a plain amnesic preset there — it keeps nothing, the safe direction.
        else expect([s.permanentPlayed, s.sessionPlayed]).toEqual([SAVED, 1])
        // …and merely loading the snapshot did not disturb this build's value.
        expect(readAmnesicMode(s.savedAfter)).toBe(mode)
      })

    // ⚠ THE SPELLING THIS BUILD DID NOT USE, and why: the three-way value put in the boolean's own
    // field. The older build finds a string where it wants `true`, treats the preset as permanent,
    // and writes a guest's answer into the saved stats — for a preset SAVED as a guest preset.
    for (const mode of ['stats', 'full'])
      it(`${mode} as a string in the boolean's field would have been recorded permanently`, () => {
        const s = seen[`freshOpen:stringField:${mode}`]
        expect(s.flag).not.toBe(true)
        expect([s.permanentPlayed, s.sessionPlayed]).toEqual([SAVED + 1, null])
      })
  })

  describe('what the older build leaves in the saved defaults, as this build reads it', () => {
    it('its own Save Defaults over a Stats Only snapshot drops the kind and keeps "amnesic": read as Full', () => {
      const { loaded, saved } = seen.saveDefaultsOverStatsOnly
      expect(readAmnesicMode(loaded)).toBe('stats')
      expect(saved).not.toHaveProperty('amnesicMode')
      expect(saved.amnesic).toBe(true)
      expect(readAmnesicMode(saved)).toBe('full') // never Off
    })

    it('its load of an older-version snapshot carrying this build’s value leaves the value there', () => {
      expect(readAmnesicMode(seen.migratedV2.state.saved)).toBe('stats')
    })
  })

  describe('the registry flag', () => {
    // A guest is playing in the older build: its flag is true, and its play is in a session copy of its
    // own, never in the saved stats. ⚠ THIS BUILD CARRIES THE FLAG AND READS NEITHER IT NOR THAT COPY
    // (design-amnesic-close.md 3 and 7): an older guest session that updates into this build lands on the
    // preset's own value, and the session copy's numbers - which that build never saved - are not shown.
    it('a guest session in the older build: its flag is true, and its play is in its own session copy', () => {
      const s = seen.guestSession
      expect([s.permanentPlayed, s.sessionPlayed]).toEqual([SAVED, 1])
      const preset = s.registry.presets.find((p) => p.id === s.registry.activeId)
      expect(preset.amnesic).toBe(true)
      expect(s.sessionKeys).toContain('cg-progress-v1')
    })

    // This build never changes the flag, so one can be left TRUE on the device long after the
    // session that set it. At its own fresh open the older build puts every flag back to the saved
    // default, so the stale one does no harm there.
    it('a stale true flag is put back at the older build’s fresh open', () => {
      const s = seen.staleFlag.freshOpen
      expect(s.flag).toBe(false)
      expect(s.permanentPlayed).toBe(SAVED + 1)
    })

    it('the registry it writes carries every preset’s flag as a boolean', () => {
      for (const preset of seen.createdPreset.presets) expect(typeof preset.amnesic).toBe('boolean')
    })
  })

  // ⚠⚠ THE ONE SEQUENCE LEFT OPEN, pinned so it is never mistaken for covered: a preset is put on
  // Full (or Stats Only) in THIS build — a field of its settings, the registry flag untouched — and the
  // OLDER build is then loaded in the same tab. The older build knows nothing of this build's value,
  // in this tab or any other, and records.
  it('⚠ this build’s value is invisible to the older build loaded in the same tab', () => {
    const s = seen.sameTabAfterThisBuild
    expect(s.flag).toBe(false)
    expect(s.permanentPlayed).toBe(SAVED + 1) // recorded — the unsafe direction, and known
  })
})

// A stale flag met by a RELOAD of the older build (its session already open) is the one place the
// two builds differ, and both answers are safe in their own way.
describe('a stale true flag at a reload of the older build', () => {
  it('v2.27.3 keeps the session’s flag: amnesic, nothing recorded permanently', () => {
    const s = recorded('v2.27.3').staleFlag.reload
    expect([s.flag, s.sessionPlayed]).toEqual([true, 1])
  })
  it('v2.26.0 treats every load as a fresh open and puts the flag back', () => {
    expect(recorded('v2.26.0').staleFlag.reload.flag).toBe(false)
  })
})

// ★ THE AMNESIC ANCHOR IN AN OLDER BUILD'S HANDS (design-amnesic-close.md 1, "WHERE IT LIVES"). This build
// writes a mode's anchor as one more field of its silo in the doc (`a`, store/progressDoc) - and the four
// older builds on this origin were RUN over a silo carrying an unknown field (syncedDoc.olderBuilds' F-A:
// `zz`, beside the door's tag): every one of them carries it through each answer and an Override at any
// depth, and drops it - with the counts it described - on its own Reset. So an older tab's answers keep
// the anchor of the version they were played on (the forget then puts that mode back, or leaves the older
// tab's cards on the far side of it - the residuals R16-R19), and its Reset drops the anchor with the
// content, as this build's own Reset does: after a Reset there is nothing older left to forget.
describe.each(['v2.26.0', 'v2.27.3', 'v2.28.0', 'v2.29.0'])(
  '%s carries a silo field it does not know, as the anchor needs',
  (build) => {
    const seen = JSON.parse(
      readFileSync(new URL(`./fixtures/olderBuilds/sync-${build}.json`, import.meta.url), 'utf8'),
    )
    const classic = (writes) =>
      writes
        .filter((w) => w.op === 'set' && w.key === 'cg-progress-v1')
        .map((w) => w.value.state.stats.classic)
    it('through every answer and an Override at any depth', () => {
      const written = [
        ...classic(seen.answers),
        ...classic(seen.overrideAtDepth),
        ...classic(seen.overrideBack),
      ]
      expect(written.length).toBeGreaterThan(3)
      for (const silo of written) expect(silo.zz).toBe(1)
    })
    it('and not through its own Reset: the field goes with the counts', () => {
      const [after] = classic(seen.reset)
      expect('zz' in after).toBe(false)
    })
  },
)
