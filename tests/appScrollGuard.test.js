// tests/appScrollGuard.test.js — every scroll the app makes goes through lib/appScroll.
//
// Why: lib/pointerGestures reads a touch during which a box holding the pressed control MOVED as a
// scroll, and presses nothing. A move the APP made (How to Play's glide, the Shift+Tab rest under the
// bar, a list keeping its row in view, a screen sent to its top) must never count as the person's —
// and the controller can only tell the two apart because the app's moves are told to it, by the door.
// A raw scroll write anywhere else would quietly bring back a swallowed press. So this fails the
// suite on any `scrollTop =` / `scrollLeft =` (plain or compound), `scrollTo(`, `scrollBy(`, or
// `scrollIntoView(` in src outside the door, comments excepted, listing the exact file:line sites.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const DOOR = 'src/lib/appScroll.ts'
const BANNED = [
  /\.scroll(?:Top|Left)\s*(?:[-+*/]?=)(?!=)/g,
  /\bscrollTo\s*\(/g,
  /\bscrollBy\s*\(/g,
  /\bscrollIntoView\s*\(/g,
]

const srcFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? srcFiles(join(dir, e.name))
      : /\.(ts|tsx|js|jsx)$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  )
const rel = (file) => relative(root, file).replace(/\\/g, '/')
// Code only: a line's `//` comment, and lines inside a block comment, say these words in prose.
const codeOf = (line) => {
  const t = line.trimStart()
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return ''
  const at = line.indexOf('//')
  return at >= 0 && !/['"`]/.test(line.slice(0, at)) ? line.slice(0, at) : line
}

describe('appScrollGuard — the app scrolls only through lib/appScroll', () => {
  it('no raw scroll write in src outside the door', () => {
    const violations = srcFiles(join(root, 'src')).flatMap((file) =>
      rel(file) === DOOR
        ? []
        : readFileSync(file, 'utf8')
            .split('\n')
            .flatMap((line, i) =>
              BANNED.flatMap((re) => [...codeOf(line).matchAll(re)]).map(
                (m) => `${rel(file)}:${i + 1} — ${m[0]} (scroll through lib/appScroll)`,
              ),
            ),
    )
    expect(violations).toEqual([])
  })
  it('the patterns are live: each catches its own shape', () => {
    const probe = [
      'el.scrollTop = 0',
      'el.scrollTop -= px',
      'el.scrollLeft+=1',
      'window.scrollTo(0, 0)',
      'el.scrollBy(0, 1)',
      'el.scrollIntoView()',
    ]
    for (const line of probe) expect(BANNED.some((re) => line.match(re))).toBe(true)
    expect(BANNED.some((re) => 'if (el.scrollTop === 0)'.match(re))).toBe(false)
  })
})
