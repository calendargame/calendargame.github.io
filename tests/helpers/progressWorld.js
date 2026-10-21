// tests/helpers/progressWorld.js — one device's storage, the pages that share it, and the OLDER
// builds among them, for store/progressStorage's tests.
//
// Every build on an origin shares its saved progress, so it is read and written by whatever builds
// are open: this build (which seals), the READER builds v2.28.0 and v2.29.x (which read and
// keep the layout and never start it), v2.27.3, and v2.26.0. This file is the stand-in for that: a
// Disk (the device), a view of it per page (store/storageHealth keys what it is holding by the
// Storage object, so each page gets its own), a small independent reader of the layout (the
// oracle), a page over any codec (`newPage` — this build's, or the reader builds' recorded one,
// tests/fixtures/olderBuilds/progressStorage-v2.29.0.ts), and models of the two builds before them.
//
// ★ THE OLDER-BUILD MODELS ARE CHECKED AGAINST THE REAL BUILDS, not against a reading of them.
// tests/fixtures/olderBuilds/*.json is what the real app at each tag stored, step by step, when
// driven over a seeded sealed save (sealedDrive.dom.test.jsx.txt beside them is the driver; it was
// run inside `git archive` copies of fcdcf56, ff506f8, 389ebd1, and a54b9f1).
// tests/progressStorage.olderBuilds.test.js replays those steps through the models and compares.

export const MAIN = 'cg-progress-v1'
export const CHUNK = 250
export const SILOS = ['classic', 'flash', 'dedDay', 'dedMonth', 'dedYear']

export const blank = () => ({ played: 0, good: 0, streak: 0, best: 0, times: [] })
export const blankState = () => ({
  stats: Object.fromEntries(SILOS.map((s) => [s, blank()])),
  blitzBest: {},
  suddenBest: {},
  suddenAmBest: {},
  aoxBest: {},
})
export const mainKey = (preset) => (preset === 1 ? MAIN : `${MAIN}~p${preset}`)
export const family = (preset) => (preset === 1 ? 'cg-times-v1:' : `cg-times-v1~p${preset}:`)

export class Crash extends Error {}

/** A storage area: a device's localStorage, or one page's sessionStorage. */
export class Disk {
  items = new Map()
  /** The most characters (keys + values) it will hold; a write past it is refused. */
  limit = Infinity
  /** Throw Crash at the n-th write or removal from now (1 = the very next one). 0 = never. */
  crashIn = 0
  /** Every write and removal, in order: [op, key, length, page]. */
  log = []
  /** A chunk key written a second time with different text — must stay empty. */
  rewritten = []
  /** Called with (page, key, text, the text it replaced or undefined) after a main key lands. */
  onMain = null

  /** Characters held (keys + values), kept as a running total. */
  used = 0
  keyList = null
  tick() {
    if (this.crashIn > 0 && --this.crashIn === 0) throw new Crash('the page died here')
  }
  set(key, value, page) {
    this.tick()
    const old = this.items.get(key)
    const grown = key.length + value.length - (old === undefined ? 0 : key.length + old.length)
    if (this.used + grown > this.limit) throw new DOMException('full', 'QuotaExceededError')
    if (key.startsWith('cg-times-v1') && old !== undefined && old !== value)
      this.rewritten.push(key)
    this.put(key, value)
    this.log.push(['set', key, value.length, page])
    if (key.startsWith(MAIN)) this.onMain?.(page, key, value, old)
  }
  remove(key, page) {
    this.tick()
    const old = this.items.get(key)
    if (old === undefined) return
    this.items.delete(key)
    this.used -= key.length + old.length
    this.keyList = null
    this.log.push(['remove', key, 0, page])
  }
  /** Place a value directly — a seed, with no page behind it, no limit and no log. */
  put(key, value) {
    const old = this.items.get(key)
    this.used += value.length - (old === undefined ? -key.length : old.length)
    if (old === undefined) this.keyList = null
    this.items.set(key, value)
  }
  /** This area as one page sees it — a Storage of its own identity over the shared items. */
  view(page = 'page') {
    const disk = this
    return {
      get length() {
        return disk.items.size
      },
      key: (i) => (disk.keyList ??= [...disk.items.keys()])[i] ?? null,
      getItem: (k) => (disk.items.has(k) ? disk.items.get(k) : null),
      setItem: (k, v) => disk.set(k, String(v), page),
      removeItem: (k) => disk.remove(k, page),
    }
  }
  chunkKeys(preset = 1) {
    return [...this.items.keys()].filter((k) => k.startsWith(family(preset))).sort()
  }
}

// cyrb53, as store/progressStorage spells a chunk's id — repeated here so a seeded layout is built
// without the code under test.
export function chunkId(text) {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** The sealed layout of one silo: how many chunks a sealing build keeps for `len` times. */
export const sealedChunks = (len) => (len > 1000 ? Math.floor(len / CHUNK) - 1 : 0)

/**
 * Write a state to a disk in the SEALED layout, by hand (no code under test): every silo past 1,000
 * times gets its chunks and a tail. Returns the main text.
 */
export function seedSealed(disk, state, { preset = 1, version = 5 } = {}) {
  const stats = {}
  for (const [name, silo] of Object.entries(state.stats)) {
    const S = sealedChunks(silo.times.length)
    if (S === 0) {
      stats[name] = silo
      continue
    }
    const ids = []
    for (let j = 0; j < S; j++) {
      const text = JSON.stringify(silo.times.slice(j * CHUNK, (j + 1) * CHUNK))
      ids.push(chunkId(text))
      disk.put(`${family(preset)}${name}:${j}.${ids[j]}`, text)
    }
    const n = S * CHUNK
    stats[name] = {
      ...silo,
      times: silo.times.slice(n),
      timesLost: (silo.timesLost ?? 0) + n,
      sealed: { n, ids },
    }
  }
  const text = JSON.stringify({ state: { ...state, stats }, version })
  disk.put(mainKey(preset), text)
  return text
}

/**
 * ★ THE ORACLE: what a main text MEANS, read with nothing but the layout's definition — the tail
 * after its chunks, the sealed count taken back off `timesLost`, and (for a save stamped before v5)
 * the old cap's trim recorded first. Returns { version, state } with every silo's times whole, or
 * null for no text. A chunk that is not on the disk stays counted in `timesLost`.
 */
export function meaning(disk, text, preset = 1) {
  if (text === null || text === undefined) return null
  const { state, version } = JSON.parse(text)
  const stats = {}
  for (const [name, stored] of Object.entries(state.stats)) {
    let silo = stored
    if (version < 5 && silo.times.length === 1000 && silo.good > 1000)
      silo = { ...silo, timesLost: silo.good - 1000 }
    if (!silo.sealed) {
      stats[name] = silo
      continue
    }
    const { sealed, timesLost, ...rest } = silo
    let times = []
    let found = 0
    sealed.ids.forEach((id, j) => {
      const chunk = disk.items.get(`${family(preset)}${name}:${j}.${id}`)
      if (chunk === undefined) return
      times = times.concat(JSON.parse(chunk))
      found += CHUNK
    })
    stats[name] = { ...rest, times: times.concat(silo.times) }
    if (timesLost - found > 0) stats[name].timesLost = timesLost - found
  }
  return { version, state: { ...state, stats } }
}

// ── A page of THIS build ──────────────────────────────────────────────────────────────────────

const timeOf = (rand) => Math.round((0.8 + rand() * 30) * 1e4) / 1e4
/** The changes a page makes to one silo, each a spread of what it holds — as the engine's are. */
export const play = {
  timed: (t) => (s) => ({
    ...s,
    played: s.played + 1,
    good: s.good + 1,
    streak: s.streak + 1,
    best: Math.max(s.best, s.streak + 1),
    times: [...s.times, t],
  }),
  untimed: (s) => ({
    ...s,
    played: s.played + 1,
    good: s.good + 1,
    streak: s.streak + 1,
    best: Math.max(s.best, s.streak + 1),
  }),
  wrong: (s) => ({ ...s, played: s.played + 1, streak: 0 }),
  // An Override that takes back the credit of the timed answer at `i` of the times the page holds.
  takeBack: (i) => (s) => ({
    ...s,
    good: s.good - 1,
    streak: Math.min(s.streak, s.good - 1),
    best: Math.min(s.best, s.good - 1),
    times: [...s.times.slice(0, i), ...s.times.slice(i + 1)],
  }),
}
/** A silo of `n` timed answers. */
export const siloOf = (n, rand = Math.random, extra = {}) => ({
  played: n,
  good: n,
  streak: Math.min(n, 3),
  best: Math.min(n, 40),
  times: Array.from({ length: n }, () => timeOf(rand)),
  ...extra,
})
export const mulberry = (seed) => () => {
  let t = (seed += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
export { timeOf }

/**
 * A page on one copy: zustand's persist in miniature (load replaces the state and re-saves a save
 * stamped with another version; every change saves the whole state), over the codec it is given —
 * this build's (store/progressStorage), or the reader builds' recorded one.
 */
export function newPage(createProgressCodec, disk, { preset = 1, name = 'N' } = {}) {
  const area = disk.view(name)
  const codec = createProgressCodec()
  const page = {
    name,
    area,
    // Which copy the page is on. A test may point it elsewhere (another preset, a session area) and
    // load — as a preset switch or an Amnesic toggle does to the one codec the app has.
    copy: { area, presetId: preset },
    state: blankState(),
    save() {
      codec.save(page.copy, { state: page.state, version: 5 })
    },
    load() {
      const saved = codec.load(page.copy)
      page.state = saved ? { ...blankState(), ...saved.state } : blankState()
      if (saved && saved.version !== 5) page.save()
      return saved
    },
    update(silo, change) {
      const next = change(page.state.stats[silo])
      page.state = { ...page.state, stats: { ...page.state.stats, [silo]: next } }
      page.save()
    },
    reset(silo) {
      page.update(silo, blank)
    },
    fullReset() {
      page.state = blankState()
      page.save()
    },
  }
  return page
}

// ── The older builds ──────────────────────────────────────────────────────────────────────────
//
// What both have in common, and all that matters here: a page holds the main key's `state` exactly
// as stored (it has never heard of `sealed`; to it the silo's times ARE the tail), every Stats it
// builds is a spread of the one it holds or a blank one, and every change saves the whole state
// under ITS version. They differ in two places:
//   v2.27.3 (version 5) — on a save stamped older than 5 it records the old cap's trim (1,000 times
//     beside more than 1,000 correct answers → timesLost = good − 1,000) and re-saves at once; a
//     save it refuses to fit is kept in memory rather than thrown.
//   v2.26.0 (version 4) — keeps only the newest 1,000 times of the silo being saved; re-saves at
//     once any save not stamped 4.
const OLDER = {
  'v2.27.3': {
    version: 5,
    onLoad: (state, version) =>
      version < 5
        ? {
            ...state,
            stats: Object.fromEntries(
              Object.entries(state.stats).map(([k, s]) => [
                k,
                s.times.length === 1000 && s.good > 1000 ? { ...s, timesLost: s.good - 1000 } : s,
              ]),
            ),
          }
        : state,
    onSet: (silo) => silo,
  },
  'v2.26.0': {
    version: 4,
    onLoad: (state) => state,
    onSet: (silo) => ({
      ...silo,
      times: silo.times.length > 1000 ? silo.times.slice(-1000) : silo.times,
    }),
  },
}

/** A page of an older build, on one preset of a disk. */
export function olderPage(build, disk, { preset = 1, name = build } = {}) {
  const rules = OLDER[build]
  const area = disk.view(name)
  const page = {
    build,
    name,
    preset,
    state: blankState(),
    save() {
      const key = mainKey(page.preset)
      try {
        area.setItem(key, JSON.stringify({ state: page.state, version: rules.version }))
      } catch (e) {
        if (!(e instanceof DOMException)) throw e // a full device: the page keeps what it holds
      }
    },
    load() {
      const text = area.getItem(mainKey(page.preset))
      if (text === null) {
        page.state = blankState()
        return
      }
      const { state, version } = JSON.parse(text)
      page.state = { ...blankState(), ...rules.onLoad(state, version) }
      if (version !== rules.version) page.save() // zustand re-saves a migrated save at once
    },
    /** Change one silo — `change` gets the Stats the page holds and spreads it, as the build does. */
    update(silo, change) {
      const next = rules.onSet(change(page.state.stats[silo]))
      page.state = { ...page.state, stats: { ...page.state.stats, [silo]: next } }
      page.save()
    },
    reset(silo) {
      page.update(silo, blank)
    },
    fullReset() {
      page.state = blankState()
      page.save()
    },
    /** An older build's preset delete: the keys it knows, and no chunk. */
    deletePreset() {
      area.removeItem(mainKey(page.preset))
    },
  }
  return page
}
