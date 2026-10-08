// @vitest-environment jsdom
//
// keyboardFocus.dom — THE KEYBOARD'S FOCUS RING, on every screen.
//
// The ring is three facts joined by one stylesheet rule, and each fact has its own owner:
//   • WHICH control has focus — the browser's :focus;
//   • WHETHER the keyboard is what is being used — src/lib/keyboardFocus, one attribute on <html>;
//   • WHICH KEYS count as finding your way by keyboard — Tab, and an arrow that moves focus; never
//     a game shortcut. The ring is drawn anywhere a control has focus, so this is what keeps it off
//     a button a mouse player clicked a moment ago and is now answering with the number keys.
//     And a shortcut that ACTS is the player going back to playing: it puts the ring out, the way
//     a press does — which is what takes it off the Mode button after Tab has chosen a mode.
//
// ⚠ WHAT NO CASE HERE CAN PROVE. jsdom draws nothing and has no cascade worth trusting for layered
// CSS, so "a ring is on the screen" is not a thing this file can see. What it pins is each fact
// above and the exact rule that joins them, read from src/index.css. The ring itself — on every
// kind of control, in a dark and a light theme, absent under a mouse and a finger — was looked at
// in a real browser.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cleanup, act, fireEvent, screen, within } from '@testing-library/react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { installKeyboardFocus, shortcutActed, KEYBOARD_ATTR } from '../src/lib/keyboardFocus.js'
import { resetAppState, mountApp, openSettings, pressKey } from './helpers/settingsPanel.jsx'
import { useLookupHistory } from '../src/store/lookupHistory.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cssCode = readFileSync(join(root, 'src', 'index.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)
const byKeyboard = () => document.documentElement.hasAttribute(KEYBOARD_ATTR)
const press = (target = document.body) =>
  act(() => {
    fireEvent.pointerDown(target)
  })
const key = (k, target = document.body, init = {}) =>
  act(() => {
    fireEvent.keyDown(target, { key: k, ...init })
  })

describe('lib/keyboardFocus — is the keyboard what is being used?', () => {
  let uninstall
  let box
  let button
  beforeEach(() => {
    uninstall = installKeyboardFocus()
    box = document.createElement('input')
    box.type = 'text'
    button = document.createElement('button')
    document.body.append(box, button)
  })
  afterEach(() => {
    uninstall()
    box.remove()
    button.remove()
  })

  it('starts as "not the keyboard": nothing is ringed until a key is pressed', () => {
    expect(byKeyboard()).toBe(false)
  })

  it('Tab is the keyboard; the next press of a finger or mouse is not', () => {
    key('Tab', button)
    expect(byKeyboard()).toBe(true)
    press(button)
    expect(byKeyboard()).toBe(false)
  })

  it('Tab counts from anywhere — it is the key that moves focus', () => {
    key('Tab')
    expect(byKeyboard()).toBe(true)
    press()
    key('Tab', box) // …including from inside a text box
    expect(byKeyboard()).toBe(true)
  })

  // ★ The app's keys are mostly shortcuts, pressed with a hand on the mouse — and the button last
  // clicked still has focus. Any key used to count, which was harmless only while the ring was drawn
  // in the ⚙ menu and the popups alone.
  it.each([...'0123456789', 'n', 'r', 'o', 'c', 's', 'k', 'd', 'f', 'a', 'b', 'l', 'h', 'g'])(
    'a game shortcut is NOT the keyboard: %s',
    (shortcut) => {
      press(button)
      button.focus()
      key(shortcut, button)
      expect(byKeyboard()).toBe(false)
    },
  )

  // Said by whoever owns the shortcut, when it does something (the mounted cases below drive the
  // real ones): the player has gone back to playing.
  it('a shortcut that ACTED puts it out, as a press does — and Tab lights it again', () => {
    key('Tab', button)
    expect(byKeyboard()).toBe(true)
    shortcutActed()
    expect(byKeyboard()).toBe(false)
    key('Tab', button, { shiftKey: true })
    expect(byKeyboard()).toBe(true)
  })

  it('…and an arrow that turned out to be a shortcut is no longer watched for moving focus', () => {
    const other = document.createElement('button')
    document.body.append(other)
    key('ArrowLeft', button) // armed: has it moved focus?
    shortcutActed() // no — it stepped back a card
    act(() => other.focus()) // whatever the shortcut's own work then focuses is not the arrow's
    expect(byKeyboard()).toBe(false)
    other.remove()
  })

  it('Enter, Space, and Escape press or close what is there: they change nothing either way', () => {
    press(button)
    for (const k of ['Enter', ' ', 'Escape', 'Backspace', 'Delete']) key(k, button)
    expect(byKeyboard()).toBe(false)
    key('Tab', button)
    for (const k of ['Enter', ' ', 'Escape', '3', 'n']) key(k, button)
    expect(byKeyboard()).toBe(true) // …and a keyboard user stays one
  })

  it('an arrow is the keyboard only when it MOVES FOCUS — a page shortcut (← →, ↑ ↓) does not', async () => {
    const other = document.createElement('button')
    document.body.append(other)
    press(button)
    button.focus()
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'])
      key(k, button) // nothing answers by moving focus: Back, Forward, Lookup's history
    expect(byKeyboard()).toBe(false)
    // A control whose arrows walk its options moves focus as it handles the key.
    button.addEventListener('keydown', (e) => e.key === 'ArrowRight' && other.focus())
    key('ArrowRight', button)
    expect(byKeyboard()).toBe(true)
    // …and the watch does not outlive the key's own turn: a focus that arrives later is not its.
    press(button)
    key('ArrowLeft', button)
    await new Promise((done) => setTimeout(done))
    act(() => other.focus())
    expect(byKeyboard()).toBe(false)
    other.remove()
  })

  // A phone's on-screen keyboard sends the same key events as a real one. A tap into a year box
  // followed by typing must never light a ring on it.
  it('typing in a text box is NOT the keyboard driving the app', () => {
    press(box)
    for (const k of ['1', '9', 'Backspace', 'ArrowLeft', 'Enter', 'Escape']) key(k, box)
    expect(byKeyboard()).toBe(false)
  })

  it('a slider is not a text box: its arrow keys are the keyboard', () => {
    const range = document.createElement('input')
    range.type = 'range'
    document.body.append(range)
    press(range)
    key('ArrowRight', range)
    expect(byKeyboard()).toBe(true)
    range.remove()
  })

  it('a modifier going down, or a shortcut addressed to the browser, changes nothing', () => {
    for (const k of ['Shift', 'Control', 'Alt', 'Meta']) key(k, button)
    key('r', button, { ctrlKey: true })
    key('Tab', button, { altKey: true })
    key('Tab', button, { ctrlKey: true })
    key('c', button, { metaKey: true })
    expect(byKeyboard()).toBe(false)
    key('Tab', button, { shiftKey: true }) // Shift+Tab is a Tab
    expect(byKeyboard()).toBe(true)
  })

  it('is heard even when a control stops the press or the key it considers its own', () => {
    const stop = (e) => e.stopPropagation()
    button.addEventListener('keydown', stop)
    button.addEventListener('pointerdown', stop)
    key('Tab', button)
    expect(byKeyboard()).toBe(true)
    press(button)
    expect(byKeyboard()).toBe(false)
  })

  it('uninstalling takes the listeners and the mark with it', () => {
    key('Tab')
    uninstall()
    expect(byKeyboard()).toBe(false)
    key('Tab')
    expect(byKeyboard()).toBe(false)
    uninstall = installKeyboardFocus() // afterEach's uninstall needs a live one
  })
})

describe('the rule in index.css that draws it', () => {
  const RING = `:root[${KEYBOARD_ATTR}] :focus:not(`
  it('rings what has focus, anywhere, only while the keyboard is in use', () => {
    const at = cssCode.indexOf(RING)
    expect(at).toBeGreaterThan(-1)
    const [, excluded, body] = /:not\(([^)]*)\)\{([^}]*)\}/.exec(cssCode.slice(at))
    // A real, solid, 2px line in a named colour — and INSIDE the control's edge by default, so no
    // scroll region can clip it.
    expect(body).toBe(
      'outline:2px solid var(--kbd-ring,var(--tx-50));outline-offset:var(--kbd-ring-offset,-2px)',
    )
    // What takes focus and is not ringed: the three things that hold it without being a control
    // (a popup's card, the ⚙ menu's card, the page's scroller), a slider's track (its thumb is
    // ringed instead) and anything in an open list.
    expect(excluded.split(',').sort()).toEqual(
      [
        '[role="dialog"]',
        '[role="option"]',
        '[type="range"]',
        '#settings-popover',
        '#appScroll',
      ].sort(),
    )
  })

  it('EVERY selector that draws a ring starts at the keyboard mark', () => {
    // A rule is as wide as its widest selector, so each comma-separated one is checked on its own.
    const rings = [...cssCode.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, , body]) =>
      /outline:2px solid var\(--kbd-ring/.test(body),
    )
    expect(rings.length).toBe(1)
    for (const selector of rings[0][1].split(/,(?![^(]*\))/))
      expect(selector.trim().startsWith(`:root[${KEYBOARD_ATTR}] `)).toBe(true)
    expect(cssCode).not.toContain('data-kbd-cursor')
  })

  it('a control marked unavailable takes a DOTTED ring, not the solid one', () => {
    expect(cssCode).toContain(
      `:root[${KEYBOARD_ATTR}] [aria-disabled="true"]:focus{outline-style:dotted}`,
    )
  })

  it('never draws it from plain :focus or from the browser`s :focus-visible guess', () => {
    // :focus-visible matches a tapped text box and any scripted focus that follows a key press.
    expect(cssCode).not.toMatch(/:focus-visible/)
    // Every rule that gives a focused element a VISIBLE outline is gated on the keyboard mark.
    const visible = [...cssCode.matchAll(/([^{}]*:focus[^{}]*)\{([^}]*)\}/g)].filter(
      ([, , body]) => /outline:2px solid (?!transparent)/.test(body) || /box-shadow/.test(body),
    )
    expect(visible.length).toBe(3) // the ring, and the slider thumb for the two engines
    for (const [, selector] of visible) expect(selector).toContain(`:root[${KEYBOARD_ATTR}]`)
  })

  it('the browser draws nothing of its own, anywhere, for a press or for a key', () => {
    expect(cssCode).toContain(':focus{outline:2px solid transparent;outline-offset:-2px}')
    // …and nothing blanks it out for one kind of control: forced-colors mode paints a transparent
    // outline, and `none` would take that away.
    expect(cssCode).not.toMatch(/(button|select|input|a)[^{},]*:focus\{outline:none\}/)
  })

  it('a slider wears it on the thumb — in both engines` spelling', () => {
    for (const thumb of ['::-webkit-slider-thumb', '::-moz-range-thumb'])
      expect(cssCode).toContain(
        `:root[${KEYBOARD_ATTR}] input[type="range"]:focus${thumb}{box-shadow:0 0 0 2px var(--card-bg),0 0 0 4px var(--kbd-ring,var(--tx-50))}`,
      )
  })

  it('is white and further in on a filled control, and outside the readout — the drag ring too', () => {
    // Purple, rose, and the green and red of an answered day.
    expect(cssCode).toContain(
      '.btn-solid,.ring-on-fill,.btn-correct-persist,.btn-wrong-persist{--kbd-ring:#fff;--kbd-ring-offset:-4px}',
    )
    expect(cssCode).toContain('.ring-outside{--kbd-ring:var(--tx-50);--kbd-ring-offset:2px}')
    // The press-drag ring is inset everywhere else; on the readout that ran it through the digits.
    expect(cssCode).toContain('.ring-outside.drag-target{outline-offset:2px}')
  })

  // Amnesic's dashed frame and the ring can now be on one control: the stats strip, when the whole
  // strip is one button. At the ring's usual inset it would be drawn exactly over the dashes.
  it('sits clear inside Amnesic`s dashed frame where a control wears both', () => {
    expect(cssCode).toContain('.session-only{position:relative;--kbd-ring-offset:-5px}')
    expect(cssCode).toMatch(/\.session-only::after\{[^}]*inset:0;border:1\.5px dashed/)
  })

  // A Tailwind utility outranks the whole `components` layer the ring lives in, so one outline
  // utility on a control would silently take the ring off it — which is how the reorder grip lost
  // its only keyboard indicator once.
  it('no control in the app wears a Tailwind outline utility, or a class of its own for the ring', () => {
    const files = []
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(tsx?|jsx?)$/.test(name)) files.push(p)
      }
    }
    walk(join(root, 'src'))
    const offenders = files.filter((f) =>
      /(^|[\s"'`:])(outline-(hidden|none|\d|offset-)|focus-ring|focus-scope)/.test(
        readFileSync(f, 'utf8'),
      ),
    )
    expect(offenders).toEqual([])
  })
})

describe('on the mounted app', () => {
  beforeEach(() => {
    resetAppState()
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  // ★ The case the whole key rule exists for: a player with a hand on the mouse clicks a button —
  // it keeps focus — and plays on with the shortcut keys. No ring may ever light on that button.
  it('a click, then every game shortcut: the keyboard mark never lights', () => {
    mountApp()
    const fresh = screen.getByRole('button', { name: 'New' })
    press(fresh)
    act(() => fresh.focus())
    for (const k of ['3', 'n', 'r', 'c', 'c', 'ArrowLeft', 'ArrowRight', 'o', 'd', 'k', 'l']) {
      pressKey(k)
      expect([k, byKeyboard()]).toEqual([k, false])
    }
    for (const k of ['ArrowUp', 'ArrowDown', 'Backspace', 'h', 'h', 'g', 'g', 'Escape']) {
      pressKey(k)
      expect([k, byKeyboard()]).toEqual([k, false])
    }
  })

  // ★ The one navigating key a mouse-and-number-keys player does use: Tab opens the mode list (it
  // is the documented key for it), an arrow and Enter choose. The Mode button keeps focus — and it
  // used to keep the ring for the rest of the game, through every number key, until the next press
  // of the mouse.
  it('Tab, choose a mode, play on with the number keys: the ring goes with the first answer', () => {
    mountApp()
    const modeButton = screen.getByRole('button', { name: /^Mode,/ })
    pressKey('Tab')
    key('ArrowDown', modeButton)
    key('ArrowUp', modeButton)
    key('Enter', modeButton) // Classic, chosen from the list
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(modeButton)
    expect(byKeyboard()).toBe(true) // still finding their way round: nothing has been played yet
    pressKey('3') // an answer, right or wrong
    expect(byKeyboard()).toBe(false)
    pressKey('Tab') // …and navigating again lights it again
    expect(byKeyboard()).toBe(true)
  })

  it.each([
    ['a Game Action (N)', [], 'n'],
    ['Reveal (R)', [], 'r'],
    ['a mode letter (D)', [], 'd'],
    ['How to Play (H)', [], 'h'],
    ['the ⚙ menu (G)', [], 'g'],
    ['← once there is a card to step back to', ['r', 'n'], 'ArrowLeft'],
  ])('every shortcut that acts puts it out: %s', (_name, first, shortcut) => {
    mountApp()
    for (const k of first) pressKey(k)
    pressKey('Tab')
    pressKey('Escape') // the mode list Tab opened; the keyboard mark stays
    expect(byKeyboard()).toBe(true)
    pressKey(shortcut)
    expect(byKeyboard()).toBe(false)
  })

  it('on Lookup, ↑ and ↓ choose a history row — shortcuts there — and Backspace clears the box', () => {
    const entry = (id, y, m, d) => ({ id, y, m, d })
    useLookupHistory.getState().setHistory([entry('a', 2001, 1, 1), entry('b', 2002, 2, 2)])
    mountApp()
    pressKey('l')
    for (const k of ['ArrowDown', 'ArrowUp', 'Backspace']) {
      pressKey('Tab')
      pressKey('Escape') // the mode list Tab opened; the keyboard mark stays
      expect([k, byKeyboard()]).toEqual([k, true])
      key(k) // Lookup listens on the document: pressed on the page
      expect([k, byKeyboard()]).toEqual([k, false])
    }
  })

  // The same keys, where they do nothing: a keyboard user finding their way round keeps the ring.
  it('a key that is not a shortcut where it is pressed changes nothing', () => {
    mountApp()
    pressKey('Tab')
    pressKey('Escape')
    for (const k of ['ArrowUp', 'ArrowDown', 'Backspace', 'x', 'Enter', ' ']) {
      key(k) // Classic: ↑ ↓ and Backspace are Lookup's, and there is no X
      expect([k, byKeyboard()]).toEqual([k, true])
    }
    pressKey('l')
    pressKey('Tab')
    pressKey('Escape')
    for (const k of ['3', 'n', 'r', 'ArrowLeft', 'ArrowUp']) {
      key(k) // Lookup: no answer grid, no Game Actions, and no history to choose from yet
      expect([k, byKeyboard()]).toEqual([k, true])
    }
  })

  it('under the ⚙ menu the page`s keys are out of reach, so they change nothing — G closes it, and does', () => {
    mountApp()
    openSettings()
    const panel = document.getElementById('settings-popover')
    key('Tab', panel)
    expect(byKeyboard()).toBe(true)
    for (const k of ['3', 'n', 'r', 'ArrowLeft', 'ArrowDown']) {
      key(k)
      expect([k, byKeyboard()]).toEqual([k, true])
    }
    pressKey('g')
    expect(document.getElementById('settings-popover')).toBeNull()
    expect(byKeyboard()).toBe(false)
  })

  it('typing in a text box is neither: the ring a Tab lit stays while a year is typed', () => {
    mountApp()
    openSettings()
    const [from] = within(document.getElementById('settings-popover')).getAllByRole('textbox')
    act(() => from.focus())
    key('Tab', from)
    expect(byKeyboard()).toBe(true)
    for (const k of ['1', '9', 'ArrowLeft', 'Backspace', 'n', 'g']) key(k, from)
    expect(byKeyboard()).toBe(true)
  })

  it('Tab lights it (the keyboard is on the Mode button), and a press puts it out', () => {
    mountApp()
    pressKey('Tab')
    expect(byKeyboard()).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Mode,/ }))
    press()
    expect(byKeyboard()).toBe(false)
  })

  it('an arrow along a setting`s options moves focus, so it lights it', () => {
    mountApp()
    openSettings()
    const pills = within(document.getElementById('settings-popover')).getAllByRole('radio')
    const chosen = pills.find((pill) => pill.tabIndex === 0)
    press(chosen)
    act(() => chosen.focus())
    expect(byKeyboard()).toBe(false)
    key('ArrowRight', chosen)
    expect(document.activeElement).not.toBe(chosen)
    expect(byKeyboard()).toBe(true)
  })

  // The open list is driven from its button, which keeps the real focus — so the BUTTON is what the
  // ring is on, list open or shut, and nothing in the list is marked for one (tests/customselect).
  it('the ⚙ menu`s list button keeps the keyboard while its list is open', () => {
    mountApp()
    openSettings()
    const trigger = within(document.getElementById('settings-popover')).getByRole('button', {
      name: /^Open in/,
    })
    act(() => {
      fireEvent.click(trigger)
    })
    key('ArrowDown', trigger)
    const options = screen.getAllByRole('option')
    expect(document.activeElement).toBe(trigger)
    expect(trigger.getAttribute('aria-activedescendant')).toBe(options[1].id)
    for (const option of options) expect(option.hasAttribute('data-kbd-cursor')).toBe(false)
  })
})
