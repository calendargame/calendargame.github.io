// tests/classGlueGuard.test.js — round 7's root-cause kill for the glued-class bug class.
// History: two shipped incidents, both from a class token glued directly to a template-literal
// `${` inside a className. Tailwind v4's source scanner tokenizes raw text, so a glued site
// reads as one candidate (`pt-5${mode…`, `max-h-[440px]${lookup…`) — not a valid utility, so
// the rule is silently DROPPED from the built CSS whenever the utility appears nowhere else.
// Incident one: the HtP sticky bar lost its pt-5 and the whole site sat ~20px too high (fixed
// next day, 2026-06-01 — the ⚠ REQUIRED-SPACE comment in main.tsx). Incident two survived a
// month and a half because it only showed at 11+ Lookup history entries: `max-h-[440px]` never
// reached the CSS, the list grew unbounded, and the whole Lookup page scrolled (found in round-7,
// fixed 2026-07-21; that cap has since been replaced by measured flex layout, so LookupCard no
// longer carries the twin of this note — see tests/heightGuard.test.js). This guard makes the bug
// class UNSHIPPABLE: on any className/_CLASS line in src *.tsx/*.jsx or index.html, a class
// token character (lowercase letter, digit, `)`, `]`) immediately followed by `${` fails the
// suite, listing the exact file:line sites. The fix is always one SPACE before the `${` —
// conditional branches already carry their own leading space, and a doubled space in a class
// attribute is meaningless to the browser and to the scanner alike.
// Scan-scope assumption: the guard is LINE-based — only lines matching className/_CLASS are
// read, so a className template literal SPLIT ACROSS LINES would put its continuation lines
// outside the scan. Every className literal in the tree is single-line today; if one is ever
// wrapped, extend the guard to track open template literals so it stays honest.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// A class-token character glued to an interpolation opener. `)`/`]` close the v4 var
// shorthand and arbitrary-value forms (text-(--tx-…), max-h-[440px]); `}` is deliberately
// NOT in the set — `}${` chains two interpolations, so no source token spans the seam.
// Only className/_CLASS lines are scanned: template literals elsewhere (RegExp sources,
// aria-labels, message strings) glue `${` legitimately and never feed the class scanner
// with tokens that matter.
const GLUE = /[a-z0-9)\]]\$\{/g
const CLASS_LINE = /className|_CLASS/

const uiFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? uiFiles(join(dir, e.name))
      : /\.(tsx|jsx)$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  )

const scanned = [...uiFiles(join(root, 'src')), join(root, 'index.html')]

const violations = scanned.flatMap((file) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((line, i) =>
      CLASS_LINE.test(line)
        ? [...line.matchAll(GLUE)].map(
            (m) =>
              `${relative(root, file).replace(/\\/g, '/')}:${i + 1} — …${line.slice(
                Math.max(0, m.index - 24),
                m.index + 2,
              )}… (add a space before the \`\${\`)`,
          )
        : [],
    ),
)

describe('class glue guard — no class token may touch a `${` on a className/_CLASS line', () => {
  it('scans the real tree (main.tsx and index.html both present — the guard cannot go blind)', () => {
    const names = scanned.map((f) => relative(root, f).replace(/\\/g, '/'))
    expect(names).toContain('src/main.tsx')
    expect(names).toContain('index.html')
    expect(names.length).toBeGreaterThan(10)
  })

  it('finds zero glued class sites (every `${` after a class token needs a space before it)', () => {
    expect(violations).toEqual([])
  })
})
