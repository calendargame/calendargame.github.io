// syncedDoc.lookup — THE LOOKUP HISTORY THROUGH THE WINDOWS-IN-SYNC DOOR (design-q1-q2.md v4, 4.2).
//
// THE GATE: design-q2-model's model6 world (tests/helpers/syncModel/world6.js) with every new window played
// by the real store/syncList ListBook, judged by the model's oracle (fuzz6): exactly the entries looked up
// and not cleared since are on the device at the end, older pages' lookups, Clears, trims and reloads
// included. PARITY, run before this was written: the door beside the model's own new windows, 300 seeds a
// configuration - every count identical.
// THEN THE DOOR ITSELF, two windows in one process: two doors (store/syncedDoc's createDoor) over one
// storage, each with its own zustand store persisted through its door's list adapter, and the storage
// events a browser would send each other window delivered by hand.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { run, cfgs } from './helpers/syncModel/fuzz6.js'
import { createDoor, syncKeyOf } from '../src/store/syncedDoc.js'
import { normalizeLookupEntries } from '../src/store/lookupHistory.js'
import { forgetStorageHealth, useStorageHealth } from '../src/store/storageHealth.js'

const SCALE = Math.max(1, Number(process.env.FUZZ_SCALE ?? 1))
const SEEDS = Math.round(Number(process.env.FUZZ_SEEDS ?? 60) * SCALE)

describe("the list door in model6's world", () => {
  for (const [ci, [name, cfg]] of cfgs.entries())
    it(`[${ci}] ${name}: 0 bad in ${SEEDS}`, () => {
      const tot = {}
      let bad = 0
      for (let seed = 1; seed <= SEEDS; seed++) {
        const j = run(seed, cfg, 300)
        if (j.bad) bad++
        for (const [k, v] of Object.entries(j)) tot[k] = (tot[k] ?? 0) + v
      }
      expect(bad).toBe(0)
      // reach: Clears left waiting by a re-save, an older page's trims and Clears met
      expect(tot.clearKept).toBeGreaterThan(0)
      expect(tot.trimmed).toBeGreaterThan(0)
    }, 300_000)
})

// ── two windows over one storage ──
class MemoryStorage {
  items = new Map()
  refuse = new Set() // writers the device refuses
  writer = null
  get length() {
    return this.items.size
  }
  key(i) {
    return [...this.items.keys()][i] ?? null
  }
  getItem(k) {
    return this.items.has(k) ? this.items.get(k) : null
  }
  setItem(k, v) {
    if (this.refuse.has(this.writer)) throw new DOMException('full', 'QuotaExceededError')
    const old = this.getItem(k)
    this.items.set(k, String(v))
    this.onChange?.(this.writer, k, old)
  }
  removeItem(k) {
    const old = this.getItem(k)
    this.items.delete(k)
    this.onChange?.(this.writer, k, old)
  }
}
const KEY = 'cg-lookup-v1'
const entry = (id) => ({ id, y: 2000, m: 1, d: 1 })
function world() {
  const storage = new MemoryStorage()
  const windows = []
  const pending = []
  storage.onChange = (who, key, old) => {
    for (const w of windows) if (w.name !== who) pending.push(() => w.door.notice(key, old))
  }
  const deliver = () => {
    while (pending.length || vi.getTimerCount()) {
      while (pending.length) pending.shift()()
      vi.runAllTimers()
    }
  }
  const open = (name) => {
    const door = createDoor({ storage: () => storage, tag: name, later: (fn) => fn() })
    const adapter = door.listStorage({
      kind: 'lookup',
      key: KEY,
      version: 1,
      field: 'history',
      normalize: normalizeLookupEntries,
      trimAt: 100,
    })
    // every write a window's store makes is that window's
    const wrapped = {
      getItem: (n) => adapter.getItem(n),
      setItem: (n, v) => {
        storage.writer = name
        try {
          adapter.setItem(n, v)
        } finally {
          storage.writer = null
        }
      },
      removeItem: (n) => adapter.removeItem(n),
    }
    const store = create(
      persist(
        (set) => ({ history: [], setHistory: (f) => set((s) => ({ history: f(s.history) })) }),
        {
          name: KEY,
          version: 1,
          storage: wrapped,
          partialize: (s) => ({ history: s.history }),
        },
      ),
    )
    adapter.attach(store)
    const w = {
      name,
      door,
      store,
      ids: () => store.getState().history.map((e) => e.id),
      lookup: (id) =>
        store.getState().setHistory((h) => [entry(id), ...h.filter((e) => e.id !== id)]),
      clear: () => store.getState().setHistory(() => []),
    }
    windows.push(w)
    return w
  }
  // An OLDER build's whole-list save: no envelope, the key untouched.
  const olderSave = (ids) => {
    storage.writer = 'old'
    storage.setItem(KEY, JSON.stringify({ state: { history: ids.map(entry) }, version: 1 }))
    storage.writer = null
  }
  const device = () =>
    JSON.parse(storage.getItem(KEY) ?? '{"state":{"history":[]}}').state.history.map((e) => e.id)
  return { storage, open, deliver, olderSave, device }
}

describe('the Lookup history in two windows (the real door)', () => {
  afterEach(() => {
    vi.useRealTimers()
    forgetStorageHealth()
  })

  it('opening a window writes nothing; a lookup in one shows in the other at once', () => {
    vi.useFakeTimers()
    const W = world()
    const a = W.open('a')
    const b = W.open('b')
    expect(W.storage.length).toBe(0)
    a.lookup('x')
    W.deliver()
    expect(b.ids()).toEqual(['x'])
    b.lookup('y')
    W.deliver()
    expect(a.ids()).toEqual(['y', 'x'])
    expect(W.device()).toEqual(['y', 'x'])
  })

  it('a Clear in a new window stays cleared when an OLDER tab writes its whole stale list', () => {
    vi.useFakeTimers()
    const W = world()
    const a = W.open('a')
    const b = W.open('b')
    a.lookup('x')
    a.lookup('y')
    W.deliver()
    const stale = W.device()
    b.clear()
    W.deliver()
    W.olderSave(['z', ...stale]) // the older tab's next lookup, over the list it loaded
    W.deliver()
    expect(a.ids()).toEqual(['z'])
    expect(b.ids()).toEqual(['z'])
    expect(W.device()).toEqual(['z'])
  })

  it('a save the device refuses is kept as actions: the retry merges with what another window saved meanwhile', () => {
    vi.useFakeTimers()
    const W = world()
    const a = W.open('a')
    const b = W.open('b')
    W.storage.refuse.add('a')
    a.lookup('x')
    expect(useStorageHealth.getState().unsaved).toBe(true)
    b.lookup('y')
    W.deliver()
    W.storage.refuse.delete('a')
    b.lookup('z') // a write that fits: the held one is retried, through a's door
    W.deliver()
    expect(W.device().sort()).toEqual(['x', 'y', 'z'])
    expect(a.ids().sort()).toEqual(['x', 'y', 'z'])
    expect(useStorageHealth.getState().unsaved).toBe(false)
  })

  it('the sync key holds the tombstones; no older build reads it', () => {
    vi.useFakeTimers()
    const W = world()
    const a = W.open('a')
    a.lookup('x')
    a.clear()
    const key = JSON.parse(W.storage.getItem(syncKeyOf(KEY)))
    expect(key.tomb).toEqual(['x'])
  })
})
