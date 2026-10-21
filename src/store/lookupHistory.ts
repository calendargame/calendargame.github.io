import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { persist } from 'zustand/middleware'
import { door } from './syncedDoc.js'
import { dimEither } from '../lib/calendar.js'
import { reportedHydration } from './hydrationReport.js'

// store/lookupHistory.ts — Lookup's saved history, SHARED across every preset (round 20).
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
// It therefore persists to ONE un-namespaced key — never presetDoc or the progress door, which would
// namespace it per preset, the one thing this list must never do.
// ★ AMNESIC NEVER TOUCHES IT, on any value (design-amnesic-close.md: the owner's rule). A lookup is a
// question you asked, not a stat.
// ★ THROUGH THE WINDOWS-IN-SYNC DOOR (Round 26, Q2: store/syncedDoc's list door, store/syncList's
// merge). Two windows of the app show the same history, and a lookup in one appears in the other at
// once; a Clear made in a new window stays cleared even with an OLDER build's tab open (its next lookup
// writes its whole stale list, and the cleared entries are tombstoned in the sync key); an older tab's
// lookup is kept beside a new window's. A refused save is kept as actions and merged before it is
// retried (store/storageHealth's door holds).
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
// A saved Lookup history entry — moved verbatim from store/progress (Stage D1 → round 20),
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

// Newest to the front — and NOTHING FALLS OFF THE END. The list used to be a window of the 100 most
// recent; the owner's call was to keep every lookup, like every solve time (store/progress).
// THE COST, stated so nobody has to re-derive it: an entry is about 48 characters saved, and the
// list holds one entry per DATE (looking a date up again moves its entry to the front rather than
// adding one — components/LookupCard), so 10,000 different dates is about 480 KB, a tenth of the
// ~5 million characters a browser gives this site. A device that does run out refuses the save
// without breaking anything and tells the player (store/storageHealth), and Clear History is the
// way to make room. On screen the list draws only the rows near the viewport
// (components/scrollRegion's useWindowedRows), so its length costs nothing to scroll.
// ⚠ ONE CAVEAT, accepted: every build on the origin shares this saved copy, so a tab still running a
// build from before this change trims the list back to 100 the next time a lookup is made IN THAT TAB.
export const addLookupEntry = (prev: LookupEntry[], entry: LookupEntry): LookupEntry[] => [
  entry,
  ...prev,
]

// Move an existing entry to the front of the list — a re-asked question reads as "the most recent
// one again" without duplicating it.
export const moveEntryToTop = (prev: LookupEntry[], id: string): LookupEntry[] => {
  const idx = prev.findIndex((e) => e.id === id)
  if (idx <= 0) return prev
  const entry = prev[idx]
  return [entry, ...prev.slice(0, idx), ...prev.slice(idx + 1)]
}

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
// Runs on EVERY rehydrate below, not just on a shape upgrade: a payload is read from the same
// untrusted storage whether it is this version or an older one. Exported for tests.
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

// ── The list ──────────────────────────────────────────────────────────────────────────────────

export const LOOKUP_HISTORY_KEY = 'cg-lookup-v1'
// v2.26.0, the oldest build that may share this origin, trimmed the list to its newest 100 on every
// save: an older list of 100 or more lacks what it trimmed (store/syncList's resolveList).
const OLDER_TRIM = 100
const LOOKUP_DOOR = door.listStorage<LookupEntry, Pick<LookupHistoryState, 'history'>>({
  kind: 'lookup',
  key: LOOKUP_HISTORY_KEY,
  version: 1,
  field: 'history',
  normalize: normalizeLookupEntries,
  trimAt: OLDER_TRIM,
})

export type LookupHistoryState = {
  history: LookupEntry[]
  setHistory: (v: Updater<LookupEntry[]>) => void
}

export const useLookupHistory: UseBoundStore<StoreApi<LookupHistoryState>> =
  create<LookupHistoryState>()(
    persist(
      (set) => ({
        history: [],
        setHistory: (v) => set((s) => ({ history: resolve(v, s.history) })),
      }),
      {
        name: LOOKUP_HISTORY_KEY,
        storage: LOOKUP_DOOR,
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
          history: normalizeLookupEntries(
            (persisted as Partial<LookupHistoryState> | null)?.history,
          ),
        }),
        onRehydrateStorage: reportedHydration('lookupHistoryRehydrate'),
      },
    ),
  )

LOOKUP_DOOR.attach(useLookupHistory)
