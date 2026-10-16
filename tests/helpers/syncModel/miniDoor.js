// tests/helpers/syncModel/miniDoor.js — a small, hand-driven world for store/syncCounts' named cases
// (tests/syncCounts.test.js): one device, new windows (the real CountsBook) that read it AS IT IS (no lag),
// and older pages written by hand as the older builds write (tests/syncedDoc.olderBuilds holds those
// writes to the real builds). Silos A and B, settings R and S.
import { CountsBook, blankSilo, encodeTag, decodeTag } from '../../../src/store/syncCounts.js'
import { packSync, unpackSync } from '../../../src/store/syncStamp.js'

export const SHAPE = {
  silos: ['A', 'B'],
  regs: ['R', 'S'],
  parse(text) {
    if (text == null) return null
    const o = JSON.parse(text)
    return { state: o.state ?? {}, sync: o.sync ? unpackSync(JSON.stringify(o.sync)) : null }
  },
  silo(disk) {
    if (!disk) return { v: blankSilo(), tag: null }
    return {
      v: { pl: disk.pl, gd: disk.gd, sk: disk.sk, bs: disk.bs, t: [...disk.t], tl: disk.tl ?? 0 },
      tag: disk.w ? decodeTag(disk.w) : null,
    }
  },
  diskSilo: (v, tag) => ({
    pl: v.pl,
    gd: v.gd,
    sk: v.sk,
    bs: v.bs,
    t: v.t,
    ...(v.tl ? { tl: v.tl } : {}),
    w: encodeTag(tag),
  }),
  write: (state, sync) => JSON.stringify({ state, sync: JSON.parse(packSync(sync)) }),
  readKey: (text) => (text == null ? null : unpackSync(text)),
  writeKey: (k) => packSync(k),
}

export function makeDevice() {
  const items = new Map()
  const dev = {
    items,
    full: new Set(), // windows the device refuses
    log: [],
    get doc() {
      return items.get('doc') ?? null
    },
    get key() {
      return items.get('key') ?? null
    },
    state() {
      return dev.doc ? JSON.parse(dev.doc).state : null
    },
    // An OLDER build's whole-copy save: its state, no envelope (it drops it), the key untouched.
    oldSave(state) {
      const before = dev.doc
      items.set('doc', JSON.stringify({ state }))
      dev.notify(before)
    },
    oldRemove() {
      const before = dev.doc
      items.delete('doc')
      dev.notify(before)
    },
    windows: [],
    notify(before, except) {
      for (const w of dev.windows) if (w !== except && !w.asleep) w.notice(before)
    },
  }
  return dev
}

/** A NEW window: the real door on this device. `asleep` windows miss notices (read the device later). */
export function newWindow(dev, name) {
  let prevDoc
  const io = {
    view: () => ({ doc: dev.doc, side: dev.key, prevDoc }),
    deviceKey: () => dev.key,
    save(docText, keyText) {
      if (dev.full.has(name)) return false
      const before = dev.doc
      dev.items.set('doc', docText)
      dev.items.set('key', keyText)
      dev.log.push({ by: name, doc: docText })
      prevDoc = before
      dev.notify(before, win)
      return true
    },
  }
  const book = new CountsBook({ shape: SHAPE, io, tag: name })
  const win = {
    name,
    book,
    asleep: false,
    notice(before) {
      prevDoc = before
      book.handle()
    },
    wake() {
      win.asleep = false
      prevDoc = undefined
      book.handle()
    },
    act(fn) {
      book.handle()
      fn(book)
      book.owes = !book.land()
      return book.owes === false
    },
    answer: (x, r = true, tm = null) => win.act((b) => b.answer(x, { kind: 'a', r, tm })),
    reset: (x) => win.act((b) => b.reset(x)),
    set: (x, v) => win.act((b) => b.setReg(x, v)),
    silo: (x) => book.mem[x].v,
    reg: (x) => book.mem[x].v,
  }
  book.open()
  dev.windows.push(win)
  return win
}

/** What the device holds of a silo, as counts. */
export const deviceSilo = (dev, x) => SHAPE.silo(dev.state()?.[x]).v
export const tagOn = (dev, x) => SHAPE.silo(dev.state()?.[x]).tag
