import { DEFAULT_MODE_VALUES } from './settings.js'
import type { DefaultMode } from './settings.js'

// store/sessionMode.ts — the CURRENT PAGE, per preset, for THIS browsing session only (round-21 Q3).
//
// WHAT IT IS. src/main.tsx's `mode` was `useState("classic")` — app-global, not persisted, not
// per-preset. Q3 makes "which page you are on" a per-preset fact with the SAME lifetime Amnesic's
// session stats already use: it survives a reload, and a full app close throws it away.
//   • On a COLD OPEN (no session entry for a preset) that preset opens on its `defaultMode` ⚙
//     setting (store/settings, read via readStoredDefaultMode).
//   • On a page change, the active preset's session page is written here.
//   • On a preset switch, the incoming preset shows its session page if it has one THIS session,
//     else its `defaultMode`.
// So: cold open → go to preset 2 → preset 2's default page; then, still in the session, switch away
// and back → preset 2's LAST page; next cold open → back to the default.
//
// WHY sessionStorage AND NOT a zustand store. It is a tiny key→value map with no reactivity needs
// (main.tsx reads it once per switch and once at boot, and writes it from switchMode), and
// sessionStorage IS the "gone on a full close, kept across a reload" lifetime — exactly what
// store/amnesic reaches for. A store would add a persist adapter and a subscription for nothing.
//
// KEYED BY PRESET ID in ONE JSON blob under a single key, so "forget this preset" is one delete of
// one entry and "forget everything" is the browser closing the session. A deleted preset's entry
// is cleared by store/presetControl's clearPresetStorage (ids are never reused, so a leftover entry
// is harmless, but "remove exactly its keys" is a house rule).
//
// ⚠ EVERY ACCESS IS try/catch-WRAPPED. sessionStorage throws on the property access in locked-down
// browsing (iOS "Block All Cookies", some private modes); a page-memory that cannot be written just
// means every cold open uses `defaultMode`, which is a fine degradation and never breaks a render.

const KEY = 'cg-session-mode-v1'

type PageMap = Record<string, DefaultMode>

const isMode = (v: unknown): v is DefaultMode =>
  typeof v === 'string' && (DEFAULT_MODE_VALUES as readonly string[]).includes(v)

const read = (): PageMap => {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: PageMap = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>))
      if (isMode(v)) out[k] = v
    return out
  } catch {
    return {}
  }
}

const write = (blob: PageMap): void => {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(blob))
  } catch {
    /* storage refused — the session page only ever lived in memory, which is more amnesic, not less */
  }
}

/** This preset's page for the current session, or null when it has none (a cold open). */
export const readSessionMode = (presetId: number): DefaultMode | null =>
  read()[String(presetId)] ?? null

/** Record this preset's current page. Called by src/main.tsx's switchMode — the one door. */
export const writeSessionMode = (presetId: number, mode: DefaultMode): void => {
  const blob = read()
  if (blob[String(presetId)] === mode) return
  blob[String(presetId)] = mode
  write(blob)
}

/** Forget one preset's session page — called only when the preset is deleted. */
export const discardSessionMode = (presetId: number): void => {
  const blob = read()
  if (!(String(presetId) in blob)) return
  delete blob[String(presetId)]
  write(blob)
}

/**
 * Forget every preset's session page in one go. The app never needs this — a full close is what
 * clears the whole session, and the browser does that — but the test harness has no "close the
 * browser" event, so tests/setup/dom.js calls it before every test to stop one test's page choice
 * leaking into the next (the same reason it resets the progress / mode-prefs / lookup singletons).
 */
export const discardAllSessionModes = (): void => {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    /* storage refused — nothing was ever written */
  }
}
