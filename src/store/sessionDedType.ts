// store/sessionDedType.ts — THE DEDUCTION SUB-TYPE IN FORCE IN THIS WINDOW, per preset (design-q1-q2.md v4,
// 6.7; reviewer B's V6, decided).
//
// WHY PER WINDOW. The sub-type (Day / Month / Year) is a per-mode choice saved with the preset's setup
// (store/modePrefs' `dedType`), and the windows-in-sync door shares that between every window of the
// app. But the sub-type on screen is where the player IS, the way the page they are on is: two windows
// of one preset, one on Day and one on Year, must not pull each other across. So the sub-type in force
// is the WINDOW's, kept where the page is kept (store/sessionMode) - sessionStorage, which a reload keeps
// and a real close clears - and the shared choice is only where a window STARTS:
//   • a choice made here writes both: this window's sub-type, and the shared one;
//   • another window's choice changes the shared one only - nothing moves on screen here;
//   • a fresh open, or a window whose session holds none for the preset, starts from the shared one -
//     the last one chosen anywhere - and holds it from then on.
//
// ONE SMALL JSON VALUE under one key - preset id -> sub-type - read and written whole, guarded: a browser
// that refuses sessionStorage holds the sub-type for the screen's life only, and its next load starts
// from the shared choice, which is a fine degradation and never breaks a render.

const KEY = 'cg-session-dedtype-v1'

type TypeMap = Record<string, string>
const SUB_TYPES = ['day', 'month', 'year']

const read = (): TypeMap => {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: TypeMap = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>))
      if (typeof v === 'string' && SUB_TYPES.includes(v)) out[k] = v
    return out
  } catch {
    return {}
  }
}

const write = (blob: TypeMap): void => {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(blob))
  } catch {
    /* storage refused — the sub-type lives with the screen */
  }
}

/** This window's sub-type for the preset this session, or null when it holds none. */
export const readSessionDedType = (presetId: number): string | null =>
  read()[String(presetId)] ?? null

/** Record this window's sub-type for the preset. */
export const writeSessionDedType = (presetId: number, dedType: string): void => {
  const blob = read()
  if (blob[String(presetId)] === dedType) return
  blob[String(presetId)] = dedType
  write(blob)
}

/** Forget one preset's sub-type — called when the preset is deleted. */
export const discardSessionDedType = (presetId: number): void => {
  const blob = read()
  if (!(String(presetId) in blob)) return
  delete blob[String(presetId)]
  write(blob)
}

/**
 * Forget every preset's sub-type in one go. The app never needs this — a full close is what clears the
 * whole session — but the test harness has no "close the browser" event (tests/setup/dom.js).
 */
export const discardAllSessionDedTypes = (): void => {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    /* storage refused — nothing was ever written */
  }
}
