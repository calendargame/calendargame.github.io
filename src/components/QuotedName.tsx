import { quotedNameParts } from '../lib/presetNameText.js'

// QuotedName — a preset's name as a SENTENCE quotes it: the delete question, the ⚙ menu's "You are
// on …", a row of the storage breakdown. One component, so every place that quotes a name copes
// with whatever a player has typed in the same way:
//   • IT IS THE NAME'S START, NOT ALL OF IT — lib/presetNameText's nameAsQuoted: its first eighty
//     characters and an ellipsis, so a pasted book is a few lines of a popup and its buttons stay
//     in reach;
//   • IT BREAKS ANYWHERE (`wrap-anywhere`) — a name is one unbroken word as often as not, and must
//     break where the line ends rather than push the popup's edge out;
//   • IT PAINTS INSIDE ITS OWN LINES. A letter can carry hundreds of accents, and they stack
//     upwards out of the line, over the line before, a heading, another control. Each character
//     that is stacked like that (quotedNameParts says which) is set in a box of its own, exactly
//     one line tall, that clips what leaves it (index.css's .stacked-character). Everything else
//     in the name is ordinary text in the sentence, untouched — so an ordinary accent, an emoji,
//     and the spacing between letters are drawn exactly as they would be without this.
//     ⚠ WHY A BOX PER STACKED CHARACTER, and not one clip on the whole name: a name wraps across
//     lines with the words round it, and nothing in CSS clips an inline run line by line — a clip
//     on the run is cut to its FIRST line's box and takes the rest of the name away (tried, and
//     seen in a browser). A box that never wraps can be clipped; one character never wraps.
// `strong` draws it bold, as the sentences that name a preset do.
export default function QuotedName({ name, strong = false }: { name: string; strong?: boolean }) {
  const Tag = strong ? 'b' : 'span'
  return (
    <Tag className="wrap-anywhere">
      {quotedNameParts(name).map((part, i) =>
        part.stacked ? (
          // The index is the key: the parts are a pure function of the name, in order.
          <span key={i} className="stacked-character">
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </Tag>
  )
}
