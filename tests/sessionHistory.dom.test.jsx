// @vitest-environment jsdom
//
// sessionHistory.dom — round 23 Q11: a RELOAD keeps Classic / Flash / Deduction's back/forward
// history (the owner: "only truly closing the app starts fresh"), and a real close, a preset switch
// and Full Reset still start it over; an in-progress Blitz round is still cleared by a reload (his
// explicit choice). The store and the engine halves have their own files (tests/sessionHistory,
// tests/engine/parkedHistory); this one proves the WIRING, on the mounted app, because a green store
// suite with the screens never calling it would be exactly the round-21 Group D failure.
//
// ★ HOW A RELOAD IS MODELLED, and why it is not a bare unmount. A real reload fires `pagehide` and then
// the page simply stops: React runs NO cleanup. An unmount does run them — and a casual screen's
// cleanup deliberately discards its parked history, because every real unmount (a preset switch, an
// Amnesic toggle, Full Reset, a crash) must start the history over. So reloadApp() fires pagehide,
// keeps sessionStorage exactly as the page left it, tears the tree down, puts sessionStorage back as
// it was at pagehide (undoing only what the cleanups the real page never runs just did), and mounts
// again. The stores are module singletons that already hold what localStorage holds, which is what a
// real reload's hydration would read back. closeApp() is the other door: sessionStorage gone, the
// browsing session forgotten — the browser's own doing on a real close.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { screen, cleanup, act, fireEvent } from '@testing-library/react'
import {
  resetAppState,
  mountApp,
  tap,
  openSettings,
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

// ── Reload and close ───────────────────────────────────────────────────────────────────────────
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
function reloadApp(app) {
  hide()
  const atPagehide = snapshotSession()
  teardown(app)
  restoreSession(atPagehide)
  return mountApp()
}
function closeApp(app) {
  teardown(app)
  sessionStorage.clear()
  forgetBrowsingSession()
  return mountApp()
}

let app
beforeEach(() => {
  resetAppState()
  app = mountApp()
  pinReadable()
  newQuestion() // Classic's first question was drawn before the pin; New draws one in the pinned format
})
afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

describe('Classic — a reload keeps the history, a real close does not', () => {
  it('browsed back two cards: the reload lands on the same card, and Forward walks back out', () => {
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

    app = reloadApp(app)
    expect(readDate()).toBe(cards[1])
    expect(badge()).toBe('Q2')
    expect(statValue('Score')).toBe('3/3')
    back()
    expect(readDate()).toBe(cards[0])
    expect(canGo('ArrowLeft')).toBe(false)
    forward()
    forward()
    forward()
    expect(readDate()).toBe(live)
    expect(canGo('ArrowRight')).toBe(false)
    // …and play goes on from where it left off: the next card joins the same history.
    answerRight()
    expect(statValue('Score')).toBe('4/4')
    back()
    expect(badge()).toBe('Q4')
  })

  it('every card keeps its Override state across the reload — Undo still reads Undo', () => {
    tap(ctrl('Reveal')) // a played miss…
    newQuestion() // …moved into the history
    back()
    tap(ctrl('Override')) // …and credited
    expect(statValue('Score')).toBe('1/1')
    expect(ctrl('Undo')).toBeInTheDocument()
    app = reloadApp(app)
    expect(ctrl('Undo')).toBeInTheDocument()
    tap(ctrl('Undo'))
    expect(statValue('Score')).toBe('0/1')
  })

  it('an answered live card comes back as it was — not replaced by a new question', () => {
    tap(ctrl('Reveal'))
    const shown = readDate()
    app = reloadApp(app)
    expect(readDate()).toBe(shown)
    expect(statValue('Score')).toBe('0/1')
    expect(queryCtrl('Reveal').className).toContain('pointer-events-none') // already revealed
  })

  it('a real close starts it over — the stats stay', () => {
    answerRight()
    answerRight()
    app = closeApp(app)
    expect(statValue('Score')).toBe('2/2')
    expect(canGo('ArrowLeft')).toBe(false)
  })

  it('a second reload with no play in between still keeps it (the park is re-made each time)', () => {
    answerRight()
    app = reloadApp(app)
    app = reloadApp(app)
    expect(canGo('ArrowLeft')).toBe(true)
  })
})

describe('what still starts the history over', () => {
  it('a preset switch and back — even with a park standing from an earlier hide', () => {
    answerRight()
    hide() // the page was hidden once, earlier in the visit: a park is standing
    const p2 = createPreset()
    act(() => switchPreset(p2.id))
    act(() => switchPreset(1))
    expect(statValue('Score')).toBe('1/1')
    expect(canGo('ArrowLeft')).toBe(false)
    app = reloadApp(app)
    expect(canGo('ArrowLeft')).toBe(false)
  })

  it('Full Reset — even over a park whose stats a reset leaves matching (Save Stats off)', () => {
    act(() => useSettings.getState().setSaveStats(false))
    tap(ctrl('Reveal')) // answered, never scored: the park carries stats of zero
    hide()
    openSettings('key')
    fireFullReset()
    expect(statValue('Score')).toBe('0/0')
    expect(ctrl('Reveal').className).not.toContain('pointer-events-none') // a fresh card
    app = reloadApp(app)
    expect(ctrl('Reveal').className).not.toContain('pointer-events-none')
  })

  it('saved stats that moved on underneath the park: the history is dropped, the stats win', () => {
    answerRight()
    hide()
    const atPagehide = snapshotSession()
    teardown(app)
    restoreSession(atPagehide)
    // Another writer (the other site in this tab, another tab) moved the saved stats on.
    act(() =>
      useProgress.getState().setModeStats('classic', (s) => ({ ...s, played: s.played + 5 })),
    )
    app = mountApp()
    expect(statValue('Score')).toBe('1/6')
    expect(canGo('ArrowLeft')).toBe(false)
  })

  it('a parked history this build cannot read: a fresh screen over the saved stats, no crash', () => {
    answerRight()
    hide()
    const atPagehide = snapshotSession().map(([k, v]) =>
      k.startsWith('cg-history-v1:') ? [k, '{"engine":{"stack":"nope"}}'] : [k, v],
    )
    teardown(app)
    restoreSession(atPagehide)
    app = mountApp()
    expect(statValue('Score')).toBe('1/1')
    expect(canGo('ArrowLeft')).toBe(false)
  })
})

describe('Amnesic — a guest history stays with the guest copy', () => {
  it('survives the guest reload, and never comes back over the permanent stats', () => {
    answerRight() // the owner's own card
    act(() => setPresetAmnesic(1, true))
    expect(statValue('Score')).toBe('0/0')
    answerRight()
    answerRight()
    app = reloadApp(app)
    expect(statValue('Score')).toBe('2/2') // still the guest, still amnesic
    back()
    expect(badge()).toBe('Q2')
    act(() => setPresetAmnesic(1, false))
    expect(statValue('Score')).toBe('1/1')
    expect(canGo('ArrowLeft')).toBe(false)
  })
})

describe('Flash and Deduction', () => {
  it('Flash: a revealed card comes back with its date shown, its history behind it', () => {
    press('F')
    tap(ctrl('Begin'))
    tap(ctrl('Reveal')) // mid-flash: freezes it, date stays shown
    const first = readDate()
    tap(ctrl('Begin'))
    tap(ctrl('Reveal'))
    const second = readDate()
    app = reloadApp(app)
    expect(readDate()).toBe(second)
    expect(statValue('Score')).toBe('0/2')
    back()
    expect(readDate()).toBe(first)
  })

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

  it('Deduction: each sub-type keeps its own history', () => {
    press('D')
    tap(ctrl('Reveal'))
    newQuestion()
    tap(ctrl('Month'))
    tap(ctrl('Reveal'))
    newQuestion()
    tap(ctrl('Reveal'))
    newQuestion()
    app = reloadApp(app)
    expect(statValue('Score')).toBe('0/2') // Month is still the sub-type on show
    back()
    expect(badge()).toBe('Q2')
    tap(ctrl('Day'))
    expect(statValue('Score')).toBe('0/1')
    back()
    expect(badge()).toBe('Q1')
  })
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

  it('neither timed mode ever writes a parked history', () => {
    press('B')
    tap(ctrl('Begin'))
    tap(ctrl(dayName(readDate())))
    hide()
    const keys = Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i))
    expect(keys.filter((k) => k.startsWith('cg-history-v1:'))).toEqual([])
  })
})

describe("a preset's parked histories go where its other session data goes", () => {
  // A park only outlives its screen when a reload landed on a different preset than the one that
  // parked it (another tab moved the shared registry) — so these seed one directly.
  it('a preset not on screen with a park is not factory-fresh; deleting it removes the park', () => {
    const p2 = createPreset()
    expect(isPresetFactory(p2.id, true)).toBe(true)
    writeSessionHistory(`${p2.id}:saved`, 'classic', '{}')
    expect(isPresetFactory(p2.id, true)).toBe(false)
    act(() => deletePreset(p2.id))
    expect(readSessionHistory(`${p2.id}:saved`, 'classic')).toBe(null)
  })
  it('an Amnesic toggle discards the parks of the guest copy, and only those', () => {
    const p2 = createPreset()
    writeSessionHistory(`${p2.id}:saved`, 'classic', '{}')
    writeSessionHistory(`${p2.id}:session`, 'classic', '{}')
    act(() => setPresetAmnesic(p2.id, true))
    expect(readSessionHistory(`${p2.id}:session`, 'classic')).toBe(null)
    expect(readSessionHistory(`${p2.id}:saved`, 'classic')).toBe('{}')
  })
})
