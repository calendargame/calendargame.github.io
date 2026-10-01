// @vitest-environment jsdom
//
// sessionHistory.dom — Classic / Flash / Deduction's back/forward history is kept for the BROWSING
// SESSION (the owner: "only truly closing the app starts fresh"): a reload keeps it, a preset switch
// keeps each preset's own, and a guest's Amnesic interlude hands yours back when it ends. A real
// close, Reset Stats, Full Reset and a preset delete clear it — and nothing brings cleared data back.
// An in-progress Blitz round is still cleared by a reload (the owner's explicit choice).
//
// And THE LIVE-QUESTION RULE, which holds for all three ways back: the question that was waiting is
// regenerated only when a time could still be recorded for it — timing is shown in that mode at the
// moment it comes back, and the question is unanswered with no wrong answer, Reveal or Show Codes.
// Otherwise the same question returns, including on a screen with no history.
//
// The store and the engine halves have their own files (tests/sessionHistory,
// tests/engine/parkedHistory); this one proves the WIRING, on the mounted app, because a green store
// suite with the screens never calling it would be exactly the round-21 Group D failure.
//
// ★ HOW A RELOAD IS MODELLED. A real reload fires `pagehide` and then the page simply stops: React
// runs NO cleanup. So reloadApp() fires pagehide, keeps sessionStorage exactly as the page left it,
// tears the tree down, puts sessionStorage back as it was at pagehide (undoing anything a cleanup the
// real page never runs just did), and mounts again. The stores are module singletons that already
// hold what localStorage holds, which is what a real reload's hydration would read back. closeApp()
// is the other door: sessionStorage gone, the browsing session forgotten — the browser's own doing on
// a real close.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { screen, cleanup, act, fireEvent, within } from '@testing-library/react'
import {
  resetAppState,
  mountApp,
  tap,
  openSettings,
  closeSettings,
  fireFullReset,
} from './helpers/settingsPanel.jsx'
import {
  createPreset,
  switchPreset,
  setPresetAmnesic,
  deletePreset,
  isPresetFactory,
} from '../src/store/presetControl.js'
import { readSessionHistory, writeSessionHistory } from '../src/store/sessionHistory.js'
import { useSettings } from '../src/store/settings.js'
import { useModePrefs } from '../src/store/modePrefs.js'
import { useProgress } from '../src/store/progress.js'
import { forgetBrowsingSession } from '../src/store/browsingSession.js'
import { wday } from '../src/lib/calendar.js'
import { DAY } from '../src/lib/format.js'

// ── The visible screen (the modes are all mounted; only one is shown) ───────────────────────────
function isHidden(el) {
  for (let n = el; n; n = n.parentElement) if (n.style && n.style.display === 'none') return true
  return false
}
const visible = (sel, test) =>
  [...document.querySelectorAll(sel)].filter((e) => !isHidden(e) && test(e))
function readDate() {
  const els = visible(
    'div',
    (e) => e.children.length === 0 && /^-?\d+-\d+-\d+$/.test(e.textContent.trim()),
  )
  if (els.length !== 1) throw new Error(`expected one visible ymd date, found ${els.length}`)
  return els[0].textContent.trim()
}
const dayName = (text) => {
  const [y, m, d] = text.split('-').map(Number)
  return DAY[wday(y, m, d)]
}
const yearOf = (text) => Number(text.split('-')[0])
function statValue(label) {
  const [span] = visible('span', (s) => s.textContent.trim() === label)
  if (!span) throw new Error(`stat "${label}" not found on the visible screen`)
  return span.parentElement.querySelector('[data-statval]').textContent.trim()
}
const badge = () => visible('span', (s) => /^Q\d+$/.test(s.textContent.trim()))[0]?.textContent
const ctrl = (name) => screen.getByRole('button', { name })
const queryCtrl = (name) => screen.queryByRole('button', { name })
const press = (key) => act(() => fireEvent.keyDown(window, { key }))
// Back / Forward, by the key they are bound to (their faces are bare "<" / ">"), on the visible
// screen — enabled exactly when there is somewhere to go (a dimmed, click-through button otherwise).
const navButton = (key) => visible(`button[data-key="${key}"]`, () => true)[0]
const canGo = (key) => !navButton(key).className.includes('pointer-events-none')
const back = () => tap(navButton('ArrowLeft'))
const forward = () => tap(navButton('ArrowRight'))
const newQuestion = () => tap(ctrl('New'))
const revealed = () => queryCtrl('Reveal').className.includes('pointer-events-none')

const pinReadable = () =>
  act(() => {
    const s = useSettings.getState()
    s.setRandomFormat(false)
    s.setDateFormat('numeric-ymd')
    s.setMinY(1583)
    s.setMaxY(10000)
  })
// One Classic card answered right, first time.
const answerRight = () => tap(ctrl(dayName(readDate())))
const answerWrong = () => {
  const [y, m, d] = readDate().split('-').map(Number)
  tap(ctrl(DAY[(wday(y, m, d) + 1) % 7]))
}
// Classic and Deduction start with their timing HIDDEN; Flash with it shown. Set straight on the
// store — the on-screen toggle has side effects of its own (it regenerates), which are not under test.
const showClassicTiming = (shown) => act(() => useModePrefs.getState().setClassicTimingOff(!shown))
const confirmResetStats = () => {
  tap(ctrl('Reset Stats'))
  tap(
    within(screen.getByRole('dialog', { name: 'Reset Stats?' })).getByRole('button', {
      name: 'Reset Stats',
    }),
  )
}

// ── Reload, close, and the two ways the stats copy underneath the screens is swapped ────────────
const snapshotSession = () =>
  Array.from({ length: sessionStorage.length }, (_, i) => {
    const k = sessionStorage.key(i)
    return [k, sessionStorage.getItem(k)]
  })
function restoreSession(snapshot) {
  sessionStorage.clear()
  for (const [k, v] of snapshot) sessionStorage.setItem(k, v)
}
function teardown(app) {
  app.unmount()
  cleanup()
  document.getElementById('root')?.remove()
}
// The page going away (or to the background): what every reload fires first.
const hide = () =>
  act(() => {
    window.dispatchEvent(new Event('pagehide'))
  })
// `whileAway` runs between the page going and coming back — what another tab, or the reload itself,
// changed in the meantime.
function reloadApp(app, whileAway) {
  hide()
  const atPagehide = snapshotSession()
  teardown(app)
  restoreSession(atPagehide)
  if (whileAway) act(whileAway)
  return mountApp()
}
function closeApp(app) {
  teardown(app)
  sessionStorage.clear()
  forgetBrowsingSession()
  return mountApp()
}
let other // a second preset, made on demand
const otherPreset = () => {
  if (!other) act(() => void (other = createPreset()))
  return other
}
// Away to another preset and back again.
const switchAwayAndBack = (whileAway) => {
  act(() => switchPreset(otherPreset().id))
  if (whileAway) whileAway()
  act(() => switchPreset(1))
}
// A guest's visit: Amnesic on, then off.
const guestInterlude = (whileAway) => {
  act(() => setPresetAmnesic(1, true))
  if (whileAway) whileAway()
  act(() => setPresetAmnesic(1, false))
}
const historyKeys = () =>
  Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i)).filter((k) =>
    k.startsWith('cg-history-v1:'),
  )

let app
beforeEach(() => {
  other = null
  resetAppState()
  app = mountApp()
  pinReadable()
  newQuestion() // Classic's first question was drawn before the pin; New draws one in the pinned format
})
afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

// The three ways a casual screen comes back in one browsing session. `reload` reassigns `app`.
const WAYS_BACK = [
  ['a reload', () => (app = reloadApp(app))],
  ['a preset switch and back', () => switchAwayAndBack()],
  ['an Amnesic interlude', () => guestInterlude()],
]

describe('the history comes back exactly', () => {
  it.each(WAYS_BACK)(
    '%s: browsed back two cards — the same card, and Forward walks back out',
    (_, comeBack) => {
      const cards = []
      for (let i = 0; i < 3; i++) {
        cards.push(readDate())
        answerRight()
      }
      const live = readDate()
      back()
      back()
      expect(readDate()).toBe(cards[1])
      expect(badge()).toBe('Q2')

      comeBack()
      expect(readDate()).toBe(cards[1])
      expect(badge()).toBe('Q2')
      expect(statValue('Score')).toBe('3/3')
      back()
      expect(readDate()).toBe(cards[0])
      expect(canGo('ArrowLeft')).toBe(false)
      forward()
      forward()
      forward()
      expect(readDate()).toBe(live) // timing is hidden in Classic: the same question was waiting
      expect(canGo('ArrowRight')).toBe(false)
      // …and play goes on from where it left off: the next card joins the same history.
      answerRight()
      expect(statValue('Score')).toBe('4/4')
      back()
      expect(badge()).toBe('Q4')
    },
  )

  it.each(WAYS_BACK)(
    '%s: every card keeps its Override state — Undo still reads Undo',
    (_, comeBack) => {
      tap(ctrl('Reveal')) // a played miss…
      newQuestion() // …moved into the history
      back()
      tap(ctrl('Override')) // …and credited
      expect(statValue('Score')).toBe('1/1')
      expect(ctrl('Undo')).toBeInTheDocument()
      comeBack()
      expect(ctrl('Undo')).toBeInTheDocument()
      tap(ctrl('Undo'))
      expect(statValue('Score')).toBe('0/1')
    },
  )

  it('each preset keeps its OWN history', () => {
    answerRight()
    answerRight() // preset 1: two cards
    act(() => switchPreset(otherPreset().id))
    expect(statValue('Score')).toBe('0/0')
    expect(canGo('ArrowLeft')).toBe(false) // preset 2 starts with none of preset 1's
    pinReadable()
    newQuestion()
    answerRight() // preset 2: one card
    const waiting = readDate()
    act(() => switchPreset(1))
    expect(statValue('Score')).toBe('2/2')
    back()
    expect(badge()).toBe('Q2')
    act(() => switchPreset(other.id))
    expect(statValue('Score')).toBe('1/1')
    expect(readDate()).toBe(waiting)
    back()
    expect(badge()).toBe('Q1')
  })

  it('a second reload with no play in between still keeps it (the park is re-made each time)', () => {
    answerRight()
    app = reloadApp(app)
    app = reloadApp(app)
    expect(canGo('ArrowLeft')).toBe(true)
  })

  it('a real close starts it over — the stats stay', () => {
    answerRight()
    answerRight()
    app = closeApp(app)
    expect(statValue('Score')).toBe('2/2')
    expect(canGo('ArrowLeft')).toBe(false)
  })
})

describe('an Amnesic interlude: your history returns, the guest’s does not', () => {
  it('the guest never sees your history, and their own is gone when they are', () => {
    answerRight() // the owner's own card
    act(() => setPresetAmnesic(1, true))
    expect(statValue('Score')).toBe('0/0')
    expect(canGo('ArrowLeft')).toBe(false)
    answerRight()
    answerRight()
    app = reloadApp(app)
    expect(statValue('Score')).toBe('2/2') // still the guest, still amnesic
    back()
    expect(badge()).toBe('Q2')
    act(() => setPresetAmnesic(1, false))
    expect(statValue('Score')).toBe('1/1') // yours, with your one card behind it
    back()
    expect(badge()).toBe('Q1')
    // A later guest starts from nothing — not from the last guest's history.
    act(() => setPresetAmnesic(1, true))
    expect(statValue('Score')).toBe('0/0')
    expect(canGo('ArrowLeft')).toBe(false)
  })
})

// ── The live-question rule ───────────────────────────────────────────────────────────────────────
describe('the question that was waiting', () => {
  describe.each(WAYS_BACK)('%s', (_, comeBack) => {
    it('timing HIDDEN: the same unanswered question returns — even with no history at all', () => {
      const waiting = readDate()
      comeBack()
      expect(readDate()).toBe(waiting)
      expect(canGo('ArrowLeft')).toBe(false)
    })

    it('timing SHOWN: an unanswered question is regenerated — its clock restarts, so it must be new', () => {
      showClassicTiming(true)
      answerRight() // some history, so the park clearly came back
      const waiting = readDate()
      comeBack()
      expect(canGo('ArrowLeft')).toBe(true)
      expect(readDate()).not.toBe(waiting)
      expect(statValue('Score')).toBe('1/1')
    })

    it('timing SHOWN, browsed back: the unanswered question waiting behind the browsed card is regenerated too', () => {
      showClassicTiming(true)
      const first = readDate()
      answerRight()
      const waiting = readDate()
      back()
      comeBack()
      expect(readDate()).toBe(first) // still on the browsed card
      forward()
      expect(readDate()).not.toBe(waiting)
    })

    it.each([
      ['answered wrong', answerWrong],
      ['revealed', () => tap(ctrl('Reveal'))],
      ['shown its codes', () => tap(ctrl('Show Codes'))],
    ])('timing SHOWN, but the question was %s: no time can be recorded, so it stays', (_w, use) => {
      showClassicTiming(true)
      use()
      const waiting = readDate()
      comeBack()
      expect(readDate()).toBe(waiting)
    })
  })

  it('a reload records no solve time for a question read before it (the clock cannot be cheated)', () => {
    showClassicTiming(true)
    answerRight()
    const read = readDate() // the player reads this one for as long as they like…
    app = reloadApp(app) // …and reloads
    expect(readDate()).not.toBe(read) // it is not waiting for them with a fresh clock
  })

  it('it is decided when the screen COMES BACK: timing turned on in between regenerates it', () => {
    const waiting = readDate() // parked with timing hidden
    app = reloadApp(app, () => useModePrefs.getState().setClassicTimingOff(false))
    expect(readDate()).not.toBe(waiting)
  })

  it('…and timing turned OFF in between brings the same question back', () => {
    showClassicTiming(true)
    const waiting = readDate() // parked with timing shown
    guestInterlude(() => showClassicTiming(false)) // the guest hides it (the setup is shared)
    expect(readDate()).toBe(waiting)
  })

  // Timing shown is only half of "a time could be recorded": with Save Stats off nothing is, so
  // there is nothing to protect and the question the player was on must still be there. (The rule
  // used to look at timing alone and redrew it.) Save Stats coming back ON later is its own door,
  // pinned in tests/settingsPanel.lifecycle.
  describe.each(WAYS_BACK)('Save Stats OFF with timing shown — %s', (_, comeBack) => {
    it('the same unanswered question returns: no time can be recorded for it', () => {
      showClassicTiming(true)
      act(() => useSettings.getState().setSaveStats(false))
      const waiting = readDate()
      comeBack()
      expect(readDate()).toBe(waiting)
    })
  })

  it('Save Stats turned ON in between, with timing shown, regenerates it — decided as the screen comes back', () => {
    showClassicTiming(true)
    act(() => useSettings.getState().setSaveStats(false))
    const waiting = readDate() // parked while nothing counted
    guestInterlude(() => act(() => useSettings.getState().setSaveStats(true))) // the shared switch
    expect(readDate()).not.toBe(waiting)
  })

  it('a date setting changed under a parked history: an unanswered question is redrawn under the new one', () => {
    const waiting = readDate() // timing hidden — on its own this question would return
    guestInterlude(() =>
      act(() => {
        useSettings.getState().setMinY(2000)
        useSettings.getState().setMaxY(2001)
      }),
    )
    expect(readDate()).not.toBe(waiting)
    expect([2000, 2001]).toContain(yearOf(readDate()))
  })

  it('…but a question already answered wrong stays, exactly as it does when the setting changes on screen', () => {
    answerWrong()
    const waiting = readDate()
    guestInterlude(() =>
      act(() => {
        useSettings.getState().setMinY(2000)
        useSettings.getState().setMaxY(2001)
      }),
    )
    expect(readDate()).toBe(waiting)
  })

  it('a date setting changed with the ⚙ panel still open at the reload: the question is redrawn', () => {
    const waiting = readDate()
    openSettings('key')
    act(() => {
      useSettings.getState().setMinY(2000)
      useSettings.getState().setMaxY(2001)
    })
    // The panel never closed, so the question on screen was never regenerated — and it must not be
    // parked as if it belonged to the new range.
    app = reloadApp(app)
    expect(readDate()).not.toBe(waiting)
    expect([2000, 2001]).toContain(yearOf(readDate()))
  })

  it('the same holds while browsing history in one sitting: a narrowed range reaches the waiting question', () => {
    answerRight()
    const waiting = readDate()
    back()
    openSettings('key')
    act(() => {
      useSettings.getState().setMinY(2000)
      useSettings.getState().setMaxY(2001)
    })
    closeSettings('key')
    forward()
    expect(readDate()).not.toBe(waiting)
    expect([2000, 2001]).toContain(yearOf(readDate()))
  })
})

// ── What clears a history, and stays cleared ────────────────────────────────────────────────────
describe('what starts the history over — and nothing brings it back', () => {
  it.each(WAYS_BACK)('Reset Stats, then %s: still clear', (_, comeBack) => {
    answerRight()
    answerRight()
    hide() // a park is standing from before the reset
    confirmResetStats()
    expect(statValue('Score')).toBe('0/0')
    comeBack()
    expect(statValue('Score')).toBe('0/0')
    expect(canGo('ArrowLeft')).toBe(false)
  })

  it('Reset Stats retires the standing park at once — even if the page then dies without a goodbye', () => {
    act(() => useSettings.getState().setSaveStats(false))
    tap(ctrl('Reveal')) // answered, never scored: its park carries stats of zero, which a reset matches
    newQuestion()
    hide()
    expect(readSessionHistory('1:saved', 'classic')).not.toBe(null)
    act(() => useSettings.getState().setSaveStats(true))
    answerRight()
    confirmResetStats()
    expect(readSessionHistory('1:saved', 'classic')).toBe(null)
    // The page is discarded with no pagehide (a crash, a killed tab) and the session is restored.
    const asLeft = snapshotSession()
    teardown(app)
    restoreSession(asLeft)
    app = mountApp()
    expect(statValue('Score')).toBe('0/0')
    expect(canGo('ArrowLeft')).toBe(false)
  })

  it.each(WAYS_BACK)(
    'Full Reset, then %s: still clear (Save Stats off, so the stats cannot tell)',
    (_, comeBack) => {
      act(() => useSettings.getState().setSaveStats(false))
      tap(ctrl('Reveal')) // answered, never scored: the park carries stats of zero
      hide()
      openSettings('key')
      fireFullReset()
      expect(statValue('Score')).toBe('0/0')
      expect(revealed()).toBe(false) // a fresh card
      comeBack()
      expect(revealed()).toBe(false)
      expect(canGo('ArrowLeft')).toBe(false)
    },
  )

  it('Full Reset clears the history a guest interlude had put aside as well', () => {
    answerRight() // yours
    act(() => setPresetAmnesic(1, true)) // parked for the guest's visit
    openSettings('key')
    fireFullReset() // in the Amnesic preset: wipes both copies, and turns Amnesic back off
    expect(statValue('Score')).toBe('0/0')
    expect(canGo('ArrowLeft')).toBe(false)
    expect(historyKeys().filter((k) => sessionStorage.getItem(k)[0] === '1')).toEqual([])
  })

  it('deleting the preset you are on removes its parked histories — the switch away does not leave them', () => {
    const p2 = otherPreset()
    act(() => switchPreset(p2.id))
    pinReadable()
    newQuestion()
    answerRight()
    act(() => deletePreset(p2.id)) // back on preset 1
    expect(historyKeys().filter((k) => k.startsWith(`cg-history-v1:${p2.id}:`))).toEqual([])
  })

  it('saved stats that moved on underneath the park: the history is dropped, the stats win', () => {
    answerRight()
    // Another writer (the other site in this tab, another tab) moved the saved stats on.
    app = reloadApp(app, () =>
      useProgress.getState().setModeStats('classic', (s) => ({ ...s, played: s.played + 5 })),
    )
    expect(statValue('Score')).toBe('1/6')
    expect(canGo('ArrowLeft')).toBe(false)
  })

  it('a parked history this build cannot read: a fresh screen over the saved stats, no crash', () => {
    answerRight()
    hide()
    const atPagehide = snapshotSession().map(([k, v]) =>
      k.startsWith('cg-history-v1:') ? [k, '1{"engine":{"stack":"nope"}}'] : [k, v],
    )
    teardown(app)
    restoreSession(atPagehide)
    app = mountApp()
    expect(statValue('Score')).toBe('1/1')
    expect(canGo('ArrowLeft')).toBe(false)
  })
})

// ── Flash and Deduction ─────────────────────────────────────────────────────────────────────────
describe('Flash and Deduction', () => {
  it.each(WAYS_BACK)(
    'Flash, %s: a revealed card comes back with its date shown, its history behind it',
    (_, comeBack) => {
      press('F')
      tap(ctrl('Begin'))
      tap(ctrl('Reveal')) // mid-flash: freezes it, date stays shown
      const first = readDate()
      tap(ctrl('Begin'))
      tap(ctrl('Reveal'))
      const second = readDate()
      comeBack()
      expect(readDate()).toBe(second)
      expect(statValue('Score')).toBe('0/2')
      back()
      expect(readDate()).toBe(first)
    },
  )

  it('Flash: a flash still running is not restored — the screen comes back idle', () => {
    press('F')
    tap(ctrl('Begin'))
    tap(ctrl('Reveal'))
    tap(ctrl('Begin')) // a new flash, running
    app = reloadApp(app)
    expect(ctrl('Begin')).toBeInTheDocument()
    expect(() => readDate()).toThrow() // the idle dash, not a date
    expect(canGo('ArrowLeft')).toBe(true) // …with the finished card behind it
  })

  it.each(WAYS_BACK)('Deduction, %s: each sub-type keeps its own history', (_, comeBack) => {
    press('D')
    tap(ctrl('Reveal'))
    newQuestion()
    tap(ctrl('Month'))
    tap(ctrl('Reveal'))
    newQuestion()
    tap(ctrl('Reveal'))
    newQuestion()
    comeBack()
    expect(statValue('Score')).toBe('0/2') // Month is still the sub-type on show
    back()
    expect(badge()).toBe('Q2')
    tap(ctrl('Day'))
    expect(statValue('Score')).toBe('0/1')
    back()
    expect(badge()).toBe('Q1')
  })

  // The three puzzle filters are the screen's own state, saved nowhere else, and each sub-type's
  // waiting puzzle was drawn under them.
  const filterOn = (name) => ctrl(name).className.includes('btn-solid')
  it.each(WAYS_BACK)(
    'Deduction, %s: the puzzle filters come back with the history',
    (_, comeBack) => {
      act(() => useSettings.getState().setMinY(1500)) // a range the 1582 filters can be offered on
      press('D')
      tap(ctrl('Year'))
      tap(ctrl('ab Cross'))
      expect(filterOn('ab Cross')).toBe(true)
      tap(ctrl('Month'))
      tap(ctrl('1582 Only'))
      expect(filterOn('1582 Only')).toBe(true)
      comeBack()
      expect(filterOn('1582 Only')).toBe(true)
      tap(ctrl('Year'))
      expect(filterOn('ab Cross')).toBe(true)
      expect(filterOn('Jul Cross')).toBe(false)
    },
  )
})

describe('Blitz and MoX — the owner kept a reload clearing a round or run still in progress', () => {
  it('a Blitz round in progress is gone after the reload; the mode is idle', () => {
    press('B')
    tap(ctrl('Begin'))
    tap(ctrl(dayName(readDate())))
    expect(queryCtrl('Begin')).toBeNull()
    app = reloadApp(app)
    expect(ctrl('Begin')).toBeInTheDocument()
    expect(statValue('Score')).toBe('0/0')
    expect(canGo('ArrowLeft')).toBe(false)
  })

  it('a MoX run in progress is gone after the reload; the mode is idle', () => {
    press('A')
    tap(ctrl('Begin'))
    tap(ctrl(dayName(readDate())))
    expect(queryCtrl('Begin')).toBeNull()
    app = reloadApp(app)
    expect(ctrl('Begin')).toBeInTheDocument()
    expect(canGo('ArrowLeft')).toBe(false)
  })

  it('neither timed mode ever parks a history — only the five casual silos do', () => {
    press('B')
    tap(ctrl('Begin'))
    tap(ctrl(dayName(readDate())))
    hide()
    expect(historyKeys().sort()).toEqual(
      ['classic', 'dedDay', 'dedMonth', 'dedYear', 'flash'].map(
        (s) => `cg-history-v1:1:saved:${s}`,
      ),
    )
  })
})

// ── The budget's survivor ───────────────────────────────────────────────────────────────────────
// Every history together is held to one budget, and each write makes room by dropping others — so
// the LAST one written always survives (tests/sessionHistory pins that). It has to be the screen in
// use, not whichever screen mounted last.
describe('the screen in use is parked last', () => {
  const parkOrder = (act_) => {
    const written = []
    const real = Storage.prototype.setItem
    Storage.prototype.setItem = function (k, v) {
      if (this === window.sessionStorage && k.startsWith('cg-history-v1:')) written.push(k)
      return real.call(this, k, v)
    }
    try {
      act_()
    } finally {
      Storage.prototype.setItem = real
    }
    return written.map((k) => k.split(':').pop())
  }
  it.each([
    ['Classic', null, 'classic'],
    ['Flash', 'F', 'flash'],
    ['Deduction (Day)', 'D', 'dedDay'],
  ])('%s on screen', (_, key, silo) => {
    if (key) press(key)
    const order = parkOrder(hide)
    expect(order).toHaveLength(5)
    expect(order.at(-1)).toBe(silo)
  })
  it('Deduction: the sub-type on show', () => {
    press('D')
    tap(ctrl('Month'))
    expect(parkOrder(hide).at(-1)).toBe('dedMonth')
  })
  it('a preset switch parks in the same order', () => {
    press('F')
    const p2 = otherPreset()
    const order = parkOrder(() => act(() => switchPreset(p2.id)))
    expect(order).toHaveLength(5)
    expect(order.at(-1)).toBe('flash')
  })
})

describe("a preset's parked histories go where its other session data goes", () => {
  it('a preset you only LOOKED at is still factory-fresh; one you played in is not', () => {
    const p2 = otherPreset()
    expect(isPresetFactory(p2.id, true)).toBe(true)
    act(() => switchPreset(p2.id)) // looked at…
    act(() => switchPreset(1)) // …and left: its screens parked a waiting question each, no play
    expect(historyKeys().some((k) => k.startsWith(`cg-history-v1:${p2.id}:`))).toBe(true)
    expect(isPresetFactory(p2.id, true)).toBe(true)
    act(() => switchPreset(p2.id))
    act(() => useSettings.getState().setSaveStats(false))
    tap(ctrl('Reveal')) // play that reaches no saved stat: only the parked history holds it
    act(() => useSettings.getState().setSaveStats(true))
    act(() => switchPreset(1))
    expect(isPresetFactory(p2.id, true)).toBe(false)
  })
  it('deleting a preset removes its parks', () => {
    const p2 = otherPreset()
    writeSessionHistory(`${p2.id}:saved`, 'classic', '{}', true)
    expect(isPresetFactory(p2.id, true)).toBe(false)
    act(() => deletePreset(p2.id))
    expect(readSessionHistory(`${p2.id}:saved`, 'classic')).toBe(null)
  })
  it('an Amnesic toggle discards the parks of the guest copy, and only those', () => {
    const p2 = otherPreset()
    writeSessionHistory(`${p2.id}:saved`, 'classic', '{}', true)
    writeSessionHistory(`${p2.id}:session`, 'classic', '{}', true)
    act(() => setPresetAmnesic(p2.id, true))
    expect(readSessionHistory(`${p2.id}:session`, 'classic')).toBe(null)
    expect(readSessionHistory(`${p2.id}:saved`, 'classic')).toBe('{}')
  })
})
