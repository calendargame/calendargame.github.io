import { createPortal } from 'react-dom'
import { useEffect, useRef } from 'react'
import {
  MODAL_SCRIM_CLASS,
  MODAL_CARD_SHADOW,
  trapModalTab,
  useModalEscape,
} from './modalContract.js'
import { useBackButton } from './useBackButton.js'
import { useStorageHealth } from '../store/storageHealth.js'

// ─────────────────────────────────────────────────────────────────────────
// StorageFullNotice — the device refused a save, and the player is told (round 23 Q3).
//
// store/storageHealth catches the refusal and keeps play going; this is the half the player sees.
// It opens on the FIRST refusal of an episode and never again until saving has worked in between,
// so a full device costs one popup, not one per answer.
//
// ★ IT IS AN INFORMATION POPUP, SO IT WEARS THE APP'S INFORMATION-POPUP SHAPE — the Changelog's and
// the run breakdown's since round 21: a card of text with NO button, dismissed by a scrim tap,
// Escape or Android Back. A "Got it" button would be the noise button the owner took off every other
// popup; and the one action worth a button (deleting a preset) lives behind a confirmation in the
// preset manager, which a popup cannot safely open on top of itself (ConfirmModal's header argues the
// stacking limit), so the text NAMES the way there instead. Card geometry and text tiers are
// ConfirmModal's, so it reads as one of the app's own popups.
// All five modal-contract terms are owned here (components/modalContract).
//
// ⚠ THE COPY PROMISES ONLY WHAT storageHealth DOES: what's on screen is kept until the app is
// closed (the in-memory state is untouched by a refusal), and it is saved again automatically once
// there is room (every unsaved store is re-saved on the next write that fits, and when a preset is
// deleted). It says nothing about live and staging sharing one allowance — that is true, and it is
// not the player's business.
// ─────────────────────────────────────────────────────────────────────────
export default function StorageFullNotice() {
  const open = useStorageHealth((s) => s.noticeOpen)
  const dismiss = useStorageHealth((s) => s.dismissStorageNotice)
  const cardRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (open) cardRef.current?.focus()
  }, [open])
  useModalEscape(open, dismiss, false)
  useBackButton(open, dismiss, 'storage-full')
  if (!open) return null
  return createPortal(
    <div
      data-settings-modal
      role="presentation"
      className={MODAL_SCRIM_CLASS}
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss()
      }}
      onKeyDown={trapModalTab}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="storage-full-title"
        style={MODAL_CARD_SHADOW}
        className="card rounded-2xl p-4 w-full max-w-[20rem] space-y-3 focus:outline-hidden"
      >
        <div id="storage-full-title" className="text-sm font-semibold text-(--tx-50)">
          Your progress isn&apos;t being saved
        </div>
        <div className="text-xs text-(--tx-200-80) space-y-2">
          <p>
            This device is out of room for Calendar Game&apos;s saved data. Everything saved before
            now is safe, and you can keep playing — but your newest answers and changes are only
            kept until you close the app.
          </p>
          <p>
            To make room, delete a preset you no longer use (⚙ → Presets → Manage Presets), or use
            Reset Stats in a mode whose history you don&apos;t need. As soon as there&apos;s room,
            everything on screen is saved again by itself.
          </p>
        </div>
      </div>
    </div>,
    document.getElementById('root')!,
  )
}
