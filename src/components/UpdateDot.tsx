// UpdateDot — the light-blue "there is news" marker, the two-stage breadcrumb from the ⚙ gear and
// the ⚙ panel's Changelog link to the changelog popup after a new build lands. The build-stamp check
// lights the GEAR flag; the CHANGELOG flag is lit only when the newest changelog entry actually
// changed since this device last looked (2026-08-10). Opening Settings retires the gear's, the first tap on the link
// retires the link's (main.tsx owns those flags; src/changelog.ts owns their storage keys).
//
// WHY A COMPONENT AND NOT ONE CSS CLASS. Round 6 shipped a single recipe — an absolutely positioned
// corner badge with fixed px insets — and reused it verbatim on both hosts. A corner badge is only
// safe on a host that reserves room for it inside its own padding: the ⚙ gear does (px-2.5 / py-2),
// a text link does not, so on the Changelog link the dot necessarily landed on top of the word. The
// precondition was real but unwritten, so nothing could catch the reuse. Here the call site NAMES
// the form it can host — which is also why no string-scanning guard test is needed: there is no way
// to ask for the corner badge without saying "corner".
//
// PURELY DECORATIVE. The marker is aria-hidden, so every host has to publish the same fact in its
// own accessible name — the ⚙ gear folds "update" into its aria-label (which it needs regardless:
// its visible content is a bare glyph), the Changelog link carries a visually-hidden text node.
// Both are pinned in tests/changelog.dom.test.jsx.
//
// ★ THE GEAR'S DOT HAS A SECOND REASON, AND ITS COLOUR SAYS WHICH. The same corner badge is lit
// while the device's room for the app is nearly used up (store/storageUsage's warning; src/main.tsx
// passes it). That is a caution about STATE, not news, so it is AMBER — the colour of the "Storage
// used" line it points at inside the menu — where an update is the light blue. When both are true
// the dot is amber: the storage warning is the one that asks for something to be done, and the
// update's own breadcrumb (the Changelog link's dot) is still there once the menu is open. The
// caller states the reason; this component only publishes it for the stylesheet.
//
// The paint — em sizing, the two colours per theme, and the corner form's per-axis precondition —
// lives in src/index.css under [data-update-dot].

export type UpdateDotPlacement =
  // Absolutely positioned in the host's top-right inside corner. Icon buttons only: the host must
  // be a containing block (a literal `relative`) AND clear the inset + the dot in its own padding.
  | 'corner'
  // Hanging just past the end of a text link's text, OUTSIDE its box (Round 26): the link's box,
  // and so its right edge, is its text alone, and lighting the marker moves nothing. The host is the
  // text's own span, which must be a containing block (a literal `relative`), with room for the
  // marker (0.73em) beyond it — the ⚙ foot has its px-4.
  | 'trailing'

// What a lit dot is saying, which is its colour: news (an update landed), or the storage warning.
export type UpdateDotReason = 'update' | 'storage'

export function UpdateDot({
  placement,
  lit,
  reason = 'update',
}: {
  placement: UpdateDotPlacement
  lit: boolean
  reason?: UpdateDotReason
}) {
  // data-lit rather than conditional rendering: one attribute drives the paint (index.css) and the
  // tests alike, and the marker keeps its place lit or not.
  return (
    <span
      aria-hidden="true"
      data-update-dot={placement}
      data-lit={lit ? 'true' : 'false'}
      data-reason={reason}
    />
  )
}
