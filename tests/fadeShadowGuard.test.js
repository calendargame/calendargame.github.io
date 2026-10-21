// tests/fadeShadowGuard.test.js — ONE STANDARD for fades and shadows, made unshippable to drift from.
// History: an audit before the themes were reworked found SIX shadow recipes for three ideas (two
// followed the theme's shadow colour; four were plain black literals that no theme could tint, one
// of them a framework default nobody had chosen), and the fade depth as the app's one fixed-pixel
// measure. Each had been added in good faith, beside the thing it was for, by someone who could not
// see the others. The standard now lives in ONE place — src/index.css:
//   FADES    one depth (--fade-h), drawn by the .fade-scroll-* masks on a scroll region and by the
//            .doc-fade-* strips on How to Play's page (index.css says why that page needs strips).
//   SHADOWS  three roles — EDGE (.elev-shadow-down/up), LIFTED (--shadow-lifted, .held-shadow),
//            FLOATING (--shadow-float; .float-shadow, .float-shadow-frost) — all in the theme's own
//            shadow colour, plus two named things that are not one of the three: --frost-edge (an
//            edge line) and --shadow-thumb (a white slider knob's neutral shadow).
// and this guard fails the suite on a fade or a shadow written ANYWHERE else:
//   • in the stylesheet — any box-shadow / text-shadow / mask / mask-image / drop-shadow()
//     declaration outside the rules listed below, any listed rule whose value is not exactly the
//     recipe written here, and any shadow or fade TOKEN declared twice, elsewhere, or by a new name;
//   • in markup (src/**/*.{ts,tsx,js,jsx} and index.html, comments stripped) — an inline-style key
//     (boxShadow, textShadow, maskImage, …), a CSS declaration in a string or a <style> block, a
//     Tailwind shadow-* / inset-shadow-* / drop-shadow-* / text-shadow-* / mask-* utility, or an
//     SVG mask. Markup wears the role CLASSES; it never spells a recipe.
// ⚠ AN ALLOW-LIST ENTRY CARRIES ITS REASON, in words, and a stale one fails too: every entry must
// still match something, so the list cannot outlive what it excuses.
// WHAT IT CANNOT SEE: that a shadow is on the RIGHT element for its role, and how any of it looks —
// those were checked in a real browser, in all five themes, when the standard was built.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const rel = (file) => relative(root, file).replace(/\\/g, '/')

// Comments are prose ABOUT fades and shadows — index.css and the components argue their shadows at
// length — so every scan reads code only. A block comment is replaced by its own line breaks, so
// the line numbers a violation reports are still the file's.
const stripBlockComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ''))

// ═════════════════════════════════════════════════════════════════════════════════════════════
// THE STYLESHEET
// ═════════════════════════════════════════════════════════════════════════════════════════════
const css = stripBlockComments(readFileSync(join(root, 'src/index.css'), 'utf8'))

// The theme's shadow colour, exactly as every themed recipe must spell it (channels and alpha kept
// apart — index.css's --shade note says what an unsupported value inside a box-shadow costs).
const THEME = 'rgb(var(--shadow-elev-c) / var(--shadow-elev-a))'
const THEME_SHADED = 'rgb(var(--shadow-elev-c) / calc(var(--shadow-elev-a) * var(--shade,1)))'
// (the top fade starts --fade-top-inset down: 0 but for the page, whose box starts behind the bar;
// the bottom fade ends at the box's edge — every region's box ends at its neighbour since Round 27)
const MASK_TOP =
  'transparent var(--fade-top-inset),black calc(var(--fade-top-inset) + var(--fade-h))'
const MASK_BOTTOM = 'black calc(100% - var(--fade-h)),transparent 100%'
const mask = (stops) => {
  const value = `linear-gradient(to bottom,${stops})`
  return { '-webkit-mask-image': value, 'mask-image': value }
}
const KEYBOARD_RING = '0 0 0 2px var(--card-bg),0 0 0 4px var(--kbd-ring,var(--tx-50))'

// EVERY RULE THAT MAY DECLARE A SHADOW OR A MASK: selector → the exact declarations → why.
const OWNER_RULES = [
  // ── the three roles ──
  {
    selector: '.elev-shadow-down',
    declares: { 'box-shadow': `0 .25rem .375rem -.125rem ${THEME_SHADED}` },
    why: 'EDGE: content slides under this fixed edge, from above',
  },
  {
    selector: '.elev-shadow-up',
    declares: { 'box-shadow': `0 -.25rem .375rem -.125rem ${THEME_SHADED}` },
    why: 'EDGE: content slides under this fixed edge, from below',
  },
  {
    selector: '.held-shadow',
    declares: { 'box-shadow': 'var(--shadow-lifted)' },
    why: 'LIFTED: a preset row in the hand',
  },
  {
    selector: '.float-shadow',
    declares: { 'box-shadow': 'var(--shadow-float)' },
    why: 'FLOATING: every popup card and the settings menu',
  },
  {
    selector: '.float-shadow-frost',
    declares: { 'box-shadow': 'var(--shadow-float),var(--frost-edge)' },
    why: 'FLOATING, on the frosted dropdown list: the same shadow plus its named edge line',
  },
  // ── the one deliberate non-theme shadow ──
  {
    selector: 'input[type="range"]::-webkit-slider-thumb',
    declares: { 'box-shadow': 'var(--shadow-thumb)' },
    why: 'a white slider knob needs a neutral shadow on every theme (WebKit, Blink)',
  },
  {
    selector: 'input[type="range"]::-moz-range-thumb',
    declares: { 'box-shadow': 'var(--shadow-thumb)' },
    why: 'the same knob, in Gecko',
  },
  // ── the fades ──
  { selector: '.fade-scroll-top', declares: mask(MASK_TOP), why: 'the fade at a region’s top' },
  {
    selector: '.fade-scroll-bottom',
    declares: mask(MASK_BOTTOM),
    why: 'the fade at a region’s bottom',
  },
  {
    selector: '.fade-scroll-both',
    declares: mask(`${MASK_TOP},${MASK_BOTTOM}`),
    why: 'both at once — two mask-image declarations from two classes do not stack',
  },
  // ── drawn with box-shadow, and NOT shadows ──
  {
    selector: '.held-ink',
    declares: { 'box-shadow': '0 0 0 2px var(--card-bg)' },
    why: 'a RIM: a 2px spread of the card’s own colour round a dragged row’s marks, so a row passing underneath is hidden; a spread because padding would move the mark',
  },
  {
    selector: ':root[data-keyboard] input[type="range"]:focus::-webkit-slider-thumb',
    declares: { 'box-shadow': KEYBOARD_RING },
    why: 'a RING: the keyboard focus ring on a slider knob, which an outline cannot follow',
  },
  {
    selector: ':root[data-keyboard] input[type="range"]:focus::-moz-range-thumb',
    declares: { 'box-shadow': KEYBOARD_RING },
    why: 'the same ring, in Gecko',
  },
  {
    selector: '.dot-btn.drag-target',
    declares: { 'box-shadow': '0 0 0 2px var(--drag-ring)' },
    why: 'a RING: the press-drag target ring on a round answer dot, which follows the circle where an outline is square',
  },
]

// EVERY SHADOW AND FADE TOKEN: name → its one value. All live in a :root rule, each exactly once.
const TOKENS = {
  '--fade-h': '.75rem',
  '--shade-ramp': '1.5rem',
  '--fade-top-inset': '0px',
  '--shadow-lifted': `0 .1875rem .75rem ${THEME}`,
  '--shadow-float': `0 .375rem 1.5rem ${THEME}`,
  '--frost-edge': '0 0 0 .5px rgb(0 0 0 / .05)',
  '--shadow-thumb': '0 .5px 4px rgb(0 0 0 / .3)',
}
// The theme's shadow colour pair is the one thing a theme row may set, per theme, to any value.
const THEME_PAIR = ['--shadow-elev-c', '--shadow-elev-a']
// A custom property is one of OURS — and so must be in TOKENS or THEME_PAIR — by its name.
const TOKEN_NAME = /shadow|frost|^--fade-|^--shade-ramp$/

const SHADOW_PROPERTY = /^(?:-webkit-|-moz-)?(?:box-shadow|text-shadow|mask|mask-image)$/

// Every innermost `selector{declarations}` block. Nesting (the @layer wrapper, @media) is walked
// by matching only blocks with no brace inside them, which is every style rule in the file.
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  // What is left before the `{` once the enclosing block's own `{` is cut away.
  selector: m[1].trim().split('\n').at(-1).trim(),
  line: css.slice(0, m.index + m[1].length).split('\n').length,
  declarations: m[2]
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => ({
      property: d.slice(0, d.indexOf(':')).trim(),
      value: d.slice(d.indexOf(':') + 1).trim(),
    })),
}))

describe('index.css — every shadow and every fade is one of the named ones', () => {
  it('reads the stylesheet as rules at all (the scan is not vacuous)', () => {
    expect(rules.length).toBeGreaterThan(100)
    expect(rules.some((r) => r.selector === '.card')).toBe(true)
  })

  it('no rule outside the owner list declares a shadow, a mask, or a drop-shadow()', () => {
    const owners = new Set(OWNER_RULES.map((o) => o.selector))
    const strays = rules.flatMap((r) =>
      owners.has(r.selector)
        ? []
        : r.declarations
            .filter(
              (d) =>
                !d.property.startsWith('--') &&
                (SHADOW_PROPERTY.test(d.property) || /drop-shadow\(/.test(d.value)),
            )
            .map((d) => `src/index.css:${r.line} — ${r.selector} { ${d.property}: ${d.value} }`),
    )
    expect(strays).toEqual([])
  })

  for (const { selector, declares, why } of OWNER_RULES)
    it(`${selector} declares exactly its recipe — ${why}`, () => {
      expect(why.length).toBeGreaterThan(10) // an entry with no reason is not an entry
      const matches = rules.filter((r) => r.selector === selector)
      expect(matches, `the rule is gone, so its allow-list entry is stale`).toHaveLength(1)
      const found = Object.fromEntries(
        matches[0].declarations
          .filter((d) => SHADOW_PROPERTY.test(d.property) || /drop-shadow\(/.test(d.value))
          .map((d) => [d.property, d.value]),
      )
      expect(found).toEqual(declares)
    })

  it('every shadow and fade token is declared once, on :root, with its one value — and no other exists', () => {
    const declared = rules.flatMap((r) =>
      r.declarations
        .filter((d) => d.property.startsWith('--') && TOKEN_NAME.test(d.property))
        .map((d) => ({ ...d, selector: r.selector })),
    )
    const ours = declared.filter((d) => !THEME_PAIR.includes(d.property))
    expect(Object.fromEntries(ours.map((d) => [d.property, d.value]))).toEqual(TOKENS)
    expect(ours.map((d) => d.property).sort()).toEqual(Object.keys(TOKENS).sort()) // each ONCE
    expect([...new Set(ours.map((d) => d.selector))]).toEqual([':root'])
    // The theme pair: the default on :root, and on a theme's own row — nowhere else.
    const pairHomes = declared.filter((d) => THEME_PAIR.includes(d.property)).map((d) => d.selector)
    expect(pairHomes.length).toBeGreaterThan(0)
    for (const home of pairHomes) expect(home).toMatch(/^(:root|\[data-theme="[a-z]+"\])$/)
  })

  it('the three roles are the theme’s own colour, and every length in them is rem', () => {
    const themed = [
      TOKENS['--shadow-lifted'],
      TOKENS['--shadow-float'],
      ...OWNER_RULES.filter((o) => o.selector.startsWith('.elev-shadow-')).map(
        (o) => o.declares['box-shadow'],
      ),
    ]
    expect(themed).toHaveLength(4)
    for (const recipe of themed) {
      expect(recipe).toContain('var(--shadow-elev-c)')
      expect(recipe).toContain('var(--shadow-elev-a)')
      expect(recipe).not.toMatch(/\dpx/) // the fluid unit, like every other measure in the app
      expect(recipe).not.toMatch(/rgba\(|#[0-9a-f]{3}/i) // no literal colour beside the theme's
      expect(recipe).not.toContain('color-mix') // would ship raw and void the whole declaration
    }
    // …and the two that are NOT theme shadows are the only literal colours, and say so by name.
    expect(TOKENS['--frost-edge']).toMatch(/^0 0 0 \.5px rgb\(0 0 0 \/ /) // a line: all spread
    expect(TOKENS['--shadow-thumb']).toMatch(/rgb\(0 0 0 \/ /)
  })

  it('the guide’s two strips are the same fade: the one depth, the page’s colour, the continuous strength', () => {
    for (const [edge, direction] of [
      ['top', 'to bottom'],
      ['bottom', 'to top'],
    ]) {
      const strip = rules.filter((r) => r.selector === `.doc-fade-${edge}`)
      expect(strip).toHaveLength(1)
      const d = Object.fromEntries(strip[0].declarations.map((x) => [x.property, x.value]))
      expect(d.height).toBe('var(--fade-h)')
      expect(d.background).toBe(`linear-gradient(${direction},var(--bg1),transparent)`)
      expect(d.opacity).toBe('var(--shade,1)')
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════
// MARKUP
// ═════════════════════════════════════════════════════════════════════════════════════════════
const srcFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? srcFiles(join(dir, e.name))
      : /\.(ts|tsx|js|jsx)$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  )
const scanned = [...srcFiles(join(root, 'src')), join(root, 'index.html')]

// Code only. A `//` comment runs to the end of its line; one that follows a `:` is a URL in a
// string ("https://…") and is left alone. index.html has no line comments, only <!-- -->.
const codeOf = (file) => {
  const text = readFileSync(file, 'utf8')
  return file.endsWith('.html')
    ? stripBlockComments(text).replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ''))
    : stripBlockComments(text).replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// What markup may not say. Each pattern is anchored so that the role classes themselves
// (elev-shadow-down, float-shadow, held-shadow, fade-scroll-top) and the tokens (--shadow-float)
// are NOT matches: a shadow word that follows a `-` or a word character is part of a longer name.
const BANNED = [
  {
    what: 'an inline-style shadow or mask key',
    re: /\b(?:boxShadow|textShadow|maskImage|WebkitMaskImage|WebkitBoxShadow|WebkitMask|MozBoxShadow)\b/g,
  },
  {
    what: 'a shadow or mask CSS declaration',
    re: /(?<![\w-])(?:-webkit-|-moz-)?(?:box-shadow|text-shadow|mask-image|drop-shadow)(?![\w-])/g,
  },
  {
    what: 'a Tailwind shadow utility',
    re: /(?<![\w-])(?:inset-|drop-|text-)?shadow-[\w[(][^\s"'`]*/g,
  },
  { what: 'a Tailwind mask utility', re: /(?<![\w-])mask-[\w[(][^\s"'`]*/g },
  { what: 'an SVG mask', re: /<mask\b|\bmask=/g },
]
// A bare `shadow` / `drop-shadow` is a Tailwind utility too, and also an English word — so it is
// only read as a class where classes are written: a className, a class attribute, or one of the
// shared class constants (…_CLASS, BASE_BTN and its kin).
const BARE_UTILITY = /(?<![\w-])(?:drop-)?shadow(?![\w-])/g
const CLASS_LINE = /className|class=|_CLASS\b|_BTN\b/
// Inside a quoted string on such a line: the class list itself, not the prose beside it.
const QUOTED = /(["'`])(?:(?!\1).)*\1/g

// THE ALLOW-LIST — file → pattern → reason. One entry.
const ALLOWED = [
  {
    file: 'src/components/BootOverlay.tsx',
    what: 'an SVG mask',
    why: 'the boot screen’s traced logo is REVEALED through an SVG <mask> as it draws — a drawing technique inside one <svg>, not an edge fade on a scroll region, and nothing a CSS token could express',
  },
]
const allowedFor = (file, what) => ALLOWED.find((a) => a.file === file && a.what === what)

const sites = scanned.flatMap((file) =>
  codeOf(file)
    .split('\n')
    .flatMap((line, i) =>
      [
        ...BANNED.flatMap(({ what, re }) =>
          [...line.matchAll(re)].map((m) => ({ what, hit: m[0] })),
        ),
        ...(CLASS_LINE.test(line)
          ? [...line.matchAll(QUOTED)].flatMap((q) =>
              [...q[0].matchAll(BARE_UTILITY)].map((m) => ({
                what: 'a Tailwind shadow utility',
                hit: m[0],
              })),
            )
          : []),
      ].map((s) => ({ ...s, file: rel(file), line: i + 1 })),
    ),
)

describe('markup — no fade or shadow is spelled outside the stylesheet’s tokens', () => {
  it('scans a real tree', () => {
    expect(scanned.length).toBeGreaterThan(40)
    expect(scanned.map(rel)).toContain('index.html')
  })

  it('finds no shadow or mask literal, style key, or Tailwind utility in src/ or index.html', () => {
    const violations = sites
      .filter((s) => !allowedFor(s.file, s.what))
      .map((s) => `${s.file}:${s.line} — ${s.what}: ${s.hit} (wear a role class from index.css)`)
    expect(violations).toEqual([])
  })

  for (const { file, what, why } of ALLOWED)
    it(`${file} may hold ${what} — ${why}`, () => {
      expect(why.length).toBeGreaterThan(40) // a written reason, not a shrug
      // …and it still does: an entry that excuses nothing is deleted, not kept.
      expect(sites.some((s) => s.file === file && s.what === what)).toBe(true)
    })

  it('the patterns catch the literals that were really in the tree, and spare the role classes', () => {
    const caught = (text) =>
      BANNED.some(({ re }) => text.match(re) !== null) ||
      (CLASS_LINE.test(text) &&
        [...text.matchAll(QUOTED)].some((q) => q[0].match(BARE_UTILITY) !== null))
    const banned = [
      `export const BASE_BTN = 'w-full rounded-2xl border px-4 py-3 text-base shadow-xs select-none'`,
      `export const MODAL_CARD_SHADOW = { boxShadow: '0 0 8px rgba(0,0,0,0.12)' } as const`,
      `              boxShadow: '0 6px 28px rgba(0,0,0,0.12), 0 0 0 0.5px rgba(0,0,0,0.05)',`,
      `<div className="rounded-2xl shadow">`,
      `<div className="hover:shadow-lg">`,
      `<div className="drop-shadow-md">`,
      `<div className="inset-shadow-sm">`,
      `<div className="text-shadow-xs">`,
      `<div className="shadow-[0_6px_24px_#000]">`,
      `<div className="shadow-(--shadow-float)">`,
      `<div className="mask-b-from-80%">`,
      `<div style={{ maskImage: 'linear-gradient(black, transparent)' }}>`,
      `el.style.setProperty('box-shadow', 'none')`,
      `#boot .bw{text-shadow:0 1px 2px #000}`,
      `.x{filter:drop-shadow(0 1px 2px #000)}`,
    ]
    const legal = [
      `className="guide-head elev-shadow-down w-full text-left px-4 py-3"`,
      `<div ref={footRef} className="elev-shadow-up shrink-0 px-4 space-y-3">`,
      `export const MODAL_CARD_CLASS = 'card float-shadow rounded-2xl py-4 w-full'`,
      `className="rounded-2xl overflow-hidden flex flex-col float-shadow-frost"`,
      `const HELD_SHADOW_CLASS = 'held-shadow'`,
      `? ' fade-scroll-both'`,
      `<p className="text-sm">each gets a shadow as you lift it</p>`,
      `'the shadow sits under whichever edge the text is sliding beneath',`,
      `writeShade(header, shades.header)`,
      `const shadow = 1`,
    ]
    for (const text of banned) expect(caught(text), text).toBe(true)
    for (const text of legal) expect(caught(text), text).toBe(false)
  })
})
