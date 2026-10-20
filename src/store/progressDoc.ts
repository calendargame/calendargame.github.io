import type { Stats } from '../engine/gameReducer.js'
import type { StatsKey } from './progress.js'
import {
  blankSilo,
  encodeTag,
  decodeTag,
  encodeAnchor,
  decodeAnchor,
  type CountsShape,
  type Envelope,
  type Silo,
  type SyncKey,
  type Tag,
} from './syncCounts.js'
import {
  loadKeyOf,
  type RecordsDev,
  type RecordsKey,
  type RecDisk,
  type RecordsOut,
} from './syncRecords.js'
import {
  BEST_MAPS,
  toRec,
  fromRec,
  taggedRecord,
  passThroughTag,
  type BestMap,
} from './bestRecords.js'
// (a pass-through literal with ops, tagged so a reader applies them only to the record they were written
// with - store/bestRecords' toRec)
const passThrough = (r: Record<string, unknown>) => (r.ops ? { ...r, pw: passThroughTag(r) } : r)
import {
  packSync,
  unpackSync,
  encodeStamp,
  decodeStamp,
  cmpStamp,
  canonicalJson,
  type Stamp,
} from './syncStamp.js'
import { expandProgress } from './progressStorage.js'
import { timesHash } from '../engine/timesPool.js'
import { isRecord } from './json.js'

// store/progressDoc.ts — THE SAVED PROGRESS AS THE WINDOWS-IN-SYNC DOOR READS AND WRITES IT
// (design-q1-q2.md v4, 2.2 and 4): which slices it has, how its text maps onto them, and back.
//
// ONE DOC, TWO MERGES. The progress doc (`cg-progress-v1[~pN]`) holds the five modes' lifetime stats - SILOS,
// merged by store/syncCounts' CountsBook - and the four Best maps - RECORDS, merged per map by
// store/syncRecords' RecordsBook. One save writes it whole: the stats and the records together, with one
// envelope `sync`: `{ g, at: <the silos' entries>, rec: { <map>: { <set-up>: entry | 0 } } }`. Beside it, two
// keys no older build touches: the silos' sync key `cg-sync-v1|<doc>` and the RECORDS' KEY
// `cg-sync-v1|<doc>|rec` - `{ g, maps: { <map>: <that map's records key> } }`.
// ★ THE AMNESIC ANCHOR. A silo a new window writes inside an Amnesic window carries `a` (store/syncCounts'
// encodeAnchor): the mode's counts as they stood before the window's first play, which the forget at the
// next cold open puts back. An older build carries it with the silo, as it carries the tag.
// ★ THE WRITE MARK. Every silo a new window writes carries `wl`, that save's stamp. An older build carries
// a silo's unknown fields through every change but a reset (tests/syncedDoc.olderBuilds, F-A), so the
// newest `wl` in a doc an older tab saved says WHICH LOAD its records come from - what the records' merge
// asks to tell a take-back from a stale copy (4.1). A doc with none is the bytes of before the first new
// save, or one an older build rebuilt from defaults (its Full Reset: every silo blank).
// ★ TIMES ARE WHOLE HERE. A silo's older solve times live in chunk keys (store/progressStorage); every read
// here is through `expandProgress`, so a silo is always its full count form, and every write is sealed by
// the door's landing (the codec's `seal`) before it lands.

export const PROGRESS_SILOS: readonly StatsKey[] = [
  'classic',
  'flash',
  'dedDay',
  'dedMonth',
  'dedYear',
]
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** A mode's stats in the merge's count form. */
export const siloOfStats = (s: unknown): Silo => {
  if (!isRecord(s)) return blankSilo()
  return {
    pl: num(s.played),
    gd: num(s.good),
    sk: num(s.streak),
    bs: num(s.best),
    t: Array.isArray(s.times) ? (s.times as number[]) : [],
    tl: num(s.timesLost),
  }
}
/** A count form as the store holds a mode's stats (a legacy gap of zero is ABSENT, as the engine expects). */
export const statsOfSilo = (v: Silo): Stats => ({
  played: v.pl,
  good: v.gd,
  streak: v.sk,
  best: v.bs,
  times: v.t,
  ...(v.tl ? { timesLost: v.tl } : {}),
})

// A doc's text, parsed once per text: a window reads the same device text for its silos and every map's
// records, on every notice.
type Parsed = { env: Record<string, unknown> | null; version: number | null }
export function parseProgress(
  area: Storage,
  presetId: number,
  text: string | null,
  migrate: (state: Record<string, unknown>, version: number) => Record<string, unknown>,
  current: number,
): Parsed {
  const out = expandProgress(area, presetId, text)
  if (!isRecord(out)) return { env: null, version: null }
  const version = typeof out.version === 'number' ? out.version : null
  const state = isRecord(out.state) ? out.state : {}
  // (a doc an older build saved at an older version, in today's shape: the store's migration, as it is read)
  const migrated = version !== null && version !== current ? migrate(state, version) : state
  // (the envelope's stamps, read once: everything below holds them as stamps)
  let sync: unknown
  try {
    sync = isRecord(out.sync) ? unpackSync(JSON.stringify(out.sync)) : undefined
  } catch {
    sync = undefined
  }
  return { env: { ...out, state: migrated, sync }, version }
}

/** The newest write mark in a doc's silos (null: none), and whether its silos are all blank and untagged. */
function marksOf(env: Record<string, unknown> | null): {
  mark: Stamp | null
  bare: boolean
} {
  const stats = env && isRecord(env.state) && isRecord(env.state.stats) ? env.state.stats : {}
  let mark: Stamp | null = null
  let bare = true
  for (const x of PROGRESS_SILOS) {
    const s = stats[x]
    if (!isRecord(s)) continue
    const st = decodeStamp(s.wl)
    if (st && (!mark || cmpStamp(st, mark) > 0)) mark = st
    if (s.w !== undefined || s.wl !== undefined || num(s.played) > 0) bare = false
  }
  return { mark, bare }
}

/**
 * The silos' shape for store/syncCounts (the doc's silos, nothing else). `parsed` reads a text through the
 * entry's cache; `compose` writes the whole doc for a landing (the records and the write mark are the
 * landing's - the door's, store/syncedDoc).
 */
export function progressShape(o: {
  parsed: (text: string | null) => Parsed
  compose: (silos: Record<string, unknown>, sync: Envelope, full: Envelope) => unknown
}): CountsShape {
  return {
    silos: PROGRESS_SILOS,
    regs: [],
    parse(text) {
      const p = o.parsed(text)
      if (!p.env) return text === null ? null : { state: {}, sync: null }
      const stats = isRecord(p.env.state) && isRecord(p.env.state.stats) ? p.env.state.stats : {}
      const state: Record<string, unknown> = {}
      for (const x of PROGRESS_SILOS) state[x] = stats[x]
      // (an envelope that names no generation is a Stats Only window's, carrying records only: to the
      // silos it is no envelope at all - their bytes are an older page's, passed through)
      const sync = isRecord(p.env.sync) && typeof p.env.sync.g === 'string' ? p.env.sync : null
      return { state, sync: sync ? ({ g: sync.g, at: sync.at ?? {} } as Envelope) : null }
    },
    silo(disk) {
      const v = siloOfStats(disk)
      const a = isRecord(disk) ? decodeAnchor(disk.a) : null
      return { v: a ? { ...v, a } : v, tag: isRecord(disk) ? decodeTag(disk.w) : null }
    },
    // (a mode's stored stats compared without spelling out its solve times: their count and hash)
    diskFp(disk) {
      if (!isRecord(disk)) return JSON.stringify(disk) ?? 'undefined'
      const { times, ...rest } = disk
      return `${canonicalJson(rest)}#${Array.isArray(times) ? `${times.length}:${timesHash(times as number[])}` : JSON.stringify(times)}`
    },
    diskSilo(v: Silo, tag: Tag) {
      return { ...statsOfSilo(v), w: encodeTag(tag), ...(v.a ? { a: encodeAnchor(v.a) } : {}) }
    },
    write: (state, sync, full) => o.compose(state, sync, full),
    readKey(text) {
      if (text === null) return null
      try {
        return unpackSync(text) as SyncKey
      } catch {
        return null
      }
    },
    writeKey: (k) => packSync(k),
  }
}

// ── The records ──

/** The records' key as written: a generation, and one records key per map. */
export type ProgressRecKey = { g: string; maps: Partial<Record<BestMap, RecordsKey>> }
export const readRecKey = (text: string | null): ProgressRecKey | null => {
  if (text === null) return null
  try {
    const k = unpackSync(text)
    return isRecord(k) && typeof k.g === 'string' && isRecord(k.maps)
      ? (k as unknown as ProgressRecKey)
      : null
  } catch {
    return null
  }
}

/**
 * One map's records as one read of the device shows them (store/syncRecords' RecordsDev): the doc's records
 * read in field form - their counters scoped to the doc's load - with their envelope entries decoded (an
 * entry the envelope does not carry is the key's; `0`: none), and that map's records key, when it belongs
 * to the doc's generation.
 */
export function recordsDev(
  map: BestMap,
  env: Record<string, unknown> | null,
  key: ProgressRecKey | null,
  countsG: string | null,
): RecordsDev {
  const state = env && isRecord(env.state) ? env.state : {}
  const sync = env && isRecord(env.sync) ? env.sync : null
  const g = (sync && typeof sync.g === 'string' ? sync.g : null) ?? countsG
  const S = key && (g === null || key.g === g) ? (key.maps[map] ?? null) : null
  const { mark, bare } = marksOf(env)
  const stBoot = !!env && !mark && !(bare && !!(S || sync))
  const stFresh = !!env && !mark && bare && !!(S || sync)
  const load = loadKeyOf(mark, stBoot)
  const disk = isRecord(state[map]) ? (state[map] as Record<string, unknown>) : {}
  const envRec = sync && isRecord(sync.rec) && isRecord(sync.rec[map]) ? sync.rec[map] : {}
  const recs: Record<string, RecDisk> = {}
  for (const k of new Set([...Object.keys(disk), ...Object.keys(S?.at ?? {})])) {
    const e = (envRec as Record<string, unknown>)[k]
    const fromKey = S?.at?.[k] ? { st: S.at[k].st, fp: S.at[k].fp } : null
    recs[k] = {
      rec: toRec(map, disk[k], load, `${map}|${k}`),
      tagged: taggedRecord(disk[k]),
      env: !sync ? null : e === 0 ? null : isRecord(e) ? (e as RecDisk['env']) : fromKey,
    }
  }
  return { docPresent: !!env, env: !!sync, stTag: mark, stBoot, stFresh, S, recs }
}

/**
 * A landing's records, as the doc and its envelope spell them: per map, every record as it is to be stored
 * (a version tagged; a pass-through as an untagged literal with this window's rounds on it; one left
 * `keep` as the device has it, from `device`), and the envelope's entries - only where they differ from the
 * key the landing builds on (2.2's compact form), and `0` for a record the key has an entry for that is not
 * a version of this write.
 */
export function composeRecords(
  outs: Partial<Record<BestMap, RecordsOut | null>>,
  device: Record<string, unknown> | null,
  prevKey: ProgressRecKey | null,
): {
  maps: Record<BestMap, Record<string, unknown>>
  rec: Record<string, Record<string, unknown>>
} {
  const deviceState = device && isRecord(device.state) ? device.state : {}
  const maps = {} as Record<BestMap, Record<string, unknown>>
  const rec: Record<string, Record<string, unknown>> = {}
  for (const map of BEST_MAPS) {
    const out = outs[map]
    const devMap = isRecord(deviceState[map]) ? (deviceState[map] as Record<string, unknown>) : {}
    if (!out) {
      maps[map] = devMap
      continue
    }
    const m: Record<string, unknown> = {}
    const e: Record<string, unknown> = {}
    const prev = prevKey?.maps?.[map] ?? null
    for (const [k, d] of Object.entries(out.doc)) {
      if (d.keep) {
        if (devMap[k] !== undefined) m[k] = devMap[k]
      } else {
        const stored = fromRec(map, d.rec, d.tagged, true)
        if (stored)
          m[k] = d.tagged
            ? stored
            : passThrough({ ...stored, ...(d.ops?.length ? { nr: d.nr, ops: d.ops } : {}) })
      }
      const entry = out.env[k]
      const before = prev?.at?.[k]
      if (!entry) {
        if (before) e[k] = 0
      } else if (!before || before.fp !== entry.fp || cmpStamp(before.st, entry.st) !== 0)
        e[k] = JSON.parse(packSync(entry))
    }
    // (a record the book knows nothing of is the device's, as it is)
    for (const [k, v] of Object.entries(devMap)) if (!(k in out.doc)) m[k] = v
    maps[map] = m
    if (Object.keys(e).length) rec[map] = e
  }
  return { maps, rec }
}

/**
 * A doc's state with the door's own marks taken off - each mode's tag, write mark and anchor (`w`, `wl`,
 * `a`), each
 * record's tag (`w`) and the rounds a pass-through carries (`nr`, `ops`) - and nothing else touched: the
 * values a build of any age reads from it, with whatever this build cannot name left in place
 * (store/presetControl's isPresetFactory compares it with the factory values).
 */
export function progressStateUnmarked(state: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...state }
  if (isRecord(state.stats))
    out.stats = Object.fromEntries(
      Object.entries(state.stats).map(([x, s]) => {
        if (!isRecord(s)) return [x, s]
        const { w: _w, wl: _wl, a: _a, ...v } = s
        return [x, v]
      }),
    )
  for (const map of BEST_MAPS)
    if (isRecord(state[map]))
      out[map] = Object.fromEntries(
        Object.entries(state[map] as Record<string, unknown>).map(([k, r]) => {
          if (!isRecord(r)) return [k, r]
          const { w: _w, nr: _nr, ops: _ops, ...v } = r
          return [k, v]
        }),
      )
  return out
}

/** A stamp as a write mark is stored. */
export const markText = (st: Stamp): string => encodeStamp(st)
