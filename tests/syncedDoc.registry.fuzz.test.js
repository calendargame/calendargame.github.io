// syncedDoc.registry.fuzz — THE GATE FOR THE PRESET LIST'S MEMBERSHIP (design-q1-q2.md v5, 8.1): the REAL
// registry door (store/presets' registrySpec through store/syncedDoc) plays every new window in the world of
// design-q2-model's model7.mjs, driven as fuzz7.mjs drives it, judged by the model's own judge (judge7).
//
// THE WORLD (tests/helpers/registryWorld): new windows that make and delete presets, open, and close; OLDER
// pages that behave as v2.26.0-v2.29.1 do - a page holds the list it loaded; its New Preset takes
// max(its own next id, the STORED next id) and writes its own list plus the new preset; its delete writes
// its own list without one; it saves its list whole, and reloads.
// THE JUDGE (judge7, the model's): knows nothing of stamps or records - only what was created and deleted,
// by whom, and when. Every preset created and never deleted is listed at the end (G-reg1: a creation is
// never lost); a preset deleted is not listed (G-reg2) - except R16-registry, an OLDER page's delete whose
// copy lists no preset a NEW window made after it (nothing proves that page had loaded it); and every open
// new window lists what the device lists.
// (v4's rule, "a higher next id means that side knew it", lost presets in every one of the model's 3,000
// runs - the review lane's (a); tests/syncedDoc.registry pins that sequence.)
//
// ★ SCALE. CI runs 20 seeds per configuration (200 steps each, about half a minute: every step is the real
// door's merge in up to four windows); FUZZ_SCALE multiplies it - FUZZ_SCALE=15 runs 300 a configuration.
// WHY=1 prints a bad run's log.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { world, DEFAULTS } from './helpers/registryWorld.js'
import { forgetStorageHealth } from '../src/store/storageHealth.js'
import { appendFileSync } from 'node:fs'

const SCALE = Math.max(1, Number(process.env.FUZZ_SCALE ?? 1))
const SEEDS = Math.round(Number(process.env.REG_SEEDS ?? 20) * SCALE)
const STEPS = Number(process.env.REG_STEPS ?? 200)

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function run(seed, olds) {
  const r = rng(seed)
  const W = world()
  const pick = (a) => a[Math.floor(r() * a.length)]
  // (oracle) every preset made and deleted: by whom, and - for an older page's delete - its list after it
  const created = new Map([[1, { kind: 'boot' }]])
  const deleted = new Map()
  const log = []
  let n = 0
  const news = [W.open('n' + n++), W.open('n' + n++)]
  W.deliver()
  // ── older pages, as v2.26.0-v2.29.1 behave ──
  const stored = () => {
    const raw = W.storage.getItem('cg-presets-v1')
    return raw ? JSON.parse(raw).state : { ...DEFAULTS }
  }
  const load = (o) => {
    const s = stored()
    o.presets = s.presets.map((p) => ({ ...p }))
    o.next = s.nextId
  }
  const save = (o) =>
    W.olderSave({
      presets: o.presets,
      activeId: o.presets[0].id,
      nextId: o.next,
      openInPreset: 'last',
    })
  const pages = Array.from({ length: olds }, () => {
    const o = {}
    load(o)
    return o
  })
  for (let i = 0; i < STEPS; i++) {
    const live = news.filter((w) => !w.closed)
    const x = r()
    if (x < 0.2 && live.length) {
      const w0 = pick(live)
      const id = w0.create('n')
      created.set(id, { kind: 'N' })
      log.push(`${w0.name}+${id}`)
    } else if (x < 0.3 && live.length) {
      const w = pick(live)
      const ids = w.ids()
      if (ids.length > 1) {
        const id = pick(ids)
        w.remove(id)
        deleted.set(id, { kind: 'N' })
        log.push(`${w.name}-${id}`)
      }
    } else if (x < 0.45 && pages.length) {
      const o = pick(pages)
      const id = Math.max(o.next, stored().nextId, 2)
      o.presets = [...o.presets, { id, name: 'o' + id, amnesic: false }]
      o.next = id + 1
      created.set(id, { kind: 'O' })
      save(o)
      log.push(`old${pages.indexOf(o)}+${id}`)
    } else if (x < 0.55 && pages.length) {
      const o = pick(pages)
      if (o.presets.length > 1) {
        const id = pick(o.presets).id
        o.presets = o.presets.filter((p) => p.id !== id)
        deleted.set(id, { kind: 'O', ids: o.presets.map((p) => p.id) })
        save(o)
        log.push(`old${pages.indexOf(o)}-${id}[${o.presets.map((p) => p.id)}]`)
      }
    } else if (x < 0.65 && pages.length) {
      const o = pick(pages)
      load(o)
      log.push(`old${pages.indexOf(o)}:load[${o.presets.map((p) => p.id)}]`)
    } else if (x < 0.7 && pages.length) {
      const o = pick(pages)
      save(o)
      log.push(`old${pages.indexOf(o)}:save[${o.presets.map((p) => p.id)}]`)
    } else if (x < 0.78) {
      if (live.length > 1) W.close(pick(live))
    } else if (x < 0.86) {
      if (live.length < 4) news.push(W.open('n' + n++))
    }
    W.deliver()
  }
  for (let i = 0; i < 3; i++) W.deliver()
  // ── judge7 ──
  const j = { lost: 0, resurrected: 0, olderDeleteUnproven: 0, diverged: 0 }
  const listed = new Set(stored().presets.map((p) => p.id))
  for (const [id] of created) {
    if (deleted.has(id)) {
      if (!listed.has(id)) continue
      const d = deleted.get(id)
      const proof = d.kind === 'O' && d.ids.some((q) => q > id && created.get(q)?.kind === 'N')
      if (d.kind === 'O' && !proof) j.olderDeleteUnproven++
      else {
        j.resurrected++
        if (process.env.WHY)
          console.log(
            'RES',
            id,
            JSON.stringify(d),
            log.join(' '),
            W.storage.getItem('cg-sync-v1|cg-presets-v1'),
          )
      }
    } else if (!listed.has(id)) j.lost++
  }
  const sorted = (ids) => [...ids].sort((a, b) => a - b).join()
  for (const w of news) if (!w.closed && sorted(w.ids()) !== sorted(listed)) j.diverged++
  j.bad = j.lost + j.resurrected + j.diverged
  j.created = created.size
  j.deleted = deleted.size
  return j
}

const totals = {}
describe('the preset list’s membership in model7’s world (the real door)', () => {
  afterEach(() => {
    vi.useRealTimers()
    forgetStorageHealth()
  })
  for (const olds of [1, 2])
    it(`${olds} older page${olds > 1 ? 's' : ''}: 0 bad runs in ${SEEDS}`, () => {
      vi.useFakeTimers()
      const bad = []
      for (let seed = Number(process.env.REG_FROM ?? 1); seed <= SEEDS; seed++) {
        const t0 = performance.now()
        const j = run(seed, olds)
        if (process.env.REG_LOG)
          appendFileSync(
            process.env.REG_LOG,
            `SEED ${olds} ${seed} ${Math.round(performance.now() - t0)}` + String.fromCharCode(10),
          )
        if (j.bad) bad.push(seed)
        if (j.bad && process.env.WHY) console.log('BAD', seed, JSON.stringify(j))
        for (const [k, v] of Object.entries(j)) totals[k] = (totals[k] ?? 0) + v
        forgetStorageHealth()
      }
      expect(bad, `first bad seeds: ${bad.slice(0, 3).join(', ')}`).toEqual([])
    }, 3_600_000)

  it('reach: older deletes, proven and unproven, and new-window deletes all happened', () => {
    expect(totals.deleted).toBeGreaterThan(0)
    expect(totals.olderDeleteUnproven).toBeGreaterThan(0) // (R16-registry met, and named)
    expect(totals.created).toBeGreaterThan(SEEDS * 2)
  })
})
