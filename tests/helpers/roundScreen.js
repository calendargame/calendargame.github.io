// tests/helpers/roundScreen.js — ONE SCREEN'S ROUNDS ON ONE BEST RECORD, filed as the round screens file
// them (modes/BlitzMode, modes/AoxMode, through store/screenPool's fileRoundResult): each round's own
// figures as an op on the record (store/bestRecords' roundOp) in the records' merge (store/syncRecords) -
// the first filing of a round is its end, every later one an Override of it, and `null` takes it back.
// No storage: the record lives in the book.
import { RecordsBook } from '../../src/store/syncRecords.js'
import { recordSpec, roundOp, fromRec } from '../../src/store/bestRecords.js'

/** A round id as the clock draws one (engine/roundId), in the order the rounds began. */
export const ROUND_ID = (i) => 1_800_000_000_000 * 1024 + i * 1024

export function roundScreen(map, hooks) {
  const book = new RecordsBook({
    spec: recordSpec(map),
    tag: 'w1',
    clock: { hi: 0, peek: () => ROUND_ID(1e6) },
    io: {
      view: () => ({
        docPresent: false,
        env: false,
        stTag: null,
        stBoot: false,
        stFresh: false,
        S: null,
        recs: {},
      }),
      deviceKey: () => null,
    },
    ...(hooks ? { hooks } : {}),
  })
  const filed = new Set()
  return {
    /** File round `id`'s figures (null: it holds nothing now). */
    file(id, values) {
      book.op('k', roundOp(map, id, values, filed.has(id)))
      filed.add(id)
    },
    /** The record as the app stores it (undefined: none). */
    record: () => fromRec(map, book.recs.k?.mem ?? null, false),
  }
}

/** Several set-ups' records of one map, each filed by its own screen: a Best map as the store holds it. */
export function roundMap(map) {
  const screens = new Map()
  return {
    file(key, id, values) {
      if (!screens.has(key)) screens.set(key, roundScreen(map))
      screens.get(key).file(id, values)
    },
    map() {
      const out = {}
      for (const [key, s] of screens) {
        const r = s.record()
        if (r) out[key] = r
      }
      return out
    },
  }
}
