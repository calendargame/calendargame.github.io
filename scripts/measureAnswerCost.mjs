// scripts/measureAnswerCost.mjs — WHAT ONE ANSWER COSTS, WITH A LOT OF SOLVE TIMES, THROUGH THE REAL PATH.
//
//   node scripts/measureAnswerCost.mjs [times=100000] [answers=200]
//
// Every solve time is kept (store/progress), so a casual mode's pool grows without bound, and the work an
// answer does must not grow with it. This measures what the app does for one answer on top of a Classic
// silo already holding `times` solve times, and what a window does to RECEIVE another window's answer:
//   • the engine's reducer and its invariant walk, and the stat strip's Last / Mean / Median;
//   • the SAVE as the app makes it: the progress store's state set, persisted through the windows-in-sync
//     door (store/progressDoor: the counts book's merge and landing, the records, the sync keys) and
//     sealed into chunks (store/progressStorage) - the store and the door themselves, not a codec
//     called on its own (Round 26's review lane: a measurement that skipped the door showed 1 ms while
//     the real path cost 93-107);
//   • a NOTICE: another window's answer in the same mode, and in another mode, heard and merged here.
// It runs in jsdom, through Vitest's own runner (tests/measure/answerCost.measure.jsx - a name the test
// suite does not collect), because the stores read `window.localStorage` and the app's module graph. A
// development build's path, as the test suite's: the numbers are this machine's, and nothing asserts
// them. Design-q1-q2.md section 13 gives the targets: 3.5 ms an answer, 4 ms a notice, at 100,000 times.
import { startVitest } from 'vitest/node'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const [times = '100000', answers = '200'] = process.argv.slice(2)
const out = join(tmpdir(), `measureAnswerCost-${process.pid}.json`)
process.env.MEASURE_TIMES = times
process.env.MEASURE_ANSWERS = answers
process.env.MEASURE_OUT = out
const file = 'tests/measure/answerCost.measure.jsx'
const vitest = await startVitest('test', [file], {
  include: [file],
  watch: false,
  reporters: ['dot'],
  testTimeout: 1_800_000,
})
await vitest?.close()
const r = JSON.parse(readFileSync(out, 'utf8'))
rmSync(out)
console.log(
  `\n${r.answers} answers on top of ${Number(r.times).toLocaleString('en-US')} solve times (median ms)`,
)
for (const [k, v] of Object.entries(r.median)) console.log(`  ${k.padEnd(28)} ${v.toFixed(3)}`)
