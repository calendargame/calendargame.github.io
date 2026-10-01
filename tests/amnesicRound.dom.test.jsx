// @vitest-environment jsdom
//
// amnesicRound.dom — round 23: an Amnesic (guest) preset must NEVER touch the other copy of the
// stats, and a reload is the SAME session everywhere (only a real close of the app starts fresh).
//
// ★ THE BUG THESE CASES WERE WRITTEN AGAINST (all reproduced on v2.26.0 by the investigation that
// queued this fix — 14 of its 19 probes failed): a Blitz round / MoX run that ENDED while the preset was
// Amnesic was parked in store/sessionRound under "<preset>:<mode>" only. Turning Amnesic OFF remounts
// the screens against the PERMANENT stats, and the remount restored the guest's round and reconciled
// it into the permanent Bests — replacing a best, LOWERING one (round ids collided at 1), or ERASING
// one (a MoX retraction restores the guest run's empty floor). The reverse flip copied the player's
// own result into the fresh guest copy. The fix keys each parked round by the stats copy it was
// played on (store/amnesic's activeDataId — "1:saved" / "1:session"), so a round only ever comes back
// against its own copy, and the session slot shares the session stats' lifetime.
//
// The first 19 cases are the investigation's probes, kept exactly as questions (the permanent bytes
// before vs after) and turned into real tests. The rest pin the owner's two session rules:
//   (a) within one session everything comes back exactly as it was left — your own finished round,
//       hidden during a guest interlude, reappears when Amnesic goes off;
//   (b) a reload keeps the session (Amnesic stays on, the guest round stays on screen); only a real
//       close — the browser clearing sessionStorage — reseeds Amnesic to the saved default.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { screen, cleanup, act, fireEvent } from '@testing-library/react'
import { setPresetAmnesic, createPreset, switchPreset } from '../src/store/presetControl.js'
import { usePresets, presetKey, PRESET_STORE_KEYS } from '../src/store/presets.js'
import { useSettings } from '../src/store/settings.js'
import { useModePrefs } from '../src/store/modePrefs.js'
import { useProgress } from '../src/store/progress.js'
import { useUserDefaults } from '../src/store/userDefaults.js'
import {
  resetAppState,
  mountApp,
  tap,
  openSettings,
  fireResetSettings,
  fireFullReset,
} from './helpers/settingsPanel.jsx'
import { wday } from '../src/lib/calendar.js'
import { DAY } from '../src/lib/format.js'

function isHidden(el) {
  for (let n = el; n; n = n.parentElement) if (n.style && n.style.display === 'none') return true
  return false
}
function readDate() {
  const els = Array.from(document.querySelectorAll('div')).filter(
    (e) => e.children.length === 0 && /^-?\d+-\d+-\d+$/.test(e.textContent.trim()) && !isHidden(e),
  )
  if (els.length !== 1) throw new Error(`expected one visible ymd date, found ${els.length}`)
  const [y, m, d] = els[0].textContent.trim().split('-').map(Number)
  return { y, m, d }
}
function statValue(label) {
  const labelSpan = Array.from(document.querySelectorAll('span')).find(
    (s) => s.textContent.trim() === label && !isHidden(s),
  )
  if (!labelSpan) throw new Error(`stat "${label}" not found on the visible screen`)
  return labelSpan.parentElement.querySelector('[data-statval]').textContent.trim()
}
const correctName = ({ y, m, d }) => DAY[wday(y, m, d)]
const ctrl = (name) => screen.getByRole('button', { name })
const press = (key) => act(() => fireEvent.keyDown(window, { key }))
const pinReadable = () =>
  act(() => {
    const s = useSettings.getState()
    s.setRandomFormat(false)
    s.setDateFormat('numeric-ymd')
    s.setMinY(1583)
    s.setMaxY(10000)
  })
const setAmnesic = (on, id = usePresets.getState().activeId) => act(() => setPresetAmnesic(id, on))
const statsKey = (id = 1) => presetKey(PRESET_STORE_KEYS.progress, id)
const permanent = (id = 1) => JSON.parse(localStorage.getItem(statsKey(id)) ?? 'null')?.state
const amnesicNow = (id = 1) =>
  usePresets.getState().presets.find((p) => p.id === id).amnesic === true
function finishBlitz(n) {
  tap(ctrl('Begin'))
  for (let i = 0; i < n; i++) tap(screen.getByRole('button', { name: correctName(readDate()) }))
  tap(ctrl('Reveal'))
}
function finishMox(n) {
  tap(ctrl('Begin'))
  for (let i = 0; i < n; i++) tap(screen.getByRole('button', { name: correctName(readDate()) }))
}
const onlyKey = (o) => {
  const k = Object.keys(o)
  if (k.length !== 1) throw new Error('expected one Best key, found ' + k.length)
  return k[0]
}
const unmount = () => {
  cleanup()
  document.getElementById('root')?.remove()
}
// A RELOAD: the page goes away and comes back with every storage area intact — localStorage AND
// sessionStorage — and every store re-read from it, exactly as a real reload re-reads them.
const reload = () => {
  unmount()
  act(() => {
    usePresets.persist.rehydrate()
    useProgress.persist.rehydrate()
    useSettings.persist.rehydrate()
    useModePrefs.persist.rehydrate()
    useUserDefaults.persist.rehydrate()
  })
  mountApp()
}
// A REAL CLOSE, then an open: the browser ends the session (sessionStorage is gone) and localStorage
// is all that is left.
const closeAndReopen = () => {
  unmount()
  sessionStorage.clear()
  act(() => {
    usePresets.persist.rehydrate()
    useProgress.persist.rehydrate()
  })
  mountApp()
}

const variants = [
  { name: 'per-round', perQ: false, am: false, field: 'blitzBest' },
  { name: 'per-Q sudden death', perQ: true, am: false, field: 'suddenBest' },
  { name: 'per-Q + Allow Mistakes', perQ: true, am: true, field: 'suddenAmBest' },
]
// A permanent Best planted under the config's key. `rid` 1 is the id the old per-screen counter gave
// EVERY first round — the collision that let a guest round lower a real record.
const sentinel = (field, score, rid) =>
  field === 'suddenBest'
    ? { score, roundId: rid }
    : { score, streak: score, scoreRoundId: rid, streakRoundId: rid }

describe('Blitz: a guest round on screen, Amnesic ON → OFF, leaves the permanent Best alone', () => {
  beforeEach(() => resetAppState())
  afterEach(unmount)
  for (const v of variants) {
    for (const [label, permScore, permRid, guestScore] of [
      ['guest beats permanent (different round id)', 1, 99, 3],
      ['guest below permanent, the colliding round id 1', 30, 1, 3],
      ['guest below permanent, different round id', 30, 99, 3],
    ]) {
      it(`${v.name}: ${label}`, () => {
        mountApp()
        pinReadable()
        act(() => {
          useModePrefs.getState().setBlitzPerQ(v.perQ)
          useModePrefs.getState().setBlitzAllowMistakes(v.am)
        })
        press('B')
        finishBlitz(1) // create the config's key permanently…
        tap(ctrl('Reset'))
        const key = onlyKey(useProgress.getState()[v.field])
        // …then plant the permanent record under test.
        act(() =>
          useProgress.setState({ [v.field]: { [key]: sentinel(v.field, permScore, permRid) } }),
        )
        const before = JSON.stringify(permanent()[v.field])
        setAmnesic(true)
        expect(useProgress.getState()[v.field]).toEqual({})
        finishBlitz(guestScore)
        expect(useProgress.getState()[v.field][key].score).toBe(guestScore)
        expect(JSON.stringify(permanent()[v.field])).toBe(before) // untouched while amnesic
        setAmnesic(false)
        expect(JSON.stringify(permanent()[v.field])).toBe(before)
        expect(ctrl('Begin')).toBeInTheDocument() // the guest's round went with the guest's stats
      })
    }
  }
})

describe('Blitz: your own round on screen, Amnesic OFF → ON', () => {
  beforeEach(() => resetAppState())
  afterEach(unmount)
  it('per-round: the guest copy starts at zero and your permanent stats are untouched', () => {
    mountApp()
    pinReadable()
    press('B')
    finishBlitz(4)
    const before = localStorage.getItem(statsKey())
    setAmnesic(true)
    expect(localStorage.getItem(statsKey())).toBe(before)
    expect(useProgress.getState().blitzBest).toEqual({})
    expect(ctrl('Begin')).toBeInTheDocument() // your round is not the guest's to see
  })
})

describe('Blitz: a reload with a guest round parked', () => {
  beforeEach(() => resetAppState())
  afterEach(unmount)
  it('the reload keeps Amnesic on and the guest round on screen; the permanent Best is untouched', () => {
    mountApp()
    pinReadable()
    press('B')
    finishBlitz(1)
    tap(ctrl('Reset'))
    const key = onlyKey(useProgress.getState().blitzBest)
    act(() => useProgress.setState({ blitzBest: { [key]: sentinel('blitzBest', 30, 1) } }))
    const before = JSON.stringify(permanent().blitzBest)
    setAmnesic(true)
    finishBlitz(3)
    reload()
    expect(amnesicNow()).toBe(true) // a reload is the SAME session — no reseed
    expect(JSON.stringify(permanent().blitzBest)).toBe(before)
    expect(statValue('Score')).toBe('3/4') // the guest's round, still on screen
    expect(useProgress.getState().blitzBest[key].score).toBe(3)
  })
})

describe('MoX: a guest run and the permanent Best', () => {
  beforeEach(() => resetAppState())
  afterEach(unmount)
  for (const [label, retract] of [
    ['guest run standing', false],
    ['guest run with a credit retracted (Override)', true],
  ]) {
    it(`ON → OFF: ${label}`, () => {
      mountApp()
      pinReadable()
      press('A')
      act(() => useModePrefs.getState().setAoxN('2'))
      finishMox(2)
      tap(ctrl('Reset'))
      const key = onlyKey(useProgress.getState().aoxBest)
      const sent = { avg: 0.5, avgMed: 0.5, avgRoundId: 7, med: 0.5, medAvg: 0.5, medRoundId: 7 }
      act(() => useProgress.setState({ aoxBest: { [key]: sent } }))
      const before = JSON.stringify(permanent().aoxBest)
      setAmnesic(true)
      finishMox(2)
      if (retract) tap(ctrl('Override')) // take the completing solve's credit away
      expect(JSON.stringify(permanent().aoxBest)).toBe(before)
      setAmnesic(false)
      expect(JSON.stringify(permanent().aoxBest)).toBe(before)
    })
  }
  it('OFF → ON: the guest copy starts at zero', () => {
    mountApp()
    pinReadable()
    press('A')
    act(() => useModePrefs.getState().setAoxN('2'))
    finishMox(2)
    setAmnesic(true)
    expect(useProgress.getState().aoxBest).toEqual({})
  })
})

describe('more paths into the permanent copy', () => {
  beforeEach(() => resetAppState())
  afterEach(unmount)

  it('MoX: a SLOWER guest run does not overwrite a FASTER permanent best', () => {
    mountApp()
    pinReadable()
    press('A')
    act(() => useModePrefs.getState().setAoxN('2'))
    finishMox(2)
    tap(ctrl('Reset'))
    const key = onlyKey(useProgress.getState().aoxBest)
    act(() =>
      useProgress.setState({
        aoxBest: { [key]: { avg: 0, avgMed: 0, avgRoundId: 7, med: 0, medAvg: 0, medRoundId: 7 } },
      }),
    )
    const before = JSON.stringify(permanent().aoxBest)
    setAmnesic(true)
    finishMox(2)
    setAmnesic(false)
    expect(JSON.stringify(permanent().aoxBest)).toBe(before)
  })

  it('Blitz: Reset Settings (saved default = not amnesic) with a guest round on screen', () => {
    mountApp()
    pinReadable()
    press('B')
    finishBlitz(1)
    tap(ctrl('Reset'))
    const key = onlyKey(useProgress.getState().blitzBest)
    act(() => useProgress.setState({ blitzBest: { [key]: sentinel('blitzBest', 30, 1) } }))
    const before = JSON.stringify(permanent().blitzBest)
    setAmnesic(true)
    finishBlitz(3)
    openSettings('gear')
    fireResetSettings() // restores the saved Amnesic state (off) — the same discard as a toggle
    expect(amnesicNow()).toBe(false)
    expect(JSON.stringify(permanent().blitzBest)).toBe(before)
  })

  it('Blitz: Full Reset in an amnesic preset with a guest round on screen wipes the permanent copy', () => {
    mountApp()
    pinReadable()
    press('B')
    setAmnesic(true)
    finishBlitz(3)
    openSettings('gear')
    fireFullReset()
    expect(permanent()?.blitzBest ?? {}).toEqual({})
  })

  it('Blitz: preset 1 guest round, switch to preset 2, reload, switch back — nothing leaks', () => {
    mountApp()
    pinReadable()
    press('B')
    finishBlitz(1)
    tap(ctrl('Reset'))
    const key = onlyKey(useProgress.getState().blitzBest)
    act(() => useProgress.setState({ blitzBest: { [key]: sentinel('blitzBest', 30, 1) } }))
    const before = JSON.stringify(permanent().blitzBest)
    setAmnesic(true)
    finishBlitz(3)
    const p2 = createPreset()
    act(() => switchPreset(p2.id))
    reload()
    expect(amnesicNow(1)).toBe(true) // the reload kept preset 1's guest session
    expect(JSON.stringify(permanent(1).blitzBest)).toBe(before)
    act(() => switchPreset(1))
    expect(JSON.stringify(permanent(1).blitzBest)).toBe(before)
    expect(statValue('Score')).toBe('3/4') // the guest round, still preset 1's this session
  })

  it('Blitz: a plain preset switch while amnesic (no flip) is harmless', () => {
    mountApp()
    pinReadable()
    press('B')
    finishBlitz(1)
    tap(ctrl('Reset'))
    const before = JSON.stringify(permanent().blitzBest)
    setAmnesic(true)
    finishBlitz(3)
    const p2 = createPreset()
    act(() => switchPreset(p2.id))
    act(() => switchPreset(1))
    expect(JSON.stringify(permanent().blitzBest)).toBe(before)
    expect(Object.values(useProgress.getState().blitzBest)[0].score).toBe(3)
  })
})

// ── The owner's session rules ─────────────────────────────────────────────────────────────────
describe('within one session everything comes back exactly as it was left', () => {
  beforeEach(() => resetAppState())
  afterEach(unmount)

  it('Blitz: your own finished round, hidden during a guest interlude, reappears when Amnesic goes off', () => {
    mountApp()
    pinReadable()
    press('B')
    finishBlitz(4) // YOUR round: 4/5
    const before = localStorage.getItem(statsKey())
    setAmnesic(true)
    expect(ctrl('Begin')).toBeInTheDocument() // hidden from the guest
    finishBlitz(2) // the guest's round
    setAmnesic(false)
    expect(statValue('Score')).toBe('4/5') // yours again, exactly as you left it
    expect(localStorage.getItem(statsKey())).toBe(before) // and nothing moved underneath it
  })

  it('MoX: your own finished run reappears when Amnesic goes off, with its ★', () => {
    mountApp()
    pinReadable()
    press('A')
    act(() => useModePrefs.getState().setAoxN('2'))
    finishMox(2)
    const before = localStorage.getItem(statsKey())
    expect(screen.getByText(/Best Mean:/).textContent).toContain('★')
    setAmnesic(true)
    expect(ctrl('Begin')).toBeInTheDocument()
    setAmnesic(false)
    expect(statValue('Score')).toBe('2/2')
    expect(screen.getByText(/Best Mean:/).textContent).toContain('★') // still the run that set it
    expect(localStorage.getItem(statsKey())).toBe(before)
  })

  it('turning Amnesic back ON gives a fresh guest start — not the previous guest round', () => {
    mountApp()
    pinReadable()
    press('B')
    setAmnesic(true)
    finishBlitz(2)
    setAmnesic(false)
    setAmnesic(true)
    expect(ctrl('Begin')).toBeInTheDocument()
    expect(useProgress.getState().blitzBest).toEqual({})
  })
})

// ── A parked round carries the configuration it was played under ───────────────────────────────
// The ⚙ settings and the per-mode setup are shared by a preset's two stats copies, and a guest's idle
// screen leaves every one of them editable. So "your finished round comes back" has a condition: it
// comes back only over the configuration it was played under. Restored over a different one, the
// round reconciled against settings it was never played on — and each of these changed a PERMANENT
// best (round 23's review, reproduced as found). A round that no longer matches is not restored: the
// screen is idle, and every saved Best is exactly as the round left it.
describe('a guest who changes the setup never changes your saved bests', () => {
  beforeEach(() => resetAppState())
  afterEach(unmount)

  it('MoX: the guest raises the run length — your Best is not taken away', () => {
    mountApp()
    pinReadable()
    press('A')
    act(() => useModePrefs.getState().setAoxN('2'))
    finishMox(2) // YOUR run: done, its Best recorded
    const before = JSON.stringify(permanent().aoxBest)
    expect(Object.values(permanent().aoxBest)[0].avg).toEqual(expect.any(Number))
    setAmnesic(true)
    act(() => useModePrefs.getState().setAoxN('5')) // the guest edits the (idle) run length
    setAmnesic(false)
    expect(JSON.stringify(permanent().aoxBest)).toBe(before)
    expect(ctrl('Begin')).toBeInTheDocument() // a Mo2 run is not shown as a Mo5 one
  })

  it('MoX: the guest flips One-by-One — your run is not restored into the other sub-mode', () => {
    mountApp()
    pinReadable()
    press('A')
    act(() => useModePrefs.getState().setAoxN('2'))
    finishMox(2)
    const before = JSON.stringify(permanent().aoxBest)
    setAmnesic(true)
    act(() => useModePrefs.getState().setAoxOneByOne(true))
    setAmnesic(false)
    expect(JSON.stringify(permanent().aoxBest)).toBe(before)
    expect(ctrl('Begin')).toBeInTheDocument()
  })

  for (const [label, guestEdit] of [
    ['Per Question', () => useModePrefs.getState().setBlitzPerQ(true)],
    [
      'Per Question + Allow Mistakes off',
      () => {
        useModePrefs.getState().setBlitzPerQ(true)
        useModePrefs.getState().setBlitzAllowMistakes(false)
      },
    ],
    ['Allow Mistakes off', () => useModePrefs.getState().setBlitzAllowMistakes(false)],
    ['a different round length', () => useModePrefs.getState().setBlitzSec(30)],
  ])
    it(`Blitz: the guest picks ${label} — no Best appears in a sub-mode you never played`, () => {
      mountApp()
      pinReadable()
      press('B')
      finishBlitz(4) // YOUR Per Round round: 4/5
      const before = JSON.stringify(permanent())
      setAmnesic(true)
      act(guestEdit) // the guest's screen is idle, so its setup is all live
      setAmnesic(false)
      expect(JSON.stringify(permanent())).toBe(before)
      expect(ctrl('Begin')).toBeInTheDocument()
    })

  it('Blitz: the guest changes the year range — your round does not come back to be resumed on it', () => {
    mountApp()
    pinReadable()
    press('B')
    finishBlitz(4) // 4 right, then Reveal ends it: 4/5 on 1583–10000
    const before = JSON.stringify(permanent())
    setAmnesic(true)
    act(() => {
      useSettings.getState().setMinY(2000)
      useSettings.getState().setMaxY(2001)
    })
    setAmnesic(false)
    // Restored, an Override on the revealed card resumed the round drawing 2000–2001 dates and the
    // 1583–10000 Best rose with them. There is no round to resume.
    expect(ctrl('Begin')).toBeInTheDocument()
    expect(statValue('Score')).toBe('0/0')
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(JSON.stringify(permanent())).toBe(before)
  })

  it('a guest who changes nothing: your round still comes back, untouched', () => {
    mountApp()
    pinReadable()
    press('B')
    finishBlitz(4)
    const before = JSON.stringify(permanent())
    setAmnesic(true)
    act(() => useModePrefs.getState().setBlitzPerQ(true)) // changed…
    act(() => useModePrefs.getState().setBlitzPerQ(false)) // …and put back
    setAmnesic(false)
    expect(statValue('Score')).toBe('4/5')
    expect(JSON.stringify(permanent())).toBe(before)
  })

  it('the same holds across a reload: a round parked under settings that have since moved is dropped', () => {
    mountApp()
    pinReadable()
    press('B')
    finishBlitz(4)
    const before = JSON.stringify(permanent().blitzBest)
    unmount()
    act(() => {
      useSettings.getState().setMinY(1900) // another tab on this origin moved the shared settings
    })
    mountApp()
    press('B')
    expect(ctrl('Begin')).toBeInTheDocument()
    expect(JSON.stringify(permanent().blitzBest)).toBe(before)
  })
})

// The same rule from inside one copy: Reset Settings can move the run length under a MoX run that is
// still on screen (the run resets when the ⚙ panel closes). The run's own arithmetic uses the length
// it was BEGUN at, so nothing happens to it — or to its Best — in between.
describe('MoX: a run keeps the length it was begun at', () => {
  beforeEach(() => resetAppState())
  afterEach(unmount)

  it('Reset Settings with a finished run on screen does not take its Best away', () => {
    mountApp()
    pinReadable()
    press('A')
    act(() => useModePrefs.getState().setAoxN('2'))
    finishMox(2)
    const key = onlyKey(useProgress.getState().aoxBest)
    const record = JSON.stringify(useProgress.getState().aoxBest[key])
    openSettings('gear')
    fireResetSettings() // the run length goes back to 10 while the Mo2 run is still up
    expect(useModePrefs.getState().aoxN).toBe('10')
    expect(JSON.stringify(useProgress.getState().aoxBest[key])).toBe(record)
  })

  it('Reset Settings with a run in progress does not complete it early', () => {
    mountApp()
    pinReadable()
    act(() => useModePrefs.getState().setAoxN('2'))
    act(() => {
      useUserDefaults.getState().saveDefaults({
        settings: { ...useSettings.getState() },
        prefs: { flashMs: 800, blitzSec: 60, blitzQSec: 10, aoxN: '2' },
        amnesic: false,
      })
    })
    press('A')
    act(() => useModePrefs.getState().setAoxN('5'))
    tap(ctrl('Begin'))
    for (let i = 0; i < 3; i++) tap(screen.getByRole('button', { name: correctName(readDate()) }))
    openSettings('gear')
    fireResetSettings() // the saved run length (2) comes back under a Mo5 run holding 3 solves
    expect(useModePrefs.getState().aoxN).toBe('2')
    expect(useProgress.getState().aoxBest).toEqual({}) // 3 solves are not a finished Mo2
  })
})

// A config with no Best has no key — after a run that created one is retracted, exactly as Blitz.
describe('MoX: a retracted run with no earlier Best leaves no record behind', () => {
  beforeEach(() => resetAppState())
  afterEach(unmount)
  it('Override on the completing solve removes the record the run created', () => {
    mountApp()
    pinReadable()
    press('A')
    act(() => useModePrefs.getState().setAoxN('2'))
    finishMox(2)
    expect(Object.keys(useProgress.getState().aoxBest)).toHaveLength(1)
    tap(ctrl('Override')) // the held completing solve, overridden to a miss: the run no longer stands
    expect(useProgress.getState().aoxBest).toEqual({})
    expect(permanent().aoxBest).toEqual({})
  })
})

describe('a reload is the same session; only a real close starts fresh', () => {
  beforeEach(() => resetAppState())
  afterEach(unmount)

  it('a reload keeps the page, a finished round, and an Amnesic preset Amnesic', () => {
    mountApp()
    pinReadable()
    press('B')
    setAmnesic(true)
    finishBlitz(2)
    reload()
    expect(amnesicNow()).toBe(true)
    expect(ctrl('Reset')).toBeInTheDocument() // Blitz, with the ended round still up
    expect(statValue('Score')).toBe('2/3')
    expect(Object.values(useProgress.getState().blitzBest)[0].score).toBe(2)
  })

  it('a real close reseeds Amnesic to the saved default and the guest session is gone', () => {
    mountApp()
    pinReadable()
    const permBefore = localStorage.getItem(statsKey())
    setAmnesic(true)
    press('B')
    finishBlitz(2)
    closeAndReopen()
    expect(amnesicNow()).toBe(false) // no saved default → guest mode reverts
    expect(localStorage.getItem(statsKey())).toBe(permBefore)
    press('B')
    expect(ctrl('Begin')).toBeInTheDocument()
    expect(useProgress.getState().blitzBest).toEqual({})
  })
})

describe('round ids are never reused across screen loads (what the ★ rule rests on)', () => {
  beforeEach(() => resetAppState())
  afterEach(unmount)
  it('a best score and a best streak set on two different loads read "Different Rounds"', () => {
    // Per Round, Allow Mistakes on (the factory setup). Both rounds are the FIRST round of their
    // load, which the old per-screen counter numbered 1 — so the tag read "Same Round".
    const wrong = ({ y, m, d }) => DAY[(wday(y, m, d) + 1) % 7]
    const answer = (right) =>
      tap(screen.getByRole('button', { name: (right ? correctName : wrong)(readDate()) }))
    mountApp()
    pinReadable()
    press('B')
    // Round A: ✓ ✓ ✗ (retry ✓, no credit) ✓ ✓ → score 4, best streak 2.
    tap(ctrl('Begin'))
    answer(true)
    answer(true)
    answer(false)
    answer(true)
    answer(true)
    answer(true)
    tap(ctrl('Reveal'))
    const a = Object.values(useProgress.getState().blitzBest)[0]
    expect([a.score, a.streak]).toEqual([4, 2])
    tap(ctrl('Reset'))
    closeAndReopen()
    press('B')
    // Round B: ✓ ✓ ✓ → score 3 (A keeps the score), best streak 3 (B takes the streak).
    tap(ctrl('Begin'))
    answer(true)
    answer(true)
    answer(true)
    tap(ctrl('Reveal'))
    const b = Object.values(useProgress.getState().blitzBest)[0]
    expect([b.score, b.streak]).toEqual([4, 3])
    expect(b.scoreRoundId).toBe(a.scoreRoundId)
    expect(b.streakRoundId).not.toBe(a.scoreRoundId)
    // The tag on the visible Blitz screen (the guide mentions both phrases too, hidden).
    const tag = Array.from(document.querySelectorAll('span')).find(
      (e) => /^(Same Round|Different Rounds)$/.test(e.textContent) && !isHidden(e),
    )
    expect(tag.textContent).toBe('Different Rounds')
  })
})

// ── A PRACTICE ROUND STAYS A PRACTICE ROUND ACROSS A GUEST'S INTERLUDE ─────────────────────────
// Save Stats is a ⚙ setting, and the settings are shared by a preset's two stats copies — so a guest
// can turn it back ON while the owner's ended practice round (played with Save Stats OFF) waits
// parked. Whether a round counts was settled as it FIRST ended and is parked with it (recordedRef in
// both screens): the round comes back exactly as it was left, and records nothing — not on its
// return, and not when an Override puts it back in play and it ends again with the switch on.
describe('a parked practice round is not recorded when a guest turns Save Stats on', () => {
  beforeEach(() => resetAppState())
  afterEach(unmount)
  const setSaveStats = (on) => act(() => useSettings.getState().setSaveStats(on))

  it('Blitz: the practice round comes back, and the permanent Bests are still empty', () => {
    mountApp()
    pinReadable()
    setSaveStats(false)
    press('B')
    finishBlitz(3) // ended on an internally-tracked 3, in practice mode
    expect(useProgress.getState().blitzBest).toEqual({})
    setAmnesic(true) // the guest's turn…
    setSaveStats(true) // …and the guest turns the shared switch on
    setAmnesic(false)
    expect(statValue('Score')).toBe('3/4') // the owner's round is back on screen
    expect(useProgress.getState().blitzBest).toEqual({})
    expect(permanent().blitzBest).toEqual({})
    tap(ctrl('Override')) // credits the revealed card → the round is back in play
    tap(ctrl('Reveal')) // …and ends a second time, with Save Stats on: still the practice round
    expect(statValue('Score')).toBe('4/5')
    expect(useProgress.getState().blitzBest).toEqual({})
    expect(permanent().blitzBest).toEqual({})
  })

  it('MoX: the practice run comes back, and the permanent Bests are still empty', () => {
    mountApp()
    pinReadable()
    act(() => useModePrefs.getState().setAoxN('2'))
    setSaveStats(false)
    press('A')
    finishMox(2)
    expect(useProgress.getState().aoxBest).toEqual({})
    setAmnesic(true)
    setSaveStats(true)
    setAmnesic(false)
    expect(statValue('Score')).toBe('2/2')
    expect(useProgress.getState().aoxBest).toEqual({})
    expect(permanent().aoxBest).toEqual({})
    // (Bare clicks, not two taps: the button reads a second TAP inside 350 ms as a double-tap.)
    act(() => fireEvent.click(ctrl('Override'))) // the completing solve → a miss: the run fails
    expect(statValue('Score')).toBe('1/2')
    act(() => fireEvent.click(ctrl('Undo'))) // …and completes again, with Save Stats on
    expect(statValue('Score')).toBe('2/2')
    expect(useProgress.getState().aoxBest).toEqual({})
    expect(permanent().aoxBest).toEqual({})
  })
})
