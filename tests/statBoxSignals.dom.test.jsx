// @vitest-environment jsdom
//
// THE STAT BOX'S THREE SIGNALS (C1, round 16) — the behaviour net for the redesign.
//
// The rule the whole strip is built to, site-wide, in every mode that has toggleable stats:
//
//   • an em dash (—)  = there is no data YET, but there could be
//   • BLANK           = this group is HIDDEN
//   • DIM             = nothing is being recorded — and dim only ever applies to the WHOLE STRIP,
//                       never to one cell
//
// ⚠ BLANK MEANS HIDDEN AND NOTHING MORE, and the shorthand it replaced ("you turned these off; they
// ARE still recording") was wrong twice over. Whether hiding also PAUSES is the caller's business,
// not the panel's: the scoring trio keeps recording in every mode and the timing trio keeps
// recording in Blitz/AoX (visual-only, Q8), but hiding timing in Classic/Deduction/Flash stops the
// clock outright and re-enabling after answering costs a full reset. And it is not always the
// user's own doing — Classic and Deduction SHIP with timing hidden, which is the launch case pinned
// further down. Only the first of those halves is exercised by the RECORDING case below (the
// scoring trio), so the shorthand was also unguarded where it was false.
//
// and the full table those three produce:
//
//   group on, no data ....... the values, which read '—'      plain
//   group on, has data ...... the values                      plain
//   group OFF ............... value cells BLANK, labels stay  plain
//   Save Stats off .......... '—' in every value cell         whole strip dimmed
//   group off + Save off .... value cells BLANK               whole strip dimmed
//
// WHAT IT REPLACED, AND THE REAL BUG UNDERNEATH IT. One flag used to carry two facts:
// modeHooks derived `sOff = scoringOff || !saveStats`, and that single bit drove BOTH a label
// strikethrough and an em dash. So turning Save Stats off struck through and dashed EVERY box, and
// your own per-group choices vanished underneath the global state — not lost (scoringOff/timingOff
// persist and come back) but invisible, so you could not predict what a tap would do. Separately, a
// SHOWN stat with nothing recorded yet also read as a dash, so "I hid this" and "nothing here yet"
// were the same picture. The two facts are now two flags — `off` (yours, per group) and `dimmed`
// (the app's, whole strip) — and the strikethrough is gone entirely.
//
// The file has two halves. The first drives <StatPanel> directly, because the table above is a
// statement about the COMPONENT and every mode inherits whatever it does. The second drives the
// real <App/> through Classic, because the bug was in the shared hook's derivation and only a real
// screen with a real Save Stats switch can prove the two flags no longer collapse into one.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, within, cleanup, fireEvent, act } from '@testing-library/react'
import StatPanel from '../src/components/StatPanel.jsx'
import { App } from '../src/main.jsx'
import { useSettings } from '../src/store/settings.js'
import { useModePrefs } from '../src/store/modePrefs.js'
import { wday } from '../src/lib/calendar.js'
import { DAY } from '../src/lib/format.js'

// ── Readers ───────────────────────────────────────────────────────────────────────────────────
// THE VISIBLE strip. All five mode screens stay mounted (display:none for the four you are not in),
// so "the stats strip" is only ever a question about the visible one — and asking it of the whole
// document would silently answer with whichever hidden mode happens to come first in the tree.
const isHidden = (el) => {
  for (let n = el; n; n = n.parentElement) if (n.style && n.style.display === 'none') return true
  return false
}
// The strip root is the element the auto-fit effect observes; every cell hangs off it. Found from
// the value spans up rather than by its own class, so the dim assertions cannot become tautologies.
const strip = () => {
  const roots = new Set(
    [...document.querySelectorAll('[data-statval]')]
      .filter((v) => !isHidden(v))
      .map((v) => v.closest('.panel')),
  )
  if (roots.size !== 1)
    throw new Error(`strip(): expected exactly one visible stats strip, found ${roots.size}`)
  return [...roots][0]
}
const cells = () => [...strip().children].filter((el) => el.querySelector('[data-statval]'))
const cellFor = (label) =>
  cells().find((c) => [...c.querySelectorAll('span')].some((s) => s.textContent.trim() === label))
// What a readout READS, through the value span's own marker — never "the cell's last span", which a
// blanked cell's trailing sr-only "Off" would answer instead. `.trim()` is kept so this stays a
// statement about what the box SAYS rather than about whitespace: a blank cell reads as the empty
// string exactly as it looks, whether or not the value ever carries padding of its own.
const valueOf = (label) => cellFor(label).querySelector('[data-statval]').textContent.trim()
// The RAW value node text — untrimmed, so a height strut smuggled back into the value would show
// here and nowhere else (the blank cell reserves its height with a fixed-height BOX now, not with
// content; see the height test below).
const rawValueOf = (label) => cellFor(label).querySelector('[data-statval]').textContent
// The fixed-height box the value is centred in — the value span's own parent. It is what keeps a
// blank cell, a short value and an auto-fit-shrunken value all the same height.
const valueCellOf = (label) => cellFor(label).querySelector('[data-statval]').parentElement
const srTextOf = (label) =>
  [...cellFor(label).querySelectorAll('.sr-only')].map((s) => s.textContent).join('')
// The thin rules between cells. "Not a cell" no longer identifies them on its own: a dimmed strip
// also holds the sr-only line that announces the dim, which is a child of the strip and holds no
// value span. It is excluded BY ITS OWN MARKER rather than by position, so this stays a statement
// about dividers whichever end of the strip that line is written at.
const dividers = () =>
  [...strip().children].filter(
    (el) => !el.querySelector('[data-statval]') && !el.classList.contains('sr-only'),
  )
// The strip-level announcement, read as its own thing — the DIM's answer to the blank cell's "Off".
const stripSrText = () =>
  [...strip().children]
    .filter((el) => el.classList.contains('sr-only'))
    .map((el) => el.textContent)
    .join('')
const isDimmed = (el) => el.className.split(/\s+/).includes('opacity-50')

const SIX = ['Score', 'Accuracy', 'Streak', 'Last', 'Mean', 'Median']
// A strip with data in the scoring trio and nothing recorded in the timing trio — the two halves of
// the "has data" / "no data yet" distinction in one fixture. The timing values are what the real
// formatters return with an empty times array, so the dash here is the app's own dash.
const withData = (over = {}) => [
  { label: 'Score', value: '3/4', fn: () => {}, ...over.scoring },
  { label: 'Accuracy', value: '75.0%', fn: () => {}, ...over.scoring },
  { label: 'Streak', value: '2/3', fn: () => {}, ...over.scoring },
  { label: 'Last', value: '—', fn: () => {}, ...over.timing },
  { label: 'Mean', value: '—', fn: () => {}, ...over.timing },
  { label: 'Median', value: '—', fn: () => {}, ...over.timing },
]

describe('StatPanel — the three signals (C1)', () => {
  afterEach(cleanup)

  it('group on with data: the values, plain — no dim on the strip and none on any cell', () => {
    render(<StatPanel stats={withData()} />)
    expect(valueOf('Score')).toBe('3/4')
    expect(valueOf('Accuracy')).toBe('75.0%')
    expect(valueOf('Streak')).toBe('2/3')
    expect(isDimmed(strip())).toBe(false)
    expect(cells().some(isDimmed)).toBe(false)
  })

  it('group on with NO data yet: an em dash — the one thing a dash is allowed to mean', () => {
    render(<StatPanel stats={withData()} />)
    expect(valueOf('Last')).toBe('—')
    expect(valueOf('Mean')).toBe('—')
    expect(valueOf('Median')).toBe('—')
    expect(isDimmed(strip())).toBe(false)
  })

  it('group OFF: the three value cells go BLANK, their labels stay, and nothing dims', () => {
    render(<StatPanel stats={withData({ scoring: { off: true } })} />)
    expect(valueOf('Score')).toBe('')
    expect(valueOf('Accuracy')).toBe('')
    expect(valueOf('Streak')).toBe('')
    // The labels are the whole reason the cells stay: they name what a tap would bring back.
    for (const label of SIX) expect(cellFor(label)).toBeTruthy()
    // The other group is untouched — one toggle, one group.
    expect(valueOf('Last')).toBe('—')
    expect(isDimmed(strip())).toBe(false)
  })

  it('Save Stats off: every value reads — and the WHOLE STRIP dims (never a single cell)', () => {
    render(<StatPanel stats={withData()} dimmed />)
    for (const label of SIX) expect(valueOf(label)).toBe('—')
    expect(isDimmed(strip())).toBe(true)
    expect(cells().some(isDimmed)).toBe(false)
    expect(dividers().some(isDimmed)).toBe(false)
  })

  it('group off + Save Stats off: BLANK wins over the dash, and the strip is dimmed', () => {
    render(<StatPanel stats={withData({ scoring: { off: true } })} dimmed />)
    // Your own choice is the more specific statement, so it is the one shown.
    expect(valueOf('Score')).toBe('')
    expect(valueOf('Accuracy')).toBe('')
    expect(valueOf('Streak')).toBe('')
    expect(valueOf('Last')).toBe('—')
    expect(isDimmed(strip())).toBe(true)
  })

  it('NO STRIKETHROUGH anywhere, in any of the five states', () => {
    for (const stats of [
      withData(),
      withData({ scoring: { off: true } }),
      withData({ scoring: { off: true }, timing: { off: true } }),
    ])
      for (const dimmed of [false, true]) {
        const { unmount } = render(<StatPanel stats={stats} dimmed={dimmed} />)
        expect(document.querySelector('.strike-center')).toBeNull()
        expect(document.querySelector('.line-through')).toBeNull()
        unmount()
      }
  })

  // ⚠ THE ONE THAT PROTECTS THE LAYOUT. An empty inline box has no line box and therefore no height,
  // so a value cell whose height came from its CONTENT would collapse the instant you toggled a
  // group off, and the whole strip would jump. It used to be answered by a NBSP the blank cell
  // rendered in place of a value; the guarantee moved to the BOX — the value now sits in a
  // fixed-height `h-[1lh]` cell — because the strut only ever covered the blank case and left the
  // auto-fit's SHRUNKEN values free to shorten their own boxes, which is what knocked them off their
  // neighbours' line (tests/statValueFit.dom.test.jsx).
  // jsdom has no layout engine, so what is pinned here is the INVARIANT the pixels rest on: the
  // blank cell carries no strut text at all, and its box is described identically to a filled one.
  // (Rendered heights are verified on-device, as everywhere else.)
  it('a BLANK cell reserves its height with its BOX, not with strut text', () => {
    const { rerender } = render(<StatPanel stats={withData()} />)
    const filled = valueCellOf('Score').className
    expect(filled).toContain('h-[1lh]') // the fixed height itself, named
    rerender(<StatPanel stats={withData({ scoring: { off: true } })} />)
    expect(rawValueOf('Score')).toBe('') // no NBSP, no space — nothing
    expect(valueOf('Score')).toBe('')
    expect(valueCellOf('Score').className).toBe(filled) // same box, blank or not
  })

  // ⚠ THE SAME CASE FOR THE DIM, which C1 promoted to a signal with a meaning of its own and which
  // the round-16 review found was the one of the three left with NO non-visual form: blank had its
  // word, dim had only an opacity, so Save Stats off and a strip with no data yet both announced as
  // six dashes and a screen-reader user could not tell them apart. The line is on the STRIP, not on
  // a cell, for the same reason `dimmed` is one flag rather than six — "this cell is not recording"
  // is not a state the app has. Placement is asserted (a child of the strip, not inside a cell) so
  // it cannot drift into a readout and be announced as part of a number.
  it('a DIMMED strip announces itself; an undimmed one is silent, and no cell ever carries it', () => {
    const { rerender } = render(<StatPanel stats={withData()} dimmed />)
    expect(stripSrText()).toBe('Stats are not being saved')
    // It belongs to the strip alone — not to a cell, and not to the divider count.
    for (const label of SIX) expect(srTextOf(label)).toBe('')
    expect(dividers().every((d) => d.className.includes('w-px'))).toBe(true)
    rerender(<StatPanel stats={withData()} />)
    expect(stripSrText()).toBe('') // nothing is wrong, so nothing is said
    // Both signals at once: the hidden group still says "Off", the strip still says the dim.
    rerender(<StatPanel stats={withData({ scoring: { off: true } })} dimmed />)
    expect(stripSrText()).toBe('Stats are not being saved')
    expect(srTextOf('Score')).toBe('Off')
  })

  // ⚠ THE ONE THAT KEEPS "CLEANEST" FROM MEANING "SILENT". Blank is a fine visual signal and no
  // signal at all to someone who cannot see it. The word costs nothing and is the difference between
  // a considered state and an unexplained gap.
  it('a BLANK cell carries a screen-reader-only "Off"; a shown cell carries no such word', () => {
    const { rerender } = render(<StatPanel stats={withData({ scoring: { off: true } })} />)
    expect(srTextOf('Score')).toBe('Off')
    expect(srTextOf('Last')).toBe('')
    // It names the blank, not the dim: Save Stats off dashes rather than blanks, so no "Off".
    rerender(<StatPanel stats={withData()} dimmed />)
    expect(srTextOf('Score')).toBe('')
    // And it must not leak into the value the auto-fit measures and a reader announces as the number.
    rerender(<StatPanel stats={withData({ scoring: { off: true } })} />)
    expect(cellFor('Score').querySelector('[data-statval]').children.length).toBe(0)
  })

  // ⚠ THE ZERO-PIXEL-MOVEMENT HALF. Three empty cells are three cells with nothing to show — not a
  // merged cell, not a spanning word, not a shortened divider. (A merged "Off" was designed in full
  // and REJECTED: a centred word under three labels reads as belonging to the middle stat.)
  it('toggling a group off changes NOTHING structural — same cells, same dividers, same nodes', () => {
    const { rerender } = render(<StatPanel stats={withData()} />)
    const before = {
      cells: cells().length,
      dividers: dividers().map((d) => d.className),
      node: cellFor('Score').querySelector('[data-statval]'),
      cellClass: cellFor('Score').className,
    }
    rerender(<StatPanel stats={withData({ scoring: { off: true } })} />)
    expect(cells().length).toBe(before.cells)
    expect(dividers().map((d) => d.className)).toEqual(before.dividers) // incl. h-8 — full height
    expect(cellFor('Score').className).toBe(before.cellClass)
    // Same DOM node, reused — React did not tear the cell down and rebuild it around the toggle.
    expect(cellFor('Score').querySelector('[data-statval]')).toBe(before.node)
  })

  it('a cell with no fn is still a plain cell, blank or not — off does not invent interactivity', () => {
    render(<StatPanel stats={withData({ scoring: { off: true, fn: null } })} />)
    expect(cellFor('Score').tagName).toBe('DIV')
    expect(cellFor('Last').tagName).toBe('BUTTON')
    expect(valueOf('Score')).toBe('')
  })
})

// ── The real screen: the two flags must not collapse back into one ────────────────────────────
// This half exists because the defect was not in StatPanel, it was in what modeHooks HANDED it:
// `scoringOff || !saveStats`. Every assertion here would have passed against a panel that renders
// the table perfectly and a hook that still merges the two facts before it gets there.
function mountApp() {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  return render(<App />)
}
const ctrl = (name) => screen.getByRole('button', { name })
// The live Classic date, as the one numeric-ymd leaf on screen (the fixture pins that format).
function readDate() {
  const els = [...document.querySelectorAll('div')].filter(
    (e) => e.children.length === 0 && /^-?\d+-\d+-\d+$/.test(e.textContent.trim()),
  )
  if (els.length !== 1) throw new Error(`expected one ymd date, found ${els.length}`)
  const [y, m, d] = els[0].textContent.trim().split('-').map(Number)
  return { y, m, d }
}
// The year range is pinned >= 1583, so the active calendar is always Gregorian → plain wday().
function answerCorrect() {
  const { y, m, d } = readDate()
  act(() => {
    fireEvent.click(ctrl(DAY[wday(y, m, d)]))
  })
}
// Tap a stat cell the way a user does — on the cell itself, which is the button.
function tapStat(label) {
  const cell = cellFor(label)
  act(() => {
    fireEvent.click(cell)
  })
}
// The ⚙ panel's own Save Stats switch, pressed as a user presses it — NOT a store write, which
// would pass a build that had stopped wiring the switch up at all. The gear both opens and closes,
// so the panel goes away the way it arrived (Esc is the DISCARD gesture and would be a different
// question). Save Stats is the one setting that takes effect immediately rather than on close.
function toggleSaveStats() {
  const gear = () => screen.getByRole('button', { name: /^Settings/ })
  act(() => {
    fireEvent.click(gear())
  })
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: 'Save Stats' }))
  })
  act(() => {
    fireEvent.click(gear())
  })
}

describe('Classic — your toggle and Save Stats are two separate signals (C1, the root-cause fix)', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.getState().resetToFactory()
    useSettings.getState().setRandomFormat(false)
    useSettings.getState().setDateFormat('numeric-ymd')
    useSettings.getState().setMinY(1583)
    useSettings.getState().setMaxY(10000)
    useModePrefs.getState().resetModePrefs()
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  // ⚠ THE FACTORY STATE IS NOT "everything on": classicTimingOff ships TRUE (store/modePrefs), so a
  // first-run Classic screen has the timing trio hidden. That makes the launch screen the single
  // most-seen instance of the blank state in the whole app, and the one place the old strikethrough
  // greeted a new user before they had done anything at all.
  it('Classic launches with timing hidden: the timing trio is BLANK, the scoring trio is not', () => {
    mountApp()
    expect(valueOf('Last')).toBe('')
    expect(valueOf('Mean')).toBe('')
    expect(valueOf('Median')).toBe('')
    expect(srTextOf('Median')).toBe('Off')
    expect(valueOf('Score')).toBe('0/0') // shown, and honestly empty
    expect(isDimmed(strip())).toBe(false) // it IS recording — nothing here is dim
  })

  // The rest need BOTH groups on, so the two signals can be told apart on one screen.
  const showTiming = () => act(() => useModePrefs.getState().setClassicTimingOff(false))

  it('tapping Score blanks the scoring trio and leaves the timing trio and the strip alone', () => {
    showTiming()
    mountApp()
    answerCorrect()
    expect(valueOf('Score')).toBe('1/1')
    tapStat('Score')
    expect(valueOf('Score')).toBe('')
    expect(valueOf('Accuracy')).toBe('')
    expect(valueOf('Streak')).toBe('')
    expect(srTextOf('Score')).toBe('Off')
    // Timing is a different group and a different tap.
    expect(valueOf('Last')).toMatch(/^\d+\.\d{2}s$/)
    expect(isDimmed(strip())).toBe(false) // your choice never dims: it IS still recording
  })

  it('the trio keeps RECORDING while blanked — the numbers that come back are the new ones', () => {
    mountApp()
    tapStat('Score')
    answerCorrect()
    answerCorrect()
    expect(valueOf('Score')).toBe('')
    tapStat('Score')
    expect(valueOf('Score')).toBe('2/2') // blank meant hidden, never paused
  })

  it('Save Stats off dashes every box and dims the whole strip — and dims no cell', () => {
    showTiming()
    mountApp()
    answerCorrect()
    toggleSaveStats()
    for (const label of SIX) expect(valueOf(label)).toBe('—')
    expect(isDimmed(strip())).toBe(true)
    expect(cells().some(isDimmed)).toBe(false)
    expect(dividers().some(isDimmed)).toBe(false)
  })

  // ★ THE DEFECT ITSELF. Under `sOff = scoringOff || !saveStats`, Save Stats off struck and dashed
  // all six, so the scoring trio looked EXACTLY like the timing trio and there was no way to see
  // which groups you had turned off — the choice was still there, just unreadable. Now the blank is
  // yours and the dash is the app's, so both facts are on screen at the same time.
  it('with Save Stats off, a group YOU turned off still reads BLANK while the rest read —', () => {
    showTiming()
    mountApp()
    answerCorrect()
    tapStat('Score') // your choice: hide the scoring trio
    toggleSaveStats() // the app's state: nothing is being recorded
    expect(valueOf('Score')).toBe('') // still visibly YOURS
    expect(valueOf('Accuracy')).toBe('')
    expect(valueOf('Streak')).toBe('')
    expect(srTextOf('Score')).toBe('Off')
    expect(valueOf('Last')).toBe('—') // the app's dash, not yours
    expect(valueOf('Mean')).toBe('—')
    expect(isDimmed(strip())).toBe(true) // and the one dim covers the whole strip
  })

  it('turning Save Stats back on returns the values and leaves your choice exactly as it was', () => {
    showTiming()
    mountApp()
    answerCorrect()
    tapStat('Score')
    toggleSaveStats() // off
    toggleSaveStats() // on again
    expect(valueOf('Score')).toBe('') // your toggle survived the round trip, and still shows it
    expect(valueOf('Last')).toMatch(/^\d+\.\d{2}s$/)
    expect(isDimmed(strip())).toBe(false)
    tapStat('Score')
    expect(valueOf('Score')).toBe('1/1') // and it is still the same tap that brings it back
  })

  // ── "Enable and Reset Stats?" — the timing-desync confirm (Q7 round 21) ──────────────────────
  // When timing is hidden the clock STOPS (Classic feeds useGameEngine timingOff:true), so a
  // question answered while hidden bumps `good` but records no time. Un-hiding then cannot
  // reconcile — so it opens the shared ConfirmModal, and confirming runs eng.fullReset(). Was an
  // inline two-tap arm rendered INSIDE the stats strip before this round.
  const enableResetDialog = () => screen.getByRole('dialog', { name: 'Enable and Reset Stats?' })

  it('un-hiding timing after the stats drifted opens the confirm popup, not an inline arm', () => {
    mountApp() // Classic ships with timing hidden
    expect(valueOf('Last')).toBe('') // hidden
    answerCorrect() // good → 1, but no time recorded (clock stopped while hidden)
    expect(valueOf('Score')).toBe('1/1')
    tapStat('Last') // try to un-hide → desync → the popup
    expect(enableResetDialog()).toBeInTheDocument()
    // The strip is still six plain cells — no merged warning button smuggled back in.
    expect(cells()).toHaveLength(6)
    // Cancel leaves everything: still hidden, stats intact.
    act(() => {
      fireEvent.click(within(enableResetDialog()).getByRole('button', { name: 'Cancel' }))
    })
    expect(screen.queryByRole('dialog', { name: 'Enable and Reset Stats?' })).toBeNull()
    expect(valueOf('Score')).toBe('1/1')
    expect(valueOf('Last')).toBe('') // still hidden
  })

  it('confirming Enable and Reset Stats turns timing on and wipes this mode back to fresh', () => {
    mountApp()
    answerCorrect()
    expect(valueOf('Score')).toBe('1/1')
    tapStat('Last')
    act(() => {
      fireEvent.click(
        within(enableResetDialog()).getByRole('button', { name: 'Enable and Reset Stats' }),
      )
    })
    expect(screen.queryByRole('dialog', { name: 'Enable and Reset Stats?' })).toBeNull()
    expect(valueOf('Score')).toBe('0/0') // the full reset fired
    expect(valueOf('Last')).toBe('—') // timing is ON now (a real readout, not blank) with no data yet
  })
})
