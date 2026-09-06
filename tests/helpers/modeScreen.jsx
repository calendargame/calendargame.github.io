// THE GAME SCREEN, read as the user reads it — the live question, and the stats strip.
//
// WHY THIS FILE EXISTS, AND WHY IT IS NOT PART OF tests/helpers/settingsPanel.jsx. That file's own
// scope note refuses mode-screen accessors, and it is right to: it owns the ⚙ panel, and what a
// game screen shows is a different subject with a different lifetime. But a large part of the
// settings behaviour net is about a settings change REACHING the game screen — "the pick applies
// on close", "Save Stats withdraws the readouts", "Reset Settings did not remount the screen" — so
// the screen has to be readable somewhere shared.
//
// WHAT IT REPLACES. Two lanes of the net each grew their own copy of these three questions, and
// the pairs did not merely duplicate each other, they rested on DIFFERENT invariants — so lifting
// either one at random would have been a coin flip about which future markup change breaks the
// net. Each reconciliation below says which form won and why.
import { screen } from '@testing-library/react'
import { wday } from '../../src/lib/calendar.js'
import { DAY } from '../../src/lib/format.js'

// ── The live question ─────────────────────────────────────────────────────────────────────────

// EVERY DATE SHAPE THE FIVE FORMATS PRODUCE. The live question is stamped with the format that was
// in effect when it was GENERATED, so "which shape is on screen" is the observable that says
// whether a regeneration happened — deterministic where the date itself is random.
const DATE_SHAPES = [
  ['numeric YMD', /^-?\d+-\d+-\d+$/],
  ['numeric DMY', /^-?\d+\.\d+\.\d+$/],
  ['numeric MDY', /^-?\d+\/\d+\/\d+$/],
  ['written MDY', /^[A-Z][a-z]+ \d+, -?\d+$/],
  ['written DMY', /^\d+ [A-Z][a-z]+ -?\d+$/],
]

// THE REGIONS THAT ARE NOT THE GAME SCREEN, and excluding them is a correctness fix rather than an
// optimisation. The reader below insists on finding EXACTLY ONE date-shaped leaf and throws
// otherwise, which is the right strictness — a screen asking two questions at once is a real bug
// and should fail loudly rather than be read at random. But many cases run it with the ⚙ panel
// OPEN, and the panel renders a date of its own ('Last Updated: 4/27/1828 12:00'), while the
// changelog modal renders BARE numeric dates that match these shapes exactly. The stamp escapes
// only by its prefix and its time suffix — one markup change away from taking every group-10 case
// down at once for a reason unrelated to what any of them assert, and the changelog modal already
// would. So the question is asked of the game screen, by excluding the two regions the app itself
// marks out: the panel by its published id, its modals by the marker App resolves live.
const NOT_THE_GAME_SCREEN = '#settings-popover, [data-settings-modal]'

// THE LIVE QUESTION, as the one date the screen is asking about, with the format it was stamped
// with. Leaf elements only, and anything holding the Deduction placeholder ('__') is skipped —
// that screen is always mounted and shows a PARTIAL date.
//
// ⚠ RECONCILED FORM: shape-aware, and over ALL elements rather than over DIVs only. The two lanes
// split here — one scanned every element for all five shapes, the other scanned DIVs for the
// numeric-ymd shape alone. The shape is load-bearing (it is how a regeneration is observed at all),
// and the DIV restriction was an accident of the markup on the day it was written: it would go
// silently blind the moment a question moved into a span or a <p>. So the wider scan wins, and
// readDate() below is expressed on top of it rather than beside it.
export function liveQuestion() {
  const elsewhere = [...document.querySelectorAll(NOT_THE_GAME_SCREEN)]
  const hits = []
  for (const el of document.querySelectorAll('*')) {
    if (el.children.length !== 0) continue
    if (elsewhere.some((region) => region.contains(el))) continue
    const text = el.textContent.trim()
    if (text.includes('_')) continue
    const shape = DATE_SHAPES.find(([, re]) => re.test(text))
    if (shape) hits.push({ shape: shape[0], text })
  }
  if (hits.length !== 1)
    throw new Error(
      `liveQuestion(): expected exactly one live question date on the game screen, found ` +
        `${hits.length} (${hits.map((h) => h.text).join(', ')})`,
    )
  return hits[0]
}
export const questionShape = () => liveQuestion().shape
export const questionText = () => liveQuestion().text

// THE LIVE QUESTION AS A DATE, for the cases that need the day of the week rather than the string.
// Only meaningful under a numeric-ymd fixture, and it says so instead of mis-parsing: every caller
// pins randomFormat off + numeric-ymd, and a fixture that stopped doing so would otherwise return
// a plausible-looking wrong answer.
export function readDate() {
  const { shape, text } = liveQuestion()
  const parts = /^(-?\d+)-(\d+)-(\d+)$/.exec(text)
  if (!parts)
    throw new Error(
      `readDate(): the question is showing a ${shape} date (${text}) — this reader needs the ` +
        'fixture to pin randomFormat off and dateFormat numeric-ymd.',
    )
  return { y: Number(parts[1]), m: Number(parts[2]), d: Number(parts[3]) }
}

// The answer to that question, by the name on the button a user would press.
export const correctDayName = ({ y, m, d }) => DAY[wday(y, m, d)]

// ── The stats strip ───────────────────────────────────────────────────────────────────────────

// The six readouts, by the name each cell announces. Save Stats withdraws them all.
const STAT_LABELS = ['Score', 'Accuracy', 'Streak', 'Last', 'Mean', 'Median']

// A stat cell is a button holding a label span and a value span — the idiom tests/classic.dom
// established, and getAllByRole skips the display:none screens, so only the visible mode answers.
//
// ⚠ RECONCILED FORM: the label is matched EXACTLY, against the cell's own label span. The other
// lane matched a /^(Score|Accuracy|…)/ prefix against the whole button's text, which is one markup
// change from colliding with the ⚙ panel's own 'Last Updated:' stamp — safe today only because
// that stamp happens to be a span inside a plain div rather than inside a button. An exact match
// on the label span cannot collide with a longer string at all, so the hazard simply stops
// existing rather than being documented and lived with.
const statCellLabel = (btn) => {
  const spans = [...btn.querySelectorAll('span')]
  return STAT_LABELS.find((l) => spans.some((s) => s.textContent.trim() === l)) ?? null
}

// Which readouts the strip is showing, in the order it shows them.
export const statReadouts = () =>
  screen
    .getAllByRole('button')
    .map(statCellLabel)
    .filter((label) => label !== null)

// What one readout READS — the cell's value span, found by ITS OWN marker.
// ⚠ Reads the value through its OWN marker, [data-statval] — the auto-fit target StatPanel puts on
// the value span — and NOT "the cell's last span". A cell can carry a trailing screen-reader-only
// span (the "Off" that names a blanked group, C1 round 16), and last-span would read that instead of
// the value. The marker names the one element that IS the readout, so it cannot drift again.
export function statValue(label) {
  const cell = screen.getAllByRole('button').find((b) => statCellLabel(b) === label)
  if (!cell) throw new Error(`statValue(${label}): no such stat cell on screen`)
  return cell.querySelector('[data-statval]').textContent.trim()
}
