// tests/heightGuard.test.js — no hard-coded PIXEL HEIGHTS in the UI tree.
// Why this is a build-failing rule and not a style preference: this app sizes itself with ONE
// fluid root font (index.css: html{font-size:clamp(…,1.95vh,…)}), so every rem-based height —
// padding, line boxes, panels, the whole vertical rhythm — shrinks together to fit a short screen
// and grows on a tall one. A height written in px is the one measurement that cannot take part in
// that. It is right on exactly one device and wrong on every other, and the failure is silent: the
// layout just runs off the bottom, or leaves a band of unused screen.
// The shipped example was the Lookup history list's max-h-[440px], which round-7 RESTORED after a
// Tailwind glue bug had silently killed it (see tests/classGlueGuard.test.js). 440px was tuned on
// one phone; on a smaller one the list pushed the Show Codes panel off-screen and the whole page
// scrolled. Round 8 replaced the cap itself with measured flex layout — the list simply takes
// the room that's left — and this guard keeps the shortcut from coming back.
// SCOPE — the VERTICAL axis only, and only fixed px:
//   • banned:  h-[64px]  min-h-[40px]  max-h-[440px]
//   • legal:   min-w-[125px], pt-[3px], text-[11px]  (widths, offsets, type — not heights)
//   • legal:   max-h-[55vh], max-h-[calc(100dvh_-_var(--bar-h))], min-h-10, h-full
//     (viewport/relative units and the rem-based scale all follow the screen; that's the point)
// A hairline BORDER or a 1px nudge is not a height and is not the target here; if a genuine
// exception ever appears, it belongs in this comment with its reason, not in a silent bypass.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// h- / min-h- / max-h- with an arbitrary value that is a bare pixel number. The leading
// boundary keeps `xh-[10px]`-style false matches out; `\d+` (no unit alternatives) is what
// restricts this to px — max-h-[55vh] and max-h-[calc(…)] don't match.
const PX_HEIGHT = /(?<![a-z0-9-])(h|min-h|max-h)-\[\d+px\]/g

const srcFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? srcFiles(join(dir, e.name))
      : /\.(ts|tsx|jsx)$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  )

const scanned = srcFiles(join(root, 'src'))

const violations = scanned.flatMap((file) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((line, i) =>
      [...line.matchAll(PX_HEIGHT)].map(
        (m) =>
          `${relative(root, file).replace(/\\/g, '/')}:${i + 1} — ${m[0]} (use the rem scale, a viewport unit, or measured flex layout)`,
      ),
    ),
)

describe('height guard — the fluid-root system cannot shrink a pixel height', () => {
  it('scans the real tree (main.tsx and LookupCard.tsx both present — the guard cannot go blind)', () => {
    const names = scanned.map((f) => relative(root, f).replace(/\\/g, '/'))
    expect(names).toContain('src/main.tsx')
    expect(names).toContain('src/components/LookupCard.tsx')
    expect(names.length).toBeGreaterThan(10)
  })

  it('finds zero hard-coded px heights', () => {
    expect(violations).toEqual([])
  })

  it('the pattern catches heights and spares widths, offsets, type sizes and relative units', () => {
    const banned = ['h-[64px]', 'min-h-[40px]', 'max-h-[440px]']
    const legal = [
      'min-w-[125px]',
      'w-[125px]',
      'pt-[3px]',
      'text-[11px]',
      'max-h-[55vh]',
      'max-h-[calc(100dvh_-_var(--bar-h))]',
      'min-h-10',
      'h-full',
    ]
    for (const c of banned) expect(c.match(PX_HEIGHT), c).not.toBeNull()
    for (const c of legal) expect(c.match(PX_HEIGHT), c).toBeNull()
  })
})
