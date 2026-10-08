// @vitest-environment jsdom
//
// modeOrder.dom — THE PAGE LIST (src/lib/modes.ts) IS THE ONE ORDER, AND EVERYTHING FOLLOWS IT.
//
// Two kinds of case, and the difference matters:
//
//   1. THE ORDER ITSELF, stated once as a literal (EXPECTED below). This is the only place in the
//      suite that spells the order out; a deliberate reorder edits lib/modes and this one array.
//
//   2. EVERYTHING THAT MUST FOLLOW IT, checked against PAGES rather than against the literal — the
//      bar's mode menu, ⚙ → Default Mode's pills, How to Play's "Mode Switching" legend, its mode
//      sections, and the wording of the guide itself. These cases never need editing for a reorder
//      or a new mode: they fail only if one of those places stops deriving from the list.
//
// The last case reads GuidePage's SOURCE. Most of the guide's sentences that name several modes are
// built by lib/modes' modeNames / modeList and cannot be out of order; this catches the ones typed
// by hand ("…in MoX runs and Blitz rounds…"), where the order is a human's job.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  PAGES,
  PRACTICE_MODES,
  PAGE_BY_KEY,
  isPageId,
  modeNames,
  modeList,
} from '../src/lib/modes.js'
import {
  resetAppState,
  mountApp,
  currentMode,
  pressKey,
  openSettings,
  tap,
} from './helpers/settingsPanel.jsx'

const EXPECTED = [
  ['classic', 'Classic', 'K'],
  ['deduction', 'Deduction', 'D'],
  ['flash', 'Flash', 'F'],
  ['aox', 'MoX', 'A'],
  ['blitz', 'Blitz', 'B'],
  ['lookup', 'Lookup', 'L'],
  ['guide', 'How to Play', 'H'],
]

const labels = (pages) => pages.map((p) => p.label)

describe('lib/modes — the page list', () => {
  it('lists the pages in the agreed order, each with its id, name, and letter', () => {
    expect(PAGES.map((p) => [p.id, p.label, p.key])).toEqual(EXPECTED)
  })

  it('counts exactly the five date-answering modes as practice modes', () => {
    expect(PRACTICE_MODES.map((m) => m.id)).toEqual([
      'classic',
      'deduction',
      'flash',
      'aox',
      'blitz',
    ])
  })

  it('gives every page a letter of its own', () => {
    expect(Object.keys(PAGE_BY_KEY)).toHaveLength(PAGES.length)
    for (const p of PAGES) expect(PAGE_BY_KEY[p.key]).toBe(p)
  })

  it('recognises a saved page by its id and nothing else', () => {
    for (const p of PAGES) expect(isPageId(p.id)).toBe(true)
    // A position, a label and a letter are all things a page is NOT saved as.
    for (const v of [0, 1, '1', 'MoX', 'K', '', null, undefined]) expect(isPageId(v)).toBe(false)
  })

  it('names several modes in the list’s order whatever order they are asked for in', () => {
    expect(modeNames('blitz', 'aox')).toBe('MoX and Blitz')
    expect(modeNames('flash', 'deduction', 'classic')).toBe('Classic, Deduction, and Flash')
    expect(modeNames('blitz')).toBe('Blitz')
    expect(modeList('aox', 'blitz', 'flash', 'classic')).toBe('Classic, Flash, MoX, Blitz')
  })
})

describe('everything that lists the pages follows the page list', () => {
  beforeEach(() => resetAppState())
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('the bar’s mode menu', () => {
    mountApp()
    tap(screen.getByRole('button', { name: /^Mode,/ }))
    const options = within(screen.getByRole('listbox', { name: 'Mode' })).getAllByRole('option')
    // The chosen option wears a ✓ in front of its name.
    expect(options.map((o) => o.textContent.replace('✓', '').trim())).toEqual(labels(PAGES))
  })

  it('⚙ → Default Mode: the practice modes on the first row, the other pages on the second', () => {
    mountApp()
    openSettings()
    const pills = within(screen.getByRole('radiogroup', { name: 'Default Mode' })).getAllByRole(
      'radio',
    )
    expect(pills.map((p) => p.textContent.trim())).toEqual(labels(PAGES))
    // The row break falls exactly between the last practice mode and the first other page.
    const rowOf = (pill) => pill.parentElement
    const lastPractice = pills[PRACTICE_MODES.length - 1]
    const firstOther = pills[PRACTICE_MODES.length]
    expect(rowOf(pills[0])).toBe(rowOf(lastPractice))
    expect(rowOf(firstOther)).not.toBe(rowOf(lastPractice))
    expect(rowOf(firstOther)).toBe(rowOf(pills[pills.length - 1]))
  })

  it('each page’s letter opens that page', () => {
    mountApp()
    // Classic last, so the first press is never a no-op on the page the app opened on.
    for (const p of [...PAGES].reverse()) {
      pressKey(p.key.toLowerCase())
      expect(currentMode()).toBe(p.label)
    }
  })

  it('How to Play: the Mode Switching legend and the mode sections', () => {
    mountApp()
    pressKey('H')
    const legend = screen.getByText('Mode Switching').parentElement
    const rows = [...legend.querySelectorAll('kbd')].map((k) => [
      k.textContent.trim(),
      k.parentElement.querySelector('span').textContent.trim(),
    ])
    // Every page with a letter except the guide itself, whose letter is listed with the toggles.
    expect(rows).toEqual(PAGES.filter((p) => p.id !== 'guide').map((p) => [p.key, p.label]))

    const sectionIds = [...document.querySelectorAll('[id^="guide-sec-"]')].map((el) =>
      el.id.slice('guide-sec-'.length),
    )
    const practiceIds = PRACTICE_MODES.map((m) => m.id)
    expect(sectionIds.filter((id) => practiceIds.includes(id))).toEqual(practiceIds)
    for (const m of PRACTICE_MODES)
      expect(document.getElementById(`guide-head-${m.id}`).textContent).toContain(m.label)
  })
})

describe('How to Play’s wording follows the page list', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'components', 'GuidePage.tsx'),
    'utf8',
  )
    // JSX comments and line comments explain the code; they are not what the reader sees.
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s+/g, ' ')

  // A RUN is two or more mode names with nothing between them but list glue: commas, "and" / "or",
  // an article, and the words a mode's own thing is called by ("Blitz rounds and MoX runs", "a MoX
  // run or a Blitz round"). Anything longer between two names is a new clause, where the order is
  // the sentence's business ("about three thousand in Classic and Flash, about two thousand in
  // Deduction's…" groups by size, not by mode).
  const NAME = PRACTICE_MODES.map((m) => m.label).join('|')
  const GLUE = String.raw`(?:&apos;s|'s)?(?: (?:rounds?|runs?))?(?:,| and| or|, and|, or)(?: (?:a|an|the|in))? `
  const RUN = new RegExp(String.raw`\b(?:${NAME})\b(?:${GLUE}(?:${NAME})\b)+`, 'g')
  const rank = Object.fromEntries(PRACTICE_MODES.map((m, i) => [m.label, i]))

  it('finds the hand-typed runs it is meant to police (the pattern is not vacuous)', () => {
    const runs = source.match(RUN) ?? []
    expect(runs).toContain('MoX runs and Blitz')
    expect(runs).toContain('Classic and Flash')
  })

  it('never names two modes in a row out of the list’s order', () => {
    const outOfOrder = (source.match(RUN) ?? []).filter((run) => {
      const order = run.match(new RegExp(String.raw`\b(?:${NAME})\b`, 'g')).map((n) => rank[n])
      return order.some((r, i) => i > 0 && r <= order[i - 1])
    })
    expect(outOfOrder).toEqual([])
  })
})
