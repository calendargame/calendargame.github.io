import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { SCROLL_REGION_CLASS, scrollFadeClass, useScrollEdgeState } from './scrollRegion.js'
import { MODAL_CARD_CLASS, MODAL_CARD_SHADOW } from './modalContract.js'
import { NOT_OFFERED_BTN_CLASS, RESET_BTN_CLASS } from './controlClasses.js'
import { usePresets, MAX_PRESET_NAME } from '../store/presets.js'
import { createPreset, deletePreset, movePreset, renamePreset } from '../store/presetControl.js'

// ============================================================
// PresetManager — the card behind the ⚙ menu's "Manage Presets" button: make a preset, rename one,
// move one up or down the list, delete one.
//
// ── WHY IT IS A ⚙ MODAL AND NOT PART OF THE SWITCHER ─────────────────────────────────────────
//
// ★ THE SWITCHER IS FOR CHOOSING, THIS IS FOR EDITING, AND MERGING THEM WAS REJECTED ON TWO COUNTS.
// The obvious alternative was a "Manage…" row at the foot of components/PresetSwitcher's dropdown.
//   • It would need a SENTINEL option value threaded through CustomSelect's onChange, which is
//     `switchPreset(Number(v))` today — one line whose whole virtue is that it cannot mean anything
//     but "open this preset". A row that looked like a preset and was not is the shape of bug that
//     ends with switchPreset called on an id nothing owns.
//   • The dropdown lives in the FIXED top bar and CustomSelect measures its panel ONCE per open
//     from the trigger's viewport rect (the caller contract at the top of that file). A panel that
//     could grow a rename field and a confirmation step is a panel that changes height while it is
//     open, which is exactly the thing that contract says it does not survive.
// The ⚙ panel is where every other thing you do TO your saved data already lives — Save Defaults,
// the defaults manager, Clear saved defaults, Reset Settings, Full Reset — and it already has a
// modal idiom with a shared contract. So this is the FIFTH user of that contract, not a fifth
// style: components/modalContract's five terms, the same scrim, the same card, the same tokens.
//
// ── ⚠⚠ THE CONFIRMATION IS A VIEW OF THIS CARD, NOT A MODAL ON TOP OF ONE ─────────────────────
//
// Deleting asks first, and the ask REPLACES this card's body rather than opening a second dialog
// over it. That is a deliberate refusal to invent nested modals, and the reason is mechanical:
// modalContract's Escape term is a DOCUMENT-level capture listener registered per open modal, and
// `stopPropagation` does not stop a second listener on the SAME node — so with two of them mounted
// one Escape would close both, the inner dismiss taking the outer with it. Android Back (LIFO) and
// the Tab trap would each need their own answer too, and every one of those answers would be new
// machinery serving one button. The four modals that predate this one are mutually exclusive BY
// CONSTRUCTION and have never had to answer any of it. One card with two views keeps it that way:
// one Escape, one Back entry, one trap, one scrim.
// ⚠ THE DIALOG'S ACCESSIBLE NAME THEREFORE CHANGES WITH THE VIEW, and both titles are FIXED
// STRINGS — "Presets" and "Delete this preset?". The preset's name is in the confirmation's BODY
// and deliberately not in its title: the Changelog popup paid for that lesson (see the ★ at its
// heading row in components/SettingsPanel), where an id placed one element too high made the
// dialog's name change on every deploy. A landmark that renames itself per row is the same defect.
//
// ── WHAT EACH CONTROL ACTUALLY DOES, and where the honesty is owed ───────────────────────────
//
// ★ NEW PRESET STARTS FROM FACTORY DEFAULTS, NOT FROM A COPY OF THE ONE YOU ARE ON (the owner's
// call). Nothing here implements that: store/presetControl's createPreset allocates an id whose
// keys hold nothing, and store/presets' mergeOverDefaults is what turns "no saved copy" into the
// factory values instead of a clone of whatever was in memory. This button is the call.
// ★ AND IT DOES NOT SWITCH TO WHAT IT MAKES, which is createPreset's documented contract rather
// than an omission here: creating and opening are separate acts, so making a preset cannot yank a
// player out of the round they are in. The new row appears at the foot of the list; the switcher in
// the top bar is how you go to it.
//
// ★ RENAMING IS CAPPED AT THE INPUT, TWICE OVER, and both are needed. `maxLength` is the BROWSER's
// enforcement — it refuses the thirteenth keystroke, so the field never shows a character it is
// about to lose, which is what makes typing feel right. The `slice` in onChange is what actually
// HOLDS: maxLength is not applied to a value set programmatically (which is every route jsdom has,
// so it is also the only half the suite can prove) and store/presets' normalizePresetName slices
// again on the way in. Three cuts sounds like duplication and is not — they are the keystroke, the
// paste-shaped write, and the untrusted-storage screen, and no one of them covers another's case.
//
// ★ MOVING IS TWO BUTTONS, NEVER A DRAG. The argument is store/presetControl's, at movePreset, and
// it is the most expensive lesson this feature inherits: two pointer gestures have now passed on a
// development machine and failed on the owner's iPhone. This one cannot, because it is not a
// gesture.
//
// ★ DELETING IS PERMANENT AND THE CARD SAYS SO IN THOSE WORDS. Two cases are real and both are
// handled out loud rather than hidden:
//   • THE ACTIVE PRESET. deletePreset opens the neighbour, which IS a switch — so the screens are
//     cleared by src/main.tsx's registry subscription, a round or run in progress included. The
//     confirmation says that in advance, because it is the one consequence a player would otherwise
//     meet as a surprise.
//   • THE LAST REMAINING PRESET. deletePreset REFUSES it (the app cannot render "no presets", and
//     "delete everything" is what Full Reset is for), so the control is withheld in the app's own
//     three-statement convention — drawn unavailable, announced unavailable, and inert in its own
//     handler — plus a line under the list saying why, because a dim on its own states a fact and
//     not a reason.
// ⚠ WHAT THE CARD DELIBERATELY DOES NOT MENTION is that deleting preset 1 vacates the un-namespaced
// storage keys forever, so a build that has never heard of presets would open factory-fresh
// afterwards. It is true (store/presetControl's deletePreset argues it in full) and it is not
// something a player can observe from inside this app, so putting it in a confirmation would be
// spending a reader's attention on a fact that cannot help them decide.
// ============================================================

// The three row glyphs, named here rather than written inline — the row below is dense enough that
// three bare arrows in the markup would read as decoration rather than as the controls they label.
// ⚠ NONE OF THEM IS aria-hidden AND NONE NEEDS TO BE: every button carrying one also carries an
// aria-label, and an aria-label REPLACES an element's content for a screen reader, so the glyph is
// already unspoken. (That is the opposite of the ✓ and A markers below, which are bare spans with
// no name of their own and therefore do need hiding plus an sr-only word.)
const MOVE_UP = '↑'
const MOVE_DOWN = '↓'
const DELETE_GLYPH = '✕'

// A row's small square controls. `shrink-0` because the NAME is the thing that gives way when the
// card is narrow — a reorder button that shrank to a sliver would be the wrong casualty. The
// surface is `surface-toggle`, the same no-fill interactive tier the modal Cancel buttons wear:
// none of these three is a destructive act on its own (the ✕ only OPENS the confirmation, exactly
// as the footer's "Clear saved defaults" link opens its own), so none of them wears the rose fill.
// ⚠ TOUCH SIZE IS A DEVICE-ONLY QUESTION. At the card's ~288px of content these land near 30×26px,
// which is the ⚙ panel's existing control tier (its On/Off switches are px-3 py-1.5 text-xs) and
// not a new, smaller one — but jsdom lays nothing out, so only the owner's iPhone can say whether
// three of them in a row are comfortable. If they are not, the fix is a taller row (py-2), not a
// narrower name cell.
const ROW_BTN_CLASS =
  'shrink-0 px-2 py-1.5 rounded-xl text-xs border surface-toggle text-(--tx-100-80)'

export default function PresetManager({
  onClose,
}: {
  /** Dismiss the whole card. The caller owns the open flag, as it does for the other four. */
  onClose: () => void
}) {
  // Two narrow subscriptions, the same pair components/PresetSwitcher takes and for the same
  // reason: `presets` is replaced wholesale by applyRegistry (so reference equality is a correct
  // change signal) and `activeId` is the one scalar this card renders a mark for. Everything this
  // card does writes through store/presetControl and lands back here as a new list.
  const presets = usePresets((s) => s.presets)
  const activeId = usePresets((s) => s.activeId)

  // ── The rename in flight ────────────────────────────────────────────────────────────────────
  //
  // ★ ONE PENDING EDIT, HELD AS {id, text}, NOT A MIRROR PER ROW. Only one field can hold the
  // keyboard, so a per-row array would be N−1 values that are always equal to the store and one
  // that is not — and the moment they can disagree, "which is the real name" has two answers. This
  // shape makes it unrepresentable: a row shows `editing.text` if it is THE row and `p.name`
  // otherwise, so a preset that is not being typed into can only ever show what is saved.
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null)
  const editingText = (id: number, name: string) => (editing?.id === id ? editing.text : name)

  // The delete confirmation's subject, or null while the list is showing. An ID and not the preset
  // object: the registry can be rewritten under this card (another row renamed, one moved), and a
  // captured object would go stale where an id is resolved fresh on every render.
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)
  const pendingDelete = presets.find((p) => p.id === pendingDeleteId) ?? null

  // ★ THIS CARD FOCUSES ITSELF, which is modalContract's term 1 and the ONE term this modal takes
  // off its call site (components/SettingsPanel declares the other four modals' focus effects in a
  // row and says at that spot why this one is missing). The reason is the two views: each renders
  // its OWN dialog element, so the term is not "focus the card when the modal opens" but "focus the
  // card whenever the card is replaced" — and the replacement is a fact only this component has.
  // Split across two owners, the second half is the half that gets forgotten, and the symptom is
  // silent: press ✕, and the keyboard is on <body> behind a scrim with a destructive button on it.
  // The dependency is the VIEW, not the mount, so it covers both directions — into the confirmation
  // and back out of it.
  const cardRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    cardRef.current?.focus()
  }, [pendingDeleteId])

  // The list's scroll region, on the app's shared recipe (components/scrollRegion) — the same
  // treatment the Changelog popup's list wears, for the same reason: a bare max-height clips with
  // nothing to say that anything scrolls, which is worse than the overflow it hides. `active` is
  // the LIST VIEW being up, so the confirmation view rests the indicators instead of leaving the
  // last measured fade painted on a region that is no longer mounted.
  const listRef = useRef<HTMLDivElement | null>(null)
  const { scrolledFromTop, atBottom } = useScrollEdgeState(listRef, pendingDelete === null)

  // ── Renaming ────────────────────────────────────────────────────────────────────────────────

  // Commit whatever is pending. store/presetControl's renamePreset normalizes (trim, cap, and an
  // empty or whitespace-only name falls back to "Preset N"), so this deliberately does NOT
  // pre-screen the text: one place decides what a name may be, and it is the store's.
  const commitRename = () => {
    if (!editing) return
    renamePreset(editing.id, editing.text)
    setEditing(null)
  }

  // ⚠ THE ESCAPE DISCARD MUST BE FLUSHED BEFORE THE BLUR, and this is the ⚙ Year Range boxes' bug
  // verbatim (round 14 — see the ★ at those inputs in components/SettingsPanel). Clearing `editing`
  // and blurring in one handler puts both in ONE React batch, so the onBlur that fires next still
  // closes over the PRE-discard `editing` and commits the very text Escape was throwing away. Only
  // unusual names would have shown it — a discarded "Weekend" simply saves as "Weekend" — which is
  // exactly how the year-box version survived unnoticed for so long. flushSync lands the discard
  // first, so the blur that follows runs against a render where `editing` is null and
  // commitRename's own guard returns.
  // ⚠ AND IT STOPS PROPAGATION, for the second half of that same fix: App's panel-level Escape
  // handler is a document keydown in the BUBBLE phase that decides "is this press mine?" by asking
  // what has focus — and this field has already blurred by then, so without the stop it would take
  // the whole ⚙ panel down on what the user meant as a discard. The MODAL's Escape handler is
  // capture-phase and runs first, where the field still holds focus and modalContract's
  // `guardTextEntry` bails — which is precisely what leaves this press to the field. A second
  // Escape, with nothing focused, reaches that handler and dismisses the card: the app's dismissal
  // ladder, unchanged.
  const discardRename = (el: HTMLInputElement) => {
    flushSync(() => setEditing(null))
    el.blur()
  }

  // ── Creating ────────────────────────────────────────────────────────────────────────────────

  // ⚠ NO AUTO-FOCUS ON THE NEW ROW'S NAME FIELD, and it is a decision rather than an omission.
  // Focusing a text box raises the soft keyboard, and lib/textEntry's rule 2 says the app takes the
  // keyboard DOWN when an overlay opens — a create that immediately put it back up would be this
  // card fighting an app-wide rule. The row is there to tap.
  // ⚠ flushSync SO THE SCROLL LANDS ON THE ROW THAT WAS JUST ADDED: createPreset appends, and on a
  // list long enough to scroll the new row is below the fold with nothing to say it arrived. The
  // flush commits the row before the scroll reads scrollHeight. DEVICE-ONLY: jsdom reports every
  // dimension as 0, so the suite can prove the preset was created and can prove nothing about
  // whether it came into view.
  const addPreset = () => {
    flushSync(() => {
      createPreset()
    })
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  // ── Deleting ────────────────────────────────────────────────────────────────────────────────

  // The last preset cannot go (store/presetControl's deletePreset refuses it), and this is the one
  // boolean the whole withholding treatment below hangs off — the class that DRAWS it unavailable,
  // the attribute that ANNOUNCES it, and the handler guard that makes it INERT. Three statements of
  // one fact, which is the app's convention (controlClasses' NOT_OFFERED_BTN_CLASS argues why all
  // three are needed and why it is aria-disabled rather than `disabled`).
  const canDelete = presets.length > 1
  const confirmDelete = () => {
    if (pendingDelete) deletePreset(pendingDelete.id)
    setPendingDeleteId(null)
  }

  // ── The confirmation view ───────────────────────────────────────────────────────────────────
  if (pendingDelete) {
    // Whether the player is standing in the preset they are about to delete, which changes what
    // happens to the SCREEN and is therefore its own sentence rather than a clause. The neighbour
    // that will open is the one deletePreset picks — the row after, or the row before when this is
    // the last — and it is named, because "you will be moved" without saying where is the half of
    // the truth that helps least.
    const index = presets.findIndex((p) => p.id === pendingDelete.id)
    const successor = presets[index + 1] ?? presets[index - 1]
    return (
      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="preset-manager-title"
        style={MODAL_CARD_SHADOW}
        className={`${MODAL_CARD_CLASS} px-4`}
      >
        <div id="preset-manager-title" className="text-sm font-semibold text-(--tx-50)">
          Delete this preset?
        </div>
        <div className="text-xs text-(--tx-200-80)">
          <b>{pendingDelete.name}</b> and everything in it go for good: its stats, its all-time
          bests, its Lookup history, its per-mode setup, every ⚙ setting it holds, and its saved
          defaults. No other preset is touched, and this cannot be undone.
        </div>
        {pendingDelete.id === activeId && (
          <div className="text-xs text-(--tx-200-80)">
            You are on this preset, so deleting it opens <b>{successor.name}</b> and clears the
            screen — a Blitz round or MoX run in progress included.
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => setPendingDeleteId(null)}
            className="flex-1 px-3 py-2 rounded-xl text-sm font-medium border surface-toggle text-(--tx-100-80)"
          >
            Cancel
          </button>
          <button type="button" onClick={confirmDelete} className={`flex-1 ${RESET_BTN_CLASS}`}>
            Delete
          </button>
        </div>
      </div>
    )
  }

  // ── The list view ───────────────────────────────────────────────────────────────────────────
  //
  // The card owns py-4 only and each block carries its own px-4, so the scroller's right padding is
  // the text-free lane the iOS overlay scrollbar paints in — the ⚙ popover's reference treatment,
  // which the Changelog popup already copies.
  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="preset-manager-title"
      style={MODAL_CARD_SHADOW}
      className={MODAL_CARD_CLASS}
    >
      <div id="preset-manager-title" className="px-4 text-sm font-semibold text-(--tx-50)">
        Presets
      </div>
      <div className="px-4 text-xs text-(--tx-200-80)">
        Each preset keeps its own stats, bests, settings and theme. Everything the ⚙ menu does — its
        settings, Reset Settings, Full Reset — reaches only the preset you are on.
      </div>
      <div
        ref={listRef}
        className={`${SCROLL_REGION_CLASS} max-h-[45vh] space-y-2 ${scrollFadeClass(scrolledFromTop, atBottom)}`}
      >
        {presets.map((p, i) => (
          <div key={p.id} className="flex items-center gap-1">
            {/* THE CURRENT-PRESET MARK, in a reserved fixed-width slot so every name box starts at
                the same x whether the row is marked or not — the same reason CustomSelect gives its
                ✓ column a width of its own. aria-hidden + an sr-only word, the idiom every quiet
                marker in this app uses (the switcher's "A", the footer's Changelog dot), because a
                bare ✓ is a glyph rather than an accessible name. */}
            <span className="w-3 shrink-0 text-center text-xs text-(--tx-200-80)">
              {p.id === activeId && (
                <>
                  <span aria-hidden="true">✓</span>
                  <span className="sr-only">Current preset</span>
                </>
              )}
            </span>
            {/* THE NAME, AS A TEXT BOX — the rename IS the field, with no edit mode to enter and no
                pencil to find.
                ⚠ IT NAMES ITSELF "Preset name" AND NOTHING MORE, deliberately. A textbox's VALUE is
                read out with it, so the row's own name is already spoken and a label carrying it as
                well ("Name of Weekend") would say it twice and would change under the typing. The
                three BUTTONS beside it have no value to be read, which is why they name the preset
                and this does not.
                ⚠ SELECT-ALL ON ENTRY COMES FOR FREE and must not be added here: lib/textEntry
                installs it once, at the document, precisely so that the seventh box in the app —
                this one — gets the rule without a call site remembering it. */}
            <input
              type="text"
              aria-label="Preset name"
              maxLength={MAX_PRESET_NAME}
              value={editingText(p.id, p.name)}
              onFocus={() => {
                // Seed the pending edit from the SAVED name.
                // ⚠ THE GUARD IS NOT REDUNDANT, AND THE CASE IT COVERS IS NOT MOVING BETWEEN ROWS.
                // Leaving a field always blurs it first, and the blur commits and clears `editing`,
                // so an ordinary tab or tap arrives here with nothing pending — the guard is silent
                // for every route inside the app. What it is for is the WINDOW regaining focus: a
                // browser re-fires `focus` on the element that already had it when you come back
                // from another app or another tab, and without this line that return would silently
                // throw away a half-typed name. iOS does it every time you switch away and back,
                // which is the likeliest way anyone would ever meet it.
                if (editing?.id !== p.id) setEditing({ id: p.id, text: p.name })
              }}
              onChange={(e) =>
                setEditing({ id: p.id, text: e.target.value.slice(0, MAX_PRESET_NAME) })
              }
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitRename()
                  e.currentTarget.blur()
                } else if (e.key === 'Escape') {
                  e.stopPropagation()
                  discardRename(e.currentTarget)
                }
              }}
              className="min-w-0 flex-1 appearance-none rounded-xl border surface-tray px-2 py-1.5 text-xs focus:outline-hidden focus-ring"
            />
            {/* The amnesic marker, the SAME letter the switcher shows and in a reserved slot for
                the same reason the ✓ above is: every row's buttons line up whether or not the row
                is marked. It is read-only here — Amnesic is flipped in ⚙ → Stats, and only for the
                preset you are on — so this is purely the answer to "which of these forget", which
                is worth knowing at the moment you are deciding what to delete.
                ⚠ DIMMED BY OPACITY, NEVER TINTED, and inheriting currentColor: components/
                PresetSwitcher argues it (a themed colour token would read correctly in one of the
                two places this letter appears and be invisible in the other). */}
            <span className="w-3 shrink-0 text-center">
              {p.amnesic && (
                <>
                  <span aria-hidden="true" className="text-[0.8em] font-semibold opacity-70">
                    A
                  </span>
                  <span className="sr-only">Amnesic</span>
                </>
              )}
            </span>
            {/* THE TWO REORDER BUTTONS. Each is withheld at the end it cannot move toward, in the
                app's three-statement convention — the class draws it, aria-disabled announces it,
                and the guard inside the handler is what makes it true. movePreset would refuse the
                press anyway; the guard is here so that the button's INERTNESS is a property of the
                button rather than a fact about a store function a reader has to go and check. */}
            <button
              type="button"
              aria-label={`Move ${p.name} up`}
              aria-disabled={i === 0 || undefined}
              onClick={() => {
                if (i > 0) movePreset(p.id, -1)
              }}
              className={`${ROW_BTN_CLASS} ${i === 0 ? NOT_OFFERED_BTN_CLASS : ''}`}
            >
              {MOVE_UP}
            </button>
            <button
              type="button"
              aria-label={`Move ${p.name} down`}
              aria-disabled={i === presets.length - 1 || undefined}
              onClick={() => {
                if (i < presets.length - 1) movePreset(p.id, 1)
              }}
              className={`${ROW_BTN_CLASS} ${i === presets.length - 1 ? NOT_OFFERED_BTN_CLASS : ''}`}
            >
              {MOVE_DOWN}
            </button>
            <button
              type="button"
              aria-label={`Delete ${p.name}`}
              aria-disabled={!canDelete || undefined}
              onClick={() => {
                if (canDelete) setPendingDeleteId(p.id)
              }}
              className={`${ROW_BTN_CLASS} ${canDelete ? '' : NOT_OFFERED_BTN_CLASS}`}
            >
              {DELETE_GLYPH}
            </button>
          </div>
        ))}
      </div>
      {/* The reason behind the dimmed ✕, shown only while it is dimmed. A withheld control states
          THAT it is unavailable; nothing about it can state WHY, and "the last one won't delete" is
          a rule a player would otherwise have to discover by pressing. It sits under the list
          rather than in it so that it reads as a fact about the set, not about that one row. */}
      {!canDelete && (
        <div className="px-4 text-[11px] text-(--tx-300-60)">
          There is always at least one preset, so this one cannot be deleted. Full Reset is how you
          empty it.
        </div>
      )}
      <div className="px-4 pt-1 flex gap-2">
        {/* NEW PRESET is the constructive act, so it wears btn-solid — the same violet fill Save
            Defaults and every Begin button wear, and the same reason rose is left to the two
            destructive controls. It sits LEFT of Close, matching the app's left-to-right reading of
            a button row as act-then-leave (the ⚙ footer's Save Defaults → Reset Settings → Full
            Reset row is the same escalation). */}
        <button
          type="button"
          onClick={addPreset}
          className="flex-1 px-3 py-2 rounded-xl btn-solid border border-transparent text-sm font-medium"
        >
          New Preset
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex-1 px-3 py-2 rounded-xl text-sm font-medium border surface-toggle text-(--tx-100-80)"
        >
          Close
        </button>
      </div>
    </div>
  )
}
