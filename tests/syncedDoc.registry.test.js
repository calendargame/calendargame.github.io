// syncedDoc.registry — THE PRESET LIST THROUGH THE WINDOWS-IN-SYNC DOOR (design-q1-q2.md v4, 8.1-8.3).
// Two windows in one process: two doors (store/syncedDoc's createDoor) over one storage, each with a zustand
// store persisted through its door's counts adapter with the registry's own rules (store/presets'
// registrySpec - the very one the app's registry goes through), and the storage events a browser would send each
// other window delivered by hand. An OLDER build's save is its whole registry with no envelope.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { world, DEFAULTS, KEY } from './helpers/registryWorld.js'
import { forgetStorageHealth } from '../src/store/storageHealth.js'
import { KEY_VALUE_MAX } from '../src/store/syncCounts.js'

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

  // ★ AN OLDER TAB'S DELETE STICKS WHEN ITS COPY PROVES IT KNEW THE PRESET (design 8.1, v5): it lists a
  // preset a NEW window made after the deleted one, so the tab loaded the list after that preset existed.
  it('a preset an OLDER tab deleted - one its copy proves it knew of - leaves every new window', () => {
    vi.useFakeTimers()
    const W = world()
    const a = W.open('a')
    const b = W.open('b')
    const p2 = a.create('Timed')
    const p3 = a.create('Guest')
    W.deliver()
    const loaded = W.device()
    W.olderSave({ ...loaded, presets: loaded.presets.filter((p) => p.id !== p2) })
    W.deliver()
    expect(a.ids()).toEqual([1, p3])
    expect(b.ids()).toEqual([1, p3])
    // …and it stays deleted: a later older copy that still lists it (another tab's) does not bring it
    // back, now that a new window has made the delete its record.
    W.olderSave(loaded)
    W.deliver()
    expect(a.ids()).toEqual([1, p3])
  })

  // (the review lane's LOW) a deleted preset's name and older-build flag leave the doc and the key with it -
  // they were kept, and stamped afresh by every window that wrote the list again
  it('a deleted preset’s name and flag go with it; only its records of who made and who deleted it stay', () => {
    vi.useFakeTimers()
    const W = world()
    const a = W.open('a')
    const p2 = a.create('Gone')
    W.deliver()
    a.remove(p2)
    W.deliver()
    a.rename(1, 'Kept')
    W.deliver()
    const key = W.storage.getItem('cg-sync-v1|' + KEY)
    const doc = W.storage.getItem(KEY)
    for (const text of [key, doc]) {
      expect(text).not.toContain(`"name:${p2}"`)
      expect(text).not.toContain(`"amn:${p2}"`)
    }
    expect(key).toContain(`"gone:${p2}"`)
  })

  // R16-registry (design 2.8): a delete nothing proves - the newest preset, with none made after it by a
  // new window - may be a tab that never loaded it, so it does not stick.
  it('an OLDER tab’s delete of the newest preset, which nothing proves it knew, does not stick (R16-registry)', () => {
    vi.useFakeTimers()
    const W = world()
    const a = W.open('a')
    a.create('Timed')
    const p3 = a.create('Guest')
    W.deliver()
    const loaded = W.device()
    W.olderSave({ ...loaded, presets: loaded.presets.filter((p) => p.id !== p3) })
    W.deliver()
    expect(a.ids()).toEqual([1, 2, p3])
  })

  // ★ THE REVIEW LANE'S FINDING (a), design v5: an older build's New Preset takes max(its own next id,
  // the STORED one) and writes its own stale list plus the new preset - so its copy's next id is above a
  // preset a new window made after the tab loaded, which v4 read as "that side knew it: deleted there".
  it('an OLDER tab’s New Preset never makes a preset a new window made after it loaded vanish', () => {
    vi.useFakeTimers()
    const W = world()
    const a = W.open('a')
    const b = W.open('b')
    const stale = { ...DEFAULTS } // the older tab loads: [1] (nothing saved yet)
    const p2 = a.create('Timed') // a new window makes a preset after
    W.deliver()
    // the older tab's New Preset: id = max(its own next 2, the stored next 3) = 3, its list + it
    const next = W.device().nextId
    W.olderSave({
      ...stale,
      presets: [...stale.presets, { id: next, name: 'Old tab’s', amnesic: false }],
      nextId: next + 1,
    })
    W.deliver()
    expect(a.ids()).toEqual([1, p2, next])
    expect(b.ids()).toEqual([1, p2, next])
    expect(W.device().presets.map((p) => p.id)).toEqual([1, p2, next])
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
