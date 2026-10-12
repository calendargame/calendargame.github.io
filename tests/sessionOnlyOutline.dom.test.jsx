// @vitest-environment jsdom
//
// THE DASHED OUTLINE — "these numbers are for this session only" (Amnesic).
//
// What is temporary is marked on the page itself (it replaced an "A" beside the preset's name):
//
//                      stats strip      Best readouts (MoX, Blitz)
//   Off                plain            plain
//   Stats Only         DASHED           plain   — they are being kept
//   Full               DASHED           DASHED
//   …with Save Stats off, the strip is DIMMED and never dashed (nothing is being recorded at all,
//   so there are no numbers on it to mark); the Best readouts keep theirs on Full.
//
// ★ AND IT IS ONE FRAME. "Dashed" means INSIDE the frame, and there is never more than one frame
// on a screen: round the strip alone, round the Best readouts alone, or — when both are the
// session's — ONE frame round the two together, drawn by the group that holds them. (They used to
// wear a frame each, of two different widths and corners.)
//
// This file pins that table in every mode, which element draws the frame, the words that say the
// same thing to a screen reader, and — as far as a test without a layout engine can — that the
// outline cannot move a pixel.
// ⚠ WHAT IT CANNOT SEE: jsdom lays nothing out and paints nothing. That the outline looks calm and
// unmistakable in all five themes, and that the strip and the readouts measure the same with it as
// without, were checked in a real browser at 390×844 (the round's gate); what is pinned here is the
// STRUCTURE those results rest on: which element carries the class, and that the class's rules
// declare nothing that takes part in layout.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import StatPanel from '../src/components/StatPanel.jsx'
import { setPresetAmnesic, createPreset, switchPreset } from '../src/store/presetControl.js'
import { useSettings } from '../src/store/settings.js'
import { useModePrefs } from '../src/store/modePrefs.js'
import { resetAppState, mountApp, tap } from './helpers/settingsPanel.jsx'

const STRIP_WORDS = 'These stats are for this session only'
const BEST_WORDS = 'Bests are for this session only'
const DIM_WORDS = 'Stats are not being saved'

const isHidden = (el) => {
  for (let n = el; n; n = n.parentElement) if (n.style && n.style.display === 'none') return true
  return false
}
// THE VISIBLE strip (all five mode screens stay mounted): found from its value spans up, never by
// the class under test.
const strip = () => {
  const value = [...document.querySelectorAll('[data-statval]')].find((el) => !isHidden(el))
  return value.closest('.panel')
}
// THE GROUP the strip and its Best readouts are the two children of.
const group = () => strip().parentElement
// THE VISIBLE Best readout — the row that holds a "Best …:" label — or null in a mode without one.
// It is the strip's sibling in the group, found from the label up and never by a class.
const bestReadout = () => {
  const label = [...document.querySelectorAll('div')].find(
    (el) => !isHidden(el) && /^s*Best (Score|Mean):/.test(el.firstChild?.nodeValue ?? ''),
  )
  if (!label) return null
  for (let n = label; n; n = n.parentElement) if (n.parentElement === group()) return n
  throw new Error('a Best label that is not in the strip’s group')
}
// DASHED = inside the frame: the element, or one it sits in, wears the class.
const dashed = (el) => el.closest('.session-only') !== null
// WHICH ELEMENT DRAWS THE FRAME on the screen that is showing — and that there is only one.
const frameHost = () => {
  const hosts = [...document.querySelectorAll('.session-only')].filter((el) => !isHidden(el))
  expect(hosts.length).toBeLessThanOrEqual(1) // never two frames
  const [host] = hosts
  if (!host) return null
  if (host === strip()) return 'strip'
  if (host === group()) return 'group'
  if (host === bestReadout()) return 'bests'
  throw new Error('the frame is on an element that is none of the three')
}
const says = (el, words) =>
  [...el.querySelectorAll('.sr-only')].some((s) => s.textContent === words)
const press = (key) => act(() => fireEvent.keyDown(window, { key }))
const setAmnesic = (mode) => act(() => setPresetAmnesic(1, mode))
const unmount = () => {
  cleanup()
  document.getElementById('root')?.remove()
}

// Each mode's screen, and how to get to it (its keyboard letter). Blitz has three Best readouts —
// one per sub-mode — and each is its own markup, so each is a row here.
const SCREENS = [
  { name: 'Classic', go: () => press('K'), hasBests: false },
  { name: 'Deduction', go: () => press('D'), hasBests: false },
  { name: 'Flash', go: () => press('F'), hasBests: false },
  { name: 'MoX', go: () => press('A'), hasBests: true },
  { name: 'Blitz, Per Round', go: () => press('B'), hasBests: true },
  {
    name: 'Blitz, Per Question + Allow Mistakes',
    go: () => {
      act(() => useModePrefs.getState().setBlitzPerQ(true))
      press('B')
    },
    hasBests: true,
  },
  {
    name: 'Blitz, Per Question sudden death',
    go: () => {
      act(() => {
        useModePrefs.getState().setBlitzPerQ(true)
        useModePrefs.getState().setBlitzAllowMistakes(false)
      })
      press('B')
    },
    hasBests: true,
  },
]

describe('the dashed outline, mode by mode and value by value', () => {
  beforeEach(() => resetAppState())
  afterEach(unmount)

  for (const { name, go, hasBests } of SCREENS)
    it(`${name}: the strip is dashed on Stats Only and Full; the Bests only on Full`, () => {
      mountApp()
      go()
      expect(bestReadout() !== null).toBe(hasBests) // the row under test is really on this screen

      const seen = {}
      for (const mode of ['off', 'stats', 'full', 'off']) {
        setAmnesic(mode)
        seen[mode] = {
          frame: frameHost(),
          strip: dashed(strip()),
          stripSays: says(strip(), STRIP_WORDS),
          bests: hasBests ? dashed(bestReadout()) : null,
          bestsSay: hasBests ? says(bestReadout(), BEST_WORDS) : null,
        }
      }
      const none = hasBests ? false : null
      expect(seen).toEqual({
        off: { frame: null, strip: false, stripSays: false, bests: none, bestsSay: none },
        // Stats Only: the frame is the strip's own — the Bests under it are outside.
        stats: { frame: 'strip', strip: true, stripSays: true, bests: none, bestsSay: none },
        // Full: ONE frame round both, where there are Bests; the strip's alone where there are not.
        full: {
          frame: hasBests ? 'group' : 'strip',
          strip: true,
          stripSays: true,
          bests: hasBests ? true : null,
          bestsSay: hasBests ? true : null,
        },
      })
    })

  // ★ NOTHING IS RECORDED AT ALL with Save Stats off, so the dim is the whole truth about the strip
  // and the outline stands down — one cue, never two stacked. The Best readouts still show real
  // records, and on Full those are still the session's.
  for (const mode of ['stats', 'full'])
    it(`${mode} with Save Stats off: the strip is dimmed and NOT dashed; the dim's own words are the ones said`, () => {
      mountApp()
      press('B')
      setAmnesic(mode)
      expect(dashed(strip())).toBe(true)
      act(() => useSettings.getState().setSaveStats(false))
      expect(dashed(strip())).toBe(false)
      // What is left to mark is the Bests alone, on Full — so the frame is the readouts' own.
      expect(frameHost()).toBe(mode === 'full' ? 'bests' : null)
      expect(strip().className).toContain('opacity-50')
      expect(says(strip(), DIM_WORDS)).toBe(true)
      expect(says(strip(), STRIP_WORDS)).toBe(false)
      expect(dashed(bestReadout())).toBe(mode === 'full')
      // …and it comes straight back with Save Stats.
      act(() => useSettings.getState().setSaveStats(true))
      expect(dashed(strip())).toBe(true)
      expect(says(strip(), DIM_WORDS)).toBe(false)
    })

  it('it follows the preset you are on, not the one you left', () => {
    mountApp()
    let p2
    act(() => {
      p2 = createPreset('Guest')
      setPresetAmnesic(p2.id, 'full')
    })
    press('B')
    expect([dashed(strip()), dashed(bestReadout())]).toEqual([false, false])
    act(() => switchPreset(p2.id))
    press('B')
    expect([dashed(strip()), dashed(bestReadout())]).toEqual([true, true])
    act(() => switchPreset(1))
    press('B')
    expect([dashed(strip()), dashed(bestReadout())]).toEqual([false, false])
  })

  // When a round has ended the whole strip is ONE BUTTON, whose aria-label replaces its content as
  // its name — so the words have to reach a screen reader as the button's DESCRIPTION.
  it('an ended round’s strip — one button — is described by the words, not just holding them', () => {
    mountApp()
    press('B')
    setAmnesic('stats')
    tap(screen.getByRole('button', { name: 'Begin' }))
    tap(screen.getByRole('button', { name: 'Reveal' })) // ends the round: 0 of 1
    const button = screen.getByRole('button', { name: 'Show round breakdown' })
    expect(button).toBe(strip())
    expect(dashed(button)).toBe(true)
    expect(frameHost()).toBe('strip')
    const described = document.getElementById(button.getAttribute('aria-describedby'))
    expect(described.textContent).toBe(STRIP_WORDS)
    expect(button.contains(described)).toBe(true)
  })
})

// ── The block on its own ──────────────────────────────────────────────────────────────────────
describe('the outline costs no layout', () => {
  beforeEach(() => resetAppState())
  afterEach(cleanup)

  const STATS = [
    { label: 'Score', value: '3/4' },
    { label: 'Accuracy', value: '75%' },
  ]
  const BESTS = <div>Best Score: 12</div>
  // Everything about the block that could size or place anything in it, as jsdom can see it: every
  // element's tag and class list, with the frame's class set aside, and its children that are in
  // the flow (the screen-reader words are positioned out of it).
  const shape = (el) => ({
    tag: el.tagName,
    classes: [...el.classList].filter((c) => c !== 'session-only').sort(),
    text: [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.nodeValue),
    inFlow: [...el.children].filter((c) => !c.classList.contains('sr-only')).map(shape),
  })
  const block = (amnesic, dimmed, bests) => {
    cleanup()
    act(() => setPresetAmnesic(1, amnesic))
    return render(<StatPanel stats={STATS} dimmed={dimmed} bests={bests} />).container.firstChild
  }
  const frames = (root) =>
    [root, ...root.querySelectorAll('*')].filter((el) => el.classList.contains('session-only'))

  it('the strip and its Bests are the same elements, classes, and cells whatever is framed', () => {
    const plain = shape(block('off', false, BESTS))
    // Stats Only: the strip wears the frame. Full: the group does, round both.
    const statsOnly = block('stats', false, BESTS)
    expect(frames(statsOnly)).toEqual([statsOnly.firstChild])
    expect(shape(statsOnly)).toEqual(plain)
    const full = block('full', false, BESTS)
    expect(frames(full)).toEqual([full])
    expect(shape(full)).toEqual(plain)
    // The only things added are positioned out of the flow.
    expect([...full.querySelectorAll('.sr-only')].map((c) => c.textContent)).toEqual([
      STRIP_WORDS,
      BEST_WORDS,
    ])
    // Save Stats off: the dim's own classes and dashes are the same with or without a frame, and
    // on Full the frame is the Best readouts' own.
    const dimmedPlain = shape(block('off', true, BESTS))
    const dimmedFull = block('full', true, BESTS)
    expect(frames(dimmedFull)).toEqual([dimmedFull.lastChild])
    expect(shape(dimmedFull)).toEqual(dimmedPlain)
  })

  it('a mode with no Bests has the same block, and its frame is the strip’s alone', () => {
    const plain = shape(block('off', false, undefined))
    expect(plain.inFlow).toHaveLength(1) // the strip, and no empty row under it
    for (const amnesic of ['stats', 'full']) {
      const root = block(amnesic, false, undefined)
      expect(frames(root)).toEqual([root.firstChild])
      expect(shape(root)).toEqual(plain)
    }
  })

  // ★ ONE SHAPE, ON THE COLUMN'S EDGES. Whichever of the three elements wears the frame, the frame
  // is that element's own box (inset:0) with that element's own radius (inherit) — so the three
  // have to be the column's width and carry the strip's radius, and the group may add no box of
  // its own. The readouts' text is kept inside the line by padding the row has in every state.
  it('the three elements that can wear the frame share one radius, and none is wider than the column', () => {
    const root = block('full', false, BESTS)
    const [stripEl, bestsEl] = root.children
    for (const el of [root, stripEl, bestsEl]) {
      const classes = [...el.classList]
      expect(classes).toContain('rounded-2xl')
      // No negative margin and no fixed width: a block box in the column is the column's width.
      expect(classes.filter((c) => /^-m|^w-(?!full$)|^min-w|^max-w/.test(c))).toEqual([])
    }
    // The group is the strip's place on the page and nothing else: no padding, no border.
    expect([...root.classList].sort()).toEqual(['mt-4', 'rounded-2xl', 'session-only'])
    // The readouts' row: its text starts inside the line, framed or not.
    expect([...bestsEl.classList]).toEqual(expect.arrayContaining(['px-3', 'py-1.5', 'mt-1.5']))
    expect([...block('off', false, BESTS).lastChild.classList]).toEqual([...bestsEl.classList])
  })

  // ★ THE INSET MUST NOT COST THE TAG ITS PLACE ON THE LINE. The readouts wrap in a line with the
  // "Same Round" tag at its far end, and the row's inset takes its width off both ends of that line.
  // Each column hands that much back, and a slack after it takes it again whenever the line has it
  // to spare (components/BestReadout's BestColumn) — so the three numbers are one, and the slack
  // adds nothing to the line. jsdom lays nothing out: what is pinned here is that the page is BUILT
  // that way, in every mode's row; that the tag then has room at exactly the widths it had before
  // the inset was measured in a browser, across widths and readouts. (The tag's own place on the
  // line, and what becomes of it where there is no room, is tests/bestTag.dom.)
  it.each([
    ['Blitz', 'B', 2],
    ['MoX', 'A', 2],
  ])(
    '%s: each Best column gives the row`s inset back, and a slack after it takes it up',
    (_mode, key, columns) => {
      mountApp()
      act(() => void fireEvent.keyDown(window, { key }))
      const row = bestReadout()
      const step = (el, prefix) => {
        const cls = [...el.classList].find((c) => c.startsWith(prefix))
        expect(cls, `${prefix} on ${el.className}`).toBeTruthy()
        return cls.slice(prefix.length)
      }
      const inset = step(row, 'px-')
      // The readouts' own group on the line (components/BestReadout's BestLine): the columns and
      // their slacks, and nothing else — the tag's place follows the group, the same gap away.
      const line = row.querySelector(':scope > div.flex > div.flex')
      const gap = step(line, 'gap-')
      expect(step(line.parentElement, 'gap-x-')).toBe(gap)
      const cells = [...line.children]
      const cols = cells.filter((el) => [...el.classList].some((c) => /^min-w-\[/.test(c)))
      expect(cols).toHaveLength(columns)
      for (const col of cols) {
        expect(step(col, '-mr-')).toBe(inset)
        const slack = col.nextElementSibling
        expect(slack.getAttribute('aria-hidden')).toBe('true')
        expect(slack.textContent).toBe('')
        expect(step(slack, 'max-w-')).toBe(inset) // grows to what the column gave up, and no further
        expect(step(slack, '-ml-')).toBe(gap) // …and cancels the gap in front of it
        expect([...slack.classList]).toEqual(
          expect.arrayContaining(['grow', 'shrink-0', 'basis-0']),
        )
      }
      // Nothing else in the group.
      expect(
        cells.filter((el) => !cols.includes(el) && !cols.includes(el.previousElementSibling)),
      ).toEqual([])
    },
  )

  // ★ THE RULES THEMSELVES. The frame is a ::after box positioned out of the flow; the host gains
  // `position:relative` and nothing else, and on a .panel only the border's COLOUR changes. Nothing
  // here may declare a width, a padding, a margin, a border-width or an outline on the host.
  it('the class’s rules declare nothing that takes part in layout', () => {
    const css = readFileSync('src/index.css', 'utf8')
    const rule = (selector) => {
      const at = css.indexOf(`\n${selector}{`)
      expect(at, selector).toBeGreaterThan(-1)
      return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
    }
    // (…and where the keyboard's focus ring sits on a control on the frame's line: clear inside it.
    // A custom property, so it reaches the strip when the frame is the group's.)
    expect(rule('.session-only')).toBe('position:relative;--kbd-ring-offset:-5px')
    // The strip's own solid border steps aside for the dashes, wearing the frame or under one.
    expect(rule('.panel.session-only,.session-only>.panel')).toBe('border-color:transparent')
    const frame = Object.fromEntries(
      rule('.session-only::after')
        .split(';')
        .map((d) => [d.slice(0, d.indexOf(':')), d.slice(d.indexOf(':') + 1)]),
    )
    expect(frame.position).toBe('absolute') // out of the flow: it cannot push anything
    expect(frame.inset).toBe('0') // the host's own box — never outside it
    expect(frame['pointer-events']).toBe('none') // and it never takes a tap meant for the strip
    expect(frame.border).toMatch(/dashed/) // dashed — the keyboard's focus ring is solid
    expect(frame['border-radius']).toBe('inherit')
    // …and every rule with the class in its selector is one of the three above: ONE frame shape.
    const selectors = [...css.matchAll(/\n([^\n{}]*session-only[^\n{}]*)\{/g)].map((m) => m[1])
    expect(selectors.sort()).toEqual(
      ['.panel.session-only,.session-only>.panel', '.session-only', '.session-only::after'].sort(),
    )
  })
})
