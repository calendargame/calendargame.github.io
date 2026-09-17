// tests/containingBlockGuard.test.js — Q8 round-11's silent-dependency guard.
//
// The mode selector's dropdown panel is position:FIXED (components/CustomSelect), which is what
// makes its position scroll-independent in both the clamped modes and the guide's document scroll.
// "Fixed" means "positioned against the viewport" — but only while no ancestor has CREATED A
// CONTAINING BLOCK for fixed descendants. transform, filter, backdrop-filter, will-change, contain
// and perspective all do exactly that: put any one of them on <html>, <body> or #root and the
// panel silently starts answering to a scrolling box instead of the viewport, i.e. it drifts with
// the page again — the Round-4 report Q8 root-caused, back with no code change to blame.
//
// That is an invisible dependency, so it gets a visible test. This scans the two places those
// three elements can be styled — src/index.css and index.html (its inline <style> plus the class
// attributes on <html>/<body>/#root) — and the one way JS can add an inline style to them.
// Nothing here is about scrolling per se; it is about who the viewport is.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(root, 'src/index.css'), 'utf8')
// index.html IS READ WITH ITS HTML COMMENTS STRIPPED, and that is correctness, not tidiness.
// Everything below scans it with tag patterns — /<body[^>]*>/ and friends — while index.html's
// prose comments talk ABOUT those tags: the note that now stands above <body> spells `<body>` out
// in full, EARLIER in the file than the element. A raw scan matches the comment first and then
// reads a class attribute off a sentence, so every class assertion here would be answering a
// question about prose, including the assertion added to prove it wasn't. Stripping once, at the
// door, is the one place that fixes it for all of them — the CSS half of this file has always
// done exactly this with /* */, for exactly this reason.
const stripHtmlComments = (text) => text.replace(/<!--[\s\S]*?-->/g, '')
const htmlRaw = readFileSync(join(root, 'index.html'), 'utf8')
const html = stripHtmlComments(htmlRaw)

// The six properties (transform and its three individual-transform siblings count as one trigger),
// each with an OPTIONAL vendor prefix. The prefix half started as a single hand-listed
// -webkit-backdrop-filter, because that is the one the app actually ships — the panel's own frosted
// glass uses it, on the PANEL, which is fine; on an ancestor it is fatal. Hand-listing one of them
// was an arbitrary line: -webkit-transform and -webkit-filter create a containing block in WebKit
// exactly as the unprefixed spellings do, and a guard against an invisible dependency should not
// depend on which spelling somebody reaches for. Making the prefix optional covers all of them for
// one token and costs nothing — no unprefixed match is lost, and the self-check below feeds it the
// prefixed shape.
const BANNED_PROPS =
  /(?:^|;)\s*((?:-(?:webkit|moz|ms|o)-)?(?:transform|translate|rotate|scale|perspective|filter|backdrop-filter|will-change|contain))\s*:/gi

// A selector targets one of the three iff it ENDS in html, body or #root (possibly with
// attribute/pseudo qualifiers) — `html[data-theme="light"] #root` counts, `#root .panel` does not,
// and neither does `[data-theme="light"] #boot`.
const TARGETS_ROOT_CHAIN = /(?:^|[\s>+~])(?:html|body|#root)(?:\[[^\]]*\])*(?::[a-z-]+)*$/i

// Innermost rule blocks only: `[^{}]+` can't cross a brace, so an @media wrapper never matches as
// a selector and its inner rules are picked up individually.
const rules = (text) =>
  [...text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].split(',').map((s) => s.trim()),
    body: m[2],
  }))

const scanRules = (text, label) =>
  rules(text).flatMap(({ selectors, body }) =>
    selectors.some((s) => TARGETS_ROOT_CHAIN.test(s))
      ? [...body.matchAll(BANNED_PROPS)].map(
          (m) => `${label} — ${selectors.join(',')} declares ${m[1]}`,
        )
      : [],
  )

// index.html's inline <style> blocks (the boot splash's, today).
const inlineStyleBlocks = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1])

// Tailwind utilities that compile to one of the banned properties. Matched against the class
// attribute of <html>, <body> and #root only.
const BANNED_CLASSES =
  /(?:^|\s)-?(?:transform|filter|transform-gpu|(?:translate|rotate|scale|skew|blur|perspective|contain|will-change|backdrop)-[^\s"]+)/i
// `text` is a parameter only so the self-check below can feed it a synthetic document; every real
// call takes the comment-stripped index.html.
const classAttr = (openTagPattern, text = html) => {
  const tag = text.match(openTagPattern)?.[0] ?? ''
  return tag.match(/class="([^"]*)"/)?.[1] ?? ''
}
const rootChainClasses = [
  ['<html>', classAttr(/<html[^>]*>/)],
  ['<body>', classAttr(/<body[^>]*>/)],
  ['#root', classAttr(/<div id="root"[^>]*>/)],
]

// The JS half. Rather than enumerate banned property names (which dates the moment CSS adds
// another containing-block trigger), pin the WHOLE SET of inline style properties the app ever
// writes to <html> / <body>: three, all harmless. Anything new has to come here and be justified.
//   • background      — <html>'s theme stamp (index.html's boot script, App's theme effect).
//   • --bar-h         — the top bar's measured height, a custom property on <html>.
//   • backgroundColor — <body>'s scrimmed colour while a modal is up (round 22 Q7, the iOS 26
//                       status-bar lever argued at App's theme effect). A colour cannot create a
//                       containing block; it is listed rather than waved through so the set stays
//                       closed.
const ALLOWED_INLINE_PROPS = ['background', '--bar-h', 'backgroundColor']
const srcFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? srcFiles(join(dir, e.name))
      : /\.(ts|tsx|js|jsx)$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  )
const rel = (file) => relative(root, file).replace(/\\/g, '/')
const inlineWrites = [
  ...srcFiles(join(root, 'src')).map((f) => [rel(f), readFileSync(f, 'utf8')]),
  ['index.html', html],
]
  .flatMap(([name, text]) =>
    [
      ...text.matchAll(
        /(?:document\.documentElement|document\.body)\.style\.(?:setProperty\(\s*['"]([^'"]+)['"]|([A-Za-z-]+)\s*=)/g,
      ),
    ].map((m) => `${name} — ${m[1] || m[2]}`),
  )
  .filter((w) => !ALLOWED_INLINE_PROPS.some((p) => w.endsWith(`— ${p}`)))

describe('containing-block guard (Q8) — nothing may make html/body/#root the fixed panel’s viewport', () => {
  it('sees the real rules for all three elements (the scanner cannot go blind)', () => {
    const hit = (sel) => rules(css).some(({ selectors }) => selectors.includes(sel))
    expect(hit('html')).toBe(true) // the overflow clamp (html,body{…})
    expect(hit('body')).toBe(true)
    expect(hit('#root')).toBe(true) // the fixed 100dvh box — now unconditional (round 13)
    // There used to be a fourth real rule here, `html[data-doc-scroll] #root`, which released that
    // box for the guide's document scroller. It is gone with the whole mechanism, and with it the
    // stylesheet's only QUALIFIED chain onto one of the three. That shape still has to be covered,
    // since it is the one an innocent-looking future rule would wear — the synthetic case below
    // holds it, and this line is deliberately not replaced by a weaker real-rule stand-in.
    expect(inlineStyleBlocks.length).toBeGreaterThan(0)
    expect(rootChainClasses.map(([el]) => el)).toEqual(['<html>', '<body>', '#root'])
    // …and the class attributes really were read, not silently missed by the tag patterns.
    const cls = (el) => rootChainClasses.find(([name]) => name === el)[1]
    expect(cls('#root')).toContain('min-h-screen')
    // <body> is the OTHER half of that proof and it no longer has a class to prove it with: its
    // `text-(--tx-50)` was deleted in round 17 (it duplicated index.css's body{color} and was the
    // sole reason the cascade-layer fix would otherwise have reflowed ~400 inherited colours — see
    // the note on the <body> tag in index.html). An empty string is what classAttr returns both
    // when it read an unclassed tag AND when it failed to find the tag at all, so asserting '' here
    // would be exactly the vacuous green this line exists to prevent. Pin the facts separately:
    // the tag pattern really matches <body>, the class really is absent, and — the part that this
    // guard got wrong once — the pattern is matching the ELEMENT and not the prose above it.
    expect(html).toMatch(/<body[^>]*>/)
    expect(cls('<body>')).toBe('')
    expect(/<body[^>]*class=/.test(html)).toBe(false)
    expect(html.length).toBeLessThan(htmlRaw.length) // comments were really stripped
    // The shape that blinded it: a comment naming `<body>`, ahead of the real element. Read
    // stripped, the answer is the element's class; read raw, it is the sentence's. Both halves are
    // asserted so the second line states the failure mode instead of leaving it to be rediscovered.
    const decoy = '<!-- <body class="transform"> is what this used to say -->\n<body class="real">'
    expect(classAttr(/<body[^>]*>/, stripHtmlComments(decoy))).toBe('real')
    expect(classAttr(/<body[^>]*>/, decoy)).toBe('transform')
  })

  it('src/index.css declares none of the six on html, body or #root', () => {
    expect(scanRules(css, 'src/index.css')).toEqual([])
  })

  it("index.html's inline styles declare none of them either", () => {
    expect(inlineStyleBlocks.flatMap((b) => scanRules(b, 'index.html <style>'))).toEqual([])
  })

  it('no Tailwind transform/filter/contain utility sits on html, body or #root', () => {
    expect(
      rootChainClasses.filter(([, cls]) => BANNED_CLASSES.test(cls)).map(([el]) => el),
    ).toEqual([])
  })

  it('JS writes only background, --bar-h and backgroundColor inline on html/body — never a containing-block property', () => {
    expect(inlineWrites).toEqual([])
  })

  it('the scanner recognises a violation when one is present (it is not vacuously green)', () => {
    // Each half, fed the exact shape it exists to catch.
    expect(scanRules('#root{transform:translateZ(0)}', 'x').length).toBe(1)
    // The qualified-chain shape, which no live rule wears any more (see the note above).
    expect(
      scanRules('html[data-theme="light"] #root{will-change:scroll-position}', 'x').length,
    ).toBe(1)
    expect(scanRules('body{backdrop-filter:blur(2px)}', 'x').length).toBe(1)
    // …and the same declarations wearing a vendor prefix, which is the half that used to be one
    // hand-listed property rather than a rule.
    expect(scanRules('#root{-webkit-transform:translateZ(0)}', 'x')).toEqual([
      'x — #root declares -webkit-transform',
    ])
    expect(scanRules('body{-webkit-backdrop-filter:blur(2px)}', 'x').length).toBe(1)
    expect(scanRules('#root .panel{transform:scale(1)}', 'x')).toEqual([]) // a descendant is fine
    expect(scanRules('html,body{overscroll-behavior-y:contain}', 'x')).toEqual([]) // value, not property
    expect(BANNED_CLASSES.test('min-h-screen backdrop-blur-xl')).toBe(true)
    expect(BANNED_CLASSES.test('min-h-screen text-(--tx-50)')).toBe(false)
  })
})
