// store/sessionRound.ts — an ENDED timed round/run, per (stats copy, mode), for THIS browsing session
// only.
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
// round to sessionStorage here, keyed by the STATS COPY it was played on and the mode, exactly as it
// already mirrors its lifetime stats to store/progress. On mount (including the remount a switch
// causes) it reads the key for the copy NOW underneath it and, if an ended round is parked there,
// restores it as the engine's initial reducer state plus the handful of component fields the
// completed view needs.
//   ★★ KEYED BY THE STATS COPY — store/amnesic's `activeDataId`, "<presetId>:saved" or
//     "<presetId>:session" — NOT by the preset alone. A parked round carries its Best
//     floor and its round id, and the mount that restores it reconciles it into whatever Best records
//     are live; so a round must only ever come back against the copy it was PLAYED on. Keyed by preset
//     alone, turning Amnesic off restored the GUEST'S round over the permanent stats and reconciled it
//     into them — replacing, lowering or erasing real bests (reproduced; tests/amnesicRound.dom) — and
//     turning it on copied your round into the fresh guest copy. Keyed by copy, both are unreachable by
//     construction, the same property that already stops one preset's round reaching another:
//       • a switch restores the incoming preset's own copy's round, never the one you just left;
//       • an Amnesic toggle restores the round of the copy that is now live: your own round, hidden
//         for the guest's interlude, comes back exactly as you left it (the owner's "within one
//         session everything comes back"), and the guest never sees it.
//   • THE SESSION SLOT SHARES THE SESSION STATS' LIFETIME. store/presetControl's setPresetAmnesic
//     discards a preset's session stats on every toggle, so it discards that preset's session-copy
//     rounds in the same breath (discardSessionRoundsOf) — a guest round must not outlive the guest
//     stats it was scored against, and a fresh guest start must not find the last guest's round.
//   • ONLY ENDED rounds are parked. An in-progress round is never written, so a preset switch mid
//     round restores nothing and the round is discarded — the owner's requirement.
//   • sessionStorage, so a full app close clears the lot (the browser does it; nothing here
//     schedules a wipe) and a reload keeps it — the same lifetime store/amnesic and store/sessionMode
//     use, and the owner's rule that a reload is the SAME session (store/browsingSession).
//   • A manual Reset takes the round to idle, at which point the mode's mirror effect deletes the
//     key (discardSessionRound). Full Reset clears the preset's rounds itself, both copies', BEFORE
//     its remount (src/main.tsx — the remounted screens would otherwise read the parked blob back),
//     and discardSessionRounds does the same when a preset is deleted (store/presetControl's
//     clearPresetStorage).
//   • A screen that CRASHES drops the round parked for the copy it is on (src/main.tsx, through its
//     error boundary) — the crashed screen's own mirror effect is gone, and a round that broke its
//     screen once must not be restored into it again by the error card's Reload.
//   • A PARKED ROUND CARRIES THE CONFIGURATION IT WAS PLAYED UNDER, and the mode restores it only
//     over exactly that configuration (modes/BlitzMode's roundConfig, modes/AoxMode's RunConfig):
//     the settings are shared by a preset's two copies, so a guest can change them under a parked
//     round, and a round reconciled against settings it was never played on changed real bests.
//
// ONE JSON BLOB under one key, a map of "<dataId>:<mode>" (e.g. "1:saved:blitz") → snapshot. The
// snapshot shape is the mode component's business (it round-trips its own engine state + flags); this
// module only reads and writes it and never inspects it. Every access is try/catch-wrapped —
// sessionStorage throws on the property access under locked-down browsing, and a round that cannot be
// parked is simply gone on the switch, which never breaks a render.
// ⚠ THE KEY IS `cg-round-v2`. v1 keyed "<presetId>:<mode>" and cannot say which copy a round was
// played on — which is the very fact whose absence was the bug — so a v1 blob is not read at all
// rather than guessed at. The cost is bounded and one-off: an ended round on screen at the moment the
// update reload lands is not restored (its Bests were saved when it ended). The v1 blob is not
// deleted either: the other site on this shared origin may still be an older build using it, and the
// browser drops it at the session's end anyway.

const KEY = 'cg-round-v2'
type RoundMode = 'blitz' | 'aox'
type Store = Record<string, unknown>

const slot = (dataId: string, mode: RoundMode) => `${dataId}:${mode}`

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

// Remove every slot whose key starts with `prefix` — the one scan both prefix discards share.
// (The trailing `:` every caller's prefix ends in is load-bearing: without it preset 1 would claim
// preset 11's slots.)
const discardPrefixed = (prefix: string): void => {
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
 * seen (live and staging share the origin) — until the mode has put it through
 * engine/parkedEngine's restoreParkedEngine.
 */
export type ParkedSnapshot<T extends { engine: unknown }> = Omit<T, 'engine'> & { engine: unknown }

/** The parked ended round for this (stats copy, mode), or null when there is none. */
export const readSessionRound = <T>(dataId: string, mode: RoundMode): T | null => {
  const v = read()[slot(dataId, mode)]
  return v == null ? null : (v as T)
}

/** Park this (stats copy, mode)'s ended round. Called from the mode's mirror effect while it is ended. */
export const writeSessionRound = (dataId: string, mode: RoundMode, snapshot: unknown): void => {
  const store = read()
  store[slot(dataId, mode)] = snapshot
  write(store)
}

/** Forget this (stats copy, mode)'s parked round — the mode calls it the moment the round goes idle. */
export const discardSessionRound = (dataId: string, mode: RoundMode): void => {
  const store = read()
  const k = slot(dataId, mode)
  if (!(k in store)) return
  delete store[k]
  write(store)
}

/**
 * Does this preset have ANY parked ended round this session, on either of its stats copies? A round
 * on the copy that is not live right now counts too: it comes back the moment that copy is live again,
 * so it is still a result the player can see.
 *
 * store/presetControl's isPresetFactory is the caller: a parked ended round is a RESULT the player
 * can still see, so a preset holding one is not factory-fresh and its delete still asks first.
 */
export const hasSessionRound = (presetId: number): boolean =>
  Object.keys(read()).some((k) => k.startsWith(`${presetId}:`))

/** Forget every parked round of ONE stats copy — setPresetAmnesic, for the session copy. */
export const discardSessionRoundsOf = (dataId: string): void => discardPrefixed(`${dataId}:`)

/** Forget every parked round for one preset, both copies — called when the preset is deleted. */
export const discardSessionRounds = (presetId: number): void => discardPrefixed(`${presetId}:`)

/**
 * Forget every parked round, all presets. The app never needs this — a full close clears the
 * session and the browser does that — but the test harness has no "close the browser" event, so
 * tests/setup/dom.js calls it before every test (the same reason it resets the progress /
 * mode-prefs / lookup / session-page singletons).
 */
export const discardAllSessionRounds = (): void => {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    /* storage refused — nothing was ever written */
  }
}
