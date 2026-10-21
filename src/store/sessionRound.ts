// store/sessionRound.ts — an ENDED timed round/run, per (preset, mode), for THIS browsing session only.
//
// THE PROBLEM. A preset switch bumps every mode screen's remount key (src/main.tsx's
// remountScreens, fired from the registry subscription), unmounting and remounting the five
// always-mounted mode screens so their engine + component state re-hydrates from the INCOMING preset's
// stores — the mechanism that stops one preset's stats leaking into another (store/presetControl's
// switchPreset argues the "500-cards-becomes-4" bug in full). That remount is load-bearing and is
// NOT touched here. Its side effect, before this file, was that an ENDED Blitz round / MoX run — which
// used to survive a detour into another mode (BlitzMode/AoxMode only reset an ACTIVE round when
// hidden, never an ended one) — was thrown away by a preset ROUND-TRIP too. The owner wants an
// ended round to behave the same across a preset switch as across a mode detour: only a manual
// Reset or a full app close clears it.
//
// THE FIX, and why it does not go near the remount. Each of BlitzMode/AoxMode mirrors its ended
// round to sessionStorage here, keyed by its preset and the mode, exactly as it already files its
// result on its Best record. On mount (including the remount a switch causes) it reads the key for
// the preset NOW underneath it and, if an ended round is parked there, restores it as the engine's
// initial reducer state plus the handful of component fields the completed view needs.
//   ★ KEYED BY PRESET: a switch restores the incoming preset's own round, never the one you just left.
//     A preset has one pool of Bests whatever its Amnesic value (store/amnesic), so there is one round
//     per preset.
//   • ONLY ENDED rounds are parked. An in-progress round is never written, so a preset switch mid
//     round restores nothing and the round is discarded — the owner's requirement.
//   • sessionStorage, so a full app close clears the lot (the browser does it; nothing here
//     schedules a wipe) and a reload keeps it — the owner's rule that a reload is the SAME session
//     (store/browsingSession). A window that rejoins after the app closed and opened again elsewhere
//     drops it (store/amnesicClose: the session it belonged to has ended).
//   • A manual Reset takes the round to idle, at which point the mode's park effect deletes the
//     key (store/screenPool's unparkRound — every screen's write and discard of a slot goes through
//     that door, which refuses one named with a preset that is no longer live). Full Reset clears the
//     preset's rounds itself BEFORE its remount (src/main.tsx — the remounted screens would otherwise
//     read the parked blob back), and discardSessionRounds does the same when a preset is deleted
//     (store/presetControl's clearPresetStorage).
//   • A screen that CRASHES drops the round parked for the preset it is on (src/main.tsx, through its
//     error boundary) — the crashed screen's own mirror effect is gone, and a round that broke its
//     screen once must not be restored into it again by the error card's Reload.
//   • A PARKED ROUND CARRIES THE CONFIGURATION IT WAS PLAYED UNDER, and the mode restores it only
//     over exactly that configuration (modes/BlitzMode's roundConfig, modes/AoxMode's RunConfig): a
//     round reconciled against settings it was never played on changed real bests.
//
// ONE JSON BLOB under one key, a map of "<presetId>:<mode>" (e.g. "1:blitz") → snapshot. The snapshot
// shape is the mode component's business (it round-trips its own engine state + flags); this module only
// reads and writes it and never inspects it. Every access is try/catch-wrapped — sessionStorage throws on
// the property access under locked-down browsing, and a round that cannot be parked is simply gone on the
// switch, which never breaks a render.
// ⚠ THE KEY IS `cg-round-v3`. v2 keyed "<presetId>:<copy>:<mode>", one per copy of a preset's Bests while
// Amnesic: Full kept its own; the copies are gone, so a v2 blob is not read at all. The cost is bounded and
// one-off, as v1's was: an ended round on screen at the moment the update reload lands is not restored (its
// Bests were filed when it ended). The older blobs are not deleted either: the other site on this shared
// origin may still be an older build using them, and the browser drops them at the session's end anyway.

const KEY = 'cg-round-v3'
type RoundMode = 'blitz' | 'aox'
type Store = Record<string, unknown>

const slot = (presetId: number, mode: RoundMode) => `${presetId}:${mode}`

const read = (): Store => {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Store) : {}
  } catch {
    return {}
  }
}

const write = (store: Store): void => {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    /* storage refused — the round only ever lived in memory, and is gone on the next remount */
  }
}

/** Forget every parked round for one preset — called when the preset is deleted. */
export const discardSessionRounds = (presetId: number): void => {
  // (the trailing `:` is load-bearing: without it preset 1 would claim preset 11's slots)
  const prefix = `${presetId}:`
  const store = read()
  let changed = false
  for (const k of Object.keys(store))
    if (k.startsWith(prefix)) {
      delete store[k]
      changed = true
    }
  if (changed) write(store)
}

/**
 * A snapshot as it comes OUT of storage: the mode's own shape, except that its `engine` is whatever
 * JSON the build that parked it wrote — this build's, an older one's, or one this build has never
 * seen (a tab keeps its session across an update) — until the mode has put it through
 * engine/parkedEngine's restoreParkedEngine.
 */
export type ParkedSnapshot<T extends { engine: unknown }> = Omit<T, 'engine'> & { engine: unknown }

/** The parked ended round for this (preset, mode), or null when there is none. */
export const readSessionRound = <T>(presetId: number, mode: RoundMode): T | null => {
  const v = read()[slot(presetId, mode)]
  return v == null ? null : (v as T)
}

/** Park this (preset, mode)'s ended round — for a screen, only through store/screenPool's parkRound. */
export const writeSessionRound = (presetId: number, mode: RoundMode, snapshot: unknown): void => {
  const store = read()
  store[slot(presetId, mode)] = snapshot
  write(store)
}

/** Forget this (preset, mode)'s parked round — the mode calls it the moment the round goes idle. */
export const discardSessionRound = (presetId: number, mode: RoundMode): void => {
  const store = read()
  const k = slot(presetId, mode)
  if (!(k in store)) return
  delete store[k]
  write(store)
}

/**
 * Does this preset have ANY parked ended round this session? store/presetControl's isPresetFactory is
 * the caller: a parked ended round is a RESULT the player can still see, so a preset holding one is
 * not factory-fresh and its delete still asks first.
 */
export const hasSessionRound = (presetId: number): boolean =>
  Object.keys(read()).some((k) => k.startsWith(`${presetId}:`))

/**
 * Forget every parked round, all presets: a window that comes back to a session that has ended
 * (store/amnesicClose). A full close clears them with the browsing session; the test harness, which has
 * no close, calls it before every test (tests/setup/dom.js).
 */
export const discardAllSessionRounds = (): void => {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    /* storage refused — nothing was ever written */
  }
}
