// tests/helpers/registryWorld.js — WINDOWS OF THE APP SHARING ONE PRESET LIST, in one process: one door
// (store/syncedDoc's createDoor) per window over one storage, each with a zustand store persisted through
// its door's counts adapter with the registry's own rules (store/presets' registrySpec - the very one the
// app's registry goes through), and the storage events a browser would send each other window delivered by
// hand (deliver). An OLDER build's save is its whole registry with no envelope (olderSave). A window can
// be closed: it hears nothing more and writes nothing more.
import { vi } from 'vitest'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createDoor } from '../../src/store/syncedDoc.js'
import { registrySpec } from '../../src/store/presets.js'

export const KEY = 'cg-presets-v1'
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
export const DEFAULTS = {
  presets: [{ id: 1, name: 'Preset 1', amnesic: false }],
  activeId: 1,
  nextId: 2,
  openInPreset: 'last',
}
export function world() {
  const storage = new MemoryStorage()
  const windows = []
  const pending = []
  storage.onChange = (who, key, old, now) => {
    if (globalThis.__regTrace) console.log('WRITE', who, key, now)
    for (const w of windows)
      if (w.name !== who) pending.push(() => !w.closed && w.door.notice(key, old, now))
  }
  // (windows that never stop answering each other's writes are a defect: a bounded number of rounds)
  const deliver = () => {
    for (let round = 0; pending.length || vi.getTimerCount(); round++) {
      if (round > 200)
        throw new Error('registryWorld: the windows never settle (a write-back loop)')
      if (round > 195 && process.env.WHY) globalThis.__regTrace = true
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
  // (a closed window hears nothing more and writes nothing more)
  const close = (w) => {
    w.closed = true
    windows.splice(windows.indexOf(w), 1)
  }
  return { storage, open, deliver, device, olderSave, close }
}
