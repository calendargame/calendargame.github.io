// lib/modes.ts — THE PAGE LIST: every page the app can show, in the ONE order everything lists
// them in. Adding a page, or moving one, is an edit to PAGES and nothing else.
//
// What derives from it, so that none of them can drift from the others:
//   - the bar's mode menu (PAGE_OPTIONS — main.tsx's mode CustomSelect);
//   - ⚙ → Default Mode's two rows of pills (PRACTICE_MODE_OPTIONS on the first, OTHER_PAGE_OPTIONS
//     on the second — components/SettingsPanel);
//   - the letter-key shortcuts (PAGE_BY_KEY — main.tsx's key handler) and the "Mode Switching"
//     legend that documents them in How to Play;
//   - How to Play's own mode sections (components/GuidePage's MODE_SECTION_BODY), its per-mode
//     bullet lists (ModeItems) and the sentences there that name several modes in a row (modeNames
//     / modeList below) — tests/modeOrder pins the rest of that page's wording to this order;
//   - the saved "which page does this preset open on" value's type and validator (store/settings'
//     DefaultMode and isPageId, used by store/sessionMode too).
//
// A page is always SAVED BY ITS ID, never by its position here, so reordering this list can never
// change what a stored value means. The ids are permanent for the same reason — 'aox' is MoX's,
// kept through the AoX → MoX rename so nobody's saved page or bests moved.
//
// `practice` marks the modes you answer dates in (they own a stats strip and a section under How
// to Play's "Modes" divider); Lookup and How to Play are pages but not practice modes. `key` is the
// letter that opens the page from the keyboard; the letters are part of what players have learned,
// so a reorder never touches them.
export const PAGES = [
  { id: 'classic', label: 'Classic', key: 'K', practice: true },
  { id: 'deduction', label: 'Deduction', key: 'D', practice: true },
  { id: 'flash', label: 'Flash', key: 'F', practice: true },
  { id: 'aox', label: 'MoX', key: 'A', practice: true },
  { id: 'blitz', label: 'Blitz', key: 'B', practice: true },
  { id: 'lookup', label: 'Lookup', key: 'L', practice: false },
  { id: 'guide', label: 'How to Play', key: 'H', practice: false },
] as const satisfies readonly { id: string; label: string; key: string; practice: boolean }[]

export type Page = (typeof PAGES)[number]
export type PageId = Page['id']
export type PracticeModeId = Extract<Page, { practice: true }>['id']
type PracticeMode = Extract<Page, { practice: true }>

const PAGE_IDS: readonly PageId[] = PAGES.map((p) => p.id)
export const isPageId = (v: unknown): v is PageId =>
  typeof v === 'string' && (PAGE_IDS as readonly string[]).includes(v)

export const PRACTICE_MODES: readonly PracticeMode[] = PAGES.filter(
  (p): p is PracticeMode => p.practice,
)
const OTHER_PAGES: readonly Page[] = PAGES.filter((p) => !p.practice)

// { value, label } rows, the shape every picker in the app takes (CustomSelect and PillTray).
const toOption = ({ id, label }: Page): { value: PageId; label: string } => ({ value: id, label })
export const PAGE_OPTIONS = PAGES.map(toOption)
export const PRACTICE_MODE_OPTIONS = PRACTICE_MODES.map(toOption)
export const OTHER_PAGE_OPTIONS = OTHER_PAGES.map(toOption)

// Letter → page, for the key handler. Keyed by the UPPERCASE letter.
export const PAGE_BY_KEY: Readonly<Record<string, Page>> = Object.fromEntries(
  PAGES.map((p) => [p.key, p]),
)

// Several practice modes named in a row, in the list's order whatever order they were asked for.
// How to Play's sentences are built with these two so a reorder re-words them:
//   modeNames('blitz', 'aox')              -> "MoX and Blitz"          (running text)
//   modeNames('flash', 'classic', 'deduction') -> "Classic, Deduction, and Flash" (three or more
//     take the comma before "and" — the app's one rule for a list, tests/oxfordCommaGuard)
//   modeList('flash', 'classic', 'deduction') -> "Classic, Deduction, Flash" (a bracketed list)
const labelsOf = (ids: readonly PracticeModeId[]): string[] =>
  PRACTICE_MODES.filter((m) => ids.includes(m.id)).map((m) => m.label)
export const modeList = (...ids: PracticeModeId[]): string => labelsOf(ids).join(', ')
export function modeNames(...ids: PracticeModeId[]): string {
  const names = labelsOf(ids)
  if (names.length <= 1) return names.join('')
  const last = names[names.length - 1]
  return names.length === 2
    ? `${names[0]} and ${last}`
    : `${names.slice(0, -1).join(', ')}, and ${last}`
}
