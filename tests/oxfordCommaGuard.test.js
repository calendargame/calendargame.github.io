// tests/oxfordCommaGuard.test.js — THE OXFORD COMMA, made unshippable to forget.
// The owner's standing rule (2026-10-07): in every list of three or more there is a comma before
// the final "and" / "or" / "nor" — "Off, Stats Only, and Full", never "Off, Stats Only and Full" —
// in everything a player can read or hear. The whole app was swept by hand when the rule was set;
// this guard is what keeps the next sentence anyone writes from quietly undoing it.
//
// WHAT IT READS
//   • src/changelog.ts and every other src/**/*.{ts,tsx,js,jsx} file, and vite.config.js (the
//     installed app's manifest text) — parsed with the TypeScript compiler, never line by line:
//       – JSX PROSE, joined the way a reader meets it. A paragraph in How to Play is split by the
//         source across line breaks, {' '} joins, and <b> / <i> / <Kbd> / <span> / <a> elements, so
//         the text of an element is flattened through its inline children and cut only where a
//         block starts or ends. A list broken over three tags is still one list here. An
//         expression the guard cannot read (a helper call, a conditional) stands in the text as ▢,
//         which is exactly one word as far as a list is concerned.
//       – EVERY STRING AND TEMPLATE LITERAL outside an import — aria-labels, titles, placeholders,
//         popup bodies, toasts, the changelog's lines. A `${…}` is a ▢ too.
//   • CHANGELOG-ARCHIVE.md, paragraph by paragraph and bullet by bullet.
//   • index.html — its attribute values (the description a search result or a shared link shows)
//     and its text, with comments, scripts, and styles removed.
//
// WHAT COUNTS AS A MISS. Inside one clause — cut at . ! ? ; : and at a dash or an unclosed bracket —
// an "and" / "or" / "nor" with NO comma before it, in a clause that already has a comma: the shape
// "A, B and C". Four things that have that shape and are not a list of three are let through by
// rule, because each is unmistakable from the words alone:
//   – the stretch after the last comma opens with a joining word ("…, and the stats and bests are
//     kept", "…, which clears A and B"): the comma closed a clause, and what follows is a pair;
//   – the list carries on for at least one more item and THEN has its comma ("A, B and C, D, and
//     E" — "B and C" is one item of a list that is punctuated properly). Only that: "A, B and C,
//     and D" is NOT let through, because "VoiceOver, TalkBack, NVDA and the rest, and the site
//     hasn't…" has the same shape and is a miss;
//   – the clause's commas are all inside a bracket that has already closed;
//   – the clause opens with an introductory word, has exactly one comma, and runs for three words
//     or more before the joiner ("In Flash, a mid-question Reset Stats always generates a new date
//     and returns to dash"): the comma ended the introduction. ("In Classic, Flash and Deduction" is
//     still caught — one word after the comma is an item, not a clause.)
// Everything else that matches is either a real miss or a sentence the guard cannot parse, and a
// sentence it cannot parse goes in NOT_A_LIST below WITH ITS REASON. ⚠ A stale entry fails too:
// every entry must still excuse something, so the list cannot outlive the sentence it was for.
//
// WHAT IT CANNOT SEE
//   • a list that has no comma at all yet reads as three ("A and B and C"), or whose items are
//     separated by something other than commas;
//   • a miss hidden behind a let-through: one inside a longer, properly punctuated list ("A, B and
//     C, D, and E" where A, B, and C were meant as three), or after a one-comma introduction;
//   • text assembled at run time. The one helper that builds a list in words is lib/modes'
//     modeNames, and the last case here pins it; a new one needs its own case;
//   • code comments and test titles, which were swept by hand and are not player-facing.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import ts from 'typescript'
import { modeNames } from '../src/lib/modes.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const rel = (file) => relative(root, file).replace(/\\/g, '/')

// ═════════════════════════════════════════════════════════════════════════════════════════════
// READING — every source becomes a list of { file, line, text } units of plain readable text
// ═════════════════════════════════════════════════════════════════════════════════════════════
const HOLE = '▢'
const BREAK = '\uE000'
// A line marker rides in front of every piece of text, so a unit cut out of the middle of a
// 2,000-line component still reports the line its own first word is on.
const mark = (line) => `\uE001${line}\uE002`
const MARK = /\uE001(\d+)\uE002/g

// The elements that sit INSIDE a sentence. Anything else — p, li, div, the guide's own Subhead /
// Lead / UL — starts and ends a block, and a list never runs across one.
const INLINE = new Set(['b', 'i', 'em', 'strong', 'span', 'a', 'code', 'u', 'sub', 'sup', 'Kbd'])

const ENTITY = {
  apos: "'",
  quot: '"',
  lt: '<',
  gt: '>',
  amp: '&',
  rarr: '→',
  mdash: '—',
  nbsp: ' ',
}
const decode = (text) => text.replace(/&(\w+);/g, (whole, name) => ENTITY[name] ?? whole)

const toUnits = (file, raw) =>
  raw.split(BREAK).flatMap((piece) => {
    const first = MARK.exec(piece)
    MARK.lastIndex = 0
    const text = decode(piece.replace(MARK, '')).replace(/\s+/g, ' ').trim()
    return text ? [{ file, line: first ? Number(first[1]) : 0, text }] : []
  })

const sourceFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sourceFiles(join(dir, e.name))
      : /\.(tsx?|jsx?)$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  )

function readSource(path, source = readFileSync(path, 'utf8')) {
  const file = rel(path)
  const sf = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    /\.[jt]sx$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const at = (node) => mark(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1)
  const template = (node) =>
    node.head.text + node.templateSpans.map((span) => HOLE + span.literal.text).join('')
  const literal = (node) =>
    ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      ? node.text
      : ts.isTemplateExpression(node)
        ? template(node)
        : null
  const isJsxParent = (node) => !!node && (ts.isJsxElement(node) || ts.isJsxFragment(node))
  const tagOf = (node) =>
    (ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName).getText(sf)

  // JSX text the way React renders it: a line break and the indentation round it are dropped,
  // not turned into a space ("<Kbd>Shift</Kbd>+" over "<Kbd>Tab</Kbd>" reads "Shift+Tab").
  const rendered = (text) =>
    text
      .split('\n')
      .map((line, i, all) => {
        const cut = i > 0 ? line.trimStart() : line
        return i < all.length - 1 ? cut.trimEnd() : cut
      })
      .filter(Boolean)
      .join(' ')

  // One JSX node as the text a reader meets, block edges marked.
  const flatten = (node) => {
    if (ts.isJsxText(node)) return at(node) + rendered(node.text)
    if (ts.isJsxExpression(node)) {
      if (!node.expression) return '' // {/* a comment */}
      return at(node) + (literal(node.expression) ?? HOLE)
    }
    if (ts.isJsxSelfClosingElement(node)) return tagOf(node) === 'br' ? BREAK : HOLE
    const inner = node.children.map(flatten).join('')
    return ts.isJsxElement(node) && INLINE.has(tagOf(node)) ? inner : BREAK + inner + BREAK
  }

  const units = []
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return
    if ((ts.isJsxElement(node) || ts.isJsxFragment(node)) && !isJsxParent(node.parent))
      units.push(...toUnits(file, flatten(node)))
    // A literal that is a JSX child — {' '}, {'some words'} — was already read in the flow above.
    const inFlow = ts.isJsxExpression(node.parent ?? node) && isJsxParent(node.parent.parent)
    const text = inFlow ? null : literal(node)
    if (text !== null) units.push(...toUnits(file, at(node) + text))
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return units
}

function readMarkdown(path) {
  const file = rel(path)
  const units = []
  let open = null
  const close = () => {
    if (open) units.push(...toUnits(file, mark(open.line) + open.text.replace(/[*`]/g, '')))
    open = null
  }
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (!line.trim() || /^(#|- )/.test(line)) close()
      if (!line.trim()) return
      if (open) open.text += ` ${line}`
      else open = { line: i + 1, text: line.replace(/^(#+|-) /, '') }
    })
  close()
  return units
}

function readHtml(path) {
  const file = rel(path)
  // Comments, scripts, and styles are blanked to their own line breaks, so a line number reported
  // from what is left is still the file's.
  const html = readFileSync(path, 'utf8').replace(
    /<!--[\s\S]*?-->|<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g,
    (cut) => cut.replace(/[^\n]/g, ''),
  )
  const lineAt = (index) => html.slice(0, index).split('\n').length
  const attributes = [...html.matchAll(/=\s*"([^"]*)"|=\s*'([^']*)'/g)].map(
    (m) => mark(lineAt(m.index)) + (m[1] ?? m[2]),
  )
  const text = [...html.matchAll(/>([^<]+)</g)].map((m) => mark(lineAt(m.index)) + m[1])
  return [...attributes, ...text].flatMap((raw) => toUnits(file, raw))
}

const SOURCES = [...sourceFiles(join(root, 'src')), join(root, 'vite.config.js')]
const units = [
  ...SOURCES.flatMap((path) => readSource(path)),
  ...readMarkdown(join(root, 'CHANGELOG-ARCHIVE.md')),
  ...readHtml(join(root, 'index.html')),
]

// ═════════════════════════════════════════════════════════════════════════════════════════════
// JUDGING — the "A, B and C" shape, and the four things with that shape that are not a list
// ═════════════════════════════════════════════════════════════════════════════════════════════
const JOINER = /\s(and|or|nor)\s/g
// A word that opens a clause or carries a pair on from a comma, not the next item of a list.
const CLAUSE_OPENER =
  /^(and|or|nor|but|so|yet|then|while|which|where|when|whenever|wherever|whether|if|unless|until|because|since|as|though|although|that|who|whose|with|without|like|not|never|even|including|except|just|exactly|rather|instead|plus)\b/i

// A word that opens an introductory phrase: "In Flash, …", "When off, …", "Once a round ends, …".
const INTRODUCER =
  /^(?:(?:and|or|but|so)\s)?(if|when|whenever|once|while|as|because|since|after|before|unless|until|although|though|where|wherever|in|on|at|with|without|for|by|from|under|during)\b/i

// Where the clause a joiner sits in starts: after a sentence end, a ; or :, a dash, or a bracket
// still open at the joiner. A bracket that opened AND closed before the joiner is walked over
// whole — it belongs to one of the clause's own items ("Stats (Amnesic included) and Default Mode").
const CUTS = ['. ', '! ', '? ', '; ', ': ', ' — ', ' – ']
function clauseStart(text, index) {
  let depth = 0
  for (let i = index - 1; i >= 0; i--) {
    if (text[i] === ')') depth++
    else if (text[i] === '(') {
      if (depth === 0) return i + 1
      depth--
    } else if (depth === 0) {
      const cut = CUTS.find((c) => text.startsWith(c, i) && i + c.length <= index)
      if (cut) return i + cut.length
    }
  }
  return 0
}
const withoutBrackets = (clause) => {
  let out = clause
  for (let prev = null; prev !== out; ) {
    prev = out
    out = out.replace(/\([^()]*\)/g, '')
  }
  return out
}
// …and where it ends.
const clauseAfter = (text, index) => text.slice(index).split(/[.!?;:)](?:\s|$)| — | – /)[0]

function missesIn(text) {
  const misses = []
  for (const joiner of text.matchAll(JOINER)) {
    const written = text.slice(clauseStart(text, joiner.index), joiner.index)
    const before = withoutBrackets(written)
    if (/[—–:;(]$/.test(before.trim())) continue // "— and …": the joiner opens the clause
    const commas = before.split(',').length - 1
    if (commas === 0) continue // no comma in the clause: a pair, or nothing this guard can call
    const item = before.slice(before.lastIndexOf(',') + 1).trim()
    if (!item) continue // ", and" — the comma is there
    if (CLAUSE_OPENER.test(item)) continue
    if (commas === 1 && INTRODUCER.test(before.trim()) && item.split(' ').length >= 3) continue
    const after = clauseAfter(text, joiner.index + joiner[0].length)
    if (/,[^,]+,\s(and|or|nor)\s/.test(after)) continue // "A, B and C, D, and E"
    misses.push({ phrase: `${written}${joiner[0]}${after.split(',')[0]}`.trim() })
  }
  return misses
}

// ── SENTENCES WITH THE SHAPE THAT ARE NOT A LIST OF THREE ──
// `phrase` is copied from the failure message: the clause up to the joiner, the joiner, and what
// follows it up to the next comma. `why` says, in words, what the comma is doing instead.
const NOT_A_LIST = [
  // ── a pair that is ONE item of a list which has its comma right after it ("A, B and C, and D",
  //    where "B and C" belong together) — the shape the guard refuses to wave through by rule ──
  {
    file: 'src/components/GuidePage.tsx',
    phrase: 'top-middle and bottom-middle in the standard one, upper-left and lower-right at 45°',
    why: 'three layouts, each naming a PAIR of places; the list’s comma follows (“…, and middle-left and middle-right at 90°”)',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase:
      "about three thousand in Classic and Flash, about two thousand in Deduction's Day and Year puzzles",
    why: 'three amounts; “Deduction’s Day and Year puzzles” is one of them, and the list’s comma follows (“…, and a little under a thousand …”)',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase:
      "the Deduction type, Flash speed, the MoX run length, One-by-One, both Blitz timers, Blitz's Per Round / Per Question choice, Allow Mistakes in MoX and in Blitz",
    why: '“Allow Mistakes in MoX and in Blitz” is one item; the list’s comma follows (“…, and which stats are shown or hidden”)',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase: 'they leave the screen, closing the ⚙ menu and any list that was open',
    why: '“closing the ⚙ menu and any list that was open” is one thing they do; the comma follows (“…, and taking any popup …”)',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase:
      "Opening one puts the keyboard inside it, Tab and Shift+Tab cycle that popup's own controls and wrap around at the ends rather than wandering into the menu beneath",
    why: 'three things a dialog does, the middle one about a PAIR of keys (“Tab and Shift+Tab”) that do a pair of things (“cycle … and wrap around”); the list’s comma follows (“…, and Esc closes it”)',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase: 'in Deduction, alongside Input and for the same reason',
    why: '“alongside Input and for the same reason” is an aside on Deduction; the comma follows (“…, and in every mode while Input is set to Buttons”)',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase:
      'From then on its green and red marks, Reveal, Override and Undo, Show Codes, its weekday letter in a run or round breakdown',
    why: '“a run or round breakdown” is inside one item; the list’s comma follows (“…, and coming back to it with < and >”). (“Override and Undo” in the same list is one button, let through by rule.)',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase: 'That decision is made once, the first time the run or round ends',
    why: 'the comma opens “the first time …”; “the run or round” is a pair, and the comma after it joins a second sentence (“…, and nothing changes it afterward”)',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase: 'MoX mean and median, Blitz score and streak',
    why: 'three bests, the first two each a PAIR; the list’s comma follows (“…, and Per Question sudden-death score”)',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase:
      'It stays in the History list for as long as the app is open, in every preset and after you leave Full',
    why: '“in every preset and after you leave Full” is a pair; the comma after it joins a second sentence (“…, and it is gone when the app is really closed”)',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase:
      'MoX mean and median, Blitz score and streak (kept separately for Per Round and for Per Question with Allow Mistakes)',
    why: 'three bests, the first two each a PAIR; the list’s comma follows the bracket (“…, and Per Question sudden-death score”)',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase:
      'the numbers behind the mean, each date with its day of the week, the fastest and slowest marked',
    why: '“the fastest and slowest marked” is one item; the list’s comma follows (“…, and any solve that didn’t count …”)',
  },
  // ── a comma that is doing something else ──
  {
    file: 'src/changelog.ts',
    phrase:
      'On a Windows computer, text on the page is drawn the way it was before the last update again, matching the text in the ⚙ menu and popups',
    why: 'the comma opens “matching the text in …”; “the ⚙ menu and popups” is the pair that text is in',
  },
  {
    file: 'CHANGELOG-ARCHIVE.md',
    phrase:
      'pressing Esc in the AoX run-length box now throws the typing away too, on the AoX screen and inside the Save Defaults box alike',
    why: 'the comma sets off where it happens; “on the AoX screen and inside the Save Defaults box” is a pair of places',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase:
      'opens a plain-words list of what recent updates changed, each entry dated and listed newest first',
    why: 'the comma opens “each entry …”; “dated and listed newest first” is a pair',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase:
      'choosing a mode, pressing anywhere outside it, Esc, Tab or Shift+Tab (Tab is also the key that opens it',
    why: "FIVE things close the menu, and “Tab or Shift+Tab” is ONE of them — the list’s own comma comes after the bracket, before “and your device's Back button”",
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase:
      "Once you've answered it right, revealed it, or are browsing back, opening the codes is just a review and changes nothing",
    why: 'the commas belong to the list that opens the sentence (“answered it right, revealed it, or are browsing back”), which has its comma; “is just a review and changes nothing” is a pair of verbs',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase:
      'every setting in the Per-preset half of the ⚙ menu, theme and Default Mode (the page it opens on',
    why: '“theme and Default Mode included” is a pair set off from “every setting in … the ⚙ menu”',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase: 'the same list, however many presets you have or whichever one you switch to',
    why: 'the comma sets off an aside; “however many presets you have or whichever one you switch to” is a pair',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase: 'a long list scrolls, here and in both preset lists',
    why: 'the comma sets off where; “here and in both preset lists” is a pair of places',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase:
      'or a Blitz round ends, tap anywhere on the stats strip to see that run or round solve by solve (with Save Stats on',
    why: 'the comma ends “When a MoX run … or a Blitz round ends”; “that run or round” is a pair',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase: "Thursday is R and Sunday is U, keeping them apart from Tuesday's T and Saturday's S",
    why: "two pairs either side of a comma: “Thursday is R and Sunday is U”, then “Tuesday's T and Saturday's S”",
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase:
      'With a list open, Tab or Shift+Tab closes the list and leaves the keyboard on its button',
    why: 'the comma ends “With a list open”; “Tab or Shift+Tab” is a pair of keys',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase:
      'a section of this guide, a stats box, a time readout, the strip of an ended run or round (Enter or Space then presses what it is on)',
    why: 'a list with no joiner at all (it ends in a bracket); “an ended run or round” is one item of it',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase:
      'Enter keeps what you typed and leaves the box, Esc throws the typing away and leaves the box',
    why: 'two sentences joined by a comma, each with a pair of verbs: “keeps … and leaves the box”, “throws … away and leaves the box”',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase: 'Nothing inside an open list is outlined, in the top bar or in the menu',
    why: 'the comma sets off where; “in the top bar or in the menu” is a pair of places',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase:
      "Each section header in this guide, and the Show Codes button, states whether it's open and which panel it opens",
    why: "the commas set off “and the Show Codes button”; “whether it's open and which panel it opens” is a pair",
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase:
      'a section of this guide, the stats boxes, a time readout, the strip of an ended run or round',
    why: "a list that carries on past this item with no joiner (“…, the preset list's button”); “an ended run or round” is one item of it",
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase: 'Sat, Fri, Thu down the left and Wed',
    why: 'two runs of three, each written as the dots read with no joiner, and ONE “and” between the two runs (“Sat, Fri, Thu down the left and Wed, Tue, Mon down the right”)',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase: 'Wed, Tue, Mon across the top and Sat',
    why: 'two runs of three, each written as the dots read with no joiner, and ONE “and” between the two runs (“Wed, Tue, Mon across the top and Sat, Fri, Thu across the bottom”)',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase:
      "If you've already wrong-guessed, revealed, or shown codes on the current date, the change is deferred and applies to the next date",
    why: 'the commas belong to the list in the “If …” half (“wrong-guessed, revealed, or shown codes”), which has its comma; “is deferred and applies” is a pair of verbs',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase: 'When on, dates on or before October 4',
    why: 'the comma ends “When on”; “on or before October 4, 1582” is a pair',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase: 'the setting only changes the weekday, and the codes, of a date on or before it',
    why: 'the commas set off “and the codes”; “on or before it” is a pair',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase: 'is saved on this device too, the same way and through the same visits',
    why: 'the comma opens an aside; “the same way and through the same visits” is a pair',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase:
      'The dates you can browse back through in ▢, each with how you answered it and whether it is overridden',
    why: 'the comma opens “each with …”; “how you answered it and whether it is overridden” is a pair',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase:
      'All three, and the saved defaults they read and write, belong to the preset you are on and reach no other one',
    why: 'the commas set off “and the saved defaults they read and write”; “belong to … and reach no other one” is a pair of verbs',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase: 'Asks first, in a popup that names what it restores and that it is per-preset',
    why: 'the comma sets off how it asks; “what it restores and that it is per-preset” is a pair',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase:
      'When every setting, toggle, stat, best, history entry, and live state in the preset you are on is already where Full Reset would put it, the button dims and locks since tapping it would have no effect',
    why: 'the commas belong to the list in the “When …” half, which has its comma (“…, history entry, and live state”); “dims and locks” is a pair of verbs',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase: 'With it on, Reveal and Show Codes also count as a miss but keep the run going',
    why: 'the comma ends “With it on”; “Reveal and Show Codes” is a pair',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase: 'With Allow Mistakes off, Reveal or Show Codes ends the run',
    why: 'the comma ends “With Allow Mistakes off”; “Reveal or Show Codes” is a pair',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase:
      'you can switch a date between Override and Undo as often as you like, now or after browsing back to it later',
    why: 'the comma sets off when; “now or after browsing back to it later” is a pair of times',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase: 'any 100-year boundary, both leap and non-leap centuries)',
    why: 'the comma opens “both …”; “leap and non-leap centuries” is a pair',
  },
  {
    file: 'src/components/GuidePage.tsx',
    phrase: 'Mid-question, Reset Stats always generates a new date and returns to the dash state',
    why: 'the comma ends “Mid-question”; “generates a new date and returns to the dash state” is a pair of verbs',
  },
  {
    file: 'CHANGELOG-ARCHIVE.md',
    phrase: 'unchanged, keeping its ISO date and its lines verbatim',
    why: "the archive's own introduction, not a changelog line: “its ISO date and its lines” is a pair",
  },
  {
    file: 'CHANGELOG-ARCHIVE.md',
    phrase:
      'Input, Julian Chance, Leap Year Chance, and Jan/Feb Chance are now drawn as one connected strip of buttons in the settings menu, matching Date Format and the themes',
    why: 'the list at the front has its comma (“…, Leap Year Chance, and Jan/Feb Chance”); “Date Format and the themes” is a pair after “matching”',
  },
  {
    file: 'CHANGELOG-ARCHIVE.md',
    phrase: 'The five themes are now buttons in two labelled rows, Dark and Light',
    why: "the comma opens the two rows' names; “Dark and Light” is a pair",
  },
]

const found = units.flatMap((unit) =>
  missesIn(unit.text).map((miss) => ({ ...unit, ...miss, where: `${unit.file}:${unit.line}` })),
)
const excusedBy = (miss) =>
  NOT_A_LIST.find((entry) => entry.file === miss.file && entry.phrase === miss.phrase)
const violations = found.filter((miss) => !excusedBy(miss))

describe('Oxford comma guard — a list of three or more takes a comma before its last and / or', () => {
  it('reads the real text (the changelog, its archive, the guide, the popups, and index.html)', () => {
    const files = new Set(units.map((u) => u.file))
    for (const must of [
      'src/changelog.ts',
      'src/components/GuidePage.tsx',
      'src/components/SettingsPanel.tsx',
      'src/main.tsx',
      'CHANGELOG-ARCHIVE.md',
      'index.html',
    ])
      expect(files, must).toContain(must)
    // The guide alone is several hundred paragraphs; a reader that went blind would not reach this.
    expect(units.filter((u) => u.file === 'src/components/GuidePage.tsx').length).toBeGreaterThan(
      400,
    )
    expect(units.filter((u) => u.file === 'src/changelog.ts').length).toBeGreaterThan(40)
  })

  it('knows a missing comma when it sees one, through tags, line breaks, and brackets', () => {
    const phrases = (text) => missesIn(text).map((m) => m.phrase)
    expect(phrases('Three choices: Off, Stats Only and Full.')).toEqual([
      'Off, Stats Only and Full',
    ])
    expect(phrases('Press Esc, Back or tap outside.')).toHaveLength(1)
    expect(phrases('Display, Dates, Stats (Amnesic included) and Default Mode.')).toHaveLength(1)
    expect(phrases('It shows no stats, no bests nor any history.')).toHaveLength(1)
    // …and the comma it asks for is the whole fix.
    expect(phrases('Three choices: Off, Stats Only, and Full.')).toEqual([])
    expect(phrases('Press Esc, Back, or tap outside.')).toEqual([])
    // The four let-throughs.
    expect(phrases('Tap Save, and the stats and bests are kept.')).toEqual([])
    expect(phrases('Reveal, Override and Undo, Show Codes, and the history all follow.')).toEqual(
      [],
    )
    expect(phrases('The buttons (Save, Reset) and the links stay.')).toEqual([])
    expect(phrases('In Flash, a Reset Stats always makes a new date and returns.')).toEqual([])
    expect(phrases('In Classic, Flash and Deduction the history stays.')).toHaveLength(1)
    // A pair is a pair.
    expect(phrases('Classic and Flash keep theirs.')).toEqual([])
  })

  it('joins a list the source splits across elements, {" "} joins, and line breaks', () => {
    const read = readSource(
      join(root, 'src/fixture.tsx'),
      `export const Fixture = ({ full }) => (
        <div>
          <p>
            On Lookup the arrows, <Kbd>Backspace</Kbd> and <Kbd>Delete</Kbd> leave
            it alone.
          </p>
          <p>
            In one block: <b>Save Defaults</b>, <b>Reset Settings</b> and{' '}
            <b>Full Reset</b>.
          </p>
          <button aria-label={\`Storage is almost full, nearly full or \${full}\`}>⚙</button>
        </div>
      )`,
    )
    const misses = read.flatMap((unit) => missesIn(unit.text).map((m) => m.phrase))
    expect(misses).toEqual([
      'On Lookup the arrows, Backspace and Delete leave it alone',
      'Save Defaults, Reset Settings and Full Reset',
      'Storage is almost full, nearly full or ▢',
    ])
  })

  it('finds no list of three or more without its comma', () => {
    expect(violations.map((v) => `${v.where} — “${v.phrase}”`)).toEqual([])
  })

  it('carries no stale or unexplained allow-list entry', () => {
    const stale = NOT_A_LIST.filter(
      (entry) => !found.some((miss) => miss.file === entry.file && miss.phrase === entry.phrase),
    )
    expect(stale.map((entry) => `${entry.file} — “${entry.phrase}”`)).toEqual([])
    for (const entry of NOT_A_LIST) expect(entry.why.length, entry.phrase).toBeGreaterThan(20)
  })

  it('builds a run-time list of modes with the comma too (lib/modes modeNames)', () => {
    expect(modeNames('classic', 'deduction', 'flash')).toBe('Classic, Deduction, and Flash')
    expect(modeNames('classic', 'flash', 'aox', 'blitz')).toBe('Classic, Flash, MoX, and Blitz')
    expect(modeNames('aox', 'blitz')).toBe('MoX and Blitz')
  })
})
