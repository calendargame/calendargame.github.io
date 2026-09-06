// tests/answerHitPad.test.js — sub-group 1B's answer-button HIT AREAS, in two halves: the pure
// placement model (lib/answerGrid's answerGridHitPad) and the drift guard between the numbers
// TypeScript owns and the copies index.css has to keep because CSS cannot read a Tailwind class.
//
// WHAT THE FEATURE IS. An answer option's pressable shape used to be exactly the rounded rectangle
// it draws. Its four CORNERS were inside its box and outside its shape (hit-testing honours
// border-radius), and the whole ANSWER_GRID_GAP gutter between two options was dead across its full
// width. Both are pure loss, so every labelled answer button now wears an invisible rectangular
// ::after that covers its whole box and reaches HALF the gutter into each side that has a
// neighbour. answerGridHitPad decides which sides those are; index.css draws it.
//
// ★ THE OWNER'S RULES, WHICH THIS FILE EXISTS TO KEEP HONEST — and rule 2 especially, because it is
// the one a future reader will be tempted to "improve":
//   1. A button owns its FULL RECTANGLE. Free; it takes nothing from anyone.
//   2. A gutter between two options splits DOWN THE MIDDLE, UNCONDITIONALLY — including beside an
//      option that is already answered, or that Deduction has ruled impossible. Letting a live
//      button swallow a dead neighbour's half was proposed and KILLED: dead space is a FEATURE,
//      because sliding a press onto it is how you CANCEL that press (lib/pointerGestures), and the
//      owner aims at dead buttons deliberately to do exactly that.
//   3. NOTHING reaches past the grid's OUTER edge — the panel padding stays dead, for that same
//      cancelling reason plus keeping a live hit area off the screen edge.
// Rule 2 needs no assertion here and CANNOT have one, which is the strongest form it could take:
// answerGridHitPad's whole input is (cols, spans). It has no way to learn that an option is dead,
// so "a dead neighbour still gets its half" is true by construction rather than by a passing test.
// The DOM half of that promise — that an inert button still carries the attribute, and that its
// live neighbour's value does not grow — is asserted on the real app in
// tests/answerHitArea.dom.test.jsx.
//
// ⚠ jsdom AND node BOTH HAVE NO LAYOUT ENGINE. Nothing in this file measures anything. It asserts
// the MODEL (which cell each option lands in, and which of its sides face an occupied cell) and the
// AGREEMENT of the two files' constants. That the resulting rectangles actually meet with no seam
// on glass is the owner's iPhone to confirm, not this suite's.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { answerGridHitPad, colSpanClass } from '../src/lib/answerGrid.js'
import { ANSWER_GRID_GAP, BASE_BTN } from '../src/components/controlClasses.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// Comments stripped at the door: every scan below is a token match, and index.css's prose names the
// very properties it is scanned for — the hit-area block spells out `--hit-bd:1px` and the
// --answer-gap note quotes the 0.75rem it resolves to, both ABOVE the rules that declare them. A
// raw scan would match the sentence first and then answer questions about prose.
const css = readFileSync(join(root, 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

// Every declaration list whose selector list contains `selector` exactly, in source order.
// ⚠ ALL of them, not the first: index.css opens several separate `:root` blocks (each token
// declared beside the prose that explains it), so "the first :root" is somebody else's block and a
// lookup that stopped there would report a token as missing while it sits ten lines further down.
function ruleBodies(selector) {
  const found = []
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').some((s) => s.trim() === selector)) found.push(m[2])
  }
  if (!found.length) throw new Error(`no rule for selector ${selector} in src/index.css`)
  return found
}
const ruleBody = (selector) => ruleBodies(selector).join(';')
// The LAST declaration wins, which is the cascade's own answer for one selector declared twice.
const decl = (selector, prop) => {
  const all = [...ruleBody(selector).matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:([^;]*)`, 'g'))]
  if (!all.length) throw new Error(`${selector} declares no ${prop}`)
  return all[all.length - 1][1].trim()
}

describe('answerGridHitPad — the placement model', () => {
  // ── The shapes the app actually ships ─────────────────────────────────────
  // Named by where they come from, so a failure says which screen broke.
  it('the weekday grid (7 over 2 columns, Saturday spanning both)', () => {
    // Read the literal, not the constant, so this test states the answer rather than pointing at it:
    // 'r b' — Sun, row 1 col 1: top and left are outer, Mon is right, Tue is below. …and 't' for
    // Sat, alone on the full-width last row: three outer sides, only the row above is a neighbour.
    expect(answerGridHitPad(2, [1, 1, 1, 1, 1, 1, 2])).toEqual([
      'r b',
      'b l',
      't r b',
      't b l',
      't r b',
      't b l',
      't',
    ])
  })
  it("Deduction Day (7 over 3 columns, the lone 7th spanning the row) and October 1582's 4", () => {
    expect(answerGridHitPad(3, [1, 1, 1, 1, 1, 1, 3])).toEqual([
      'r b',
      'r b l',
      'b l',
      't r b',
      't r b l',
      't b l',
      't',
    ])
    expect(answerGridHitPad(3, [1, 1, 1, 3])).toEqual(['r b', 'r b l', 'b l', 't'])
  })
  it('Deduction Month is the weekday grid again — 7 over 2 columns, the 7th spanning both', () => {
    // Worth stating separately rather than assumed: the two are built by DIFFERENT code — the
    // weekday grid from a module-level constant in WeekdayAnswer, Month from DeductionMode's
    // per-render `optionSpans`. They agree today, and this is what notices if one of them moves —
    // so the answer is spelled out again here rather than shared with the weekday test above.
    expect(answerGridHitPad(2, [1, 1, 1, 1, 1, 1, 2])).toEqual([
      'r b',
      'b l',
      't r b',
      't b l',
      't r b',
      't b l',
      't',
    ])
  })
  it('Deduction Year — 5 options as three thirds over two halves on 6 columns', () => {
    expect(answerGridHitPad(6, [2, 2, 2, 3, 3])).toEqual(['r b', 'r b l', 'b l', 't r', 't l'])
  })
  it('Deduction Year — the plain 3-column and the Oct-1582-straddle 2-column rows', () => {
    expect(answerGridHitPad(3, [1, 1, 1])).toEqual(['r', 'r l', 'l'])
    expect(answerGridHitPad(2, [1, 1])).toEqual(['r', 'l'])
  })

  // ── Rule 3: the outer edge ────────────────────────────────────────────────
  it('rule 3 — no option ever claims a side that faces the outside of the grid', () => {
    // Every shape above, checked as a PROPERTY rather than by reading the literals back: replay the
    // placement independently here and assert each padded side really has an occupied cell across
    // it. This is the assertion that would survive somebody "simplifying" the expectations above.
    const shapes = [
      [2, [1, 1, 1, 1, 1, 1, 2]],
      [3, [1, 1, 1, 1, 1, 1, 3]],
      [3, [1, 1, 1, 3]],
      [6, [2, 2, 2, 3, 3]],
      [3, [1, 1, 1]],
      [2, [1, 1]],
    ]
    for (const [cols, spans] of shapes) {
      // A deliberately independent placement model — the project's standing oracle rule. Written as
      // "fill cells left to right, wrapping when the span doesn't fit", not as a copy of the source.
      const rows = [[]]
      const cells = []
      for (const span of spans) {
        let r = rows.length - 1
        if (rows[r].length && rows[r].length + span > cols) {
          rows.push([])
          r += 1
        }
        const from = rows[r].length + 1
        for (let k = 0; k < span; k++) rows[r].push(true)
        cells.push({ r: r + 1, from, to: from + span - 1 })
        if (rows[r].length >= cols) rows.push([])
      }
      const occupied = (r, c) => c >= 1 && c <= cols && !!(rows[r - 1] && rows[r - 1][c - 1])
      const pads = answerGridHitPad(cols, spans)
      cells.forEach((cell, i) => {
        const sides = pads[i].split(' ').filter(Boolean)
        const colsOf = Array.from({ length: cell.to - cell.from + 1 }, (_, k) => cell.from + k)
        const facing = {
          t: colsOf.some((c) => occupied(cell.r - 1, c)),
          b: colsOf.some((c) => occupied(cell.r + 1, c)),
          l: occupied(cell.r, cell.from - 1),
          r: occupied(cell.r, cell.to + 1),
        }
        for (const side of ['t', 'r', 'b', 'l']) {
          expect(
            sides.includes(side),
            `cols=${cols} spans=[${spans}] option ${i} side ${side}`,
          ).toBe(facing[side])
        }
      })
    }
  })
  it('a single option claims nothing — one button IS the whole grid, so every side is outer', () => {
    expect(answerGridHitPad(2, [1])).toEqual([''])
  })
  it('the value is emitted in CSS inset order (t r b l), so a rendered attribute reads like the rule', () => {
    // The middle of a 3×3 is the only option that can claim all four, and it pins the order.
    expect(answerGridHitPad(3, [1, 1, 1, 1, 1, 1, 1, 1, 1])[4]).toBe('t r b l')
  })
  it('every option gets an attribute value, empty included — an empty value is a real opt-in', () => {
    // '' still matches [data-hit-pad] in the CSS, which is what hands a corner-only button its
    // rectangle back (rule 1). Dropping the attribute when there are no sides would silently
    // un-fix the corners, so the model must return one entry per option, always.
    expect(answerGridHitPad(2, [1]).length).toBe(1)
    expect(answerGridHitPad(6, [2, 2, 2, 3, 3]).length).toBe(5)
  })
  it('a hole left by an early wrap stays dead — the rule is about the gap between two BUTTONS', () => {
    // No shipped grid has a hole (this is the reason phrasing it as "is a button there?" rather
    // than "am I on an outer edge?" is the honest reading). 2 singles then a col-span-3 on a
    // 4-column grid wraps early and leaves cells (1,3) and (1,4) empty: the wide option's top must
    // face only the two cells that are filled, and neither single may claim a right-hand gutter it
    // shares with nothing.
    expect(answerGridHitPad(4, [1, 1, 3])).toEqual(['r b', 'b l', 't'])
  })
})

describe('colSpanClass — the one place a span number becomes a Tailwind class', () => {
  it('maps the spans the app uses, and spells span-1 as no class at all', () => {
    expect(colSpanClass(1)).toBe('')
    expect(colSpanClass(2)).toBe('col-span-2')
    expect(colSpanClass(3)).toBe('col-span-3')
  })
  it('the class names it can emit are LITERALS in scanned source, or Tailwind ships no CSS', () => {
    // ⚠ Tailwind v4 emits only utilities it can SEE in the files index.css @sources. A template
    // `col-span-${span}` scans as nothing and the grids would silently lose their spans — which is
    // exactly why the numbers are primary and the class is derived from them by hand-written
    // literals. This asserts those literals survive in a file the scanner reads (src/**/*.ts).
    const src = readFileSync(join(root, 'src/lib/answerGrid.ts'), 'utf8')
    for (const span of [2, 3]) expect(src).toContain(`'${colSpanClass(span)}'`)
  })
})

// ── The drift guard ──────────────────────────────────────────────────────────
// index.css cannot resolve a Tailwind class name, so it restates two facts TypeScript owns. Both
// restatements are named in the comments beside them as "checked by tests/answerHitPad.test.js";
// this is that check.
describe('TS ↔ CSS drift guard — the numbers index.css has to keep a copy of', () => {
  const TAILWIND_SPACING_REM = 0.25 // Tailwind v4's default --spacing (node_modules/tailwindcss/theme.css)

  it('--spacing is never redefined in index.css, so the step arithmetic below means what it says', () => {
    // The whole guard rests on `gap-N` being N × 0.25rem. index.css SPENDS var(--spacing) in two
    // places but must not DECLARE it; if it ever did, this file's conversion would go quietly wrong
    // rather than loudly, which is the failure mode a guard exists to prevent.
    expect(css).not.toMatch(/(?:^|;|\{)\s*--spacing\s*:/)
  })

  it('--answer-gap equals ANSWER_GRID_GAP — the same spacing STEP, not a re-resolved length', () => {
    const step = ANSWER_GRID_GAP.match(/^gap-(\d+)$/)
    expect(step, `ANSWER_GRID_GAP is "${ANSWER_GRID_GAP}", not a plain gap-N step`).toBeTruthy()
    // `gap-N` IS calc(var(--spacing) * N), so restating the step is the smallest possible copy: one
    // integer, and Tailwind's own scale still does the resolving on both sides of the join.
    expect(decl(':root', '--answer-gap')).toBe(`calc(var(--spacing) * ${step[1]})`)
  })

  it("--hit-bd matches BASE_BTN's border width, which is Tailwind's bare `border` = 1px", () => {
    // The border width is not cosmetic here: it is the whole of the seam trap. An absolutely
    // positioned ::after is offset from its containing block's PADDING edge, one border INSIDE the
    // visible edge, so each inset adds --hit-bd first to land on the border box. Get this number
    // wrong and the two halves of a gutter miss each other by 2 × the error — a dead line down the
    // exact centre of the gap, which is where a finger aiming at a gap lands.
    expect(BASE_BTN.split(/\s+/)).toContain('border')
    expect(BASE_BTN).not.toMatch(/\bborder-\d/) // a width override would make 1px a lie
    expect(decl('[data-hit-pad]', '--hit-bd')).toBe('1px')
    expect(decl('.dot-btn', '--hit-bd')).toBe('1px')
  })

  it('every ::after inset adds --hit-bd — the seam fix, not a fudge factor anyone may tidy away', () => {
    const after = ruleBody('[data-hit-pad]::after')
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const m = after.match(new RegExp(`(?:^|;)\\s*${side}\\s*:([^;]*)`))
      expect(m, `[data-hit-pad]::after declares no ${side}`).toBeTruthy()
      expect(m[1]).toContain('var(--hit-bd)')
      expect(m[1]).toContain(`var(--hit-${side[0]})`)
    }
  })

  it('each side letter switches exactly its own inset to half a gutter', () => {
    expect(decl('[data-hit-pad]', '--hit-half')).toBe('calc(var(--answer-gap) / 2)')
    for (const side of ['t', 'r', 'b', 'l']) {
      // ~= so an empty attribute value matches nothing here and the base rule's 0px stands.
      expect(decl(`[data-hit-pad~="${side}"]`, `--hit-${side}`)).toBe('var(--hit-half)')
      expect(decl('[data-hit-pad]', `--hit-${side}`)).toBe('0px')
    }
  })

  it('--ans-h spends var(--answer-gap) rather than folding the gutter into a number', () => {
    // The dot box must stay exactly as tall as the 4-row labelled grid, which counts THREE gutters.
    // That arithmetic used to read `14.25rem + 8px`, with the three gap-3s already added into the
    // 14.25 where nothing could see them — the drift this whole guard is about. It now names the
    // variable, so the two layouts cannot part company.
    const ansH = decl('.dot-box', '--ans-h')
    expect(ansH).toContain('var(--answer-gap)')
    expect(ansH).not.toContain('14.25rem')
    // …and the total is unchanged: 4 rows × (1.5rem line + 1.5rem py-3 + 2px border) + 3 gutters.
    const m = ansH.match(/^calc\((\d+(?:\.\d+)?)rem \+ (\d+)px \+ (\d+) \* var\(--answer-gap\)\)$/)
    expect(m, `--ans-h is "${ansH}", not the expected rows + borders + gutters form`).toBeTruthy()
    const [, rem, px, gutters] = m
    const gapRem = Number(ANSWER_GRID_GAP.match(/^gap-(\d+)$/)[1]) * TAILWIND_SPACING_REM
    expect(Number(rem)).toBe(4 * (1.5 + 1.5)) // 4 rows × (text-base line 1.5rem + py-3 1.5rem)
    expect(Number(px)).toBe(4 * 2) // 4 rows × two 1px borders — the one part that isn't rem
    expect(Number(gutters)).toBe(3) // 4 rows have 3 gutters between them
    // The height the owner actually sees is unchanged by having named the gutter: still 14.25rem
    // + 8px, which is what the folded literal used to say.
    expect(Number(rem) + Number(gutters) * gapRem).toBe(14.25)
  })

  it('--dot-frac is unitless, because the dot ::after divides by it to recover the cell', () => {
    // The cluster has NO gutter, so a dot's half-of-the-space-between-two-dots IS the rest of its
    // own square cell. index.css gets that cell back as (border box ÷ --dot-frac), which is only
    // arithmetic if the fraction carries no unit; the width it always was is recovered by × 100%.
    const frac = decl('.dot-cluster', '--dot-frac')
    expect(frac).not.toContain('%')
    expect(Number(frac)).toBeGreaterThan(0)
    expect(Number(frac)).toBeLessThan(1)
    expect(decl('.dot-btn', 'inline-size')).toBe('calc(var(--dot-frac) * 100%)')
    expect(decl('.dot-btn::after', 'inline-size')).toContain('/ var(--dot-frac)')
  })
})
