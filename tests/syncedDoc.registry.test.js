// syncedDoc.registry — THE PRESET LIST THROUGH THE WINDOWS-IN-SYNC DOOR (design-q1-q2.md v4, 8.1-8.3).
// Two windows in one process: two doors (store/syncedDoc's createDoor) over one storage, each with a zustand
// store persisted through its door's counts adapter with the registry's own rules (store/presets'
// registrySpec - the very one the app's registry goes through), and the storage events a browser would send each
// other window delivered by hand. An OLDER build's save is its whole registry with no envelope.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createDoor } from '../src/store/syncedDoc.js'
import { registrySpec } from '../src/store/presets.js'
import { forgetStorageHealth } from '../src/store/storageHealth.js'
import { KEY_VALUE_MAX } from '../src/store/syncCounts.js'

const KEY = 'cg-presets-v1'
class MemoryStorage {
  items = new Map()
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
    const old = this.getItem(k)
    this.items.set(k, String(v))
    this.onChange?.(this.writer, k, old, String(v))
  }
  removeItem(k) {
    const old = this.getItem(k)
    this.items.delete(k)
    this.onChange?.(this.writer, k, old, null)
  }
}
const DEFAULTS = {
  presets: [{ id: 1, name: 'Preset 1', amnesic: false }],
  activeId: 1,
  nextId: 2,
  openInPreset: 'last',
}
function world() {
  const storage = new MemoryStorage()
  const windows = []
  const pending = []
  storage.onChange = (who, key, old, now) => {
    for (const w of windows) if (w.name !== who) pending.push(() => w.door.notice(key, old, now))
  }
  const deliver = () => {
    while (pending.length || vi.getTimerCount()) {
      while (pending.length) pending.shift()()
      vi.runAllTimers()
    }
  }
  const open = (name) => {
    const door = createDoor({ storage: () => storage, tag: name, later: (fn) => fn() })
    const adapter = door.countsStorage(registrySpec(null))
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
      removeItem: () => {},
    }
    const store = create(
      persist(() => ({ ...DEFAULTS }), {
        name: KEY,
        version: 1,
        storage: wrapped,
        partialize: ({ presets, activeId, nextId, openInPreset }) => ({
          presets,
          activeId,
          nextId,
          openInPreset,
        }),
      }),
    )
    adapter.attach(store)
    const w = {
      name,
      door,
      store,
      ids: () => store.getState().presets.map((p) => p.id),
      names: () => store.getState().presets.map((p) => p.name),
      create(label) {
        adapter.syncNow() // (store/presetControl: the registry is merged first, 8.5)
        const s = store.getState()
        const id = s.nextId
        store.setState({
          presets: [...s.presets, { id, name: label, amnesic: false }],
          nextId: id + 1,
        })
        return id
      },
      rename: (id, label) =>
        store.setState({
          presets: store.getState().presets.map((p) => (p.id === id ? { ...p, name: label } : p)),
        }),
      remove: (id) =>
        store.setState({ presets: store.getState().presets.filter((p) => p.id !== id) }),
      switchTo: (id) => store.setState({ activeId: id }),
    }
    windows.push(w)
    return w
  }
  const device = () => JSON.parse(storage.getItem(KEY)).state
  // An OLDER build's whole-registry save: what it loaded with its change, no envelope.
  const olderSave = (state) => {
    storage.writer = 'old'
    storage.setItem(KEY, JSON.stringify({ state, version: 1 }))
    storage.writer = null
  }
  return { storage, open, deliver, device, olderSave }
}

describe('the preset list in two windows (the real door)', () => {
  afterEach(() => {
    vi.useRealTimers()
    forgetStorageHealth()
  })

  it('a preset made, renamed, or deleted in one window is in the other at once; the other stays on its preset', () => {
    vi.useFakeTimers()
    const W = world()
    const a = W.open('a')
    const b = W.open('b')
    const p2 = a.create('Timed')
    W.deliver()
    expect(b.names()).toEqual(['Preset 1', 'Timed'])
    b.switchTo(p2)
    W.deliver()
    expect(a.store.getState().activeId).toBe(1) // another window's switch never moves this one
    expect(W.device().activeId).toBe(p2) // …but it is what a fresh open lands in
    a.rename(1, 'Mornings')
    W.deliver()
    expect(b.names()).toEqual(['Mornings', 'Timed'])
    const p3 = b.create('Guest')
    W.deliver()
    a.remove(p3)
    W.deliver()
    expect(b.ids()).toEqual([1, p2])
  })

  it('an OLDER tab’s stale whole list never drops a preset a new window made after it loaded', () => {
    vi.useFakeTimers()
    const W = world()
    const a = W.open('a')
    const b = W.open('b')
    a.create('Timed')
    W.deliver()
    const stale = W.device() // the older tab loads here…
    const p3 = a.create('Guest') // …a new window makes a preset after
    W.deliver()
    W.olderSave({
      ...stale,
      presets: stale.presets.map((p) => (p.id === 1 ? { ...p, name: 'Old name' } : p)),
    })
    W.deliver()
    expect(a.names()).toEqual(['Old name', 'Timed', 'Guest']) // its rename stands; Guest is kept
    expect(b.ids()).toEqual([1, 2, p3])
    expect(W.device().presets.map((p) => p.id)).toEqual([1, 2, p3])
    expect(W.device().nextId).toBe(p3 + 1)
  })

  it('a preset an OLDER tab deleted - one it knew of - leaves every new window', () => {
    vi.useFakeTimers()
    const W = world()
    const a = W.open('a')
    const b = W.open('b')
    a.create('Timed')
    const p3 = a.create('Guest')
    W.deliver()
    const loaded = W.device()
    W.olderSave({ ...loaded, presets: loaded.presets.filter((p) => p.id !== p3) })
    W.deliver()
    expect(a.ids()).toEqual([1, 2])
    expect(b.ids()).toEqual([1, 2])
  })

  // ★ A NAME TOO LONG TO COPY INTO THE SYNC KEY (store/syncCounts' KEY_VALUE_MAX - a preset name has no
  // length limit, and a second copy of a pasted book would halve what the device holds) is still put
  // back over an older tab's stale copy by every window that holds it; the key keeps its fingerprint.
  it('a long name renamed in a new window survives an OLDER tab’s stale list', () => {
    vi.useFakeTimers()
    const W = world()
    const a = W.open('a')
    const b = W.open('b')
    a.create('Timed')
    W.deliver()
    const stale = W.device() // the older tab loads here…
    const long = 'n'.repeat(KEY_VALUE_MAX + 1)
    a.rename(1, long) // …a new window renames after
    W.deliver()
    expect(W.storage.getItem('cg-sync-v1|' + KEY)).not.toContain(long.slice(0, 100))
    W.olderSave({
      ...stale,
      presets: stale.presets.map((p) => (p.id === 2 ? { ...p, name: 'Old tab’s' } : p)),
    })
    W.deliver()
    expect(a.names()).toEqual([long, 'Old tab’s'])
    expect(b.names()).toEqual([long, 'Old tab’s'])
    expect(W.device().presets.map((p) => p.name)).toEqual([long, 'Old tab’s'])
  })

  it('an OLDER tab’s own Amnesic flag on a preset is carried as it set it', () => {
    vi.useFakeTimers()
    const W = world()
    const a = W.open('a')
    a.create('Guest')
    W.deliver()
    const loaded = W.device()
    W.olderSave({
      ...loaded,
      presets: loaded.presets.map((p) => (p.id === 2 ? { ...p, amnesic: true } : p)),
    })
    W.deliver()
    a.rename(1, 'Mornings')
    W.deliver()
    expect(W.device().presets[1]).toEqual({ id: 2, name: 'Guest', amnesic: true })
  })
})
