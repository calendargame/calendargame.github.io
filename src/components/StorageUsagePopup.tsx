import Popup from './Popup.js'
import { MODAL_PLAIN_CARD_CLASS } from './modalContract.js'
import {
  percentSpoken,
  percentText,
  suggestShorterNames,
  usageRowsShown,
  useStorageUsage,
} from '../store/storageUsage.js'
import type { UsageRow } from '../store/storageUsage.js'
import { usePresets } from '../store/presets.js'
import type { Preset } from '../store/presets.js'
import { modeNames } from '../lib/modes.js'
import QuotedName from './QuotedName.jsx'

// StorageUsagePopup — what is using the device's room for this app, and how to get some back.
//
// One popup, two ways in: the "Storage used: N.N%" line in ⚙ opens it, and it opens BY ITSELF once
// when the reading first passes the warning line (store/storageUsage decides when, and remembers
// that it did). It is the EARLY warning; components/StorageFullNotice is the late one, for a save
// the device has already refused, and takes precedence — this popup does not open by itself while
// that is happening, and if a refusal comes while this one is up the notice opens on top of it.
//
// Rendered once, at App level, and reads its own open flag — the same arrangement as the
// storage-full notice, and for the same reason: it can open from any screen. Through the shared
// Popup shell, so it is a normal stacked popup (Escape, Back, the dim, the keyboard's reach and the
// status-bar strip are the shell's) — and app-wide: no screen or panel owns it, so a mode letter
// under it does nothing (components/overlayStack's isAppWidePopupOpen).

// The saved stats' own names for the things solve times are kept for, in the app's words. Each is
// built from the mode's name in lib/modes — the one place a mode is named — so a rename there
// renames it here.
const TIMES_OWNER: Record<string, string> = {
  classic: modeNames('classic'),
  flash: modeNames('flash'),
  dedDay: `${modeNames('deduction')} (Day)`,
  dedMonth: `${modeNames('deduction')} (Month)`,
  dedYear: `${modeNames('deduction')} (Year)`,
}

const count = (n: number): string => n.toLocaleString('en-US')

// A row's name, in the words the app uses for the thing. A preset is named only when there is more
// than one to tell apart; one that is no longer in the list is said to be so. The name is QUOTED
// (components/QuotedName): a very long one is its start and an ellipsis, so a row stays a few lines.
// A preset's row that holds its name too (store/storageUsage's usageRowsShown, when the names have no
// row of their own) says so.
function RowLabel({ row, presets }: { row: UsageRow; presets: Preset[] }) {
  if (row.kind === 'lookup') return `Lookup history (${count(row.count)})`
  if (row.kind === 'names') return 'Preset names'
  if (row.kind === 'other') return 'Everything else'
  const preset = presets.find((p) => p.id === row.presetId)
  const what =
    row.kind === 'preset'
      ? row.withName
        ? 'Name, Bests, settings, and saved defaults'
        : 'Bests, settings, and saved defaults'
      : `${TIMES_OWNER[row.silo] ?? row.silo} solve times (${count(row.count)})`
  if (!preset) return `A deleted preset: ${what}`
  if (presets.length === 1) return what
  return (
    <>
      <QuotedName name={preset.name} />: {what}
    </>
  )
}

// ★ WHICH OWNERS ARE LISTED BY NAME, AT EVERY SIZE. The list answers "what is using the room", and
// it has to answer it on a device that is nearly empty as well as on one that is nearly full:
//   • every owner holding 1% or more of the room is listed — on a filling device those are the
//     ones worth clearing, and there are never many (at most a hundred, in practice a handful);
//   • and the LARGEST owners are listed whatever they hold, until the list is LISTED_AT_LEAST long.
//     Without that, a device with little on it showed one line — "Everything saved <1%" — which
//     says nothing about what is there; and on a device that could not be measured there is no
//     percentage to sort anything out by at all.
//   • what is left over is one last line, "Everything else": the many small owners a player with
//     several presets has (each preset × each mode), and the app's own few keys, which are nobody's
//     to clear.
//   • an owner with NOTHING in it is never named: a mode nobody has played keeps an empty list of
//     solve times, and "Flash solve times (0)" is a line about nothing, with nothing to clear.
//     store/storageUsage makes no such row (its few characters are counted with their preset, or,
//     for an emptied Lookup history, with "Everything else").
//   • the preset names have a line of their own only beside the advice to shorten them (see that
//     note below); otherwise each preset's name is in its own line.
// Largest first, so the line to act on is the first one read.
const LISTED_AT_LEAST = 5
// One row of "What is using it": its name to the left (wrapping as it must), its figure to the right
// on the FIRST line (items-start), and room above and below for the dividers between rows.
const USAGE_ROW_CLASS = 'flex items-start justify-between gap-3 py-1'

// ONE PERCENTAGE, AS IT IS SHOWN AND AS IT IS SAID — the ⚙ menu's "Storage used" line, this popup's
// title, and every row of its breakdown draw their figure through this, so none of them can show
// one a screen reader stumbles on. `written` is store/storageUsage's own text for the figure
// (percentText). Almost always that is all there is to draw. The one figure with a sign in it,
// "<0.1%", is drawn for the eye and hidden from a screen reader, which is given the store's words
// for it instead (percentSpoken) — in an sr-only span, so nothing on screen moves or changes.
export function StoragePercent({ written }: { written: string }) {
  const spoken = percentSpoken(written)
  if (spoken === null) return written
  return (
    <>
      <span aria-hidden="true">{written}</span>
      <span className="sr-only">{spoken}</span>
    </>
  )
}
export default function StorageUsagePopup() {
  const open = useStorageUsage((s) => s.popupOpen)
  const close = useStorageUsage((s) => s.closePopup)
  const figure = useStorageUsage((s) => s.figure)
  const warning = useStorageUsage((s) => s.warning)
  const rows = useStorageUsage((s) => s.rows)
  const limit = useStorageUsage((s) => s.limit)
  const presets = usePresets((s) => s.presets)
  if (!open) return null
  // The one rule for the names (store/storageUsage's suggestShorterNames): their own row and the
  // advice to shorten them come together, or not at all.
  const namesApart = suggestShorterNames(warning, rows, limit)
  // Each owner's share of the WHOLE allowance, written by the rule the headline is written by
  // (store/storageUsage's percentText): each is cut at its last digit, so together they come to the
  // headline or a little under it, and never to more.
  // ⚠ On a device whose limit could not be measured (store/storageUsage) there is no whole to take
  // a share of: the owners are listed with no figure beside them, and the card says why.
  const measured = limit !== null
  const share = (chars: number) => (measured ? (chars / limit) * 100 : 0)
  const shownRows = usageRowsShown(rows, namesApart)
  const owners: UsageRow[] = shownRows.filter((row) => row.kind !== 'other')
  const listed = owners.filter((row, i) => i < LISTED_AT_LEAST || share(row.chars) >= 1)
  const rest = shownRows
    .filter((row) => !listed.includes(row))
    .reduce((sum, row) => sum + row.chars, 0)
  const shown = (chars: number) =>
    measured ? <StoragePercent written={percentText(chars, limit)} /> : null
  return (
    <Popup id="storage-usage" onDismiss={close} appWide>
      <div
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="storage-usage-title"
        className={MODAL_PLAIN_CARD_CLASS}
      >
        <div id="storage-usage-title" className="text-sm font-semibold text-(--tx-50) tabular-nums">
          Storage used: {figure === null ? 'not measured yet' : <StoragePercent written={figure} />}
        </div>
        <div className="text-xs text-(--tx-200-80) space-y-2">
          <p>
            {warning
              ? 'This device is running out of room for Calendar Game’s saved data. Once it is full, new answers can’t be saved until some room is made.'
              : 'Calendar Game keeps your stats, history, and settings on this device, which gives it a fixed amount of room.'}
          </p>
          {!measured && (
            <p>
              How much room this device gives couldn&apos;t be measured, so there are no percentages
              to show. The app tries again each time it starts, and each time you open ⚙ with no
              flash, run, or round under way.
            </p>
          )}
          <p className="font-semibold text-(--tx-100-90)">What is using it</p>
          {/* ★ ONE ROW, ONE OWNER, AT A GLANCE (Round 27, owner): a hairline in the panel's thin
              divider colour (--thin-bd) BETWEEN rows — none above the first or below the last — so a
              row that wraps still reads as one row; a little padding above and below each row, so
              no text touches a line; and each figure on its row's FIRST line, at the right. No
              bullets here (the list below keeps its own). The lane holds all of it
              (tests/browser/storageBreakdown.browser.ts). */}
          <ul className="divide-y divide-(--thin-bd)">
            {listed.map((row) => (
              <li
                key={`${row.kind}:${'presetId' in row ? row.presetId : ''}:${'silo' in row ? row.silo : ''}`}
                className={USAGE_ROW_CLASS}
              >
                <span className="min-w-0 wrap-anywhere">
                  <RowLabel row={row} presets={presets} />
                </span>
                <span className="tabular-nums whitespace-nowrap">{shown(row.chars)}</span>
              </li>
            ))}
            {rest > 0 && (
              <li className={USAGE_ROW_CLASS}>
                <span>Everything else</span>
                <span className="tabular-nums whitespace-nowrap">{shown(rest)}</span>
              </li>
            )}
          </ul>
          <p className="font-semibold text-(--tx-100-90)">To make room</p>
          {/* ★ SHORTENING PRESET NAMES IS SUGGESTED ONLY WHEN IT WOULD WORK ON ITS OWN — the warning
              is on, and the names hold enough that shortening them alone would end it
              (store/storageUsage's suggestShorterNames — the one rule the storage-full notice asks
              too). A name is normally a few
              characters, and "shorten your names" on a device filled by solve times would be
              advice that cannot help; so it is first in the list when it is the answer, and not
              in it at all otherwise.
              ⚠ IT SAYS THAT AND NOTHING MORE. The condition is about what shortening would DO, not
              about how much the names hold: it is met by two default names on a device a few
              characters over the line. So the line makes the one claim the condition proves —
              "would be enough on its own" — and none about the names being large (it once opened
              "Your preset names are taking up much of this room", which was false there). How
              much they hold is the "Preset names" row above, in its own figure — a row shown by the
              same rule (namesApart), so the two always come together. */}
          {/* (Each works on every Amnesic value alike: nothing is kept anywhere but the saved
              progress and the Lookup history.) */}
          <ul className="space-y-1 list-disc ps-4">
            {namesApart && (
              <li>
                <b>Shortening your preset names</b> would be enough on its own to end this warning
                (⚙ → Global → Manage Presets).
              </li>
            )}
            <li>
              <b>Reset Stats</b>, on a mode&apos;s own screen, clears that mode&apos;s solve times
              in the preset you are on.
            </li>
            <li>
              <b>Clear History</b>, on the Lookup page, empties the Lookup history.
            </li>
            <li>
              Deleting a preset you no longer use removes everything it holds (⚙ → Global → Manage
              Presets).
            </li>
          </ul>
        </div>
      </div>
    </Popup>
  )
}
