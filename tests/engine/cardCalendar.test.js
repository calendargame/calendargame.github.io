// tests/engine/cardCalendar.test.js — ONE CARD, ONE CALENDAR (CardMeta.jul).
//
// A date on or before October 4, 1582 has two weekdays — its Julian one and its Gregorian one — and
// the Julian Calendar setting can be switched while a date is on screen. The defect this pins shut: a
// date drawn under one setting and answered under the other was judged by the setting at the answer
// and stored with the calendar it was DRAWN under, so browsing back to it showed a green answer and
// Show Codes for two different calendars.
//
// The rule now: the first thing that JUDGES a card stamps the calendar onto it, and everything that
// judges, shows or re-derives that card afterwards reads the stamp (gameReducer's calendarOf). These
// are the named cases — every judging action, every reader, and what the restore door does with a
// card an older build parked without a stamp (it refuses it, quietly). engine/invariants holds every state to the same rule
// and the fuzz's reference model keeps its own copy of it (tests/engine/referenceModel).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  gameReducer,
  initEngine,
  calendarOf,
  correctIndexOf,
  waitingDateMissing,
} from '../../src/engine/gameReducer.js'
import { checkGameInvariants } from '../../src/engine/invariants.js'
import { buildRunBreakdown } from '../../src/engine/runBreakdown.js'
import { restoreParkedEngine } from '../../src/engine/parkedEngine.js'
import { restoreParked, parkedText } from '../../src/engine/parkedHistory.js'
import { captureError } from '../../src/observability/sentry.js'
import { wday, wdayJulian } from '../../src/lib/calendar.js'
vi.mock('../../src/observability/sentry.js', () => ({ captureError: vi.fn() }))
beforeEach(() => vi.mocked(captureError).mockClear())

// October 14, 1066 (Hastings): a Saturday in the Julian calendar it was fought under, another
// day in the Gregorian one projected back. Every case rests on the two DIFFERING, so that is asserted.
const J = wdayJulian(1066, 10, 14)
const G = wday(1066, 10, 14)
const OTHER = [0, 1, 2, 3, 4, 5, 6].find((i) => i !== J && i !== G) // wrong in both calendars
// A weekday date carries no calendar of its own: until something judges it, it follows the setting.
const HASTINGS = { y: 1066, m: 10, d: 14, _fmt: 'numeric-ymd' }
const MODERN = { y: 2024, m: 1, d: 1, _fmt: 'numeric-ymd' }

const act = (s, a) => gameReducer(s, { saveStats: true, tracking: true, elapsed: 1, ...a })
const answer = (s, idx, useJulian, nextDate = MODERN, extra = {}) =>
  act(s, { type: 'ANSWER', idx, useJulian, nextDate, ...extra })
const reveal = (s, useJulian) => act(s, { type: 'REVEAL', useJulian })
const codes = (s, useJulian) => act(s, { type: 'SHOW_CODES', open: true, useJulian })
const override = (s, useJulian, extra = {}) =>
  act(s, { type: 'OVERRIDE', useJulian, nextDate: MODERN, ...extra })
const back = (s) => gameReducer(s, { type: 'BACK' })
const forward = (s, useJulian) => gameReducer(s, { type: 'FORWARD', useJulian })
// The day a grid marks as the answer: its green, or the 'override-wrong' on the answer.
const marked = (btns) =>
  Object.entries(btns)
    .filter(([, v]) => v === 'correct' || v === 'override-wrong')
    .map(([k]) => Number(k))
// Healthy whichever way the setting stands NOW — a judged card no longer depends on it.
const healthy = (s) => {
  expect(checkGameInvariants(s, true)).toEqual([])
  expect(checkGameInvariants(s, false)).toEqual([])
}

it('the fixture: the two calendars disagree about October 14, 1066', () => {
  expect(J).toBe(6)
  expect(G).not.toBe(J)
})

describe('calendarOf — which calendar a card is read in', () => {
  it('a weekday date nothing has judged follows the setting as it stands, whatever it was drawn under', () => {
    const s = initEngine(HASTINGS)
    expect(s.card.jul).toBeUndefined()
    expect(calendarOf(s.card, s.date, true)).toBe(true)
    expect(calendarOf(s.card, s.date, false)).toBe(false)
  })
  it('a judged card is read in its own calendar, whatever the setting says now', () => {
    expect(calendarOf({ wrongTime: null, answered: null, jul: true }, HASTINGS, false)).toBe(true)
    expect(calendarOf({ wrongTime: null, answered: null, jul: false }, HASTINGS, true)).toBe(false)
  })
  it('a Deduction puzzle nothing has judged is read in the calendar it was BUILT in', () => {
    const puzzle = { type: 'day', y: 1066, m: 10, d: 14, w: J, options: [14, 15], _jul: true }
    const blank = { wrongTime: null, answered: null }
    expect(calendarOf(blank, puzzle, false)).toBe(true)
    expect(calendarOf(blank, { ...puzzle, _jul: false }, true)).toBe(false)
    // One built without the record has only the setting to go by.
    const { _jul, ...bare } = puzzle
    expect(calendarOf(blank, bare, false)).toBe(false)
  })
})

describe('every judging action stamps the calendar in force, once', () => {
  // [name, the action under a setting, where the judged card is afterwards]
  const live = (s) => ({ meta: s.card, btns: s.persistBtns })
  const pushed = (s) => ({ meta: s.stack[s.stack.length - 1].meta, btns: s.stack.at(-1).btns })
  const JUDGES = [
    ['a wrong answer', (s, jul) => answer(s, OTHER, jul), live],
    ['a correct answer', (s, jul) => answer(s, jul ? J : G, jul), pushed],
    [
      'a held completing answer',
      (s, jul) => answer(s, jul ? J : G, jul, MODERN, { complete: true }),
      live,
    ],
    ['a Reveal', (s, jul) => reveal(s, jul), live],
    ['Show Codes', (s, jul) => codes(s, jul), live],
    [
      'a per-round timeout',
      (s, jul) => gameReducer(s, { type: 'LOCK_REVEAL', useJulian: jul }),
      live,
    ],
    [
      'a per-question timeout',
      (s, jul) => gameReducer(s, { type: 'TIMEOUT_MISS', useJulian: jul, saveStats: true }),
      live,
    ],
  ]
  for (const jul of [true, false]) {
    it.each(JUDGES)(`%s under Julian ${jul ? 'on' : 'off'}`, (_name, judge, where) => {
      // Drawn under the OPPOSITE setting: the draw has no say.
      const s = judge(initEngine(HASTINGS), jul)
      const card = where(s)
      expect(card.meta.jul).toBe(jul)
      // Whatever answer the grid marks is the answer in that calendar.
      for (const day of marked(card.btns)) expect(day).toBe(jul ? J : G)
      healthy(s)
    })
  }

  it('a correct answer leaves the NEXT date unstamped — the stamp went with the card', () => {
    const s = answer(initEngine(HASTINGS), G, false)
    expect(s.stack[0].meta.jul).toBe(false)
    expect(s.card).toEqual({ wrongTime: null, answered: null })
  })

  it('with Save Stats off a judged date is still stamped (the stamp is about the answer, not the score)', () => {
    const s = answer(initEngine(HASTINGS), OTHER, false, MODERN, { saveStats: false })
    expect(s.card.jul).toBe(false)
    expect(s.stats.played).toBe(0)
    healthy(s)
  })
})

describe('the reported defect — drawn under one setting, answered under the other, browsed back', () => {
  it('the green, the codes calendar, and the breakdown letter are all the calendar it was ANSWERED in', () => {
    // Drawn with Julian on; the player switches it off, then answers what is now correct.
    let s = answer(initEngine(HASTINGS), G, false)
    expect(s.stats.good).toBe(1) // judged by the setting at the answer, as before
    s = back(s)
    expect(marked(s.persistBtns)).toEqual([G]) //                       the highlighted answer
    expect(calendarOf(s.card, s.date, true)).toBe(false) //             what Show Codes works in…
    expect(correctIndexOf(s.date, calendarOf(s.card, s.date, true))).toBe(G) // …and arrives at
    expect(buildRunBreakdown(s, true).rows[0].wday).toBe(G) //          the breakdown's letter
    healthy(s)
  })

  it('the same the other way round — drawn with Julian off, answered with it on', () => {
    let s = answer(initEngine(HASTINGS), J, true)
    expect(s.stats.good).toBe(1)
    s = back(s)
    expect(marked(s.persistBtns)).toEqual([J])
    expect(calendarOf(s.card, s.date, false)).toBe(true)
    expect(buildRunBreakdown(s, false).rows[0].wday).toBe(J)
    healthy(s)
  })

  it('one history can hold both, and each card keeps its own through Back and Forward', () => {
    let s = answer(initEngine(HASTINGS), J, true, HASTINGS) // card 1, Julian
    s = answer(s, G, false) //                                             card 2, Gregorian
    expect(buildRunBreakdown(s, true).rows.map((r) => r.wday)).toEqual([J, G])
    s = back(back(s))
    expect(calendarOf(s.card, s.date, false)).toBe(true)
    s = forward(s, false)
    expect(calendarOf(s.card, s.date, true)).toBe(false)
    s = forward(s, true)
    expect(s.backDepth).toBe(0)
    expect(s.stack.map((e) => e.meta.jul)).toEqual([true, false])
    healthy(s)
  })
})

describe('a card that has been judged cannot be judged again in the other calendar', () => {
  // Answered wrong with Julian on, then the setting is switched off with the date still on screen.
  const burned = () => answer(initEngine(HASTINGS), OTHER, true)

  it('a Reveal after the switch shows the answer it was being judged by', () => {
    const s = reveal(burned(), false)
    expect(marked(s.persistBtns)).toEqual([J])
    healthy(s)
  })
  it('the day that is right in the OTHER calendar is still a wrong answer on this card', () => {
    const s = answer(burned(), G, false)
    expect(s.persistBtns[G]).toBe('wrong-latest')
    expect(s.countedWrong).toBe(true)
    expect(s.date.y).toBe(1066) // not advanced
    healthy(s)
  })
  it('and its own day still finishes it', () => {
    const s = answer(burned(), J, false)
    expect(s.date).toBe(MODERN) // advanced
    expect(marked(s.stack[0].btns)).toEqual([J])
    expect(s.stack[0].meta.jul).toBe(true)
    healthy(s)
  })
  it('a New past it puts the green it never showed on the day it was judged by', () => {
    const s = gameReducer(burned(), {
      type: 'NEW',
      nextDate: MODERN,
      useJulian: false,
      saveStats: true,
    })
    expect(marked(s.stack[0].btns)).toEqual([J])
    healthy(s)
  })
  it('Show Codes after the switch shows that same answer', () => {
    const s = codes(burned(), false)
    expect(marked(s.persistBtns)).toEqual([J])
    healthy(s)
  })
})

describe('an Override reads the card, not the setting', () => {
  it('the newest history card, overridden after a switch: its answer stays where it was judged', () => {
    let s = gameReducer(answer(initEngine(HASTINGS), OTHER, true), {
      type: 'NEW',
      nextDate: MODERN,
      useJulian: true,
      saveStats: true,
    })
    s = override(s, false) //  credit it, with the setting now off
    expect(s.stack[0].hasCredit).toBe(true)
    expect(s.stack[0].btns).toEqual({ [J]: 'correct' })
    s = override(s, false) //  …and Undo
    expect(marked(s.stack[0].btns)).toEqual([J])
    healthy(s)
  })
  it('a browsed card, its credit taken away after a switch: the mark is on its own answer', () => {
    let s = back(answer(initEngine(HASTINGS), G, false))
    s = override(s, true)
    expect(s.persistBtns).toEqual({ [G]: 'override-wrong' })
    healthy(s)
    s = forward(s, true)
    expect(s.stack[0].btns).toEqual({ [G]: 'override-wrong' })
    healthy(s)
  })
  it('the live card, credited and held after a switch', () => {
    let s = answer(initEngine(HASTINGS), OTHER, true)
    s = override(s, false, { hold: true })
    expect(s.persistBtns).toEqual({ [J]: 'correct' })
    healthy(s)
  })
})

describe('a Deduction puzzle is judged in the calendar it was built in', () => {
  const puzzle = (built) => ({
    type: 'day',
    y: 1066,
    m: 10,
    d: 14,
    w: built ? J : G,
    options: [13, 14, 15, 16],
    _jul: built,
  })
  it.each([true, false])('built with Julian %s, answered under the opposite setting', (built) => {
    const s = answer(initEngine(puzzle(built)), 0, !built) // a wrong option
    expect(s.card.jul).toBe(built)
    healthy(s)
  })
})

describe('a card nothing has judged carries no calendar', () => {
  it('a Reset, a kept date, and a regenerated date are all unstamped', () => {
    let s = answer(initEngine(HASTINGS), OTHER, true)
    s = gameReducer(s, { type: 'RESET', timingOff: true, nextDate: MODERN })
    expect(s.card.jul).toBeUndefined()
    s = gameReducer(initEngine(HASTINGS), { type: 'REGEN_DATE', nextDate: HASTINGS })
    expect(s.card.jul).toBeUndefined()
    healthy(s)
  })
  it('a mid-round Reset clears it with the grid', () => {
    const s = gameReducer(reveal(initEngine(HASTINGS), true), { type: 'RESET_ROUND' })
    expect(s.card.jul).toBeUndefined()
    healthy(s)
  })
})

describe('the tripwires (engine/invariants)', () => {
  const join = (v) => v.join(' | ')
  it('8 — a judged card with no calendar, on screen and in history', () => {
    const s = answer(initEngine(HASTINGS), OTHER, true)
    const { jul: _j, ...bare } = s.card
    expect(join(checkGameInvariants({ ...s, card: bare }, true))).toContain(
      'on-screen card: a judged card carries no calendar',
    )
    const h = answer(initEngine(HASTINGS), J, true)
    const { jul: _k, ...bareMeta } = h.stack[0].meta
    expect(
      join(checkGameInvariants({ ...h, stack: [{ ...h.stack[0], meta: bareMeta }] }, true)),
    ).toContain('stack[0]: a judged card carries no calendar')
  })
  it('8 — a calendar on a card nothing has judged', () => {
    const s = initEngine(HASTINGS)
    expect(join(checkGameInvariants({ ...s, card: { ...s.card, jul: true } }, true))).toContain(
      'a card nothing has judged carries a calendar',
    )
  })
  it('9 — a green that is not the answer in the card’s calendar (the defect itself)', () => {
    // Exactly what the older builds stored: judged Gregorian, read back as Julian.
    const s = back(answer(initEngine(HASTINGS), G, false))
    expect(join(checkGameInvariants({ ...s, card: { ...s.card, jul: true } }, false))).toContain(
      'its grid marks an answer that is not the answer in its calendar',
    )
  })
  it('9 — …or an overridden card whose stored as-answered grid names another day', () => {
    let s = gameReducer(answer(initEngine(HASTINGS), OTHER, true), {
      type: 'NEW',
      nextDate: MODERN,
      useJulian: true,
      saveStats: true,
    })
    s = override(s, true)
    const e = s.stack[0]
    const answeredElsewhere = {
      ...e,
      meta: { ...e.meta, answered: { ...e.meta.answered, btns: { [G]: 'correct' } } },
    }
    expect(join(checkGameInvariants({ ...s, stack: [answeredElsewhere] }, true))).toContain(
      'stack[0]: its grid marks an answer that is not the answer in its calendar',
    )
  })
  // ★ WHAT THE WALK REMEMBERS MUST NEVER HIDE A FAULT. A history card that passed is not asked again
  // while the same object stays at the same place (engine/invariants: it remembers the arrays of the
  // last state that passed in full). Three ways that memory could go wrong, each held shut:
  describe('the memory of which history cards passed', () => {
    const played = () => {
      let s = initEngine(HASTINGS)
      for (let i = 0; i < 3; i++) s = answer(s, J, true, HASTINGS)
      return s // three judged cards behind the one on screen
    }
    const FAULT = 'its grid marks an answer that is not the answer in its calendar'
    const wrongGreen = (e) => ({ ...e, btns: { [G]: 'correct' } }) // a NEW object, as a toggle makes

    it('a card REPLACED where it stands is asked, though its neighbours and its array’s length are the same', () => {
      const s = played()
      healthy(s) // the walk now remembers s.stack
      for (const i of [0, 1, 2]) {
        const stack = s.stack.map((e, k) => (k === i ? wrongGreen(e) : e))
        expect(join(checkGameInvariants({ ...s, stack }, true))).toContain(`stack[${i}]: ${FAULT}`)
      }
    })

    it('a fault is reported on EVERY walk, not only the first that meets it', () => {
      const s = played()
      healthy(s)
      const bad = { ...s, stack: [s.stack[0], wrongGreen(s.stack[1]), s.stack[2]] }
      for (let n = 0; n < 3; n++)
        expect(join(checkGameInvariants(bad, true))).toContain(`stack[1]: ${FAULT}`)
      // …and a healthy state checked in between does not launder it either.
      healthy(s)
      expect(join(checkGameInvariants(bad, true))).toContain(`stack[1]: ${FAULT}`)
    })

    it('after the oldest card is forgotten — every index shifts — a bad card among the rest is found', () => {
      const s = played()
      healthy(s)
      const shifted = [wrongGreen(s.stack[1]), s.stack[2]]
      expect(
        join(checkGameInvariants({ ...s, stack: shifted, historyBase: s.historyBase + 1 }, true)),
      ).toContain(`stack[0]: ${FAULT}`)
    })

    it('the cards parked ahead of a browsed one are remembered and asked the same way', () => {
      const s = back(back(played()))
      healthy(s)
      const i = s.forwardStack.findIndex((e) => !e.isLive)
      const forwardStack = s.forwardStack.map((e, k) => (k === i ? wrongGreen(e) : e))
      const bad = { ...s, forwardStack }
      for (let n = 0; n < 2; n++)
        expect(join(checkGameInvariants(bad, true))).toContain(`forwardStack[${i}]: ${FAULT}`)
    })
  })

  it('10 — a puzzle stamped with a calendar it was not built in', () => {
    const p = { type: 'day', y: 1066, m: 10, d: 14, w: J, options: [13, 14], _jul: true }
    const s = answer(initEngine(p), 0, true)
    expect(join(checkGameInvariants({ ...s, card: { ...s.card, jul: false } }, true))).toContain(
      "a puzzle's calendar is not the one it was built in",
    )
  })
})

// ── A DATE ONLY THE JULIAN CALENDAR HAS ──────────────────────────────────────────────────────────
// February 29, 1500 is a day in the Julian calendar and no day at all in the Gregorian one. It can be
// drawn with the Julian Calendar setting on, and Classic and Flash keep an untouched date when the
// setting is switched — so it used to be judged, with the setting off, as a Gregorian date that never
// existed: the weekday of March 1, 1500 came out as its answer. Two rules end that. The engine reads
// such a date in the one calendar that has it, whatever the setting says; and a screen whose setting
// is off does not keep it waiting at all (waitingDateMissing → the one REGEN_DATE).
describe('a date only the Julian calendar has (February 29, 1500)', () => {
  const leapDay = (drawn = true) => ({ y: 1500, m: 2, d: 29, _fmt: 'numeric-ymd', _jul: drawn })
  const JL = wdayJulian(1500, 2, 29)
  const NEVER = wday(1500, 2, 29) // what the old reading gave: the Gregorian formula run off the end of February
  const MISS = [0, 1, 2, 3, 4, 5, 6].find((i) => i !== JL && i !== NEVER)
  const blank = { wrongTime: null, answered: null }

  it('the fixture: the old reading was the weekday of March 1, and it is not the Julian answer', () => {
    expect(NEVER).toBe(wday(1500, 3, 1))
    expect(NEVER).not.toBe(JL)
    // …and the day itself is the one after February 28 in the calendar that has it.
    expect(JL).toBe((wdayJulian(1500, 2, 28) + 1) % 7)
  })

  it('calendarOf reads it as Julian with the setting off, untouched — the setting has no say', () => {
    expect(calendarOf(blank, leapDay(), false)).toBe(true)
    expect(calendarOf(blank, leapDay(), true)).toBe(true)
    // An ordinary pre-reform date still follows the setting.
    expect(calendarOf(blank, { ...leapDay(), d: 28 }, false)).toBe(false)
  })

  // Every way a card is judged, with the setting OFF — the state a clock running out behind the open
  // ⚙ panel reaches before the screen has replaced the date.
  const JUDGES = [
    ['a wrong answer', (s) => answer(s, MISS, false), (s) => s],
    ['the right answer', (s) => answer(s, JL, false), (s) => s.stack[0]],
    ['a Reveal', (s) => reveal(s, false), (s) => s],
    ['Show Codes', (s) => codes(s, false), (s) => s],
    [
      'a per-round timeout',
      (s) => gameReducer(s, { type: 'LOCK_REVEAL', useJulian: false }),
      (s) => s,
    ],
    [
      'a per-question timeout',
      (s) => gameReducer(s, { type: 'TIMEOUT_MISS', useJulian: false, saveStats: true }),
      (s) => s,
    ],
  ]
  it.each(JUDGES)(
    '%s with the setting off judges it as the Julian day it is',
    (_n, judge, where) => {
      const s = judge(initEngine(leapDay()))
      const card = where(s)
      expect((card.meta ?? card.card).jul).toBe(true)
      for (const day of marked(card.btns ?? card.persistBtns)) expect(day).toBe(JL)
      healthy(s)
    },
  )
  it('the day the old reading called right is a WRONG answer', () => {
    const s = answer(initEngine(leapDay()), NEVER, false)
    expect(s.persistBtns[NEVER]).toBe('wrong-latest')
    expect(s.stats.good).toBe(0)
    healthy(s)
  })
  it('the run breakdown shows its row in the Julian calendar too', () => {
    const s = answer(initEngine(leapDay()), JL, false)
    expect(buildRunBreakdown(s, false).rows[0].wday).toBe(JL)
  })

  it('11 — a card stamped with the calendar that lacks its date trips the wire, on screen and in history', () => {
    const s = reveal(initEngine(leapDay()), false)
    const onScreen = { ...s, card: { ...s.card, jul: false }, persistBtns: { [NEVER]: 'correct' } }
    expect(checkGameInvariants(onScreen, false).join(' | ')).toContain(
      'on-screen card: judged in a calendar that does not have its date',
    )
    const h = answer(initEngine(leapDay()), JL, true)
    const e = {
      ...h.stack[0],
      btns: { [NEVER]: 'correct' },
      meta: { ...h.stack[0].meta, jul: false },
    }
    expect(checkGameInvariants({ ...h, stack: [e] }, true).join(' | ')).toContain(
      'stack[0]: judged in a calendar that does not have its date',
    )
  })

  describe('waitingDateMissing — is the waiting question one the setting no longer asks?', () => {
    const regen = (s) => gameReducer(s, { type: 'REGEN_DATE', nextDate: MODERN })
    it('an untouched Julian-only date with the setting OFF is; with it ON it is not', () => {
      const s = initEngine(leapDay())
      expect(waitingDateMissing(s, false)).toBe(true)
      expect(waitingDateMissing(s, true)).toBe(false)
      expect(regen(s).date).toBe(MODERN) // …and the one REGEN_DATE replaces it
    })
    it('an ordinary date never is, whichever way the setting is switched', () => {
      for (const q of [HASTINGS, HASTINGS, MODERN, { ...leapDay(), d: 28 }])
        for (const jul of [true, false]) expect(waitingDateMissing(initEngine(q), jul)).toBe(false)
    })
    it.each([
      ['answered wrong', (s) => answer(s, MISS, true)],
      ['revealed', (s) => reveal(s, true)],
      ['shown its codes', (s) => codes(s, true)],
      ['held as a credit', (s) => answer(s, JL, true, MODERN, { complete: true })],
    ])('a date that was %s is not — it is a Julian card for good, and stays', (_n, use) => {
      const s = use(initEngine(leapDay()))
      expect(waitingDateMissing(s, false)).toBe(false)
      expect(regen(s)).toBe(s)
      expect(calendarOf(s.card, s.date, false)).toBe(true)
      healthy(s)
    })
    it('it is the live question wherever it waits: behind a browsed card too', () => {
      let s = answer(initEngine(MODERN), wday(2024, 1, 1), false, leapDay())
      s = back(s) // browsing the answered card; the leap day waits in the forward stack
      expect(s.date.y).toBe(2024)
      expect(waitingDateMissing(s, false)).toBe(true)
      expect(waitingDateMissing(s, true)).toBe(false)
      const after = regen(s)
      expect(after.forwardStack[0].y).toBe(2024)
      expect(waitingDateMissing(after, false)).toBe(false)
      // …and a Julian-only date being BROWSED, with an ordinary one waiting, is not the question.
      let t = answer(initEngine(leapDay()), JL, true, MODERN)
      t = back(t)
      expect(t.date.d).toBe(29)
      expect(waitingDateMissing(t, false)).toBe(false)
    })
    it('a Deduction puzzle is never one — it is read in the calendar it was built in', () => {
      const p = { type: 'day', y: 1500, m: 2, d: 29, w: JL, options: [27, 28, 29], _jul: true }
      expect(waitingDateMissing(initEngine(p), false)).toBe(false)
      expect(calendarOf(blank, p, false)).toBe(true)
    })
  })
})

// ── WHAT AN OLDER BUILD PARKED ───────────────────────────────────────────────────────────────────
// Builds up to v2.27.3 park in these same slots and stamp nothing. Every build since stamps its own
// cards, and a tab last used on one of those builds — evicted and reloaded by the browser, or reopened
// from history — can still hand this one such a blob (engine/parkedEngine). A judged card in it is
// REFUSED, quietly: the mode starts from its saved stats, and nothing is reported, because it is an
// honest path and not a defect. `asOlderBuild` turns a state this build produced into what they would
// have parked: the same state with every stamp removed.
describe('the restore door — a card an older build parked without its calendar', () => {
  const strip = ({ jul: _j, ...meta }) => meta
  const asOlderBuild = (s) => {
    const j = JSON.parse(JSON.stringify(s))
    return {
      ...j,
      card: strip(j.card),
      stack: j.stack.map((e) => ({ ...e, meta: strip(e.meta) })),
      forwardStack: j.forwardStack.map((e) => ({ ...e, meta: strip(e.meta) })),
    }
  }

  it('a judged card with no calendar is refused — wherever it sits — and nothing is reported', () => {
    const inHistory = answer(initEngine(HASTINGS), G, false)
    const onScreen = answer(initEngine(HASTINGS), OTHER, true) // a wrong pick, still on screen
    let ahead = answer(initEngine(HASTINGS), G, false, HASTINGS)
    ahead = back(answer(ahead, J, true)) // browsed back: the judged card parked ahead of it
    for (const [s, where] of [
      [inHistory, 'in the history'],
      [onScreen, 'on screen'],
      [ahead, 'parked ahead of a browsed card'],
    ]) {
      const old = asOlderBuild(s)
      expect(restoreParkedEngine(old, true, 'classic'), where).toBe(null)
      expect(restoreParkedEngine(old, false, 'classic'), where).toBe(null)
    }
    // …and a casual history from such a build, through parkedHistory: the mode starts from its stats.
    const text = parkedText(asOlderBuild({ ...inHistory, stats: inHistory.stats }), { config: 'c' })
    expect(restoreParked(JSON.parse(text), inHistory.stats, true, 'classic')).toBe(null)
    expect(captureError).not.toHaveBeenCalled()
  })

  it('a live date nothing has judged has no calendar to carry, and comes back', () => {
    const old = asOlderBuild(initEngine(HASTINGS))
    const back = restoreParkedEngine(old, true, 'classic')
    expect(back).toEqual(old)
    expect(back.card.jul).toBeUndefined()
  })

  it('a state THIS build parked comes back as the very same object', () => {
    const j = JSON.parse(JSON.stringify(back(answer(initEngine(HASTINGS), G, false))))
    expect(restoreParkedEngine(j, true, 'classic')).toBe(j)
  })

  it('a card that is unstamped for any other reason is still a defect, and still reported', () => {
    // Stamped but never judged (no mark on its grid): no build parks this.
    const s = initEngine(HASTINGS)
    const odd = { ...JSON.parse(JSON.stringify(s)), card: { ...s.card, jul: true } }
    expect(restoreParkedEngine(odd, true, 'classic')).toBe(null)
    expect(vi.mocked(captureError).mock.calls[0][1].reason).toBe('breaks an engine invariant')
  })
})
