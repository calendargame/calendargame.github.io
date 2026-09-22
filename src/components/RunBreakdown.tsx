import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { FmtDate } from '../modes/modeTypes.js'
import { DAY, DAY_LETTER } from '../lib/format.js'
import type { RunBreakdown as RunBreakdownData, SolveMark } from '../engine/runBreakdown.js'
import { fmtTime, truncTime, fmtAccuracyPct } from '../lib/modeFormat.js'
import { SCROLL_REGION_CLASS, scrollFadeClass, useScrollEdgeState } from './scrollRegion.js'
import { useBackButton } from './useBackButton.js'
import {
  MODAL_CARD_CLASS,
  MODAL_CARD_SHADOW,
  MODAL_SCRIM_CLASS,
  trapModalTab,
  useModalEscape,
} from './modalContract.js'

// ─────────────────────────────────────────────────────────────────────────
// components/RunBreakdown — an ended run or round, solve by solve.
//
// Opened by TAPPING ANYWHERE ON THE STAT STRIP once a MoX run has ENDED — completed or failed — or a
// Blitz round has ended (StatPanel's onActivate). That gesture is free: on an ended run every stat
// box is already inert — MoX drops its timing toggle on `isLocked` and Blitz on `timerDone`, both
// because an ended strip is a result readout rather than a control — so the strip had a tap going
// spare and no competing meaning. It is also the right place for it: the thing you tap to see the
// solves is the thing showing you the number they add up to.
//
// ★ THE ROW, left to right (round 22):   12.  R  2024-1-4      fastest   2.00s
//   • the card's NUMBER — fixed width, so the letters line up behind it;
//   • the WEEKDAY LETTER (lib/format's DAY_LETTER — U M T W R F S) that date fell on, under the
//     card's own calendar snapshot (engine/runBreakdown computes it). Fixed width too, so the dates
//     line up behind it. A screen reader hears the full day name instead (see the row);
//   • the DATE, in the card's own `_fmt`, taking whatever width is left;
//   • the WORDS — fastest/slowest, and missed/shown/overridden — each LEFT of the time it labels;
//   • the TIME, last, right-aligned in a minimum-width column, so every row's time ends on one edge.
//
// ★ IT LIVES AND DIES WITH THE SCREEN. No persistence, no new saved data, no migration (the owner's
// call): it is built fresh from the engine state every time it opens, and it is gone the moment
// Reset clears the run. So there is no second copy of the run anywhere and nothing that can go stale
// — which is also why it can afford to be a live proof of the mean rather than a report about it.
// The maths lives in engine/runBreakdown; this file only formats it.
//
// It is the app's one modal outside the ⚙ panel, and owes the same contract as the five ⚙ popups
// — focus on open,
// capture-phase Escape, Android Back, the Tab trap, the [data-settings-modal] marker — which is now
// shared code rather than a checklist; see components/modalContract. The card, scrim, shadow, and
// the scroll region's fades are the changelog popup's, literally: same tokens, same recipe.
//
// ⚠ THE MODE PAGE ITSELF MUST NEVER SCROLL (the owner's standing constraint), which is why this is
// a modal with its OWN internal scroller and not a section that grows the screen. A run can be a
// thousand solves long; the card's max-height caps it and the list scrolls inside.
// ─────────────────────────────────────────────────────────────────────────

// The words for a card that did not earn its point. `shown` is deliberately vague and the vagueness
// is the accurate part: Reveal, Show Codes and a timeout leave byte-identical records, so the panel
// says the one thing all three have in common instead of guessing which it was. See the ⚠ note in
// engine/runBreakdown for what it would take to tell them apart, and why that was not bought here.
const MARK_WORDS: Record<Exclude<SolveMark, null>, string> = {
  wrong: 'missed',
  shown: 'shown',
  override: 'overridden',
}

// One summary figure. Kept as a pair so the grid below can lay label and value out identically for
// all seven without seven copies of the markup.
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-(--tx-200-80)">{label}</span>
      <span className="tabular-nums whitespace-nowrap text-(--tx-100-80)">{value}</span>
    </div>
  )
}

// ⚠ MOUNTED ONLY WHILE OPEN — there is no `open` prop, and that is deliberate. The four ⚙ popups
// carry one because they live inside an always-mounted panel; this one is rendered by a mode screen
// that can simply not render it. Conditional mounting is what lets the caller build the breakdown
// data ONLY when the panel is up (a prop would be evaluated on every render of the mode, finished
// run or not), and it makes "open" one fact — the component exists — instead of two that can
// disagree. Every hook below therefore runs in the open state, unconditionally.
export default function RunBreakdown({
  onClose,
  data,
  fmtDate,
  title,
}: {
  onClose: () => void
  data: RunBreakdownData
  fmtDate: FmtDate
  // The card's heading, chosen by the mode for what that mode actually measures: "Mean Breakdown"
  // (MoX), "Round Breakdown" (Blitz per round) or "Run Breakdown" (Blitz per question). The mode
  // owns the word for its own unit of play; this component owns nothing but the layout.
  title: string
}) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLUListElement | null>(null)
  const { scrolledFromTop, atBottom } = useScrollEdgeState(scrollRef, true)
  // Term 1 of the modal contract: move focus INTO the dialog on open, so a screen reader announces a
  // modal and the keyboard starts inside it rather than on the stat strip under the scrim.
  useEffect(() => {
    cardRef.current?.focus()
  }, [])
  useModalEscape(true, onClose, false) //  no text box to guard (and, since round 21, no buttons at all)
  useBackButton(true, onClose, 'run-breakdown')

  const { rows, summary, fastestIdx, slowestIdx } = data
  return createPortal(
    <div
      data-settings-modal
      role="presentation"
      className={MODAL_SCRIM_CLASS}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={trapModalTab}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="run-breakdown-title"
        style={MODAL_CARD_SHADOW}
        className={MODAL_CARD_CLASS}
      >
        <div className="px-4 flex items-baseline justify-between gap-2">
          <span id="run-breakdown-title" className="text-sm font-semibold text-(--tx-50)">
            {title}
          </span>
        </div>
        {/* THE SUMMARY. Two columns of label/value pairs, so seven figures fit above the list
            without pushing it off the card.
            ★ WHICH FORMATTER EACH FIGURE TAKES IS THE WCA SPLIT (lib/modeFormat, regulation 9f1),
            APPLIED PER FIGURE RATHER THAN PER SECTION — which is what this block got wrong until
            round 22's fixer: it sent all of them through the ROUNDING formatter on the reasoning
            that "the summary is aggregates", and Fastest and Slowest are not aggregates. They are
            SINGLE SOLVES — the very rows below, which truncate — so a 0.395s solve printed
            "Fastest 0.40s" above its own row reading "fastest 0.39s", the panel contradicting itself
            about one number in two places. Both now truncate, exactly as their rows do.
            Mean, Median and Spread keep fmtTime: the first two are averages, and Spread is a
            DIFFERENCE of two times rather than a time anybody solved.
            ⚠ SPREAD IS A DIFFERENCE OF TWO ROUNDED-LOOKING NUMBERS AND IS COMPUTED FROM THE RAW
            ONES, so it can print a hundredth away from (slowest − fastest) as displayed. That is
            the correct trade: rounding the inputs first to make the subtraction "look right" would
            print a spread the run does not have. It reads null — and is omitted — unless there are
            at least two DISTINCT times to span, because a spread of 0.00s across identical solves
            is a fact about nothing. */}
        <div className="px-4 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
          <Figure label="Solves" value={`${summary.solves}/${summary.cards}`} />
          <Figure label="Accuracy" value={fmtAccuracyPct(summary.solves, summary.cards)} />
          <Figure label="Mean" value={fmtTime(summary.mean)} />
          <Figure label="Median" value={fmtTime(summary.median)} />
          <Figure label="Fastest" value={truncTime(summary.fastest)} />
          <Figure label="Slowest" value={truncTime(summary.slowest)} />
          {summary.spread != null && <Figure label="Spread" value={fmtTime(summary.spread)} />}
        </div>
        {/* THE LIST. The shared scroll-region recipe (components/scrollRegion): the card owns py-4
            only, this scroller owns the px-4, which puts the right padding INSIDE the scroller as
            the text-free lane the iOS overlay scrollbar paints in. max-h caps a thousand-solve run
            without growing the card off-screen — and without the mode page behind it ever scrolling,
            which is the constraint this whole panel exists inside. */}
        <ul
          ref={scrollRef}
          className={`${SCROLL_REGION_CLASS} max-h-[45vh] text-xs ${scrollFadeClass(scrolledFromTop, atBottom)}`}
        >
          {rows.map((r, i) => (
            <li
              key={r.n}
              className="flex items-baseline gap-2 py-0.5"
              data-solve-row={r.n}
              data-solve-accent={
                i === fastestIdx ? 'fastest' : i === slowestIdx ? 'slowest' : undefined
              }
            >
              {/* The card's own number — the same figure the Q# badge shows on this run, so a row
                  and the card it names can be matched by eye. Fixed width + tabular-nums so a
                  three-digit number does not shove the letters and dates out of column.
                  ⚠ THE WIDTH IS THE WIDEST NUMBER THIS LIST ACTUALLY HAS, not the widest the app
                  can produce (round 22's fixer). It was `w-8` — 2rem, room for "1000." — which on a
                  two-solve run left a visible gap between "1." and the weekday letter for digits
                  that were never coming. `ch` is the width of a "0" and tabular-nums makes every
                  digit exactly that, so digits + 1 covers the number and its period with a hair to
                  spare (a "." is narrower than a digit). The row count IS the widest number, because
                  `n` is the 1-based position in the run (engine/runBreakdown), and it is measured
                  once for the whole list — so the column is still one width and everything behind
                  it still lines up. */}
              <span
                style={{ width: `${String(rows.length).length + 1}ch` }}
                className="shrink-0 tabular-nums text-(--mut-color)"
              >
                {r.n}.
              </span>
              {/* THE WEEKDAY, as one letter (lib/format's DAY_LETTER — How to Play's breakdown notes
                  carry the key). Beside the date and BEFORE it, the way a written date leads with its
                  day ("Thu, 4 Jan"), and in a fixed-width, centred box: the letters are not equally
                  wide (W against R), and a content-sized box would stagger every date after it.
                  The box is PresetManager's ✓ column, class for class, for the same reason.
                  ⚠ THE LETTER IS aria-hidden AND THE FULL NAME IS sr-only — the idiom every quiet
                  marker in this app uses (that ✓, the switcher's amnesic "A", the footer's Changelog
                  dot). "R" read aloud names nothing; "Thursday" is what the letter says. */}
              <span className="w-3 shrink-0 text-center text-(--mut-color)">
                <span aria-hidden="true">{DAY_LETTER[r.wday]}</span>
                <span className="sr-only">{DAY[r.wday]}</span>
              </span>
              <span className="flex-1 min-w-0 text-(--tx-100-80)">
                {fmtDate(r.question.y, r.question.m, r.question.d, r.question._fmt)}
              </span>
              {/* THE WORDS SIT LEFT OF THE TIME, because each one LABELS the number after it — the
                  owner's call, and it reads the way a stat line does ("fastest 2.00s").
                  THE QUIET ACCENT on the fastest and the slowest solve is the honest stand-in for
                  "trimmed" in an app that does not trim: it points at the two solves a trimmed
                  average would have thrown away, and then keeps them in the mean, which is exactly
                  what this mode does. A WORD, not a colour: a colour alone says nothing to a screen
                  reader and nothing to a colour-blind player, and this panel's whole job is to be
                  checkable. Neither is drawn when every time is identical — see runBreakdown.
                  ★ THE MARK (missed/shown/overridden) GOES ON THE SAME SIDE, and for the same reason
                  rather than for symmetry: it labels the value after it too — almost always the dash,
                  where it answers "why is there no time here?". Leaving it trailing would also have
                  made it the one thing on the row's right edge that is not the time, which is exactly
                  the edge the time column is aligned on; with every word on the left, that edge
                  belongs to the times alone, whichever words a row carries. */}
              {i === fastestIdx && <span className="shrink-0 text-(--mut-color)">fastest</span>}
              {i === slowestIdx && <span className="shrink-0 text-(--mut-color)">slowest</span>}
              {r.mark && <span className="shrink-0 text-(--mut-color)">{MARK_WORDS[r.mark]}</span>}
              {/* THE TIME, LAST AND RIGHT-ALIGNED, so the times form one column down the list: the
                  date before them is flex-1, which pins every time's right edge to the row's.
                  min-w-[6ch] gives the short values — a dash, a sub-ten-second "2.00s" — the width of
                  a two-digit-second time, so the WORDS beside them line up as well instead of
                  sliding right towards a narrow dash; only a time of a minute or more outgrows it.
                  (`ch` is the width of a "0", and tabular-nums sets every digit to that width.)
                  ⚠ whitespace-nowrap, for the reason every other time readout in the app carries it:
                  since the em-dash ceiling came off the formatters a long solve reads "1m 2.34s",
                  and that space is a line-break opportunity that would split one number across two
                  lines in this narrow column. A dash here means the card contributed no time — a
                  miss, or a correct answer that came after a wrong one. */}
              <span className="shrink-0 min-w-[6ch] text-right tabular-nums whitespace-nowrap text-(--tx-200-80)">
                {truncTime(r.time)}
              </span>
            </li>
          ))}
        </ul>
        {/* NO dismiss button (round 21, Q5): the scrim tap, Escape and Android Back all already
            dismiss, and the owner wanted the row back. The card is now title + summary + solve
            list only. With zero focusable controls the modal contract's Tab trap keeps focus
            pinned on this card (tabIndex={-1}, focused on open) rather than letting Tab walk out
            to the screen under the scrim — see trapModalTab's degenerate branch. */}
      </div>
    </div>,
    document.getElementById('root')!,
  )
}
