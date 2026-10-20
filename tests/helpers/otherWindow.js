// ANOTHER WINDOW OF THE APP, in the same test: a second windows-in-sync door (store/syncedDoc's
// createDoor) over the same localStorage, with the docs' own rules (each store's exported spec), so a
// change "made in another window" is written exactly as a new build writes it - envelope, sync key and
// all. The storage events a browser would send THIS window are kept and handed to this window's door
// by deliver(), as src/store/windowSync does with the real ones.
// An OLDER build's save is olderSave(): the doc's whole state, no envelope, no sync key.
// That window's SAVED PROGRESS is progress(): its own progress store (the five modes' stats and the four
// Best maps) persisted through its door's progress binding (store/progressDoor) - an answer is a mode's
// stats one answer on, a round's result an op on its record, exactly as this build's screens make them;
// its play anchored in the Amnesic window the shared settings and session name (store/amnesicWindow), as
// this window's is.
import { act } from '@testing-library/react'
import { vi } from 'vitest'
import { createDoor, door } from '../../src/store/syncedDoc.js'
import { presetDocSpec, usePresets, presetKey } from '../../src/store/presets.js'
import { makeProgressStorage } from '../../src/store/progressDoor.js'
import { makeProgressDefaults, migrateProgress } from '../../src/store/progress.js'
import { mainKeyOf } from '../../src/store/progressStorage.js'
import { amnesicWindowOf } from '../../src/store/amnesicWindow.js'
import { roundOp } from '../../src/store/bestRecords.js'

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
  let progress = null
  const progressOf = () => {
    if (progress) return progress
    const PERSISTED = ['stats', 'blitzBest', 'suddenBest', 'suddenAmBest', 'aoxBest']
    let state = makeProgressDefaults()
    const storage = makeProgressStorage(other.progressKit, {
      presetId: () => usePresets.getState().activeId,
      key: () => mainKeyOf(usePresets.getState().activeId),
      keyOf: mainKeyOf,
      win: amnesicWindowOf,
      version: 5,
      migrate: migrateProgress,
      defaults: makeProgressDefaults,
      gate: () => true,
      rebase() {},
    })
    // (zustand's persist, in miniature: every change of the store is offered to the storage)
    const save = () =>
      storage.setItem('progress', {
        state: Object.fromEntries(PERSISTED.map((k) => [k, state[k]])),
        version: 5,
      })
    storage.attach({
      getState: () => state,
      setState(patch) {
        state = { ...state, ...patch }
        save()
      },
    })
    const loaded = storage.getItem('progress')
    if (loaded) state = { ...state, ...loaded.state }
    progress = {
      /** What that window's progress store holds. */
      state: () => state,
      /** One more answer in mode `key`: right (with its solve time, or untimed) or wrong. */
      answer(key, right, time = null) {
        const s = state.stats[key]
        const streak = right ? s.streak + 1 : 0
        const next = {
          ...s,
          played: s.played + 1,
          good: s.good + (right ? 1 : 0),
          streak,
          best: Math.max(s.best, streak),
          times: right && time !== null ? [...s.times, time] : s.times,
        }
        state = { ...state, stats: { ...state.stats, [key]: next } }
        save()
      },
      /** A round's result on its record, as this build's screens file it (`filedBefore`: an Override). */
      round(map, setup, id, values, filedBefore = false) {
        storage.round(map, setup, roundOp(map, id, values, filedBefore))
      },
      /** Full Reset. */
      fullReset: () => storage.fullReset(),
    }
    return progress
  }
  return {
    /** That window's saved progress (above). */
    progress: progressOf,
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
