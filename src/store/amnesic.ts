import type { PersistStorage, StorageValue } from 'zustand/middleware'
import { usePresets, readStoredRegistry, FIRST_PRESET_ID } from './presets.js'
import { useSessionAmnesic, amnesicModeOf } from './sessionAmnesic.js'
import { readItem, writeItem } from './storageHealth.js'
import { createProgressCodec, removeProgressCopy, mainKeyOf } from './progressStorage.js'
import { captureError } from '../observability/sentry.js'
import { isRecord, sameJson } from './json.js'
import type { AmnesicMode } from './amnesicMode.js'
import type { ProgressValues } from './progress.js'
import { betterBlitzBest, betterSuddenBest } from '../engine/blitzBest.js'
import { betterAoxBest } from '../engine/aoxBest.js'

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

// ★ THE BETTER OF TWO RECORDS OF ONE BEST MAP, for the one place that can be holding two (writeKept,
// below: this page's record and the one another tab has saved since). Each map's own ordering, which
// is its MODE's — the comparison that decides a new best on its screen (engine/blitzBest,
// engine/aoxBest), not a second one written here. `theirs` is what is on the device and keeps
// whatever `mine` does not strictly beat; and it stands as it is when either of the two is not a
// record of that map's shape — saved data is untrusted, and nothing is compared that cannot be read.
const num = (v: unknown): v is number => typeof v === 'number'
const time = (v: unknown): v is number | null => v === null || num(v)
const comparing =
  <T>(shaped: (rec: Record<string, unknown>) => boolean, better: (a: T, b: T) => T) =>
  (theirs: unknown, mine: unknown): unknown =>
    isRecord(theirs) && isRecord(mine) && shaped(theirs) && shaped(mine)
      ? better(theirs as T, mine as T)
      : theirs
const scoreAndStreak = comparing((r) => num(r.score) && num(r.streak), betterBlitzBest)
const BETTER: Record<Exclude<ProgressKey, 'stats'>, (theirs: unknown, mine: unknown) => unknown> = {
  blitzBest: scoreAndStreak,
  suddenAmBest: scoreAndStreak,
  suddenBest: comparing((r) => num(r.score), betterSuddenBest),
  aoxBest: comparing((r) => time(r.avg) && time(r.med), betterAoxBest),
}
export const AMNESIC_CLEARS: Record<Exclude<AmnesicMode, 'off'>, readonly ProgressKey[]> = {
  stats: ALL_KEYS.filter((key) => KIND[key] === 'stat'),
  full: ALL_KEYS,
}
// What stays in the permanent copy while a preset is on that value — every key the list above does
// not name. Nothing under Full; the four Best maps under Stats Only.
const keptKeys = (mode: Exclude<AmnesicMode, 'off'>): readonly Exclude<ProgressKey, 'stats'>[] =>
  ALL_KEYS.filter(
    (key): key is Exclude<ProgressKey, 'stats'> =>
      key !== 'stats' && !AMNESIC_CLEARS[mode].includes(key),
  )

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

/**
 * Throw away one preset's PARKED (permanent) copy of its saved progress. The counterpart to
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
 * means everything is gone. It runs under Stats Only for the same reason: the permanent STATS sit
 * untouched behind that session too.
 *
 * ⚠ It is deliberately NOT filtered by AMNESIC_CLEARS. Amnesic forgets a subset; Full Reset is not
 * a bigger amnesic, it is the whole store — the same payload resetProgress() clears on a normal
 * preset.
 */
export function discardParkedStats(presetId: number): void {
  try {
    removeProgressCopy({ area: window.localStorage, presetId })
  } catch {
    /* storage refused — there is no parked copy to remove */
  }
}

// ── Where an amnesic preset's saved progress actually reads and writes ────────────────────────
//
// ★★ THE INVARIANT, IN ONE SENTENCE: WHILE A PRESET IS AMNESIC, NOTHING WRITES ITS PERMANENT STATS,
// AND THE ONLY THING WRITTEN TO ITS PERMANENT COPY AT ALL IS A BEST MAP IT KEEPS. It is true because
// the storage below has exactly two places that name `ls` for a write — the whole-copy save, which
// cannot run while the value is anything but Off, and writeKept, which builds what it writes from the
// permanent text as it stands plus the kept maps and nothing else: it is never handed the stats.
// tests/amnesic.dom asserts it as a byte comparison rather than as a behaviour, because a behaviour
// test would only prove the paths somebody thought to drive.
//
// ⚠⚠ MERGING A SESSION BACK INTO THE PERMANENT STATS IS BANNED, and it is banned by there being
// nowhere to write it FROM: the session copy is discarded on every change of the value before the
// store rehydrates, so by the time anything permanent is read again the session's numbers no longer
// exist. A merge is exactly the 500-cards-becomes-4 shape — two sets of stats, one of them stale, one
// write picking the wrong one — and the owner ruled it out. Changing the value discards; it never
// reconciles.
//
// This is store/presets' presetDoc (the active preset's key, at each read and each write) with ONE
// extra question asked per call — WHICH COPY, per key — and it stays a SECOND named adapter rather
// than an option on the first: the first is the rule for the stores that are always permanent, and
// an adapter that could be either would put a condition in front of the sentence above.
// ★ IT ONLY CHOOSES THE COPY. How a copy is laid out on the device — the main key, and the sealed
// chunks a long history of solve times is kept in — is store/progressStorage's, which is handed
// exactly one (area, preset) per call and can therefore reach no other: while a preset is amnesic
// nothing there reads, lists or deletes a single chunk of its permanent copy. The kept Best maps are
// read from and written into the permanent MAIN key's text directly, beside that layout rather than
// through it — everything else in that text, the stats and whatever chunk record they carry, is
// passed over untouched.

type Envelope = { state: Record<string, unknown>; version?: number }

// A saved copy's text as an envelope — or null for one that is absent, will not parse, or is not the
// shape persist writes. An unreadable permanent copy gives the session NOTHING: a truncated or
// tampered envelope cannot be trusted to say which numbers are whose.
const readEnvelope = (text: string | null): Envelope | null => {
  if (text === null) return null
  try {
    const envelope: unknown = JSON.parse(text)
    if (!envelope || typeof envelope !== 'object') return null
    const state = (envelope as { state?: unknown }).state
    return state && typeof state === 'object' && !Array.isArray(state)
      ? (envelope as Envelope)
      : null
  } catch {
    return null
  }
}

export const presetStatsStorage = <S>(): PersistStorage<S> | undefined => {
  // ⚠ EAGER, for the reason the windows-in-sync door opens its storage in a try: a browser that
  // throws on the localStorage property access must be found out HERE, so the store lands on persist's
  // in-memory-only path (no storage at all), rather than inside every getItem/setItem — i.e. inside
  // hydration and inside every setState. sessionStorage is opened after it, guarded, because it is
  // allowed to be missing on its own.
  let ls: Storage
  try {
    ls = window.localStorage
  } catch {
    return undefined
  }
  const ss = openSessionStorage()
  const codec = createProgressCodec<S>()
  // Resolved per call, never captured: the active preset and its value both change under a live
  // store, and the whole point of an adapter (rather than a swapped persist `name`) is that there is
  // no window in which it is pointed at one preset while holding another's.
  const target = () => {
    const presetId = usePresets.getState().activeId
    return { presetId, mode: amnesicModeOf(presetId) }
  }

  // ★ WHAT THE STORE WAS HANDED FROM A PERMANENT COPY'S KEPT KEYS, AND WHAT IT HAS DONE TO THEM SINCE
  // — the guard on writeKept, and its memory. The kept maps in memory may be written back only when
  // they are known to have STARTED as that permanent copy's: `presetId` says whose, and `readable`
  // that the copy could be read (or was absent). The rest is what lets a save tell its own changes
  // from everybody else's:
  //   `base`  each kept map as the permanent copy held it when this page loaded it;
  //   `maps`  the store's map objects as they stood at the last save, so a save that did not touch
  //           them is recognised by identity;
  //   `mine`  per map, the records THIS PAGE has changed since it loaded, each with the value it
  //           last saved for it (`undefined`: it took the record away);
  //   `text`  the permanent copy's text as this page last read or wrote it.
  type Maps = Partial<Record<ProgressKey, unknown>>
  let handed: {
    presetId: number
    readable: boolean
    base: Maps
    maps: Maps
    mine: Partial<Record<ProgressKey, Map<string, unknown>>>
    text: string | null
  } | null = null
  const records = (map: unknown): Record<string, unknown> => (isRecord(map) ? map : {})

  // Save the kept maps into one preset's permanent main key — and nothing else into it.
  // ★ READ, LAY THIS PAGE'S OWN CHANGES OVER IT, WRITE BACK. The text is read as it stands NOW (a
  // save the device refused included, store/storageHealth), so whatever the permanent copy holds
  // besides the kept maps — its stats, with every solve time and any sealed-chunk record, and its
  // version stamp — goes back exactly as it came, whoever wrote it last. Nothing from the session
  // can be in what is written: this function is never given the session's stats.
  // ★ RECORD BY RECORD, NOT MAP BY MAP — because the permanent copy has other writers: another tab
  // on Off saves the WHOLE copy, from the Best maps it loaded, on every answer. For each record:
  //   • one this page has JUST changed (it differs from what the page held at its last save) is
  //     written — the newest save wins, as it does everywhere;
  //   • one this page set EARLIER, where the copy now holds a different record for the same set-up,
  //     is the BETTER of the two (BETTER, above) — whoever wrote the other and whenever. So a save
  //     that never knew of this page's Best and put the older record back does not cost it, and
  //     neither does a worse record another tab earned afterwards; a better one of theirs stands;
  //   • one this page set earlier that the copy NO LONGER HOLDS AT ALL is not put back, and this
  //     page stops claiming it. A record that is gone was reset — in another tab, by a Full Reset
  //     there, by the preset being deleted there — and bringing it back would undo something the
  //     player did on purpose. ⚠ The cost, accepted: a save that never knew of a set-up's FIRST Best
  //     (there was no record before it) also leaves no record, and cannot be told from a reset by
  //     anything the copy holds — so that Best is kept only until this page is closed, unless it is
  //     beaten again here;
  //   • one this page TOOK AWAY earlier is taken away again if the copy has gone back to exactly
  //     what it held when this page loaded — a save that never knew of the removal;
  //   • every other record is the copy's own, passed through.
  // ⚠ FOUR WAYS IT WRITES NOTHING:
  //   • the store's kept maps did not start as this copy's (`handed`) — a new best must never replace
  //     records this page has not read;
  //   • the permanent copy cannot be read — it is left exactly as it is, as the load left it, and the
  //     bests of this session last only as long as the page (reported, not hidden);
  //   • the copy already says what the rules above come to. Most saves are a stat moving with the
  //     copy untouched since this page last looked, and those cost one comparison of its text;
  //   • the preset is no longer in the registry on the device: another tab deleted it, and a write
  //     — even of a Best set this minute — would bring its key back with nothing to own it.
  const writeKept = (
    presetId: number,
    keys: readonly Exclude<ProgressKey, 'stats'>[],
    state: Record<string, unknown>,
    version: number | undefined,
  ) => {
    if (!handed || handed.presetId !== presetId || !handed.readable) return
    const text = readItem(ls, mainKeyOf(presetId))
    if (text === handed.text && keys.every((key) => state[key] === handed!.maps[key])) return
    const parked = readEnvelope(text)
    if (text !== null && !parked) {
      handed.readable = false
      captureError(new Error('Saved progress: the permanent copy became unreadable'), {
        tripwire: 'progressKept',
      })
      return
    }
    handed.text = text
    const kept: Record<string, unknown> = {}
    let changed = false
    for (const key of keys) {
      const now = records(state[key])
      const was = records(handed.maps[key])
      const base = records(handed.base[key])
      const theirs = records(parked?.state[key])
      const mine = (handed.mine[key] ??= new Map())
      for (const id of new Set([...Object.keys(now), ...Object.keys(was)]))
        if (!sameJson(now[id], was[id])) mine.set(id, now[id]) // changed by this page, just now
      handed.maps[key] = state[key]
      const out = { ...theirs }
      for (const [id, value] of mine) {
        let next = value
        if (sameJson(value, was[id])) {
          // Changed earlier, not in this very save.
          if (theirs[id] === undefined) {
            mine.delete(id) // gone from the copy: reset there, and no longer this page's to assert
            continue
          }
          if (value !== undefined) next = BETTER[key](theirs[id], value)
          else if (!sameJson(theirs[id], base[id])) continue // a record set since the removal
        }
        if (sameJson(theirs[id], next)) continue
        if (next === undefined) delete out[id]
        else out[id] = next
        changed = true
      }
      kept[key] = out
    }
    if (!changed) return
    const listed = readStoredRegistry()?.presets.some((preset) => preset.id === presetId)
    if (!(listed ?? presetId === FIRST_PRESET_ID)) return
    handed.text = JSON.stringify(
      parked ? { ...parked, state: { ...parked.state, ...kept } } : { state: kept, version },
    )
    writeItem(ls, mainKeyOf(presetId), handed.text)
  }

  return {
    // Every access goes through store/storageHealth, in BOTH areas: sessionStorage has an allowance
    // of its own, and a refusal there is the same promise broken — the guest's session stops being
    // kept. A refused save is held for the exact (area, key) it was for, so the two copies stay
    // apart even while neither can be written: the permanent copy's held value can only ever be
    // read back as, and retried to, the permanent copy.
    getItem: () => {
      const { presetId, mode } = target()
      handed = null
      if (mode === 'off') return codec.load({ area: ls, presetId })
      // ★ THE STORE'S VALUE IS COMPOSED, KEY BY KEY: what this value CLEARS comes from the session
      // copy — or is simply absent until the session has saved something, and an absent key is what
      // store/presets' mergeOverDefaults turns into the factory value: "the session starts at ZERO",
      // expressed as data rather than as a wipe — and what it KEEPS comes from the permanent copy.
      // ⚠ IT IS A PURE DERIVATION AND WRITES NOTHING. The permanent main key is read and never
      // written here; an amnesic preset can SEE its permanent payload (that is how the kept keys get
      // their values) and this function cannot alter it.
      // A session copy that will not load is a session that starts again — and it must not take the
      // kept maps down with it: a failed load here would leave the store on its factory values, and
      // the next best would then be written over the permanent records as if there had been none.
      let session: Envelope | null = null
      try {
        session = ss && (codec.load({ area: ss, presetId }) as Envelope | null)
      } catch (e) {
        captureError(e instanceof Error ? e : new Error(String(e)), { tripwire: 'progressSession' })
      }
      const keep = keptKeys(mode)
      const text = keep.length ? readItem(ls, mainKeyOf(presetId)) : null
      const parked = readEnvelope(text)
      handed = {
        presetId,
        readable: text === null || parked !== null,
        base: {},
        maps: {},
        mine: {},
        text,
      }
      const state: Record<string, unknown> = {}
      for (const key of AMNESIC_CLEARS[mode])
        if (session && key in session.state) state[key] = session.state[key]
      for (const key of keep)
        if (parked && key in parked.state)
          handed.base[key] = handed.maps[key] = state[key] = parked.state[key]
      if (Object.keys(state).length === 0) return null
      // The version stamp is the copy's whose shape a migration could still have to rewrite — the
      // permanent one when it supplied the Best maps (store/progress' `migrate` rewrites nothing
      // else), the session's otherwise.
      const version = keep.some((key) => key in state) ? parked!.version : session?.version
      return { state, version } as StorageValue<S>
    },
    setItem: (_name, value) => {
      const { presetId, mode } = target()
      if (mode === 'off') return codec.save({ area: ls, presetId }, value)
      const state = value.state as Record<string, unknown>
      const cleared = Object.fromEntries(
        AMNESIC_CLEARS[mode].filter((key) => key in state).map((key) => [key, state[key]]),
      )
      if (ss) codec.save({ area: ss, presetId }, { ...value, state: cleared } as StorageValue<S>)
      const keep = keptKeys(mode)
      if (keep.length) writeKept(presetId, keep, state, value.version)
    },
    removeItem: () => {
      const { presetId, mode } = target()
      if (mode === 'off') removeProgressCopy({ area: ls, presetId })
      else if (ss) removeProgressCopy({ area: ss, presetId })
    },
  }
}
