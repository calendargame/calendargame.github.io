// store/sessionLookup.ts — what is ON SCREEN in Lookup, kept across a RELOAD.
//
// THE OWNER'S RULE (store/browsingSession): "only truly closing the app starts fresh." Lookup's
// HISTORY LIST is saved for good (store/lookupHistory). What the player had on the screen above it —
// the text in the date box, the answer or message being shown, which history row is selected, and
// whether Show Codes is open — was plain App state, so a reload (pull-to-refresh, the app's own
// update reload) emptied the box and closed the codes under them. This keeps those values for the
// browsing session; a real close clears them (the browser drops sessionStorage).
//
// ★ IT BELONGS TO THE APP, NOT TO A PRESET. The history list is shared by every preset, so what is
// selected in it — and the box, the answer and the codes that follow from the selection — is too:
// a preset switch, an Amnesic toggle and deleting the preset you are on all leave it exactly as it
// was. What a preset CAN change under it is the Date Format the box is typed in, which is why the
// format the text was written in is kept beside it (`format`): components/LookupCard compares that
// with the live one and applies its one format-change rule, whether the format changed with the
// card on screen or while it was away.
//
// ★ WRITTEN ON EVERY CHANGE, NOT WHEN THE PAGE HIDES. The whole value is a few dozen characters, so
// there is nothing to save by waiting — and writing as it changes means it does not depend on the
// page being told it is going away. (The casual modes' histories and the guide's place do wait for
// that, because theirs are large or change every frame: store/sessionHistory, store/sessionGuide.)
// src/main.tsx owns the values and mirrors them here in one effect; so the two things that reset
// them — Clear and Full Reset — clear this with them, with nothing to remember.
//
// ONE SMALL JSON VALUE under one key; `cg-lookup-screen-v1` is new, so no older build on this shared
// origin reads it. It is read back through a full shape check: anything unreadable — a build this
// one has never seen, a hand-edited value — reads as "nothing kept", and Lookup opens empty as it
// always did. (A selected row that is no longer in the history list is dropped by LookupCard's own
// orphaned-selection cleanup; a format this build does not know simply differs from the live one,
// which is the format-change rule's case.) Every access is try/catch-wrapped: locked-down browsing
// throws on the property access, where the screen is simply not kept.
const KEY = 'cg-lookup-screen-v1'

// The date Show Codes explains (the y/m/d a code panel reads — components/MethodBreakdown's CodeDate).
interface ShownDate {
  y: number
  m: number
  d: number
}

export interface LookupScreen {
  input: string //                  the text in the date box
  output: string //                 the message under it (an error, or "" — the answer itself is
  //                                derived from the selected row)
  calcDate: ShownDate | null //     the date Show Codes explains
  selectedId: string | null //      the selected history row
  calcOpen: boolean //              is Show Codes open
  format: string | null //          the Date Format the box's text was written in — null until the
  //                                card has been on screen (there is no text to belong to one)
}

/** Lookup as it launches: nothing typed, nothing shown, nothing selected, the codes closed. */
export const EMPTY_LOOKUP_SCREEN: LookupScreen = {
  input: '',
  output: '',
  calcDate: null,
  selectedId: null,
  calcOpen: false,
  format: null,
}

const isShownDate = (v: unknown): v is ShownDate => {
  if (typeof v !== 'object' || v === null) return false
  const { y, m, d } = v as Record<string, unknown>
  return (
    Number.isInteger(y) &&
    Number.isInteger(m) &&
    Number.isInteger(d) &&
    (m as number) >= 1 &&
    (m as number) <= 12 &&
    (d as number) >= 1 &&
    (d as number) <= 31
  )
}

/** Lookup's screen as the last page left it this session — the launch screen when nothing is kept. */
export function readLookupScreen(): LookupScreen {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (raw === null) return EMPTY_LOOKUP_SCREEN
    const v: unknown = JSON.parse(raw)
    if (typeof v !== 'object' || v === null) return EMPTY_LOOKUP_SCREEN
    const { input, output, calcDate, selectedId, calcOpen, format } = v as Record<string, unknown>
    if (
      typeof input !== 'string' ||
      typeof output !== 'string' ||
      !(calcDate === null || isShownDate(calcDate)) ||
      !(selectedId === null || typeof selectedId === 'string') ||
      typeof calcOpen !== 'boolean' ||
      !(format === null || typeof format === 'string')
    )
      return EMPTY_LOOKUP_SCREEN
    return {
      input,
      output,
      calcDate: calcDate && { y: calcDate.y, m: calcDate.m, d: calcDate.d },
      selectedId,
      calcOpen,
      format,
    }
  } catch {
    return EMPTY_LOOKUP_SCREEN
  }
}

/**
 * Keep Lookup's screen for the reload that may follow. The launch screen keeps nothing — whatever
 * format it was last shown in: with nothing in the box there is no text for a format to belong to.
 */
export function writeLookupScreen(s: LookupScreen): void {
  const launch =
    s.input === '' && s.output === '' && s.calcDate === null && s.selectedId === null && !s.calcOpen
  try {
    if (launch) window.sessionStorage.removeItem(KEY)
    else window.sessionStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    discardLookupScreen() // refused — and an older screen must not come back instead
  }
}

/**
 * Forget Lookup's screen. The app calls it when the Lookup page crashes (so a screen that somehow
 * broke it cannot come back and break it again); tests/setup/dom.js calls it before every test — the
 * harness has no "close the browser" event.
 */
export function discardLookupScreen(): void {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    /* storage refused — nothing was ever written */
  }
}
