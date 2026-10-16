// store/syncStamp.ts — the small pieces every part of the windows-in-sync door (store/syncedDoc) is
// built from: the STAMP that orders versions, the text hash that names content, and canonical JSON.
// design-q1-q2.md v4, 2.2-2.3.
//
// ★ A STAMP IS A LAMPORT COUNTER AND THE WINDOW'S TAG. A window keeps a counter above every stamp it
// has seen; each version it writes takes the next one, with the window's own random tag to break a
// tie. No ordering decision anywhere reads the wall clock (design 2.3; reviewer A V3-F3): the device
// clock can be set back or forward by years and every comparison still says the same thing.
//   `m` is the counter's era (0 for the two built-in stamps below, 1 for every written one), `c` the
//   counter, `t` the tag. `d` is never written: a window ranks what it holds against what it has
//   read with a stamp "just above version V" (d 1, an older page's change taken but not yet written)
//   or "just below V" (d -1, an older page's bytes passed through), so that it never mints a stamp
//   that would claim a version it has not written.
// ⚠ A STAMP IS WRITTEN AS `<c in base 36>.<tag>` — about seven characters (2.2's compact form).

export type Stamp = { m: number; c: number; t: string; d: number }

/** The stamp of "nothing written yet". */
export const ZERO: Stamp = { m: 0, c: 0, t: '', d: 0 }
/** The stamp of a slice no new window has changed since this build first saw the device. */
export const BOOT: Stamp = { m: 0, c: 0, t: '~boot', d: 0 }

export const cmpStamp = (a: Stamp, b: Stamp): number =>
  a.m - b.m || a.c - b.c || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0) || a.d - b.d

/** A stamp as a map key (derived stamps included). */
export const stampKey = (st: Stamp): string => `${st.m}.${st.c}.${st.t}.${st.d}`

/** A stamp as stored: `<c>.<tag>` for a written one; every other kind spelled out whole. */
export function encodeStamp(st: Stamp): string {
  if (st.m === 1 && st.d === 0) return `${st.c.toString(36)}.${st.t}`
  return `${st.m}!${st.c.toString(36)}!${st.t}!${st.d}`
}
/** A stored stamp read back — or null when the text is not one. */
export function decodeStamp(text: unknown): Stamp | null {
  if (typeof text !== 'string') return null
  const whole = text.split('!')
  if (whole.length === 4) {
    const [m, c, t, d] = [Number(whole[0]), parseInt(whole[1], 36), whole[2], Number(whole[3])]
    return Number.isSafeInteger(m) && Number.isSafeInteger(c) && Number.isSafeInteger(d)
      ? { m, c, t, d }
      : null
  }
  const dot = text.indexOf('.')
  if (dot <= 0 || dot === text.length - 1) return null
  const c = parseInt(text.slice(0, dot), 36)
  if (!Number.isSafeInteger(c) || c < 0) return null
  return { m: 1, c, t: text.slice(dot + 1), d: 0 }
}

// ── SYNC DATA AS TEXT: JSON in which every stamp is its short spelling ──
// The door's sync data (an envelope, a sync key) is plain JSON objects holding Stamp objects; on the
// way to the device each stamp becomes `§<encodeStamp>`, and on the way back every `§` string becomes
// a stamp again. A real string that begins with `§` (a preset name, say) is written with a second `§`
// in front, so nothing a player typed can ever be read back as a stamp.
const isStamp = (v: unknown): v is Stamp =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === 4 &&
  typeof (v as Stamp).m === 'number' &&
  typeof (v as Stamp).c === 'number' &&
  typeof (v as Stamp).t === 'string' &&
  typeof (v as Stamp).d === 'number'
export function packSync(value: unknown): string {
  return JSON.stringify(value, function (this: unknown, _k: string, v: unknown) {
    if (isStamp(v)) return `§${encodeStamp(v)}`
    if (typeof v === 'string' && v.startsWith('§')) return `§${v}`
    return v
  })
}
/** The value packSync wrote. Throws on text that is not JSON (the caller treats it as unreadable). */
export function unpackSync(text: string): unknown {
  return JSON.parse(text, (_k, v: unknown) => {
    if (typeof v !== 'string' || !v.startsWith('§')) return v
    if (v.startsWith('§§')) return v.slice(1)
    return decodeStamp(v.slice(1)) ?? v
  })
}

/** A window's Lamport clock: above every stamp it has seen. */
export type Clock = { m: number; c: number }
export const newClock = (): Clock => ({ m: 0, c: 0 })
/** The next stamp this window writes (the clock moves on). */
export function mint(clock: Clock, tag: string): Stamp {
  if (clock.m < 1) {
    clock.m = 1
    clock.c = 0
  } else clock.c += 1
  return { m: clock.m, c: clock.c, t: tag, d: 0 }
}
/** Hear of a stamp: the clock is raised above it. */
export function see(clock: Clock, st: Stamp | null | undefined): void {
  if (!st) return
  if (st.m > clock.m || (st.m === clock.m && st.c > clock.c)) {
    clock.m = st.m
    clock.c = st.c
  }
}

/** A short random id: a window's tag, a generation's name. */
export const randomId = (length = 6): string => {
  let out = ''
  while (out.length < length) out += Math.floor(Math.random() * 36).toString(36)
  return out
}

// cyrb53 — a fast 53-bit string hash, in base 36. Not cryptographic and does not need to be: it names
// content (a chunk of solve times, a fingerprint of a setting, a Best record's own values), and every
// reader that relies on a name being unique checks the content where a clash would matter.
export function cyrb53(text: string): string {
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

/** JSON with every object's keys in order — the one spelling two equal values share. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(',')}}`
}
