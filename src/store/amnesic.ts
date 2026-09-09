import { createJSONStorage } from 'zustand/middleware'
import { usePresets, presetKey, PRESET_STORE_KEYS } from './presets.js'
import type { PresetRegistryValues } from './presets.js'
import type { ProgressValues } from './progress.js'

// store/amnesic.ts — AMNESIC PRESETS: a preset whose stats are never written down.
//
// WHAT IT IS, in the owner's words: a guest mode. Hand the phone over, they play, they close it,
// nothing is kept. The mechanism is deliberately the dullest one available — while a preset is
// amnesic its STATS live in sessionStorage instead of localStorage, so the browser throws them away
// when the app is closed and this app never has to notice that it happened. ★ NOTHING HERE DETECTS
// A CLOSE, and nothing here schedules a wipe. There is no "clear on exit" hook to miss-fire, no
// beforeunload that iOS declines to deliver, no timer racing a suspend. The data is simply never
// written to permanent storage, which is the only version of this promise a browser can keep.
//
// ⚠⚠ AND THAT IS ALSO WHY THE PROMISE HAS TO BE STATED HONESTLY TO THE PLAYER, which the
// How-to-Play section does out loud: on iOS an app the SYSTEM evicts from the background is
// indistinguishable from one you closed yourself. Both end the browsing session; both take the
// stats with them. Anything that said "only when you close it" would be a lie no web app can make
// true, and the owner accepted that in writing rather than have it hidden.
//
// ── WHERE THE FLAG LIVES, AND WHY IT IS NOT A ⚙ SETTING ────────────────────────────────────────
//
// The switch is drawn in the ⚙ panel directly under Save Stats, but the VALUE lives on the preset
// itself (store/presets' `Preset.amnesic`, in the global registry). Three reasons, and the first is
// the one that would have caused a data-loss bug:
//   ★★ A ⚙ SETTING CAN BE WRITTEN BY applySettings. Reset Settings and Full Reset both push a whole
//      15-value snapshot through it in one `set`. If amnesic were one of those values, either
//      button could flip it from ON to OFF with no rehydration and no screen remount — the five
//      always-mounted mode screens would keep holding the session's numbers while the store was
//      repointed at the parked permanent ones, and the next answered question would write the
//      session's stats over the player's real ones. That is the exact shape of the 500-cards-
//      becomes-4 failure store/presetControl was built to make unwritable. Living on the preset
//      puts every write to it behind `applyRegistry`, which is the one door that already carries
//      the remount (src/main.tsx subscribes to it).
//   • A preset UI has to show a small "A" indicator for presets you are NOT currently on. The
//     registry is global and holds every preset; a per-preset settings payload can only answer for
//     the ACTIVE one without hand-parsing other presets' localStorage.
//   • It is simply what the flag IS. The owner's own split says "KEEPS: every setting … and the
//     amnesic flag itself" — the flag is named SEPARATELY from the settings, because it is a
//     property of the preset in the same way its name is.
//
// ⚠ An older build reading a registry that says `amnesic: true` ignores the field entirely and
// reads the permanent stats — which are exactly the parked ones, untouched. Nothing it can show is
// wrong; it just cannot see the session. That is the honest degradation, and it comes for free.

// ── WHAT AN AMNESIC PRESET FORGETS, AS ONE DECLARATIVE LIST ───────────────────────────────────
//
// ★★ THIS LIST IS THE FEATURE'S DEFINITION, and it is a LIST rather than a wipe path on purpose.
// The owner called the all-time bests his softest call — "I can always come back later and revert
// it if I change my mind" — so the cost of changing his mind has to be deleting a line from here,
// not auditing branches spread through a clearing routine. Everything below reads this list; there
// is no second place that knows what amnesic forgets.
//
// CLEARS (this list) — score, accuracy, streak and the solve times (`stats`, the five lifetime
// silos); and the ALL-TIME BESTS (blitzBest, suddenBest, suddenAmBest, aoxBest). The browsable
// question history is not named because it is not saved by anyone: it is engine state inside the
// always-mounted mode screens, and the remount that accompanies every amnesic change throws it away
// with everything else those screens hold.
//
// KEEPS (everything not named here) — which is, today, the whole of the other three per-preset
// stores: every ⚙ setting including theme, the per-mode setup, and the saved personal defaults.
// They are kept by CONSTRUCTION rather than by an exclusion list: this file only ever repoints the
// PROGRESS store, so the other three cannot be reached from here at all. The split is STATS, NOT
// CONFIGURATION — an amnesic preset stays itself across a close and only forgets how you did.
//
// ⚠ LOOKUP HISTORY USED TO BE A THIRD CLEARS ENTRY AND NO LONGER CAN BE (Q1, round 20) — it left
// store/progress entirely (see store/lookupHistory), which means it left what THIS LIST is even
// capable of describing: `keyof ProgressValues` cannot name a field that is not part of
// ProgressValues, so leaving it here would have failed to compile the moment the move landed. That
// compile error is a feature, not a casualty — read it as confirmation the type guard below is
// doing its job, not as something to work around. Removing it from this list does NOT mean an
// amnesic session's lookups now join the permanent shared history: they still don't, and still
// can't. store/lookupHistory grew its OWN suppression for exactly this — a session-only bucket a
// new entry goes into instead of the permanent one, decided by the same `selectAmnesic` check this
// file exports, at the moment main.tsx pushes the entry — because a SHARED, non-preset-scoped list
// cannot be "cleared" by repointing one preset's storage the way this file repoints PROGRESS: there
// is no preset-scoped copy of it to repoint away from in the first place.
//
// ⚠ TYPED AS `keyof ProgressValues`, which is the half a comment cannot enforce: renaming a
// persisted progress key without updating this list is a compile error rather than a silently
// remembered stat. (The import is type-only, so store/progress can import this file back for its
// storage adapter without a runtime cycle.)
export const AMNESIC_CLEARS: readonly (keyof ProgressValues)[] = [
  'stats',
  'blitzBest',
  'suddenBest',
  'suddenAmBest',
  'aoxBest',
]

// ── Reading the flag ──────────────────────────────────────────────────────────────────────────

/** Is this preset amnesic? Coerced, so a registry field an older payload never wrote reads false. */
export const isAmnesic = (reg: PresetRegistryValues, presetId: number): boolean =>
  reg.presets.some((p) => p.id === presetId && p.amnesic === true)

/**
 * Is the preset the app is CURRENTLY reading and writing amnesic? The selector the ⚙ panel's
 * switch subscribes to, and the question the storage adapter below asks on every call.
 */
export const selectAmnesic = (reg: PresetRegistryValues): boolean => isAmnesic(reg, reg.activeId)

/**
 * ★★ THE IDENTITY OF THE DATA THE APP IS READING — which preset, and which of that preset's two
 * storage areas its stats live in. src/main.tsx remounts the six always-mounted screens whenever
 * THIS changes, and that is the whole of the remount rule.
 *
 * WHY IT IS ONE VALUE AND NOT TWO COMPARISONS. Before amnesic, the subscription compared `activeId`
 * alone; adding a second `||` term beside it would have made "when do the screens remount" a
 * question answered by an expression at the subscription site, which a third repointing (a future
 * import, a sync) would have to remember to extend. Both of today's terms are the same fact — the
 * bytes underneath the screens were swapped — so they are spelled as one fact here, once.
 *
 * ⚠ IT DELIBERATELY IGNORES EVERYTHING ELSE IN THE REGISTRY. Renaming a preset, creating one, or
 * flipping ANOTHER preset's amnesic flag all rewrite the registry value and none of them may throw
 * away the run the player is in the middle of.
 */
export const activeDataId = (reg: PresetRegistryValues): string =>
  `${reg.activeId}:${selectAmnesic(reg) ? 'session' : 'saved'}`

// ── The session copy ──────────────────────────────────────────────────────────────────────────

// The stats key for one preset — the SAME key in either storage area. Sharing the spelling is safe
// because the two areas are separate namespaces (nothing in localStorage can collide with anything
// in sessionStorage), and it is what lets the payload keep its exact shape and `version` stamp
// across the move, so migrate/merge behave identically wherever the bytes came from.
const statsKey = (presetId: number) => presetKey(PRESET_STORE_KEYS.progress, presetId)

// sessionStorage, or null when the browser refuses it. Read through a try/catch rather than left to
// throw, because the two areas fail INDEPENDENTLY and this one must not take the other down: a
// browser that allows localStorage but refuses sessionStorage still has to run a non-amnesic
// preset normally. When it is null an amnesic preset simply holds its stats in memory for the
// session — which is MORE amnesic, not less, and still never touches the permanent copy.
const openSessionStorage = (): Storage | null => {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/**
 * Throw away one preset's session copy of its stats. Called on EVERY amnesic change (both
 * directions — see presetControl's setPresetAmnesic, where the two directions are argued) and when
 * a preset is deleted.
 * Swallows a refusing sessionStorage: nothing was ever written there, so nothing is left behind.
 */
export function discardSessionStats(presetId: number): void {
  try {
    openSessionStorage()?.removeItem(statsKey(presetId))
  } catch {
    /* storage refused — the session copy only ever lived in memory */
  }
}

/**
 * Throw away one preset's PARKED (permanent) copy of its stats. The counterpart to
 * discardSessionStats above, and it exists for exactly one caller: Full Reset.
 *
 * ⚠⚠ WHY THIS DOES NOT BREAK THE INVARIANT — read this before deleting it, because it looks like a
 * hole and is not. The invariant is "while a preset is amnesic, nothing writes its permanent
 * stats", and its PURPOSE is to make cross-contamination impossible: the failure it exists to
 * prevent is a SESSION'S NUMBERS being written over the real ones (the proven 500-to-4 loss). An
 * ERASE cannot contaminate anything — there is no wrong data to leak, only removal. So the honest
 * statement of the rule is "no GAMEPLAY writes the permanent stats", and a deliberate destructive
 * command sits outside it.
 *
 * ★ THE ALTERNATIVE WAS SHIPPED FIRST AND THE OWNER CAUGHT IT. Leaving the parked copy alone made
 * Full Reset resurrectable: wipe everything, turn amnesic off later, and the old stats come back —
 * data the player explicitly destroyed, returning. His words: "doesn't full reset reset everything
 * that amnesic does and more?" It does, and it must, or Full Reset stops being the one control that
 * means everything is gone.
 *
 * ⚠ It is deliberately NOT filtered by AMNESIC_CLEARS. Amnesic forgets a subset; Full Reset is not
 * a bigger amnesic, it is the whole store — the same payload resetProgress() clears on a normal
 * preset. Filtering here would leave a Full Reset in an amnesic preset quietly keeping saved
 * defaults' worth of stats that the same button removes everywhere else.
 */
export function discardParkedStats(presetId: number): void {
  try {
    window.localStorage.removeItem(statsKey(presetId))
  } catch {
    /* storage refused — there is no parked copy to remove */
  }
}

// ★ THE SEED, and it is what makes the CLEARS list above mean something. An amnesic preset with no
// session copy yet — the first read after the switch is flipped, and every read after the app is
// re-opened — starts from the PARKED permanent payload with the cleared keys REMOVED. The keys
// that survive arrive at their real saved values (so a future decision to keep the all-time bests
// is exactly "delete four lines from AMNESIC_CLEARS"); the keys that don't are absent, and an
// absent key is what store/presets' mergeOverDefaults turns into the factory value. That is the
// "the session starts at ZERO" half of the toggle rule, expressed as data rather than as a wipe.
//
// ⚠ IT IS A PURE DERIVATION AND WRITES NOTHING. Seeding by copying into sessionStorage on read
// would be a write inside a getItem, which hydration calls — and the moment this function writes,
// the question "can an amnesic session ever touch storage it should not" stops having a one-line
// answer. The next setItem creates the session copy; until then every read re-derives, which costs
// one JSON parse on a payload that is already in memory.
//
// A parked payload that will not parse seeds NOTHING (null): a truncated or tampered envelope
// cannot be trusted to say which stats are whose, and handing it to the session would launder it.
// The player sees a fresh session, which is the correct answer for a corrupt permanent copy too.
const seedFromParked = (parked: string | null): string | null => {
  if (parked === null) return null
  try {
    const envelope: unknown = JSON.parse(parked)
    if (!envelope || typeof envelope !== 'object') return null
    const state = (envelope as { state?: unknown }).state
    if (!state || typeof state !== 'object') return null
    for (const key of AMNESIC_CLEARS) delete (state as Record<string, unknown>)[key]
    return JSON.stringify(envelope)
  } catch {
    return null
  }
}

// ── Where an amnesic preset's stats actually read and write ───────────────────────────────────
//
// ★★ THE INVARIANT, IN ONE SENTENCE: WHILE A PRESET IS AMNESIC, NOTHING WRITES ITS PERMANENT STATS.
// It is true because `setItem` below has exactly one branch that names `ls`, and that branch cannot
// run while the flag is on. tests/amnesic.dom asserts it as a byte comparison rather than as a
// behaviour, because a behaviour test would only prove the paths somebody thought to drive.
//
// ⚠⚠ MERGING A SESSION BACK INTO THE PERMANENT STATS ON TOGGLE-OFF IS BANNED, and it is banned by
// there being nowhere to write it FROM: the session copy is discarded before the store rehydrates,
// so by the time anything permanent is read again the session's numbers no longer exist. A merge is
// exactly the 500-cards-becomes-4 shape — two sets of stats, one of them stale, one write picking
// the wrong one — and the owner ruled it out. Toggling OFF discards; it never reconciles.
//
// This is store/presets' presetScopedStorage with ONE extra question asked per call, and it stays a
// SECOND named adapter rather than an option on the first: the first is the rule for the three
// stores that are always permanent, and an adapter that could be either would put a boolean in
// front of the sentence above.
export const presetStatsStorage = <T>() =>
  createJSONStorage<T>(() => {
    // ⚠ EAGER, exactly as presetScopedStorage is and for the same reason: a browser that throws on
    // the localStorage property access must throw HERE, where zustand's createJSONStorage catches
    // it and puts the store on the in-memory-only path, rather than inside every getItem/setItem —
    // i.e. inside hydration and inside every setState. sessionStorage is opened after it, guarded,
    // because it is allowed to be missing on its own.
    const ls = window.localStorage
    const ss = openSessionStorage()
    // Resolved per call, never captured: the active preset and its flag both change under a live
    // store, and the whole point of an adapter (rather than a swapped persist `name`) is that there
    // is no window in which it is pointed at one preset while holding another's.
    const target = (name: string) => {
      const reg = usePresets.getState()
      return { key: presetKey(name, reg.activeId), amnesic: selectAmnesic(reg) }
    }
    return {
      getItem: (name) => {
        const { key, amnesic } = target(name)
        const parked = ls.getItem(key)
        if (!amnesic) return parked
        // The session copy once it exists; the seed derived from the parked copy until then. Note
        // that `parked` is read either way and is never written — an amnesic preset can SEE its
        // permanent payload (that is how the kept keys get their values) and can never alter it.
        return ss?.getItem(key) ?? seedFromParked(parked)
      },
      setItem: (name, value) => {
        const { key, amnesic } = target(name)
        if (amnesic) ss?.setItem(key, value)
        else ls.setItem(key, value)
      },
      removeItem: (name) => {
        const { key, amnesic } = target(name)
        if (amnesic) ss?.removeItem(key)
        else ls.removeItem(key)
      },
    }
  })
