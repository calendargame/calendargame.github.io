import Popup from './Popup.js'
import { MODAL_PLAIN_CARD_CLASS } from './modalContract.js'
import { percentText, useStorageUsage } from '../store/storageUsage.js'
import type { UsageRow } from '../store/storageUsage.js'
import { usePresets } from '../store/presets.js'
import type { Preset } from '../store/presets.js'
import { resetStatsFreesRoom, useActiveAmnesicMode } from '../store/amnesic.js'
import { amnesicLabel } from './settingsOptions.js'
import { modeNames } from '../lib/modes.js'

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
// than one to tell apart; one that is no longer in the list is said to be so.
function rowLabel(row: UsageRow, presets: Preset[]): string {
  if (row.kind === 'lookup') return `Lookup history (${count(row.count)})`
  if (row.kind === 'other') return 'Everything else'
  const preset = presets.find((p) => p.id === row.presetId)
  const who = preset ? (presets.length > 1 ? `${preset.name}: ` : '') : 'A deleted preset: '
  if (row.kind === 'preset') return `${who}Bests, settings and saved defaults`
  return `${who}${TIMES_OWNER[row.silo] ?? row.silo} solve times (${count(row.count)})`
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
//     solve times, and "Flash solve times (0)" is a line about nothing, with nothing to clear. Its
//     few characters go with "Everything else".
// Largest first, so the line to act on is the first one read.
const LISTED_AT_LEAST = 5
const holdsSomething = (row: UsageRow): boolean => !('count' in row) || row.count > 0

export default function StorageUsagePopup() {
  const open = useStorageUsage((s) => s.popupOpen)
  const close = useStorageUsage((s) => s.closePopup)
  const figure = useStorageUsage((s) => s.figure)
  const warning = useStorageUsage((s) => s.warning)
  const rows = useStorageUsage((s) => s.rows)
  const limit = useStorageUsage((s) => s.limit)
  const presets = usePresets((s) => s.presets)
  const amnesic = useActiveAmnesicMode()
  if (!open) return null
  // Each owner's share of the WHOLE allowance, written by the rule the headline is written by
  // (store/storageUsage's percentText): each is cut at its last digit, so together they come to the
  // headline or a little under it, and never to more.
  // ⚠ On a device whose limit could not be measured (store/storageUsage) there is no whole to take
  // a share of: the owners are listed with no figure beside them, and the card says why.
  const measured = limit !== null
  const share = (chars: number) => (measured ? (chars / limit) * 100 : 0)
  const owners: UsageRow[] = rows
    .filter((row) => row.kind !== 'other' && holdsSomething(row))
    .sort((a, b) => b.chars - a.chars)
  const listed = owners.filter((row, i) => i < LISTED_AT_LEAST || share(row.chars) >= 1)
  const rest = rows.filter((row) => !listed.includes(row)).reduce((sum, row) => sum + row.chars, 0)
  const shown = (chars: number) => (measured ? percentText(chars, limit) : '')
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
          Storage used: {figure ?? 'not measured yet'}
        </div>
        <div className="text-xs text-(--tx-200-80) space-y-2">
          <p>
            {warning
              ? 'This device is running out of room for Calendar Game’s saved data. Once it is full, new answers can’t be saved until some room is made.'
              : 'Calendar Game keeps your stats, history and settings on this device, which gives it a fixed amount of room.'}
          </p>
          {!measured && (
            <p>
              How much room this device gives couldn&apos;t be measured, so there are no percentages
              to show. The app tries again each time it starts, and each time you open ⚙ with no
              flash, run or round under way.
            </p>
          )}
          <p className="font-semibold text-(--tx-100-90)">What is using it</p>
          <ul className="space-y-1">
            {listed.map((row) => (
              <li
                key={`${row.kind}:${'presetId' in row ? row.presetId : ''}:${'silo' in row ? row.silo : ''}`}
                className="flex justify-between gap-3"
              >
                <span>{rowLabel(row, presets)}</span>
                <span className="tabular-nums whitespace-nowrap">{shown(row.chars)}</span>
              </li>
            ))}
            {rest > 0 && (
              <li className="flex justify-between gap-3">
                <span>Everything else</span>
                <span className="tabular-nums whitespace-nowrap">{shown(rest)}</span>
              </li>
            )}
          </ul>
          <p className="font-semibold text-(--tx-100-90)">To make room</p>
          {/* ★ ONLY WHAT IS TRUE FOR THE PRESET YOU ARE ON, RIGHT NOW. Reset Stats clears the stats
              on screen, and under Amnesic: Stats Only or Full those are the session's copy — the
              saved solve times, which are what is taking the room, are not touched (store/amnesic's
              resetStatsFreesRoom). So there it is not offered as a way to make room; it is named,
              because it is the first thing a player would reach for, with what to do instead. The
              other two work under every value: Clear History empties the saved Lookup list
              whatever the value, and deleting a preset removes everything it holds. */}
          <ul className="space-y-1 list-disc ps-4">
            {resetStatsFreesRoom(amnesic) && (
              <li>
                <b>Reset Stats</b>, on a mode&apos;s own screen, clears that mode&apos;s solve times
                in the preset you are on.
              </li>
            )}
            <li>
              <b>Clear History</b>, on the Lookup page, empties the Lookup history.
            </li>
            <li>
              Deleting a preset you no longer use removes everything it holds (⚙ → Global → Manage
              Presets).
            </li>
            {!resetStatsFreesRoom(amnesic) && (
              <li>
                <b>Reset Stats</b> won&apos;t make room while this preset&apos;s Amnesic is on{' '}
                <b>{amnesicLabel(amnesic)}</b>: it clears only this session&apos;s numbers, and the
                solve times saved before stay. To clear those, set Amnesic to <b>Off</b> first (⚙ →
                Stats), then use Reset Stats on the mode&apos;s screen.
              </li>
            )}
          </ul>
        </div>
      </div>
    </Popup>
  )
}
