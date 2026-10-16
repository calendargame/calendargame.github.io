// scripts/measureAnswerCost.mjs — WHAT ONE ANSWER COSTS, WITH A LOT OF SOLVE TIMES.
//
//   node scripts/measureAnswerCost.mjs [times=100000] [answers=300] [--frozen]
//
// Every solve time is kept (store/progress), so a casual mode's pool grows without bound, and the
// work an answer does must not grow with it. This drives the app's own code — the engine's reducer,
// its invariant walk, the stat strip's Last / Mean / Median, and the progress save through
// store/progressStorage onto an in-memory storage area — for `answers` correct answers on top of a
// Classic silo already holding `times` solve times, and prints the median cost of each part per
// answer, in milliseconds. A production build's path by default: nothing is frozen. `--frozen` is a
// development build's and the test suite's instead — every engine state frozen as it is made, as
// engine/useGameEngine does there (engine/freeze), which is what the fuzz and the DOM tests pay.
//
// The modules are loaded through Vite's own SSR loader (TypeScript, and the `.js` specifiers that
// name `.ts` files, resolved exactly as the build resolves them), with no config file: no plugin of
// the app's build is needed to run engine and store code.
//
// It is a MEASURING tool, not a test: the numbers are this machine's, and nothing asserts them.
// Round 26 used it for Q1's before/after (design-q1-q2.md, section 13).
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2).filter((a) => a !== '--frozen')
const FROZEN = process.argv.includes('--frozen')
const TIMES = Number(args[0] ?? 100_000)
const ANSWERS = Number(args[1] ?? 300)

// localStorage's surface, over a Map: the progress save writes here exactly as it writes a device.
class MemoryStorage {
  #m = new Map()
  get length() {
    return this.#m.size
  }
  key(i) {
    return [...this.#m.keys()][i] ?? null
  }
  getItem(k) {
    return this.#m.has(k) ? this.#m.get(k) : null
  }
  setItem(k, v) {
    this.#m.set(k, String(v))
  }
  removeItem(k) {
    this.#m.delete(k)
  }
  clear() {
    this.#m.clear()
  }
}

const server = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
})
try {
  const load = (p) => server.ssrLoadModule(p)
  const { gameReducer, initEngine, correctIndexOf } = await load('/src/engine/gameReducer.ts')
  const { checkGameInvariants } = await load('/src/engine/invariants.ts')
  const { calcLast, calcAvg, calcMed, solveTimeFromMs } = await load('/src/engine/stats.ts')
  const { createProgressCodec } = await load('/src/store/progressStorage.ts')
  const { deepFreeze } = await load('/src/engine/freeze.ts')
  const made = FROZEN ? deepFreeze : (s) => s

  // A seeded generator, so two runs measure the same pool.
  let seed = 0x9e3779b9
  const rand = () => {
    seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0
    return seed / 2 ** 32
  }
  const date = () => ({ y: 1600 + Math.floor(rand() * 400), m: 1 + Math.floor(rand() * 12), d: 1 })
  const times = Array.from({ length: TIMES }, () => solveTimeFromMs(500 + rand() * 20_000))
  const blank = () => ({ played: 0, good: 0, streak: 0, best: 0, times: [] })
  let state = made(
    initEngine(date(), {
      played: TIMES,
      good: TIMES,
      streak: 3,
      best: 40,
      times,
    }),
  )
  const area = new MemoryStorage()
  const copy = { area, presetId: 1 }
  const codec = createProgressCodec()
  const value = (stats) => ({
    state: {
      stats: {
        classic: stats,
        flash: blank(),
        dedDay: blank(),
        dedMonth: blank(),
        dedYear: blank(),
      },
      blitzBest: {},
      suddenBest: {},
      suddenAmBest: {},
      aoxBest: {},
    },
    version: 5,
  })
  codec.save(copy, value(state.stats)) // the device as the page found it
  codec.load(copy)

  const parts = { reducer: [], invariants: [], strip: [], save: [] }
  let sink = 0
  for (let i = 0; i < ANSWERS; i++) {
    const idx = correctIndexOf(state.date, false)
    const t0 = performance.now()
    state = made(
      gameReducer(state, {
        type: 'ANSWER',
        idx,
        useJulian: false,
        elapsed: solveTimeFromMs(500 + rand() * 20_000),
        tracking: true,
        saveStats: true,
        nextDate: date(),
      }),
    )
    const t1 = performance.now()
    if (checkGameInvariants(state, false).length) throw new Error('invariant broken')
    const t2 = performance.now()
    sink += calcLast(state.stats.times) + calcAvg(state.stats.times) + calcMed(state.stats.times)
    const t3 = performance.now()
    codec.save(copy, value(state.stats))
    const t4 = performance.now()
    parts.reducer.push(t1 - t0)
    parts.invariants.push(t2 - t1)
    parts.strip.push(t3 - t2)
    parts.save.push(t4 - t3)
  }
  const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1]
  const row = Object.entries(parts).map(([k, a]) => [k, median(a)])
  const total = row.reduce((s, [, v]) => s + v, 0)
  const bytes = [...Array(area.length).keys()].reduce(
    (s, i) => s + area.key(i).length + area.getItem(area.key(i)).length,
    0,
  )
  console.log(
    `${ANSWERS} answers on top of ${TIMES.toLocaleString('en-US')} solve times, ${FROZEN ? 'frozen (a development build)' : 'production'} (median ms per answer)`,
  )
  for (const [k, v] of row) console.log(`  ${k.padEnd(11)} ${v.toFixed(3)}`)
  console.log(`  ${'total'.padEnd(11)} ${total.toFixed(3)}`)
  console.log(
    `  main key ${area.getItem('cg-progress-v1').length.toLocaleString('en-US')} chars; device ${bytes.toLocaleString('en-US')} chars (${sink > 0 ? 'ok' : '?'})`,
  )
} finally {
  await server.close()
}
