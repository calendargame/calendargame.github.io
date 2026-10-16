// ANOTHER WINDOW OF THE APP, in the same test: a second windows-in-sync door (store/syncedDoc's
// createDoor) over the same localStorage, with the docs' own rules (each store's exported spec), so a
// change "made in another window" is written exactly as a new build writes it - envelope, sync key and
// all. The storage events a browser would send THIS window are kept and handed to this window's door
// by deliver(), as src/store/windowSync does with the real ones.
// An OLDER build's save is olderSave(): the doc's whole state, no envelope, no sync key.
import { act } from '@testing-library/react'
import { vi } from 'vitest'
import { createDoor, door } from '../../src/store/syncedDoc.js'
import { presetDocSpec, usePresets, presetKey } from '../../src/store/presets.js'

export function otherWindow() {
  const pending = []
  const area = {
    get length() {
      return localStorage.length
    },
    key: (i) => localStorage.key(i),
    getItem: (k) => localStorage.getItem(k),
    setItem(k, v) {
      const old = localStorage.getItem(k)
      localStorage.setItem(k, v)
      pending.push([k, old, String(v)])
    },
    removeItem(k) {
      const old = localStorage.getItem(k)
      localStorage.removeItem(k)
      pending.push([k, old, null])
    },
  }
  const other = createDoor({ storage: () => area, tag: 'other', later: (fn) => fn() })
  const docs = new Map()
  const docOf = (spec) => {
    if (!docs.has(spec)) docs.set(spec, other.countsStorage(presetDocSpec(spec)))
    return docs.get(spec)
  }
  return {
    /** That window, on this window's preset, saves `patch` over the doc as it reads it. */
    save(spec, patch) {
      const doc = docOf(spec)
      const now = doc.getItem(spec.base)
      doc.setItem(spec.base, {
        state: { ...(now?.state ?? {}), ...patch },
        version: spec.version,
      })
    },
    /** An OLDER build's save of the doc: what it read, changed by `edit`, with no envelope. */
    olderSave(key, edit) {
      const text = localStorage.getItem(key)
      const state = text === null ? {} : (JSON.parse(text).state ?? {})
      area.setItem(
        key,
        JSON.stringify({ state: edit(state), version: JSON.parse(text ?? '{}').version ?? 1 }),
      )
    },
    /** A key written or removed as that window would. */
    write: (k, v) => (v === null ? area.removeItem(k) : area.setItem(k, v)),
    /** The storage events this window has been sent since the last delivery, handled. */
    deliver() {
      act(() => {
        for (const [k, o, n] of pending.splice(0)) door.notice(k, o, n)
        vi.runOnlyPendingTimers()
      })
    },
    /** This window's active preset's key for a per-preset store's base key. */
    keyOf: (base) => presetKey(base, usePresets.getState().activeId),
  }
}
