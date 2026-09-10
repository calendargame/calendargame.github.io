// store/sessionRound.ts — an ENDED timed round/run, per (preset, mode), for THIS browsing session
// only (round-21 Q11).
//
// THE PROBLEM. A preset switch bumps every mode screen's remount key (src/main.tsx's
// remountScreens, fired from the registry subscription), unmounting and remounting the six
// always-mounted screens so their engine + component state re-hydrates from the INCOMING preset's
// stores — the mechanism that stops one preset's stats leaking into another (store/presetControl's
// switchPreset argues the "500-cards-becomes-4" bug in full). That remount is load-bearing and is
// NOT touched here. Its side effect, before Q11, was that an ENDED Blitz round / MoX run — which
// used to survive a detour into another mode (BlitzMode/AoxMode only reset an ACTIVE round when
// hidden, never an ended one) — was thrown away by a preset ROUND-TRIP too. The owner wants an
// ended round to behave the same across a preset switch as across a mode detour: only a manual
// Reset or a full app close clears it.
//
// THE FIX, and why it does not go near the remount. Each of BlitzMode/AoxMode mirrors its ended
// round to sessionStorage here, keyed by the ACTIVE preset's id and the mode, exactly as it already
// mirrors its lifetime stats to store/progress. On mount (including the remount a switch causes) it
// reads the key for the NOW-ACTIVE preset and, if an ended round is parked there, restores it as
// the engine's initial reducer state plus the handful of component fields the completed view needs.
//   • Keyed by PRESET ID, so the blob a switch restores is always the incoming preset's OWN round,
//     never the one you just left — cross-preset contamination is impossible by construction, the
//     same property store/amnesic's presetStatsStorage relies on. An Amnesic toggle keeps the same
//     preset id, so it naturally preserves the round too, which is correct.
//   • ONLY ENDED rounds are parked. An in-progress round is never written, so a preset switch mid
//     round restores nothing and the round is discarded — the owner's requirement.
//   • sessionStorage, so a full app close clears the lot (the browser does it; nothing here
//     schedules a wipe) and a reload keeps it — the same lifetime store/amnesic and store/sessionMode
//     use.
//   • A manual Reset takes the round to idle, at which point the mode's mirror effect deletes the
//     key (discardSessionRound). Full Reset remounts every screen AND resetProgress/resetModePrefs
//     run first, so the restored blob is stale-keyed and a fresh screen ignores it; the mode also
//     discards on idle. discardSessionRounds clears every mode for a preset when the preset is
//     deleted (store/presetControl's clearPresetStorage).
//
// ONE JSON BLOB under one key, a map of "<presetId>:<mode>" → snapshot. The snapshot shape is the
// mode component's business (it round-trips its own engine state + flags); this module only reads
// and writes it and never inspects it. Every access is try/catch-wrapped — sessionStorage throws on
// the property access under locked-down browsing, and a round that cannot be parked just behaves the
// way it did before Q11 (gone on the switch), which never breaks a render.

const KEY = 'cg-round-v1'
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
    /* storage refused — the round only ever lived in memory, i.e. it behaves as it did pre-Q11 */
  }
}

/** The parked ended round for this (preset, mode), or null when there is none. */
export const readSessionRound = <T>(presetId: number, mode: RoundMode): T | null => {
  const v = read()[slot(presetId, mode)]
  return v == null ? null : (v as T)
}

/** Park this (preset, mode)'s ended round. Called from the mode's mirror effect while it is ended. */
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

/** Forget every parked round for one preset — called when the preset is deleted. */
export const discardSessionRounds = (presetId: number): void => {
  const store = read()
  let changed = false
  for (const k of Object.keys(store))
    if (k.startsWith(`${presetId}:`)) {
      delete store[k]
      changed = true
    }
  if (changed) write(store)
}

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
