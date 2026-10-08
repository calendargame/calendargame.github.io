// tests/textSizeGuard.test.js — no new TEXT SIZE written in pixels.
//
// Why this is a build-failing rule: the app sizes itself with ONE fluid root font (index.css:
// html{font-size:clamp(0.75rem, …, 1.1875rem)} — 12px on a small or short screen, up to 19px on a
// large one), and Tailwind's text-xs / text-sm / text-base are rem, so they follow it. A size
// written `text-[11px]` does not. It was chosen to sit just under text-xs at a 16px root — and on a
// 320px-wide phone, where the root is 12px and text-xs is 9px, it is LARGER than the line it was
// meant to sit under. That is what happened to MoX's Best row: "Median: —" under "Best Mean:" drew
// the note bigger than the thing it annotates.
//
// THE RULE: a text size is on the rem scale (a Tailwind step, or `text-[…rem]`), or — where it is a
// note about the line directly above it in the same block — in em, relative to that line.
//
// ⚠ THE ALLOW-LIST BELOW IS WHAT IS STILL IN PIXELS, EACH WITH ITS REASON. They are not all right:
// several are the same defect, left because converting them changes a look the owner has to see on
// his own phone first (a rem size is ~3% larger than its px twin at his 16.5px root) or moves
// something another open decision depends on. An entry comes off this list when its site is
// converted, and the guard fails on a STALE entry as it does on a new size, so the list cannot
// drift from the tree.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const PX_TEXT = /(?<![a-z0-9-])text-\[\d+(?:\.\d+)?px\]/g

const srcFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? srcFiles(join(dir, e.name))
      : /\.(ts|tsx|jsx)$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  )
const scanned = srcFiles(join(root, 'src'))
const rel = (file) => relative(root, file).replace(/\\/g, '/')

// file → { size → how many times it is written there (comments included: a comment that quotes a
// size is quoting a real one) }, with the reason it is still in pixels.
const STILL_IN_PIXELS = [
  {
    file: 'src/components/CustomSelect.tsx',
    sizes: { 'text-[15px]': 1, 'text-[7px]': 1 },
    why: 'a dropdown row`s text, and the ▲▼ beside a trigger. The row`s size decides how many letters a preset name has room for, and that limit is under the owner`s decision — it must not move underneath it. Never smaller than its own trigger at a small root; smaller than it above a 17px root.',
  },
  {
    file: 'src/main.tsx',
    sizes: { 'text-[15px]': 1 },
    why: 'a comment naming the dropdown row`s size above, where the Mode control`s width is derived from it',
  },
  {
    file: 'src/components/GuidePage.tsx',
    sizes: { 'text-[13px]': 1, 'text-[12px]': 3, 'text-[7px]': 1 },
    why: 'How to Play`s body text, its small print, and a header`s ▼. One fixed reading size, consistent within the page — but below a 14.9px root the body is larger than its own section titles (text-sm). Converting it re-flows the whole guide on every device: the owner`s to see first.',
  },
  {
    file: 'src/components/primitives.tsx',
    sizes: { 'text-[8px]': 1, 'text-[10px]': 1, 'text-[11px]': 2 },
    why: 'the ★ beside a new Best (never larger than its text at any root); the <kbd> chip, which belongs to the guide`s fixed reading size; and the ⚙ menu`s two heading tiers, whose exact strings tests/settings.dom freezes as a look to be re-blessed on a device — below a 13.3px root the smaller heading is larger than the rows under it.',
  },
  {
    file: 'src/components/LookupCard.tsx',
    sizes: { 'text-[13px]': 1, 'text-[12px]': 1, 'text-[11px]': 1 },
    why: 'a history row`s date and readings, and the History heading: consistent with each other, and the row is width-tuned so that no reachable date is cut. Larger than the card`s own text-base below a 13px root.',
  },
  {
    file: 'src/components/CardNumber.tsx',
    sizes: { 'text-[11px]': 1 },
    why: 'the card`s number, alone in its corner: there is no line beside it for it to outgrow',
  },
]

const found = new Map()
for (const file of scanned) {
  const sizes = {}
  for (const m of readFileSync(file, 'utf8').matchAll(PX_TEXT)) sizes[m[0]] = (sizes[m[0]] ?? 0) + 1
  if (Object.keys(sizes).length > 0) found.set(rel(file), sizes)
}

describe('text size guard — a pixel text size cannot follow the fluid root', () => {
  it('scans the real tree (the guard cannot go blind)', () => {
    const names = scanned.map(rel)
    expect(names).toContain('src/main.tsx')
    expect(names).toContain('src/modes/AoxMode.tsx')
    expect(names.length).toBeGreaterThan(10)
  })

  it('finds no pixel text size outside the list of those still to be decided', () => {
    const allowed = new Map(STILL_IN_PIXELS.map((e) => [e.file, e.sizes]))
    const extra = []
    for (const [file, sizes] of found)
      for (const [size, count] of Object.entries(sizes)) {
        const most = allowed.get(file)?.[size] ?? 0
        if (count > most)
          extra.push(
            `${file} — ${size} ×${count} (listed: ${most}); use the rem scale, or em under the line it annotates`,
          )
      }
    expect(extra).toEqual([])
  })

  it('carries no stale or unexplained entry', () => {
    const stale = []
    for (const entry of STILL_IN_PIXELS) {
      expect(entry.why.length, entry.file).toBeGreaterThan(40)
      for (const [size, count] of Object.entries(entry.sizes)) {
        const now = found.get(entry.file)?.[size] ?? 0
        if (now !== count) stale.push(`${entry.file} — ${size}: listed ×${count}, found ×${now}`)
      }
    }
    expect(stale).toEqual([])
  })

  // ★ THE CASE THAT FOUND IT. The sub-line is sized from the line above it, in the same block, so
  // it is eleven twelfths of that line at every root — what 11px was at a 16px root.
  it('MoX`s Best sub-lines are sized from the line above them', () => {
    const aox = readFileSync(join(root, 'src/modes/AoxMode.tsx'), 'utf8')
    expect(aox.match(/className="text-\[0\.917em\] opacity-70"/g)).toHaveLength(2)
  })
})
