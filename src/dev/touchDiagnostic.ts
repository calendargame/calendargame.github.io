// ─────────────────────────────────────────────────────────────────────────
// ⚠ TEMPORARY — dev/touchDiagnostic.ts — the iPhone touch diagnostic. TEST SITE ONLY: main.tsx
// loads it under /test_version/ and nowhere else, and this file, that loader block, and nothing
// more are the whole of it. Delete both together (one `git revert`) once the owner has reported.
//
// WHY IT EXISTS. Two reports from the owner's iPhone, in Safari and in the installed app alike:
//   1. LOST INPUT — a finger held still on a button for about two seconds or more, or dragged
//      about over the weekday buttons for a few seconds, then lifted: nothing registers.
//   2. THE MAGNIFIER — iOS's text-selection lens appears above the finger on a double-tap-and-hold
//      over controls that hold no text to select. `body{user-select:none}` does not stop it.
// What iOS delivers to a page after a long press is documented nowhere, and lib/pointerGestures'
// onCancel already rests on a guess about it. The status-bar rounds settled what guessing costs
// (main.tsx, "THE STATUS BAR UNDER A POPUP"), so this is the same move: show the owner what his
// phone actually sends, on the REAL app — the real buttons, the real gesture controller — and let
// him switch candidate cures on one at a time and say which one works.
//
// HOW IT STAYS OUT OF THE APP'S WAY
//   • Until "Touch test" is tapped it is one small button: no listener, no style on anything of
//     the app's. Closing the panel takes every listener and style back off.
//   • It only WATCHES unless a lettered switch is on. Its listeners sit on `window` in the capture
//     phase, which runs before the gesture controller's document listeners — so it also sees the
//     clicks that controller swallows — and it calls nothing of the app's.
//   • It is plain DOM, outside React's tree, and imports only two pure functions (the controller's
//     own release decision, so a rescue acts on exactly the button the controller would have).
//
// THE SWITCHES (each alone or in any combination; all off = the app as shipped):
//   A  -webkit-touch-callout:none on everything except text
//   B  user-select:none written on every element itself, not only on <body>
//   C  preventDefault() on every touchstart that lands on a button or an answer grid. The browser
//      then makes NO click for that touch, so the diagnostic presses the button itself on release.
//      Cost to weigh: a scroll can no longer start on a button.
//   D  touch-action:none on every button (the shipped state is `manipulation` on buttons and
//      `none` on the answer grids and the two menu triggers — index.css)
//   E  preventDefault() on contextmenu and selectstart outside text
//   F  the rescue for lost input: a touch that ends on the button it pressed (or, in an answer
//      grid, on another answer) and brings no click within CLICK_WAIT_MS is pressed for it — as is
//      one the system took away (pointercancel / touchcancel) while still on a button
//   G  C's narrow form: preventDefault() only on a touchstart that follows the previous touch's
//      end within DOUBLE_TAP_MS (the second tap of a double-tap), anywhere outside text
//   H  preventDefault() on touchend over a button — like C it costs the click, unlike C it
//      leaves scrolling alone
// Text boxes, and everything marked .select-text, are left alone by every switch.
//
// SOURCES for the candidates: WebKit bugs 231161 and 251572 (the double-tap lens is not stopped by
// user-select or -webkit-touch-callout; preventing touchstart stops it, at the cost above), and
// the W3C pointer-events discussion of long-press sequences (issue 503). None of them describes
// the lost input — which is why F only acts on what the log has first shown.
// ─────────────────────────────────────────────────────────────────────────
import { APP_VERSION } from '../appVersion.js'
import { gestureTarget, resolveRelease } from '../lib/pointerGestures.js'

const HOST_ID = 'cg-touch-diag'
const CLICK_WAIT_MS = 350 // F: how long a finished touch may wait for the browser's own click
const DOUBLE_TAP_MS = 400 // G: a touchstart this soon after the last touchend is a second tap
const SETTLE_MS = 50 // a touch is judged when BOTH its pointer end and its touch end are in, or this long after one
const OUTCOME_MS = 700 // how long after a touch its RESULT line waits for a click / an answer
const MOVE_LOG_MS = 250 // moves are logged at most this often, with a count of the ones skipped
const SHOWN = 40 // lines on screen; Copy log takes all of them
const KEPT = 4000

// The controller's own two selectors (lib/pointerGestures keeps them private). Restated here
// rather than exported there, so removing the diagnostic leaves that file untouched.
const GROUP_SELECTOR = '[data-answer-grid],[data-select-group]'
const TARGET_SELECTOR = 'button,[data-drag-focus]'
const TEXT_SELECTOR = 'input,textarea,select,[contenteditable],.select-text'
const SPARED = `${TEXT_SELECTOR},.select-text *,#${HOST_ID},#${HOST_ID} *`

type ToggleId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H'
const TOGGLES: { id: ToggleId; label: string; css?: string }[] = [
  {
    id: 'A',
    label: 'no callout',
    css:
      `body *:not(${SPARED}){-webkit-touch-callout:none!important}` +
      `${TEXT_SELECTOR},.select-text *{-webkit-touch-callout:default!important}`,
  },
  {
    id: 'B',
    label: 'no select',
    css: `body *:not(${SPARED}){-webkit-user-select:none!important;user-select:none!important}`,
  },
  { id: 'C', label: 'block press' },
  { id: 'D', label: 'no pan', css: `button:not(#${HOST_ID} *){touch-action:none!important}` },
  { id: 'E', label: 'block menu' },
  { id: 'F', label: 'rescue tap' },
  { id: 'G', label: 'block 2nd tap' },
  { id: 'H', label: 'block lift' },
]

// The diagnostic's own look. Sizes in rem so the log follows the app's fluid root font.
const OWN_CSS = `
#${HOST_ID}{position:fixed;left:0;right:0;z-index:2147483000;font:500 .75rem/1.3 ui-monospace,Menlo,Consolas,monospace;color:#f2f2f2;pointer-events:none}
#${HOST_ID}[data-at=top]{top:0}
#${HOST_ID}[data-at=bottom]{bottom:0}
#${HOST_ID} *{box-sizing:border-box}
#${HOST_ID} button{font:inherit;color:inherit;border:1px solid #777;border-radius:.4rem;background:#2b2b2b;padding:.3rem .5rem;pointer-events:auto}
#${HOST_ID} button[aria-pressed=true]{background:#0a7d2c;border-color:#5fe08a;font-weight:800}
#${HOST_ID} .cgd-open{position:fixed;left:.25rem;bottom:calc(.25rem + env(safe-area-inset-bottom));opacity:.75}
#${HOST_ID} .cgd-panel{display:flex;flex-direction:column;gap:.3rem;max-height:46vh;padding:.35rem .4rem calc(.35rem + env(safe-area-inset-bottom));background:#101010;border:1px solid #777;pointer-events:auto}
#${HOST_ID} .cgd-row{display:flex;flex-wrap:wrap;gap:.25rem;align-items:center}
#${HOST_ID} .cgd-env{font-size:.6rem;color:#bbb;overflow-wrap:anywhere}
#${HOST_ID} .cgd-log{flex:1 1 auto;min-height:6rem;margin:0;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:#000;padding:.25rem;font:inherit}
#${HOST_ID} textarea{width:100%;height:5rem;font:inherit;color:#000;background:#fff}
#${HOST_ID} [hidden]{display:none}
`

const elementOf = (t: EventTarget | null): Element | null =>
  t instanceof Element ? t : t instanceof Node ? t.parentElement : null
const inOwnUi = (t: EventTarget | null): boolean => !!elementOf(t)?.closest(`#${HOST_ID}`)
const inText = (t: EventTarget | null): boolean => !!elementOf(t)?.closest(TEXT_SELECTOR)
// What C and H act on: a button (which the diagnostic can press again itself) or the answer
// grid round one (the gaps between answers, where a prevented touch costs nothing).
const isPressable = (t: EventTarget | null): boolean =>
  !inOwnUi(t) && !inText(t) && !!elementOf(t)?.closest(`button,${GROUP_SELECTOR}`)

// How a line names what was touched: the control's kind and the first words on it.
const nameOf = (t: EventTarget | null): string => {
  const node = elementOf(t)
  if (!node) return '(nothing)'
  const e = node.closest('button,[role="button"],a,input,textarea,select,label') ?? node
  const words = (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ')
  const answer = e.closest('[data-answer-grid]') ? '[answer]' : ''
  return `${e.tagName.toLowerCase()}"${words.slice(0, 14)}"${answer}`
}
const at = (p: { clientX: number; clientY: number }): string =>
  `(${Math.round(p.clientX)},${Math.round(p.clientY)})`

const environment = (): string => {
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  return (
    `v${APP_VERSION} · ${standalone ? 'INSTALLED APP' : 'BROWSER TAB'} · ` +
    `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio} · ` +
    `touch points ${navigator.maxTouchPoints}\n${navigator.userAgent}`
  )
}

// One touch on a button, from its pointerdown to the moment both of its ends are in.
interface Press {
  el: HTMLElement
  group: Element | null
  isTrigger: boolean // a [data-select-trigger]: it acted on pointerdown, so nothing presses it again
  isTouch: boolean
  downAt: number
  x0: number
  y0: number
  x: number
  y: number
  moved: number // the furthest the finger got from where it landed, px
  ended: 'pointerup' | 'pointercancel' | 'touchcancel' | null
  touchEnded: boolean
  noClick: boolean // C, G, or H told the browser to make no click for this touch
  scrolled: boolean // something scrolled meanwhile — the touch was a scroll, never a press
  endedAt: number // when `ended` was first set
  earlyClick: string // a click on the button (or its group) that came before the touch was judged
}
// What became of a finished touch, gathered for OUTCOME_MS and then written as one RESULT line.
interface Outcome {
  el: HTMLElement
  group: Element | null
  text: string
  since: number // when the touch was judged — a click is timed from here
  click: string
  answered: boolean
  timer: number
}

// Puts the "Touch test" button on the page. Everything else waits for a tap on it.
export function installTouchDiagnostic(): void {
  if (document.getElementById(HOST_ID)) return

  const make = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className = '',
    text = '',
  ): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag)
    if (className) e.className = className
    if (text) e.textContent = text
    return e
  }
  const button = (text: string, onClick: () => void): HTMLButtonElement => {
    const b = make('button', '', text)
    b.type = 'button'
    b.addEventListener('click', onClick)
    return b
  }

  const host = make('div')
  host.id = HOST_ID
  host.dataset.at = 'bottom'
  const ownStyle = make('style', '', OWN_CSS)
  const cureStyle = make('style') // the CSS half of whichever switches are on
  const opener = button('Touch test', () => open())
  opener.className = 'cgd-open'
  const panel = make('div', 'cgd-panel')
  panel.hidden = true
  const env = make('div', 'cgd-env')
  const switches = make('div', 'cgd-row')
  const actions = make('div', 'cgd-row')
  const logBox = make('pre', 'cgd-log')
  const copyBox = make('textarea')
  copyBox.hidden = true
  copyBox.readOnly = true
  panel.append(env, switches, actions, copyBox, logBox)
  host.append(ownStyle, cureStyle, opener, panel)
  document.body.appendChild(host)

  // ── the log ─────────────────────────────────────────────────────────────
  const lines: string[] = []
  let t0 = 0
  let lastT = 0
  let frame = 0
  const draw = () => {
    frame = 0
    logBox.textContent = lines.slice(-SHOWN).join('\n')
    logBox.scrollTop = logBox.scrollHeight
  }
  // seconds since the log began, then the gap since the line before, then what happened
  const log = (what: string, detail = '') => {
    const now = performance.now()
    lines.push(
      `${((now - t0) / 1000).toFixed(3)} +${Math.round(now - lastT)} ${what}${detail ? ` ${detail}` : ''}`,
    )
    lastT = now
    if (lines.length > KEPT) lines.splice(0, lines.length - KEPT)
    if (!frame) frame = requestAnimationFrame(draw)
  }
  const clear = () => {
    lines.length = 0
    t0 = lastT = performance.now()
    copyBox.hidden = true
    draw()
  }

  // ── the switches ────────────────────────────────────────────────────────
  const on: Record<ToggleId, boolean> = {
    A: false,
    B: false,
    C: false,
    D: false,
    E: false,
    F: false,
    G: false,
    H: false,
  }
  const switchedOn = (): string =>
    TOGGLES.filter((t) => on[t.id])
      .map((t) => t.id)
      .join(' ') || 'none'
  for (const t of TOGGLES) {
    const b = button(`${t.id} ${t.label}`, () => {
      on[t.id] = !on[t.id]
      b.setAttribute('aria-pressed', String(on[t.id]))
      cureStyle.textContent = TOGGLES.map((x) => (on[x.id] && x.css) || '').join('')
      log(`—— ${t.id} ${on[t.id] ? 'ON' : 'OFF'} ——`, `switched on now: ${switchedOn()}`)
    })
    b.setAttribute('aria-pressed', 'false')
    switches.appendChild(b)
  }

  // ── judging a touch ─────────────────────────────────────────────────────
  let press: Press | null = null
  let settleTimer = 0
  let outcome: Outcome | null = null
  let awaited: HTMLElement | null = null // F: the button whose own click is being waited for
  let awaitTimer = 0
  let pressed: HTMLElement | null = null // the button the diagnostic last pressed itself…
  let pressedAt = 0 // …and when, so a late click from the browser for the same touch is not a second press
  let lastTouchEnd = -Infinity
  let preventedAt = -Infinity // when C or G last prevented a touchstart
  let answersChangedAt = -Infinity // when the answer buttons last changed state

  const flushOutcome = () => {
    if (!outcome) return
    clearTimeout(outcome.timer)
    const { el, text, click, answered } = outcome
    outcome = null
    const answer = el.closest('[data-answer-grid]')
      ? `; answer buttons ${answered ? 'CHANGED' : 'did NOT change'}`
      : ''
    log('RESULT', `${text}; click: ${click || 'NONE'}${answer}`)
  }
  const pressIt = (target: HTMLElement, why: string) => {
    log('TEST PRESSES', `${nameOf(target)} — ${why}`)
    pressed = target
    pressedAt = performance.now()
    target.click()
  }
  const stopAwaiting = () => {
    clearTimeout(awaitTimer)
    awaited = null
  }
  const awaitClick = (target: HTMLElement) => {
    stopAwaiting()
    awaited = target
    awaitTimer = window.setTimeout(() => {
      awaited = null
      pressIt(target, `F: no click came in ${CLICK_WAIT_MS} ms`)
    }, CLICK_WAIT_MS)
  }
  // Both ends of the touch are in (or SETTLE_MS has passed since the only one that came). Decide
  // what the gesture controller made of it with the controller's own rule, start the RESULT line,
  // and — only where a switch asks — press the button the app was never told about.
  const settle = () => {
    clearTimeout(settleTimer)
    const p = press
    if (!p) return
    press = null
    const lost = p.ended !== 'pointerup' // the controller saw no release: it activated nothing
    const under = gestureTarget(
      document.elementFromPoint(p.x, p.y)?.closest(TARGET_SELECTOR) ?? null,
    )
    const { suppressStart, activate } = resolveRelease(p.el, under, p.group)
    const same = !suppressStart
    const other = activate as HTMLElement | null
    flushOutcome()
    outcome = {
      el: p.el,
      group: p.group,
      text:
        `${nameOf(p.el)} held ${Math.round(performance.now() - p.downAt)} ms, moved ${Math.round(p.moved)} px, ` +
        `ended by ${p.ended ?? 'touchend alone'}${p.scrolled ? ' (the page scrolled)' : ''}, ` +
        `lifted ${same ? 'on it' : under ? `on ${nameOf(under)}` : 'off every button'}`,
      since: performance.now(),
      click: p.earlyClick && `${p.earlyClick}, before the touch had finished ending`,
      answered: answersChangedAt >= p.endedAt && p.endedAt > 0,
      timer: window.setTimeout(flushOutcome, OUTCOME_MS),
    }
    // A trigger acted on its pointerdown, a scroll was never a press, and a click that is
    // already in needs no help.
    if (p.isTrigger || p.scrolled || p.earlyClick) return
    if (!lost) {
      // The controller had its pointerup: it has clicked `other` itself, and it leaves a release
      // on the pressed button to the browser's own click — the one this is here to find missing.
      if (!same) return
      if (p.noClick)
        window.setTimeout(() => pressIt(p.el, 'the browser was told to make no click (C, G, or H)'))
      else if (on.F) awaitClick(p.el)
      return
    }
    if (!on.F) return
    if (same && !p.noClick) awaitClick(p.el)
    else if (same) pressIt(p.el, 'F: the system took the touch while it was on this button')
    else if (other) pressIt(other, 'F: the system took the touch; it ended on this answer')
  }
  const settleSoon = () => {
    clearTimeout(settleTimer)
    settleTimer = window.setTimeout(settle, SETTLE_MS)
  }
  const track = (p: Press, x: number, y: number) => {
    p.x = x
    p.y = y
    p.moved = Math.max(p.moved, Math.hypot(x - p.x0, y - p.y0))
  }

  // ── what is listened to ─────────────────────────────────────────────────
  const off: (() => void)[] = []
  const listen = <E extends Event>(
    target: EventTarget,
    type: string,
    handler: (e: E) => void,
    passive = true,
  ) => {
    const wrapped = (e: Event) => {
      if (!inOwnUi(e.target)) handler(e as E)
    }
    target.addEventListener(type, wrapped, { capture: true, passive })
    off.push(() => target.removeEventListener(type, wrapped, { capture: true }))
  }
  // A move is logged at most every MOVE_LOG_MS, saying how many went by unlogged in between.
  const quiet: Record<string, { at: number; skipped: number }> = {}
  const logMove = (type: string, detail: string) => {
    const q = (quiet[type] ??= { at: -Infinity, skipped: 0 })
    const now = performance.now()
    if (now - q.at < MOVE_LOG_MS) {
      q.skipped++
      return
    }
    log(type, `${detail}${q.skipped ? ` (+${q.skipped} more)` : ''}`)
    q.at = now
    q.skipped = 0
  }
  const prevent = (e: Event, letter: string): string => {
    if (!e.cancelable) return ` [${letter}: could not be prevented]`
    e.preventDefault()
    return ` [${letter}: prevented]`
  }

  const start = () => {
    listen<TouchEvent>(
      window,
      'touchstart',
      (e) => {
        let note = ''
        const second = performance.now() - lastTouchEnd < DOUBLE_TAP_MS
        if (on.C && isPressable(e.target)) note = prevent(e, 'C')
        else if (on.G && second && !inText(e.target)) note = prevent(e, 'G')
        // pointerdown comes before touchstart on every engine checked, so the touch's Press is
        // normally here already; `preventedAt` covers an engine that orders them the other way.
        if (e.defaultPrevented) {
          preventedAt = performance.now()
          if (press) press.noClick = true
        }
        log(
          'touchstart',
          `${nameOf(e.target)} ${at(e.changedTouches[0])} fingers=${e.touches.length}${second ? ' 2nd-tap' : ''}${note}`,
        )
      },
      false,
    )
    listen<TouchEvent>(window, 'touchmove', (e) => {
      const t = e.changedTouches[0]
      if (press) track(press, t.clientX, t.clientY)
      logMove('touchmove', at(t))
    })
    listen<TouchEvent>(
      window,
      'touchend',
      (e) => {
        let note = ''
        if (on.H && isPressable(e.target)) note = prevent(e, 'H')
        log('touchend', `${nameOf(e.target)} ${at(e.changedTouches[0])}${note}`)
        if (e.touches.length > 0) return
        lastTouchEnd = performance.now()
        if (!press) return
        if (note) press.noClick = e.defaultPrevented
        press.touchEnded = true
        if (press.ended === 'pointerup') settle()
        else {
          // No pointerup has come. Take the lift point from the touch and give one a moment.
          track(press, e.changedTouches[0].clientX, e.changedTouches[0].clientY)
          press.endedAt ||= performance.now()
          settleSoon()
        }
      },
      false,
    )
    listen<TouchEvent>(window, 'touchcancel', (e) => {
      log('touchcancel', nameOf(e.target))
      if (!press) return
      press.ended = 'touchcancel'
      press.endedAt ||= performance.now()
      settle()
    })

    listen<PointerEvent>(window, 'pointerdown', (e) => {
      log(
        'pointerdown',
        `${e.pointerType}#${e.pointerId} ${nameOf(e.target)} ${at(e)}${e.isPrimary ? '' : ' not-primary'}`,
      )
      if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return
      settle() // a touch still waiting for its other end is over now
      flushOutcome()
      const el = gestureTarget(elementOf(e.target)?.closest('button') ?? null)
      if (!el) return
      const group = el.closest(GROUP_SELECTOR)
      press = {
        el,
        group,
        isTrigger: !group && !!el.closest('[data-select-trigger]'),
        isTouch: e.pointerType === 'touch',
        downAt: performance.now(),
        x0: e.clientX,
        y0: e.clientY,
        x: e.clientX,
        y: e.clientY,
        moved: 0,
        ended: null,
        touchEnded: false,
        noClick: performance.now() - preventedAt < SETTLE_MS,
        scrolled: false,
        endedAt: 0,
        earlyClick: '',
      }
    })
    listen<PointerEvent>(window, 'pointermove', (e) => {
      if (press && e.isPrimary) track(press, e.clientX, e.clientY)
      if (e.pointerType !== 'mouse' || e.buttons) logMove('pointermove', at(e))
    })
    listen<PointerEvent>(window, 'pointerup', (e) => {
      log('pointerup', `${e.pointerType}#${e.pointerId} ${nameOf(e.target)} ${at(e)}`)
      if (!press || !e.isPrimary) return
      track(press, e.clientX, e.clientY)
      press.ended = 'pointerup'
      press.endedAt = performance.now()
      if (press.isTouch && !press.touchEnded) settleSoon()
      else settle()
    })
    listen<PointerEvent>(window, 'pointercancel', (e) => {
      log('pointercancel', `${e.pointerType}#${e.pointerId} ${nameOf(e.target)}`)
      // Nothing is judged yet: touch events carry on after a pointercancel, and the touchend
      // (or touchcancel) that follows says where the finger really was when it left.
      if (press && e.isPrimary) {
        press.ended = 'pointercancel'
        press.endedAt = performance.now()
      }
    })

    listen<MouseEvent>(window, 'mousedown', (e) => log('mousedown', nameOf(e.target)))
    listen<MouseEvent>(window, 'mouseup', (e) => log('mouseup', nameOf(e.target)))
    listen<MouseEvent>(window, 'dblclick', (e) => log('dblclick', nameOf(e.target)))
    listen<MouseEvent>(
      window,
      'click',
      (e) => {
        const target = elementOf(e.target)
        const who = e.isTrusted ? 'from the browser' : 'made by script'
        // The browser's own click, arriving after the diagnostic already pressed that button for
        // the same touch: let it through and the answer would be given twice.
        if (
          e.isTrusted &&
          pressed &&
          target &&
          pressed.contains(target) &&
          performance.now() - pressedAt < OUTCOME_MS
        ) {
          e.preventDefault()
          e.stopImmediatePropagation()
          log('click', `${nameOf(target)} ${who} — LATE, dropped (the test had pressed it)`)
          return
        }
        if (e.isTrusted && awaited && target && awaited.contains(target)) stopAwaiting()
        // A click belongs to a touch when it lands on the pressed button or, after a drag
        // across an answer grid, on another member of the same group.
        const of = (el: HTMLElement, group: Element | null) =>
          !!target && (el.contains(target) || !!group?.contains(target))
        const where = `${who} on ${nameOf(target)}`
        if (press && of(press.el, press.group)) press.earlyClick = where
        if (outcome && !outcome.click && of(outcome.el, outcome.group))
          outcome.click = `${where}, ${Math.round(performance.now() - outcome.since)} ms after the lift`
        log('click', `${nameOf(target)} ${who}`)
        // The gesture controller swallows a click by preventing it (its slide-off rule), in a
        // listener that runs after this one — so ask once the event has finished its rounds.
        window.setTimeout(() => {
          if (e.defaultPrevented) log('  ↳ that click was SWALLOWED by the app’s gesture rule')
        })
      },
      false,
    )
    listen<Event>(
      window,
      'contextmenu',
      (e) =>
        log('contextmenu', nameOf(e.target) + (on.E && !inText(e.target) ? prevent(e, 'E') : '')),
      false,
    )
    listen<Event>(
      window,
      'selectstart',
      (e) =>
        log('selectstart', nameOf(e.target) + (on.E && !inText(e.target) ? prevent(e, 'E') : '')),
      false,
    )
    listen<Event>(document, 'selectionchange', () => {
      const s = document.getSelection()
      if (s && inOwnUi(s.anchorNode)) return
      const text = s && !s.isCollapsed ? `"${s.toString().slice(0, 20)}"` : 'nothing selected'
      logMove('selectionchange', `${text} in ${nameOf(s?.anchorNode ?? null)}`)
    })
    for (const type of ['gesturestart', 'gestureend'])
      listen<Event>(window, type, (e) => log(type, nameOf(e.target)))
    listen<Event>(window, 'gesturechange', () => logMove('gesturechange', ''))
    listen<Event>(window, 'scroll', (e) => {
      if (press) press.scrolled = true
      logMove('scroll', nameOf(e.target === document ? document.documentElement : e.target))
    })
    listen<Event>(document, 'visibilitychange', () =>
      log('visibilitychange', document.visibilityState),
    )

    // "Did the app take an answer?" — read off the answer buttons themselves rather than inferred
    // from a click: an answered button changes class, and a new question changes them all back.
    // The drag ring (the controller's `drag-target` class) is the one class change that is not one.
    const ring = (c: string | null) => (c ?? '').replace(/\bdrag-target\b/, '').trim()
    const answers = new MutationObserver((records) => {
      const changed = records.some(
        (r) =>
          r.target instanceof Element &&
          !!r.target.closest('[data-answer-grid]') &&
          (r.attributeName !== 'class' ||
            ring(r.oldValue) !== ring(r.target.getAttribute('class'))),
      )
      if (!changed) return
      answersChangedAt = performance.now()
      if (outcome) outcome.answered = true
      logMove('answer buttons changed', '')
    })
    answers.observe(document.getElementById('root') ?? document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'disabled'],
      attributeOldValue: true,
    })
    off.push(() => answers.disconnect())
  }

  // ── the panel's own buttons ─────────────────────────────────────────────
  const report = (): string =>
    `${environment()}\nswitched on: ${switchedOn()}\n\n${lines.join('\n')}\n`
  const copyButton = button('Copy log', () => {
    const text = report()
    const done = (ok: boolean) => {
      copyButton.textContent = ok ? 'Copied' : 'Copy from the box'
      window.setTimeout(() => (copyButton.textContent = 'Copy log'), 2500)
      // No clipboard (an old phone, or a refusal): show the text in a box to copy by hand.
      copyBox.hidden = ok
      if (!ok) {
        copyBox.value = text
        copyBox.focus()
        copyBox.select()
      }
    }
    if (!navigator.clipboard) return done(false)
    navigator.clipboard.writeText(text).then(
      () => done(true),
      () => done(false),
    )
  })
  const moveButton = button('Move to top', () => {
    const top = host.dataset.at === 'bottom'
    host.dataset.at = top ? 'top' : 'bottom'
    moveButton.textContent = top ? 'Move to bottom' : 'Move to top'
  })
  const shrinkButton = button('Shrink', () => {
    const shrink = !logBox.hidden
    for (const part of [env, switches, logBox]) part.hidden = shrink
    copyBox.hidden = true
    shrinkButton.textContent = shrink ? 'Show log' : 'Shrink'
    if (!shrink) draw()
  })
  actions.append(
    copyButton,
    button('Clear', clear),
    moveButton,
    shrinkButton,
    button('Close', close),
  )

  function open() {
    opener.hidden = true
    panel.hidden = false
    env.textContent = environment()
    clear()
    start()
    log('touch test opened', 'switched on now: none')
  }
  // Back to the one small button, and the app exactly as shipped: every listener off, every
  // switch off, nothing waiting.
  function close() {
    for (const stop of off.splice(0)) stop()
    clearTimeout(settleTimer)
    stopAwaiting()
    if (outcome) clearTimeout(outcome.timer)
    outcome = press = pressed = null
    cancelAnimationFrame(frame)
    frame = 0
    for (const t of TOGGLES) on[t.id] = false
    for (const b of switches.children) b.setAttribute('aria-pressed', 'false')
    cureStyle.textContent = ''
    panel.hidden = true
    opener.hidden = false
  }
}
