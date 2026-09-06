// @vitest-environment jsdom
//
// THE PERSISTENCE BEHAVIOUR NET — what the app promises to REMEMBER, pinned before settings presets
// move where any of it is kept.
//
// WHY IT EXISTS. Presets turn one saved copy of the app's data into several independent ones, which
// is a change to WHERE every store reads and writes. Rule 10 says a restructure of live logic goes
// behind tests written FIRST against the current app as a black box, and the gate on this one is
// falsifiable: THE NET PASSES THE CHANGE WITH ZERO EDITS TO ANY CASE. Rounds 13 and 14 established
// that the only way to earn that is an indirection — the net asks a helper "where does this store
// read and write" and never answers for itself. That helper is tests/helpers/persistence.js, and it
// works the answer out by OBSERVATION rather than by holding a copy of the key constants, which is
// what makes it survive whatever namespacing scheme the preset work picks.
//
// ⚠ NOT ONE CASE IN THIS FILE NAMES A localStorage KEY. That is the rule, not a style preference:
// the key is the implementation detail about to change, and a case pinning it would break on the
// change while teaching the next reader that the key IS the contract. The contract is the player's:
// what you saved is there when you come back, an older save still opens, storage that refuses does
// not cost you the app, and each of the three resets clears exactly what it says and nothing else.
//
// ⚠ WHAT IS DELIBERATELY NOT HERE. The build stamp, the two update-dot flags, the changelog
// seen-signature and the two sessionStorage flags are all persisted, and none of them is a player's
// saved data — they describe the CODE THAT RAN or this device's current session. They stay GLOBAL
// across presets (a preset switch must not make the update dot reappear), so they are not the
// subject of this net; tests/buildStamp.dom and tests/changelog.dom already own them and must keep
// passing unchanged through the preset work, which is itself the assertion that they stayed global.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cleanup, screen, act } from '@testing-library/react'
import {
  LIVE_STORES,
  storageKeys,
  readSavedState,
  seedSaved,
  seedSavedRaw,
  clearSaved,
  reopenApp,
  blockStorage,
} from './helpers/persistence.js'
import {
  resetAppState,
  mountApp,
  openSettings,
  closeSettings,
  footerButton,
  fullResetButton,
  panelValues,
  tap,
} from './helpers/settingsPanel.jsx'
import { statValue } from './helpers/modeScreen.jsx'

const { settings, modePrefs, progress, userDefaults } = LIVE_STORES

// A played-in Classic record, in the shape the engine hands the store. Five questions, three right,
// on a two-in-a-row streak — chosen so every field is distinguishable from a blank one.
const PLAYED = { played: 5, good: 3, streak: 2, best: 2, times: [1200, 900, 1500] }
// An AoX record, and a Blitz one, under the key shapes the modes compose today.
const AOX_KEY = '10|false|numeric-ymd|random|random|random|1583-10000|true'
const AOX_REC = { avg: 1.5, avgMed: 1.4, avgRoundId: 1, med: 1.4, medAvg: 1.5, medRoundId: 1 }
const LOOKUP = [{ id: 'a', y: 1776, m: 7, d: 4 }]

// Seed a device that has been PLAYED ON — through the stores' own setters, because a payload the
// app never wrote is not evidence about what the app saves.
function seedAPlayedDevice() {
  const p = progress.getState()
  p.setModeStats('classic', PLAYED)
  p.setModeStats('flash', { ...PLAYED, played: 9, good: 7 })
  p.setAoxBest({ [AOX_KEY]: AOX_REC })
  p.setLookupHistory(LOOKUP)
}

afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('where the saved data lives', () => {
  beforeEach(() => resetAppState())

  // THE PRECONDITION FOR EVERY OTHER CASE IN THIS FILE, and the helper's own self-test: the
  // resolution is by observation, so if it ever resolved two stores to one place — or resolved
  // nothing — the cases below would quietly assert about the wrong bytes. It is also the shape of
  // the preset requirement: four independent places, so a preset switch has to move ALL FOUR or it
  // leaves one kind of data shared between presets.
  it('the four kinds of saved data are four independent places', () => {
    const keys = storageKeys()
    expect(Object.keys(keys).sort()).toEqual(['modePrefs', 'progress', 'settings', 'userDefaults'])
    expect(new Set(Object.values(keys)).size).toBe(4)
  })

  // …and they are independent in the direction that matters: losing one does not disturb another.
  // The preset work will delete a whole preset behind a confirm, which is exactly this operation
  // repeated four times, so "clearing one leaves the rest" is a promise it inherits.
  it('clearing one kind of saved data leaves the other three', async () => {
    settings.getState().setMinY(1583)
    modePrefs.getState().setBlitzSec(45)
    seedAPlayedDevice()
    clearSaved(progress)
    const fresh = await reopenApp()
    expect(fresh.progress.getState().stats.classic.played).toBe(0)
    expect(fresh.settings.getState().minY).toBe(1583)
    expect(fresh.modePrefs.getState().blitzSec).toBe(45)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// WHAT YOU SAVED IS THERE WHEN YOU COME BACK.
//
// ⚠ EACH CASE COMES BACK THROUGH reopenApp(), NOT through a rehydrate of the live store. The live
// store already holds the value in memory, so a merge that quietly ignored storage would still pass
// — the case would be proving nothing. reopenApp drops the module registry and builds the stores
// again from whatever is on disk, so the store doing the answering has never seen the value before.
describe('what you saved is there when you come back', () => {
  beforeEach(() => resetAppState())

  it('a settings change — the theme included, which presets make per-preset too', async () => {
    const s = settings.getState()
    s.setDateFormat('numeric-dmy')
    s.setMinY(1583)
    s.setMaxY(1999)
    s.setUseSystem(false)
    s.setManualTheme('nebula')
    s.setSaveStats(false)
    const fresh = await reopenApp()
    const back = fresh.settings.getState()
    expect(back.dateFormat).toBe('numeric-dmy')
    expect(back.minY).toBe(1583)
    expect(back.maxY).toBe(1999)
    expect(back.useSystem).toBe(false)
    expect(back.manualTheme).toBe('nebula')
    expect(back.saveStats).toBe(false)
  })

  it('a mode-screen setup change', async () => {
    const p = modePrefs.getState()
    p.setBlitzSec(45)
    p.setBlitzPerQ(true)
    p.setAoxN('25')
    p.setDedType('year')
    p.setClassicTimingOff(false)
    const fresh = await reopenApp()
    const back = fresh.modePrefs.getState()
    expect(back.blitzSec).toBe(45)
    expect(back.blitzPerQ).toBe(true)
    expect(back.aoxN).toBe('25')
    expect(back.dedType).toBe('year')
    expect(back.classicTimingOff).toBe(false)
  })

  it('lifetime stats, an all-time best, and the Lookup history', async () => {
    seedAPlayedDevice()
    const fresh = await reopenApp()
    const back = fresh.progress.getState()
    expect(back.stats.classic).toEqual(PLAYED)
    expect(back.stats.flash.played).toBe(9)
    expect(back.aoxBest[AOX_KEY]).toEqual(AOX_REC)
    expect(back.lookupHistory).toEqual(LOOKUP)
  })

  it('the saved personal defaults', async () => {
    userDefaults.getState().saveDefaults({
      settings: { ...settings.getState(), minY: 1600, leapChance: '75' },
      prefs: { flashMs: 800, blitzSec: 120, blitzQSec: 20, aoxN: '25' },
    })
    const fresh = await reopenApp()
    const back = fresh.userDefaults.getState().saved
    expect(back.settings.minY).toBe(1600)
    expect(back.settings.leapChance).toBe('75')
    expect(back.prefs).toEqual({ flashMs: 800, blitzSec: 120, blitzQSec: 20, aoxN: '25' })
  })

  // The bounded-payload promise, stated as the player meets it: a long practice history does not
  // grow the saved copy without limit, and what survives is the RECENT play the averages describe.
  it('a very long run of solve times comes back capped, keeping the most recent', async () => {
    const times = Array.from({ length: 1200 }, (_, i) => i)
    progress.getState().setModeStats('classic', { ...PLAYED, played: 1200, times })
    const fresh = await reopenApp()
    const back = fresh.progress.getState().stats.classic.times
    expect(back.length).toBeLessThan(times.length)
    expect(back[back.length - 1]).toBe(1199) // the newest solve is the one kept
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// AN OLDER SAVE STILL OPENS. The version/migrate path, asked as the player's question — "I updated
// the app; are my records still mine?" — rather than as "does migrate() run".
describe('an older save still opens', () => {
  beforeEach(() => resetAppState())

  it('an AoX record earned under an older release is still found after the upgrade', async () => {
    // The 7-segment key an older release wrote (no Julian Chance dimension), and the live setting
    // the upgrade has to read to complete it.
    settings.getState().setJulianChance('always')
    seedSaved(
      progress,
      {
        ...progress.getState(),
        aoxBest: { '10|false|numeric-ymd|random|random|1583-10000|true': AOX_REC },
      },
      1,
    )
    const fresh = await reopenApp()
    const best = fresh.progress.getState().aoxBest
    expect(Object.values(best)).toEqual([AOX_REC]) // the record survived, exactly once
    expect(Object.keys(best)[0]).toContain('always') // …completed with the live setting
  })

  it('a Lookup date saved by an older release still opens, and an impossible one is dropped', async () => {
    seedSaved(
      progress,
      {
        ...progress.getState(),
        lookupHistory: [
          // The older shape carried the RENDERED text as well; the date is what matters.
          { id: 'a', y: 1776, m: 7, d: 4, label: 'July 4, 1776', weekday: 'Thursday' },
          { id: 'bad', y: 1900, m: 2, d: 30 }, // a date that exists in no calendar
        ],
      },
      2,
    )
    const fresh = await reopenApp()
    expect(fresh.progress.getState().lookupHistory).toEqual([{ id: 'a', y: 1776, m: 7, d: 4 }])
  })

  // The screening is NOT version-gated, and that is the promise: a current-shape payload is read
  // from the same untrusted storage an old one is, so a tampered or truncated entry is refused on
  // every load rather than only on an upgrade.
  it('a junk entry in a CURRENT-shape save is refused too', async () => {
    seedSaved(
      progress,
      { ...progress.getState(), lookupHistory: [{ id: 'x' }, { id: 'a', y: 1776, m: 7, d: 4 }] },
      3,
    )
    const fresh = await reopenApp()
    expect(fresh.progress.getState().lookupHistory).toEqual([{ id: 'a', y: 1776, m: 7, d: 4 }])
  })

  // Re-opening again must not re-run the upgrade. Stated as the failure it prevents: a record
  // migrated twice would land under a key nothing looks up, and the player's best would vanish on
  // the SECOND launch after an update — the worst possible time to notice.
  it('opening a second time does not upgrade the same record twice', async () => {
    settings.getState().setJulianChance('always')
    seedSaved(
      progress,
      {
        ...progress.getState(),
        aoxBest: { '10|false|numeric-ymd|random|random|1583-10000|true': AOX_REC },
      },
      1,
    )
    const once = await reopenApp()
    const afterFirst = once.progress.getState().aoxBest
    const twice = await reopenApp()
    expect(twice.progress.getState().aoxBest).toEqual(afterFirst)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// STORAGE THAT REFUSES. Private/locked-down browsing, where touching localStorage throws outright.
// Nothing here may cost the player the app; it costs them only the remembering.
describe('storage that refuses does not cost you the app', () => {
  let restore = null
  beforeEach(() => resetAppState())
  afterEach(() => {
    if (restore) restore()
    restore = null
  })

  it('the stores come up on their launch values, and still work in memory', async () => {
    settings.getState().setMinY(1583) // something IS saved — it just cannot be read
    restore = blockStorage()
    const fresh = await reopenApp()
    expect(fresh.settings.getState().minY).toBe(1) // the launch value, not a crash
    act(() => fresh.settings.getState().setMinY(1900))
    expect(fresh.settings.getState().minY).toBe(1900) // the session still works
  })

  it('the app boots and renders', () => {
    restore = blockStorage()
    mountApp()
    // A VISIBLE piece of chrome, not the app's heading: since the top-bar rebuild that heading is
    // sr-only, so it would go on proving "it rendered" even if nothing painted (tests/topBar.dom
    // owns that distinction). The mode selector is on screen in every mode.
    expect(screen.getByRole('button', { name: 'Mode' })).toBeInTheDocument()
  })

  // A payload that is not JSON at all — truncation, tampering, a write cut short by a full disk.
  it('a corrupt saved copy leaves the app on its launch values rather than broken', async () => {
    seedSavedRaw(progress, '{"state":{"stats":{"classic"')
    const fresh = await reopenApp()
    expect(fresh.progress.getState().stats.classic.played).toBe(0)
    expect(fresh.progress.getState().lookupHistory).toEqual([])
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE THREE RESETS, EACH CLEARING EXACTLY WHAT IT CLEARS.
//
// Driven through the real UI, and judged twice: once on screen, and once after coming back, because
// a reset that only emptied memory would look identical on screen and undo itself on the next
// launch. The second half is the one presets can break — a reset that clears the WRONG preset's
// saved copy passes every on-screen assertion.
describe('the three resets clear exactly what they clear', () => {
  beforeEach(() => resetAppState())

  it('Reset Settings restores the panel and leaves your stats, bests and history alone', async () => {
    seedAPlayedDevice()
    mountApp()
    openSettings()
    const launchValues = panelValues()
    act(() => {
      const s = settings.getState()
      s.setDateFormat('numeric-dmy')
      s.setLeapChance('75')
      s.setSaveStats(false)
    })
    expect(panelValues()).not.toEqual(launchValues)
    tap(footerButton('Reset Settings'))
    expect(panelValues()).toEqual(launchValues)
    // The play is untouched — on screen…
    closeSettings()
    expect(statValue('Score')).toBe('3/5')
    // …and in what was saved.
    const fresh = await reopenApp()
    expect(fresh.progress.getState().stats.classic).toEqual(PLAYED)
    expect(fresh.progress.getState().aoxBest[AOX_KEY]).toEqual(AOX_REC)
    expect(fresh.progress.getState().lookupHistory).toEqual(LOOKUP)
  })

  it('Reset Settings leaves the mode setup it does not cover', async () => {
    modePrefs.getState().setBlitzPerQ(true) // not one of the four the panel captures
    modePrefs.getState().setDedType('year')
    modePrefs.getState().setBlitzSec(45) // …and one that IS
    mountApp()
    openSettings()
    tap(footerButton('Reset Settings'))
    const fresh = await reopenApp()
    expect(fresh.modePrefs.getState().blitzPerQ).toBe(true)
    expect(fresh.modePrefs.getState().dedType).toBe('year')
    expect(fresh.modePrefs.getState().blitzSec).toBe(60)
  })

  it('Full Reset wipes the play as well, and the wipe survives coming back', async () => {
    seedAPlayedDevice()
    modePrefs.getState().setBlitzPerQ(true)
    mountApp()
    openSettings()
    const launchValues = panelValues()
    act(() => {
      settings.getState().setDateFormat('numeric-dmy')
      settings.getState().setLeapChance('75')
    })
    expect(panelValues()).not.toEqual(launchValues)
    tap(fullResetButton()) // first tap arms
    tap(fullResetButton()) // second confirms
    openSettings() // Full Reset closes the panel; come back to read it
    expect(panelValues()).toEqual(launchValues)
    closeSettings()
    expect(statValue('Score')).toBe('0/0')
    const fresh = await reopenApp()
    const back = fresh.progress.getState()
    expect(back.stats.classic.played).toBe(0)
    expect(back.stats.flash.played).toBe(0)
    expect(back.aoxBest).toEqual({})
    expect(back.lookupHistory).toEqual([])
    expect(fresh.modePrefs.getState().blitzPerQ).toBe(false) // Full Reset DOES cover this one
  })

  it('Reset Stats clears the mode you are on and nothing else', async () => {
    seedAPlayedDevice()
    mountApp()
    expect(statValue('Score')).toBe('3/5')
    tap(screen.getByRole('button', { name: 'Reset Stats' })) // first tap arms
    tap(screen.getByRole('button', { name: 'Reset Stats?' })) // second confirms
    expect(statValue('Score')).toBe('0/0')
    const fresh = await reopenApp()
    const back = fresh.progress.getState()
    expect(back.stats.classic.played).toBe(0)
    expect(back.stats.flash.played).toBe(9) // another mode's record is not yours to clear
    expect(back.aoxBest[AOX_KEY]).toEqual(AOX_REC)
    expect(back.lookupHistory).toEqual(LOOKUP)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SAVED PERSONAL DEFAULTS OUTLIVE A FULL RESET — an existing promise, and the one place where "back
// to launch" deliberately does NOT mean "back to factory". Presets make it sharper rather than
// softer: each preset gets its own saved defaults, so a Full Reset inside one must still land on
// THAT preset's saved values.
describe('saved personal defaults outlive a Full Reset', () => {
  beforeEach(() => resetAppState())

  it('Full Reset lands on the saved values, and the snapshot itself is still there afterwards', async () => {
    userDefaults.getState().saveDefaults({
      settings: { ...settings.getState(), minY: 1600, leapChance: '75' },
      prefs: { flashMs: 800, blitzSec: 120, blitzQSec: 20, aoxN: '25' },
    })
    act(() => {
      settings.getState().setMinY(1)
      settings.getState().setLeapChance('random')
      modePrefs.getState().setBlitzSec(45)
    })
    mountApp()
    openSettings()
    tap(fullResetButton())
    tap(fullResetButton())
    // Landed on the SAVED values, not the factory ones…
    expect(settings.getState().minY).toBe(1600)
    expect(settings.getState().leapChance).toBe('75')
    expect(modePrefs.getState().blitzSec).toBe(120)
    // …and the snapshot outlived the reset, on disk as well as in memory — clearing it is the ⚙
    // footer's own link, never Full Reset's business.
    expect(readSavedState(userDefaults).saved.settings.minY).toBe(1600)
    const fresh = await reopenApp()
    expect(fresh.userDefaults.getState().saved.prefs.aoxN).toBe('25')
  })
})
