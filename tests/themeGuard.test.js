// tests/themeGuard.test.js — the root-cause kill for the light-theme legibility bug class.
// History: three shipped incidents (the "#8" timestamp, the HTP Lead/markers, the ★ star)
// each came from a raw Tailwind purple text utility that dark themes render fine but
// light/parchment washed out, patched one class at a time in an enumerated index.css
// override block. That block is retired: every purple / white-alpha color literal moved
// onto the per-theme text/rule ramp vars (index.css :root/parchment/light rows, applied
// via the v4 var shorthand). This guard makes the bug UNSHIPPABLE: any raw purple-family
// shade token or white-alpha text token anywhere in src ts/tsx or index.html — className,
// string, or comment (Tailwind v4's scanner extracts candidates from comments too, which
// is how a dead `/95` tier once reached the bundle) — fails the suite, listing the exact
// file:line sites. New text goes on the ramp (text-(--tx-…) etc.); a genuinely new tier
// gets a new entry in all three var rows. src/index.css itself is exempt by design — it is
// where the theme's purple VALUES legitimately live (rgba/oklch, never utility classes).
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Any purple-family Tailwind shade token (purple/violet/fuchsia/indigo — the brand family;
// any utility prefix: text-, bg-, border-l-, ring-, marker:text-, …) plus any white-alpha
// TEXT token. Requiring shade digits keeps prose like "solid purple" legal; bare text-white
// stays legal too — it lives on theme-invariant solid fills (btn-solid / persist red-green),
// which is exactly the one place white text needs no theme awareness.
const BANNED = [/(?:purple|violet|fuchsia|indigo)-\d+(?:\/\d+)?/g, /text-white\/\d+/g]

const tsFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? tsFiles(join(dir, e.name))
      : /\.tsx?$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  )

const scanned = [...tsFiles(join(root, 'src')), join(root, 'index.html')]

const violations = scanned.flatMap((file) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((line, i) =>
      BANNED.flatMap((re) => [...line.matchAll(re)]).map(
        (m) => `${relative(root, file).replace(/\\/g, '/')}:${i + 1} — ${m[0]}`,
      ),
    ),
)

describe('theme guard — raw purple / white-alpha color literals are banned in src + index.html', () => {
  it('scans the real tree (main.tsx and index.html both present — the guard cannot go blind)', () => {
    const names = scanned.map((f) => relative(root, f).replace(/\\/g, '/'))
    expect(names).toContain('src/main.tsx')
    expect(names).toContain('index.html')
    expect(names.length).toBeGreaterThan(10)
  })

  it('finds zero banned color literals (every color site must use the index.css ramp vars)', () => {
    expect(violations).toEqual([])
  })
})
