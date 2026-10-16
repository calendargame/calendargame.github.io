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
    file: 'src/components/primitives.tsx',
    sizes: { 'text-[8px]': 1 },
    why: 'the ★ beside a new Best: never larger than its text at any root. (The <kbd> chip and the ⚙ menu`s two heading tiers left this list in Round 26, onto the root`s scale pinned to a standard phone — as did How to Play`s body, small print, and ▼.)',
  },
  {
    file: 'src/components/CardNumber.tsx',
    sizes: { 'text-[11px]': 1 },
    why: 'the card`s number, alone in its corner: there is no line beside it for it to outgrow',
  },
]

// ── AND NO BOX WIDTH WRITTEN IN PIXELS ───────────────────────────────────────────────────────────
// The same defect one step along: a box sized in pixels round text sized in rem. The Best row's
// columns had a least width of 125 pixels, tuned at the 16.458px root of a 390×844 phone; at the
// 12px root of a short screen (every landscape phone) they held 9px text in the room 12px text
// needs, and the "Same Round" tag beside them — given what was left of the line — had no place at
// any width. A width, a least width, a most width, or a basis written `…-[Npx]` cannot follow the
// root. There is no allow-list: the tree has none (the Best columns' was the only one), so every
// new one is either a mistake or a decision to be argued here.
// (Not watched, on purpose: Tailwind's own steps and `w-px`, which are not arbitrary pixel values;
// heights, which tests/heightGuard owns; and offsets and paddings, which do not box text in.)
const PX_WIDTH = /(?<![a-z0-9-])(?:min-w|max-w|w|basis)-\[\d+(?:\.\d+)?px\]/g

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

  it('finds no box width written in pixels — a width round rem-sized text is written against the root', () => {
    const widths = scanned.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(PX_WIDTH)].map((m) => `${rel(file)} — ${m[0]}`),
    )
    expect(widths).toEqual([])
    // (…and the pattern does see one, so an empty list is a clean tree and not a blind guard.)
    const sees = (text) => [...text.matchAll(PX_WIDTH)].map((m) => m[0])
    expect(sees('a min-w-[125px] b w-[40.5px] c max-w-[9px] d basis-[3px]')).toHaveLength(4)
    expect(sees('w-px min-w-0 w-[7.5rem] min-w-[calc(125rem/16.458)] h-[3px] text-[11px]')).toEqual(
      [],
    )
  })

  // ★ THE CASE THAT FOUND IT. The sub-line is sized from the line above it, in the same block, so
  // it is eleven twelfths of that line at every root — what 11px was at a 16px root. Since Round 26
  // it is one component (BestReadout's BestSubLine) that MoX's and Blitz's Best rows both draw.
  it('the Best sub-lines (MoX and Blitz) are sized from the line above them', () => {
    const read = (file) => readFileSync(join(root, file), 'utf8')
    const readout = read('src/components/BestReadout.tsx')
    expect(readout.match(/className="text-\[0\.917em\] opacity-70"/g)).toHaveLength(1)
    expect(readout.match(/className="text-\[0\.917em\] invisible"/g)).toHaveLength(1) // the spacer
    expect(read('src/modes/AoxMode.tsx').match(/<BestSubLine>/g)).toHaveLength(2)
    expect(read('src/components/BlitzBestRow.tsx').match(/<BestSubLine>/g)).toHaveLength(2)
    expect(read('src/modes/BlitzMode.tsx').match(/<BestSubLine spacer \/>/g)).toHaveLength(1)
  })
})
