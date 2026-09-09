import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { dimEither } from '../lib/calendar.js'

// store/lookupHistory.ts — Lookup's saved history, SHARED across every preset (Q1, round 20).
//
// WHY THIS IS ITS OWN FILE, NOT PART OF store/progress ANY MORE. Every other silo store/progress
// holds — stats, all-time bests — answers "how did THIS PRESET do", so it is right that switching
// presets swaps it out from under you. A Lookup is not a performance record, it is a question you
// asked ("what day was July 4, 1776?"), and the answer to THAT question does not depend on which
// preset happens to be open — asking it from Preset 2 and then switching to Preset 3 should still
// show it, the same way it would if presets did not exist. So this list is deliberately NOT one of
// the four keys store/presets namespaces per preset: it is global data, like the build stamp
// (lib/buildStamp) or the changelog's seen-signature (src/changelog) — it describes something the
// DEVICE remembers, not something any one preset owns — except unlike those two flags it is
// reactive UI state a component renders, so it needs zustand rather than a plain synchronous read.
// It therefore goes through zustand's OWN default localStorage adapter directly, exactly the way
// store/presets' registry store persists itself — never presetScopedStorage or presetStatsStorage,
// which would namespace or session-park it per preset, the one thing this list must never do.
//
// ⚠ THERE IS NO MIGRATION FROM store/progress'S OLD `lookupHistory` FIELD, on the same "preset 1
// IS the data, never a copy" principle store/presets states for itself: a rewrite that copied the
// old field over on first boot would be exactly the half-finished-copy/run-twice hazard that
// principle exists to delete, for a feature far smaller than presets. A device's existing saved
// lookups are simply left behind under the old key, unread from here on — store/progress's own
// `merge` still spreads that key in from an old payload harmlessly (nothing there reads it any
// more, and the very next save drops it, since it is no longer in that store's PERSISTED_KEYS) —
// see the version-bump note on that store's `persist` options for the full reasoning and its test.
//
// WHAT THIS FILE OWNS, in two halves:
//   • the PERMANENT list (`useLookupHistory`) — localStorage-backed, one un-namespaced key,
//     survives forever exactly like today's saved Lookup history always has;
//   • the SESSION-ONLY overflow (`useLookupSession`) — sessionStorage-backed, for lookups made
//     while the ACTIVE preset is Amnesic (store/amnesic), which must never reach the permanent list
//     but still have to appear on screen for the rest of the browsing session. See that store's
//     header for what "session" means here (survives a refresh, gone when the browser closes) —
//     the identical promise Amnesic's own stats sessionStorage copy makes, for the same reason: a
//     browser can only honestly promise to forget what it never wrote down permanently.
//     ⚠ IT IS NOT KEYED BY PRESET, unlike Amnesic's stats session copy (store/amnesic's `statsKey`).
//     That key exists per preset because the store it shadows is per-preset; this list is GLOBAL,
//     so its session overflow is one bucket for the whole browsing session, not one per preset. A
//     lookup made while Preset 2 was amnesic and one made while Preset 4 was amnesic later in the
//     same session sit in the same bucket — consistent with the permanent list being one shared
//     list too. Nothing here ever reads which preset a session entry was added under, because the
//     permanent list does not track that either.
//   • main.tsx (not this file) decides WHICH bucket a new entry goes into, by reading
//     store/amnesic's `selectAmnesic` at the moment of the push — the identical shape as fullReset's
//     own amnesic check there. It is not decided here so this file stays what every other store in
//     this folder is: state plus setters, with the app owning the one piece of cross-store business
//     logic ("is the active preset amnesic right now") the way it already does for Full Reset.

// A saved Lookup history entry — moved verbatim from store/progress (Stage D1 → Q1, round 20),
// unchanged: {id, y, m, d, isGap?} and nothing else. It carries only what the user supplied — the
// parsed date, a stable id for selection, and the Oct 5–14, 1582 gap marker. Everything the card
// SHOWS — the formatted label, the weekday(s) — is derived from y/m/d against the LIVE Date Format
// at paint time (components/LookupCard), so a Date Format change re-renders every row and the
// answer slot together rather than leaving an old-format sentence sitting above a new-format row.
export interface LookupEntry {
  id: string
  y: number
  m: number
  d: number
  isGap?: boolean
}

// The Lookup history WINDOW, and the one function that applies it — moved verbatim from
// store/progress. Newest to the front; past the cap the oldest simply falls off the end, the same
// bounded-payload rule store/progress' STATS_TIMES_CAP states for solve-times, for the same reason
// (localStorage — and now sessionStorage too — must not grow without bound across a session). 100
// entries of {id,y,m,d} is a few KB, in either storage area.
// (Keep the How-to-Play wording in sync with this number — GuidePage's Lookup section states it,
// once.)
export const LOOKUP_HISTORY_CAP = 100
export const addLookupEntry = (prev: LookupEntry[], entry: LookupEntry): LookupEntry[] =>
  [entry, ...prev].slice(0, LOOKUP_HISTORY_CAP)

// Move an existing entry to the front of ITS OWN list — a re-asked question reads as "the most
// recent one again" without duplicating it. Extracted from main.tsx's inline moveHistoryEntryToTop
// (it used to be written out once, for the one list there was); now there are two lists to apply it
// to — the permanent one and the session-only one — a shared pure function is what keeps the two
// call sites from drifting into two slightly different rewrites of the same array surgery.
export const moveEntryToTop = (prev: LookupEntry[], id: string): LookupEntry[] => {
  const idx = prev.findIndex((e) => e.id === id)
  if (idx <= 0) return prev
  const entry = prev[idx]
  return [entry, ...prev.slice(0, idx), ...prev.slice(idx + 1)]
}

// Merge the permanent list with this session's amnesic-suppressed overflow for DISPLAY. Session
// entries lead: they are always the most recent thing that can have happened relative to whatever
// the permanent list held the moment Amnesic turned on, since nothing NEW can be prepended to the
// permanent list while the active preset is amnesic (that is the whole point of the suppression).
// ⚠ THE ONE ORDERING NUANCE THIS TRADES AWAY, named rather than hidden: if the player leaves an
// amnesic preset mid-session and looks something up from a NON-amnesic one afterwards, that newer
// permanent entry is NOT re-sorted ahead of older session entries by wall-clock time — it lands
// after them here. Getting that exactly right would mean stamping every entry with a timestamp
// purely to compare across the two buckets, which the entry shape above is deliberately without
// (store/progress' own header explains why: inputs only, nothing derived or timestamped). The case
// is rare enough — crossing the amnesic boundary mid-session and then looking something up again —
// that trading it away for a shape with no extra field is the right side of that line.
// Capped at LOOKUP_HISTORY_CAP again after the merge: two buckets each individually capped at 100
// could otherwise show up to 200 rows, breaking the "100 most recent" promise the How-to-Play guide
// states for the visible list, not just for either bucket alone.
export const mergeForDisplay = (
  history: LookupEntry[],
  sessionEntries: LookupEntry[],
): LookupEntry[] =>
  sessionEntries.length ? [...sessionEntries, ...history].slice(0, LOOKUP_HISTORY_CAP) : history

// The lookup-history normalizer, and the ONLY thing that decides what shape a stored entry has.
// Moved verbatim from store/progress (see that store's git history for the v1→v3 shape story this
// comment used to tell in full) — nothing about the validation changes by moving house.
//
// VALIDATION: the filter asserts exactly what the consumers dereference. LookupCard carries no
// per-field guards of its own — the store owns the shape, so the store has to guarantee it, or a
// truncated/tampered payload reaches the card as {id} alone and renders MONTH[NaN] and a blank
// weekday, or trips the mode error boundary. An entry that can't answer "which date?" has nothing
// to show and is dropped.
//
// The date must also be a REAL one, not merely a number-shaped one — the same either-calendar rule
// Lookup validates with (dimEither): a date counts if it exists in a calendar it can be read in, so
// pre-reform February keeps Julian's 29th, and February 30 or day 32 exists nowhere and is dropped.
// Whole numbers for the same reason: month 1.5 indexes MONTH to `undefined` and day 1.5 produces a
// weekday belonging to no day. Deliberately NOT bounded to Lookup's 1–10000 years: an out-of-range
// year still names a real date and still reads correctly, so there is nothing wrong to drop.
//
// Runs on EVERY rehydrate of EITHER bucket below, not just on a shape upgrade: a payload is read
// from the same untrusted storage whether it is this version or an older one, sessionStorage
// included. Exported for tests.
export function normalizeLookupEntries(entries: unknown): LookupEntry[] {
  if (!Array.isArray(entries)) return []
  return entries
    .filter(
      (e): e is LookupEntry =>
        !!e &&
        typeof e === 'object' &&
        typeof e.id === 'string' &&
        Number.isInteger(e.y) &&
        Number.isInteger(e.m) &&
        Number.isInteger(e.d) &&
        e.m >= 1 &&
        e.m <= 12 &&
        e.d >= 1 &&
        e.d <= dimEither(e.y, e.m),
    )
    .map((e) =>
      e.isGap
        ? { id: e.id, y: e.y, m: e.m, d: e.d, isGap: true }
        : { id: e.id, y: e.y, m: e.m, d: e.d },
    )
}

type Updater<T> = T | ((prev: T) => T)
const resolve = <T>(next: Updater<T>, prev: T): T =>
  typeof next === 'function' ? (next as (prev: T) => T)(prev) : (next as T)

// ── The permanent list ────────────────────────────────────────────────────────────────────────

const LOOKUP_HISTORY_KEY = 'cg-lookup-v1'

export type LookupHistoryState = {
  history: LookupEntry[]
  setHistory: (v: Updater<LookupEntry[]>) => void
}

export const useLookupHistory = create<LookupHistoryState>()(
  persist(
    (set) => ({
      history: [],
      setHistory: (v) => set((s) => ({ history: resolve(v, s.history) })),
    }),
    {
      name: LOOKUP_HISTORY_KEY,
      version: 1, // a brand-new key: there is no older shape of THIS key to migrate from — see the
      // file header for why the old store/progress field is not copied forward.
      partialize: (state) => ({ history: state.history }),
      // Plain merge, not store/presets' mergeOverDefaults: that helper exists to stop a PRESET
      // SWITCH from leaking the outgoing preset's in-memory values into the incoming one, and this
      // store is never rehydrated on a switch (it is not in presetControl's PER_PRESET_STORES) — it
      // hydrates exactly once, at module load, the same as store/presets' own registry does. The
      // unconditional screen is the load-bearing half, for the same reason store/progress ran it
      // unconditionally: a current-version payload comes out of the same untrusted localStorage a
      // stale or tampered one does.
      merge: (persisted, current) => ({
        ...current,
        history: normalizeLookupEntries((persisted as Partial<LookupHistoryState> | null)?.history),
      }),
    },
  ),
)

// ── The session-only overflow (Amnesic suppression) ──────────────────────────────────────────
//
// A lookup made while the active preset is Amnesic must never reach the list above, but it still
// has to appear on screen for the rest of THIS browsing session — the file header argues why this
// is its own bucket rather than a reuse of store/amnesic's per-preset session machinery. It is
// created here, alongside the permanent list, rather than in store/amnesic itself, because it is
// Lookup's data and Lookup's shape (LookupEntry, the same cap) — amnesic.ts stays the single owner
// of the FLAG (`selectAmnesic`) that main.tsx reads to decide which of the two stores below a new
// entry goes into; it does not need to know this bucket exists.
const LOOKUP_SESSION_KEY = 'cg-lookup-session-v1'

export type LookupSessionState = {
  sessionEntries: LookupEntry[]
  setSessionEntries: (v: Updater<LookupEntry[]>) => void
}

export const useLookupSession = create<LookupSessionState>()(
  persist(
    (set) => ({
      sessionEntries: [],
      setSessionEntries: (v) => set((s) => ({ sessionEntries: resolve(v, s.sessionEntries) })),
    }),
    {
      name: LOOKUP_SESSION_KEY,
      version: 1,
      storage: createJSONStorage(() => window.sessionStorage),
      partialize: (state) => ({ sessionEntries: state.sessionEntries }),
      merge: (persisted, current) => ({
        ...current,
        sessionEntries: normalizeLookupEntries(
          (persisted as Partial<LookupSessionState> | null)?.sessionEntries,
        ),
      }),
    },
  ),
)
