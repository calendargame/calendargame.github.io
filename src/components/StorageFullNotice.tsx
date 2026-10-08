import Popup from './Popup.js'
import { MODAL_PLAIN_CARD_CLASS } from './modalContract.js'
import { useStorageHealth } from '../store/storageHealth.js'
import { resetStatsFreesRoom, useActiveAmnesicMode } from '../store/amnesic.js'
import { amnesicLabel } from './settingsOptions.js'

// ─────────────────────────────────────────────────────────────────────────
// StorageFullNotice — the device refused a save, and the player is told.
//
// store/storageHealth catches the refusal and keeps play going; this is the half the player sees.
// It opens on the FIRST refusal of an episode and never again until saving has worked in between,
// so a full device costs one popup, not one per answer.
//
// ★ IT IS AN INFORMATION POPUP, SO IT WEARS THE APP'S INFORMATION-POPUP SHAPE — the Changelog's and
// the run breakdown's: a card of text with NO button, dismissed by a scrim tap, Escape or Android
// Back. A "Got it" button would be the noise button the owner took off every other popup, and the
// actions worth taking each live behind a confirmation of their own, so the text NAMES the way to
// them instead. The card is the confirmations' card (modalContract's MODAL_PLAIN_CARD_CLASS) inside
// the shared components/Popup, so it reads as one of the app's own popups.
// ★ IT CAN OPEN OVER ANOTHER POPUP — a refused save does not wait for the screen to be clear (making
// a preset inside Manage Presets is a save). It is then simply the top popup of the stack: one dim,
// and Escape, Back or a tap outside closes this notice and leaves the popup under it open.
// ★ AND IT IS THE APP'S, NOT A SCREEN'S (`appWide`): it is mounted beside every screen and the ⚙
// panel, so changing the page does not take it away. A mode letter, H or G pressed under it would
// therefore change the page BEHIND a popup that is still up — so while it is open those keys do
// nothing (components/overlayStack's isAppWidePopupOpen), and it is closed first.
//
// ⚠ THE COPY PROMISES ONLY WHAT storageHealth DOES, and each clause is one of its facts:
//   • "you can keep playing" — a refused save never throws; the screen is untouched by it.
//   • "only kept until you close or reload the app" — what could not be saved is held in memory,
//     each piece for the exact place it belongs (that preset, that stats copy), so it survives
//     switching presets and back and changing Amnesic and back. It is lost only when the page goes
//     away: closing the app, or RELOADING it (a browser reload, the error card's Reload). Check for
//     updates declines to reload while anything is unsaved.
//   • "saved by itself" — every held piece is written to its own place as soon as a save fits, or
//     the moment a deleted preset frees room.
//   • WHAT MAKES ROOM — only what is true for the preset the player is on (store/amnesic's
//     resetStatsFreesRoom, the rule components/StorageUsagePopup follows too). Deleting a preset
//     always does. Reset Stats does only while Amnesic is Off: on Stats Only or Full it clears the
//     session's numbers and leaves the saved solve times — the thing taking the room — where they
//     are, so there the notice names Clear History instead and says why Reset Stats will not help.
// It says nothing about live and staging sharing one allowance — that is true, and it is not the
// player's business.
// ─────────────────────────────────────────────────────────────────────────
export default function StorageFullNotice() {
  const open = useStorageHealth((s) => s.noticeOpen)
  const dismiss = useStorageHealth((s) => s.dismissStorageNotice)
  const amnesic = useActiveAmnesicMode()
  if (!open) return null
  return (
    <Popup id="storage-full" onDismiss={dismiss} appWide>
      <div
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="storage-full-title"
        className={MODAL_PLAIN_CARD_CLASS}
      >
        <div id="storage-full-title" className="text-sm font-semibold text-(--tx-50)">
          Your progress isn&apos;t being saved
        </div>
        <div className="text-xs text-(--tx-200-80) space-y-2">
          <p>
            This device is out of room for Calendar Game&apos;s saved data. Everything saved before
            now is safe, and you can keep playing — but your newest answers and changes are only
            kept until you close or reload the app.
          </p>
          {resetStatsFreesRoom(amnesic) ? (
            <p>
              To make room, delete a preset you no longer use (⚙ → Global → Manage Presets), or use
              Reset Stats in a mode whose history you don&apos;t need. As soon as there&apos;s room,
              everything that couldn&apos;t be saved is saved by itself.
            </p>
          ) : (
            <p>
              To make room, delete a preset you no longer use (⚙ → Global → Manage Presets), or
              empty the Lookup history (Clear History, on the Lookup page). Reset Stats won&apos;t
              make room while this preset&apos;s Amnesic is on {amnesicLabel(amnesic)} — it clears
              only this session&apos;s numbers; set Amnesic to Off first (⚙ → Stats) and it clears
              the saved ones. As soon as there&apos;s room, everything that couldn&apos;t be saved
              is saved by itself.
            </p>
          )}
        </div>
      </div>
    </Popup>
  )
}
