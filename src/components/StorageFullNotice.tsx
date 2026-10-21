import Popup from './Popup.js'
import { MODAL_PLAIN_CARD_CLASS } from './modalContract.js'
import { useState } from 'react'
import { useStorageHealth } from '../store/storageHealth.js'
import { readUsageRowsNow, suggestShorterNames, useStorageUsage } from '../store/storageUsage.js'

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
//   • "being kept here until there's room" — what could not be saved is held in this window's
//     memory, each piece for the exact place it belongs (that preset's doc), so it survives
//     switching presets and back. It is lost only when the
//     page goes away: closing the window, or RELOADING it (a browser reload, the error card's
//     Reload). Check for updates declines to reload while anything is unsaved.
//   • "saved by itself — your answers added to whatever another window saved meanwhile" — a held save
//     is retried as soon as a save fits, or the moment a deleted preset frees room, and a retry is the
//     windows-in-sync door's merge with the device as it is NOW (store/syncedDoc): a held answer is
//     added onto another window's, never written over it.
//   • "a Reset or Clear made here … is cancelled if another window has played since, an Override made
//     here gives way if another window has answered in that mode since, and a setting changed here
//     yields to one changed in another window since" — the door's rules for a held Reset, Clear
//     History, Override, and setting (design-q1-q2.md v4, sections 5 and 16; an Override is a
//     whole-mode change made on exactly the mode as it stood, store/syncCounts' `rep`, so it lands only
//     on that - Round 26's review lane found the notice promising it would be added, like an answer).
//   • SHORTENING PRESET NAMES — suggested exactly when the breakdown popup suggests it, by the same
//     rule (store/storageUsage's suggestShorterNames), over the device as it was when the notice
//     opened: only when that alone would be enough. On a device filled by solve times it would be
//     advice that cannot help, so it is not given.
//   • WHAT MAKES ROOM — deleting a preset, and Reset Stats in a mode (its solve times go with it), on
//     every Amnesic value alike: nothing is kept anywhere but the saved progress.
// ─────────────────────────────────────────────────────────────────────────
export default function StorageFullNotice() {
  const open = useStorageHealth((s) => s.noticeOpen)
  // (mounted only while open, so the device is read once for each time the notice opens)
  return open ? <StorageFullCard /> : null
}

function StorageFullCard() {
  const dismiss = useStorageHealth((s) => s.dismissStorageNotice)
  const warning = useStorageUsage((s) => s.warning)
  const limit = useStorageUsage((s) => s.limit)
  const [rows] = useState(readUsageRowsNow)
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
            now is safe, and you can keep playing. What you&apos;ve done in this window since is
            being kept here until there&apos;s room. As soon as there is, it&apos;s saved by itself
            — your answers added to whatever another window saved meanwhile. A Reset or Clear made
            here while the device was full is cancelled if another window has played since, an
            Override made here gives way if another window has answered in that mode since, and a
            setting changed here yields to one changed in another window since. Closing or reloading
            this window before then loses it.
          </p>
          {suggestShorterNames(warning, rows, limit) && (
            <p>
              <b>Shortening your preset names</b> would be enough on its own to make room (⚙ →
              Global → Manage Presets).
            </p>
          )}
          <p>
            To make room, delete a preset you no longer use (⚙ → Global → Manage Presets), or use
            Reset Stats in a mode whose history you don&apos;t need.
          </p>
        </div>
      </div>
    </Popup>
  )
}
