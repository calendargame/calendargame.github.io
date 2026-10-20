import { amnesicOf, amnesicOnOf } from './settings.js'
import { readItem, writeItem } from './storageHealth.js'

// store/amnesicWindow.ts — THE AMNESIC WINDOW play is anchored in (design-amnesic-close.md 1; store/amnesic
// says what Amnesic is).
//
// ★ A WINDOW IS `<session>:<switch-on>`. The SESSION is the app's: one number for every window of the app
// open together, moved on by the first window to open after every window had closed, when that close
// forgot anything (store/amnesicClose - the counter below; a close that owes no forget leaves it). The SWITCH-ON is the preset's own: its settings' `amnesicOn`, moved on by every change
// of its Amnesic value away from Off (store/presetControl's setPresetAmnesic). So "what was played on this
// preset since its Amnesic was last switched on from Off, or since the app opened, whichever is later" is
// exactly the play anchored in its window now - and a preset on Off has none: its play anchors nothing.
// Both are counters, so windows are ordered (store/syncCounts' eAfter) and nothing reads a clock.
// ★ THE COUNTER IS ONE SMALL KEY, `cg-session-v1` — `{ n, pending? }`: `n` the session now, and `pending`
// the forgets of an earlier close a full device held (store/amnesicClose runs them again until they land).
// No older build knows the key.

const SESSION_KEY = 'cg-session-v1'

/** A forget an earlier close owes: preset `presetId`'s window `e`, its Bests too when `full`. */
export type PendingForget = { presetId: number; e: string; full: boolean }
type Counter = { n: number; pending: PendingForget[] }

const area = (): Storage | null => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}
const isCount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const isPending = (v: unknown): v is PendingForget =>
  !!v &&
  typeof v === 'object' &&
  isCount((v as PendingForget).presetId) &&
  typeof (v as PendingForget).e === 'string' &&
  typeof (v as PendingForget).full === 'boolean'

const parsedCounter = (): unknown => {
  const s = area()
  try {
    const text = s ? readItem(s, SESSION_KEY) : null
    return text === null ? null : JSON.parse(text)
  } catch {
    return null // (unreadable: as if never counted)
  }
}
/** The session counter as the device holds it (a session 0 before the first one was ever counted). */
export function readSessionCounter(): Counter {
  const raw = parsedCounter()
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    n: isCount(o.n) ? o.n : 0,
    pending: Array.isArray(o.pending) ? o.pending.filter(isPending) : [],
  }
}
/** Write the counter (held and retried like any save if the device refuses it). */
export function writeSessionCounter(c: Counter): void {
  const s = area()
  if (!s) return
  writeItem(s, SESSION_KEY, JSON.stringify(c.pending.length ? c : { n: c.n }))
}

// The session THIS window is in: the one it joined at boot (store/amnesicClose) - until then (or in a
// page that never joined, a test's) the device's.
let joined: number | null = null
export const joinedSession = (n: number): void => {
  joined = n
}
export const currentSession = (): number => joined ?? readSessionCounter().n
/** Forget the session this window joined, i.e. "the page was closed" (the test harness has no close). */
export const forgetJoinedSession = (): void => {
  joined = null
}

/** The window play on preset `presetId` is anchored in now — null while its Amnesic is Off. */
export function amnesicWindowOf(presetId: number): string | null {
  if (amnesicOf(presetId) === 'off') return null
  return `${currentSession()}:${amnesicOnOf(presetId)}`
}
