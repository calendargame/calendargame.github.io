import type { StorageValue } from 'zustand/middleware'
import { usePresets } from './presets.js'
import { useSessionAmnesic, amnesicModeOf } from './sessionAmnesic.js'
import { readItem } from './storageHealth.js'
import { createProgressCodec, removeProgressCopy, mainKeyOf } from './progressStorage.js'
import { captureError } from '../observability/sentry.js'
import type { AmnesicMode } from './amnesicMode.js'
import type { ProgressValues } from './progress.js'

// store/amnesic.ts — AMNESIC PRESETS: a preset whose stats (and, on Full, whose bests) are never
// written down.
//
// WHAT IT IS, in the owner's words: a guest mode. Hand the phone over, they play, they close it,
// nothing is kept. The mechanism is deliberately the dullest one available — what an amnesic preset
// forgets lives in sessionStorage instead of localStorage, so the browser throws it away when the app
// is closed and this app never has to notice that it happened. ★ NOTHING HERE DETECTS A CLOSE, and
// nothing here schedules a wipe. There is no "clear on exit" hook to miss-fire, no beforeunload that
// iOS declines to deliver, no timer racing a suspend. The data is simply never written to permanent
// storage, which is the only version of this promise a browser can keep.
//
// ⚠⚠ AND THAT IS ALSO WHY THE PROMISE HAS TO BE STATED HONESTLY TO THE PLAYER, which the
// How-to-Play section does out loud: on iOS an app the SYSTEM evicts from the background is
// indistinguishable from one you closed yourself. Both end the browsing session; both take the
// session's numbers with them. Anything that said "only when you close it" would be a lie no web app
// can make true, and the owner accepted that in writing rather than have it hidden.
//
// ── THE THREE VALUES (store/amnesicMode) ───────────────────────────────────────────────────────
//
//   Off        — everything is saved.
//   Stats Only — the STATS are the session's; the round modes' BESTS are the permanent ones. "I can
//                mess around and not worry about my score but I can still store a new best."
//   Full       — stats and bests are both the session's. The guest mode above.
//
// ── WHERE THE VALUE LIVES, AND WHY IT IS NOT A ⚙ SETTING ───────────────────────────────────────
//
// The pill is drawn in the ⚙ panel directly under Save Stats, but the VALUE is not one of the ⚙
// settings: it is held per preset for the browsing session (store/sessionAmnesic), and what a preset
// starts a fresh open on is the value in its saved defaults. Two reasons it cannot be a settings
// value, and the first is the one that would have caused a data-loss bug:
//   ★★ A ⚙ SETTING CAN BE WRITTEN BY applySettings. Reset Settings and Full Reset both push a whole
//      16-value snapshot through it in one `set`. If the Amnesic value were one of those, either
//      button could change it with no rehydration and no screen remount — the five always-mounted
//      mode screens would keep holding the session's numbers while the store was repointed at the
//      parked permanent ones, and the next answered question would write the session's stats over
//      the player's real ones. That is the exact shape of the 500-cards-becomes-4 failure
//      store/presetControl was built to make unwritable. Every change to the value goes through
//      store/presetControl's setPresetAmnesic instead, which pairs it with the discard, the reload
//      and the remount (src/main.tsx subscribes to activeDataId below).
//   • A preset list has to say which presets are amnesic for presets you are NOT currently on (the
//     spoken ", amnesic" in components/PresetSwitcher). A per-preset settings payload can only answer
//     for the ACTIVE one without hand-parsing other presets' localStorage.
//
// ⚠ An older build on this origin knows nothing of the session's value. It reads its own flag on the
// preset registry and the permanent stats — which are exactly the parked ones, untouched. Nothing it
// can show is wrong; it just cannot see the session. (What it reads where, and the one sequence that
// is left open, is argued in store/sessionAmnesic and store/amnesicMode.)

// ── WHAT AN AMNESIC PRESET FORGETS, AS ONE DECLARATIVE LIST ───────────────────────────────────
//
// ★★ THIS LIST IS THE FEATURE'S DEFINITION, and it is a LIST rather than a wipe path on purpose.
// Everything below reads it; there is no second place that knows what each value forgets.
//
// CLEARS (the session's, per value) —
//   Stats Only: `stats` — score, accuracy, streak (the best-streak figure included) and the solve
//     times of the five lifetime silos, i.e. the whole of the casual modes' stats strip.
//   Full: those, and the ALL-TIME BESTS (blitzBest, suddenBest, suddenAmBest, aoxBest).
// The browsable question history is not named because it is not part of the saved progress: it is
// engine state inside the always-mounted mode screens, kept for the browsing session only and per
// stats copy (store/sessionHistory) — a guest's history lives and dies with the guest's session copy,
// and your own comes back with your own stats when the guest is done. Nor are a Blitz round's or a
// MoX run's own running numbers (score, accuracy, streak, Last, Mean, Median): those are the round's,
// never saved by any value — only the Bests a round sets are.
//
// KEEPS (everything not named) — under Stats Only the four Best maps, which stay in the PERMANENT
// copy: read from it, and written back to it the moment a round sets one. And, under every value, the
// whole of the other three per-preset stores: every ⚙ setting including theme, the per-mode setup,
// and the saved personal defaults. Those are kept by CONSTRUCTION rather than by an exclusion list:
// this file only ever repoints the PROGRESS store, so the other three cannot be reached from here at
// all. The split is STATS, NOT CONFIGURATION — an amnesic preset stays itself across a close and only
// forgets how you did.
//
// ⚠ LOOKUP HISTORY IS NOT IN THIS LIST AND CANNOT BE — it left store/progress (see
// store/lookupHistory), so `keyof ProgressValues` cannot name it. It has its OWN rule, decided by the
// same value at the moment src/main.tsx pushes an entry (keepsLookups below): saved normally under Off
// and Stats Only (a lookup is not a stat), and held in a session-only bucket under Full — because a
// SHARED, non-preset-scoped list cannot be "cleared" by repointing one preset's storage the way this
// file repoints PROGRESS.
//
// ⚠ TYPED AS `keyof ProgressValues`, which is the half a comment cannot enforce: renaming a
// persisted progress key without updating this list is a compile error rather than a silently
// remembered stat. (The import is type-only, so store/progress can import this file back for its
// storage adapter without a runtime cycle.)
// …and it is a RECORD over every key, so a progress key added later that is not sorted here fails to
// compile, instead of becoming something a guest's session quietly keeps.
type ProgressKey = keyof ProgressValues
const KIND: Record<ProgressKey, 'stat' | 'best'> = {
  stats: 'stat',
  blitzBest: 'best',
  suddenBest: 'best',
  suddenAmBest: 'best',
  aoxBest: 'best',
}
const ALL_KEYS = Object.keys(KIND) as ProgressKey[]

export const AMNESIC_CLEARS: Record<Exclude<AmnesicMode, 'off'>, readonly ProgressKey[]> = {
  stats: ALL_KEYS.filter((key) => KIND[key] === 'stat'),
  full: ALL_KEYS,
}

// ── Reading the value ─────────────────────────────────────────────────────────────────────────

/** The Amnesic value of the preset the app is CURRENTLY reading and writing. */
export const activeAmnesicMode = (): AmnesicMode => amnesicModeOf(usePresets.getState().activeId)

/** …as a subscription — what the ⚙ pill and the dashed outline on the screens render from. */
export const useActiveAmnesicMode = (): AmnesicMode => {
  const activeId = usePresets((s) => s.activeId)
  return useSessionAmnesic((s) => s.modes[activeId] ?? 'off')
}

/**
 * Is a lookup made under this value added to the saved, shared Lookup history? Under Off and Stats
 * Only it is — a lookup is a question you asked, not a stat. Under Full it goes to the session-only
 * bucket instead (store/lookupHistory).
 */
export const keepsLookups = (mode: AmnesicMode): boolean => mode !== 'full'

/**
 * Does RESET STATS, on a mode's own screen, give room back ON THE DEVICE while its preset is on this
 * value? Only under Off. Under Stats Only and Full the stats on screen are the session's copy, so
 * that is what the button clears — the saved solve times parked behind it are not touched, and they
 * are what is taking the room. (What the storage popup and the storage-full notice have to know
 * before they recommend it; store/storageUsage's tests pin it beside the two remedies that work
 * under every value — Clear History, which empties the saved Lookup list whatever the value, and
 * deleting a preset, which removes everything it holds.)
 */
export const resetStatsFreesRoom = (mode: AmnesicMode): boolean => mode === 'off'

/**
 * ★★ THE IDENTITY OF THE DATA THE APP IS READING — which preset, and which copy of that preset's
 * STATS the screens are holding. src/main.tsx remounts the five always-mounted mode screens whenever
 * THIS changes, and that is the whole of the remount rule.
 *
 * WHY IT IS ONE VALUE AND NOT SEVERAL COMPARISONS. Before amnesic, the subscription compared
 * `activeId` alone; adding more `||` terms beside it would have made "when do the screens remount" a
 * question answered by an expression at the subscription site, which the next repointing (a future
 * import, a sync) would have to remember to extend. A preset switch and a change of the Amnesic
 * value are the same fact — the bytes underneath the screens were swapped — so they are spelled as
 * one fact here, once.
 *
 * ⚠ IT DELIBERATELY IGNORES EVERYTHING ELSE. Renaming a preset, creating one, or changing ANOTHER
 * preset's Amnesic value all rewrite a store this reads and none of them may throw away the run the
 * player is in the middle of.
 */
export const activeDataId = (): string =>
  dataIdOf(usePresets.getState().activeId, activeAmnesicMode())

/**
 * The spelling of one STATS copy's identity, for ANY preset and value:
 *     "<presetId>:saved"    Off         — the permanent stats
 *     "<presetId>:stats"    Stats Only  — the session's stats, beside the permanent bests
 *     "<presetId>:session"  Full        — the session's stats and bests
 * It is what a casual mode's parked history is keyed by (store/sessionHistory): a history only ever
 * comes back over the stats it was played on. Stats Only and Full are two ids although both keep
 * their stats in the same session copy, because a change between them starts that copy again from
 * zero (store/presetControl's setPresetAmnesic) — they are never the same stats.
 */
export const dataIdOf = (presetId: number, mode: AmnesicMode): string =>
  `${presetId}:${mode === 'off' ? 'saved' : mode === 'stats' ? 'stats' : 'session'}`

/**
 * The spelling of one BESTS copy's identity — "<presetId>:saved" (Off AND Stats Only: the permanent
 * bests) or "<presetId>:session" (Full) — which is what an ended Blitz round / MoX run is parked
 * under (store/sessionRound).
 *
 * ★ WHY A ROUND IS KEYED BY THE BESTS AND NOT BY THE STATS. A round's own numbers are the round's;
 * the only saved thing it touches is the Best records, and it touches them by REBUILDING its config's
 * record from the one that stood before it began (engine/blitzBest, engine/aoxBest). That is only
 * sound while it is the ONE round that can have moved that record since. So there is one parked round
 * per bests copy, not per Amnesic value: Off and Stats Only share the permanent bests, and they share
 * the round. Were a Stats Only round parked apart from an Off one, the Off round would come back
 * later and rebuild the record from its own, older, starting point — lowering or erasing a Best set
 * in between. Sharing the slot makes that unreachable: the finished round on screen simply stays the
 * finished round on screen when the pill moves between Off and Stats Only.
 */
export const bestsIdOf = (presetId: number, mode: AmnesicMode): string =>
  `${presetId}:${mode === 'full' ? 'session' : 'saved'}`

/** …for the preset and value the app is on right now. */
export const activeBestsId = (): string =>
  bestsIdOf(usePresets.getState().activeId, activeAmnesicMode())

// ── The session copy ──────────────────────────────────────────────────────────────────────────

// sessionStorage, or null when the browser refuses it. Read through a try/catch rather than left to
// throw, because the two areas fail INDEPENDENTLY and this one must not take the other down: a
// browser that allows localStorage but refuses sessionStorage still has to run a non-amnesic
// preset normally. When it is null an amnesic preset simply holds its session's numbers in memory —
// which is MORE amnesic, not less, and still never touches the permanent stats.
const openSessionStorage = (): Storage | null => {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/**
 * Throw away one preset's session copy. Called on EVERY change of the Amnesic value (all six — see
 * presetControl's setPresetAmnesic, where they are argued) and when a preset is deleted.
 * Swallows a refusing sessionStorage: nothing was ever written there, so nothing is left behind.
 * The copy goes whole (store/progressStorage's removeProgressCopy): its sealed chunks of solve times
 * with it, and a session save the device REFUSED is forgotten with the copy it was for — a guest's
 * unsaved numbers must not be written out after the guest is gone.
 */
export function discardSessionStats(presetId: number): void {
  try {
    const ss = openSessionStorage()
    if (ss) removeProgressCopy({ area: ss, presetId })
  } catch {
    /* storage refused — the session copy only ever lived in memory */
  }
}

/**
 * One preset's SESSION copy, as the raw stored text — or null when it has none (it is not amnesic,
 * it is and has written nothing yet, or the browser refuses sessionStorage).
 *
 * ★ IT LIVES HERE RATHER THAN AT ITS CALLER for the reason every other function in this section
 * does: the guarded sessionStorage open is this file's, and a second copy of it somewhere else is
 * how the two areas come to disagree about where a preset's session stats are (the key's own
 * spelling is store/progressStorage's mainKeyOf — the same name in either area).
 * store/presetControl's isPresetFactory is the one caller — it has to ask whether a preset about
 * to be deleted holds anything, and for an amnesic preset the session copy
 * is one of the two places that can answer yes.
 * ⚠ RAW TEXT, NOT A PARSED PAYLOAD, deliberately: the caller compares it against store/progress'
 * factory value with exactly the machinery it already uses for the permanent copy. Parsing it here
 * would be a second reader of a shape this file has no other reason to know.
 */
export function readSessionStats(presetId: number): string | null {
  try {
    const ss = openSessionStorage()
    return ss ? readItem(ss, mainKeyOf(presetId)) : null
  } catch {
    /* storage refused — the session copy only ever lived in memory */
    return null
  }
}

// ── An amnesic preset's SESSION copy ─────────────────────────────────────────────────────────────
//
// ★★ THE INVARIANT, IN ONE SENTENCE: WHILE A PRESET IS AMNESIC, NOTHING WRITES ITS PERMANENT STATS, AND THE
// ONLY THING WRITTEN TO ITS PERMANENT COPY AT ALL IS A BEST RECORD IT KEEPS. The saved progress goes through
// the windows-in-sync door (store/progressDoor), which keeps it: under Stats Only it reads and writes only the
// device doc's Best records - its stats pass through byte for byte - and the stats are THIS copy's; under
// Full nothing permanent is read or written at all. (A Full Reset is the one exception, and not gameplay:
// it writes the factory doc, everything gone, whatever the value - 8.7 of design-q1-q2.md v4.)
// tests/amnesic.dom asserts it as a byte comparison rather than as a behaviour, because a behaviour test
// would only prove the paths somebody thought to drive.
//
// ⚠⚠ MERGING A SESSION BACK INTO THE PERMANENT STATS IS BANNED, and it is banned by there being nowhere to
// write it FROM: the session copy is discarded on every change of the value before the store rehydrates, so
// by the time anything permanent is read again the session's numbers no longer exist. A merge is exactly the
// 500-cards-becomes-4 shape — two sets of stats, one of them stale, one write picking the wrong one — and the
// owner ruled it out. Changing the value discards; it never reconciles. (The session copy is this WINDOW's:
// sessionStorage is per window, and the door never merges it.)
// ★ WHAT IT HOLDS is exactly AMNESIC_CLEARS of the value: Stats Only's stats; Full's everything.
// How a copy is laid out (its main key, and the sealed chunks of a long history of solve times) is
// store/progressStorage's, handed exactly one (area, preset) per call: nothing here can reach the
// permanent copy.

/** The active preset's session copy: read, written, and thrown away (store/progressDoor's `session`). */
export function sessionProgress(): {
  load(): StorageValue<ProgressValues> | null
  save(value: StorageValue<ProgressValues>): void
  discard(): void
} {
  const codec = createProgressCodec<ProgressValues>()
  const copy = () => {
    const ss = openSessionStorage()
    return ss ? { area: ss, presetId: usePresets.getState().activeId } : null
  }
  return {
    load() {
      const c = copy()
      if (!c) return null
      // A session copy that will not load is a session that starts again.
      try {
        return codec.load(c)
      } catch (e) {
        captureError(e instanceof Error ? e : new Error(String(e)), { tripwire: 'progressSession' })
        return null
      }
    },
    save(value) {
      const c = copy()
      const mode = amnesicModeOf(usePresets.getState().activeId)
      if (!c || mode === 'off') return
      const state = value.state as unknown as Record<string, unknown>
      const kept = Object.fromEntries(
        AMNESIC_CLEARS[mode].filter((key) => key in state).map((key) => [key, state[key]]),
      )
      codec.save(c, { ...value, state: kept } as StorageValue<ProgressValues>)
    },
    discard() {
      discardSessionStats(usePresets.getState().activeId)
    },
  }
}
