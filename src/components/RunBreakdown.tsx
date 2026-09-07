import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { FmtDate } from '../modes/modeTypes.js'
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
// components/RunBreakdown — a finished run or round, solve by solve.
//
// Opened by TAPPING ANYWHERE ON THE STAT STRIP once a MoX run is done or a Blitz round has ended
// (StatPanel's onActivate). That gesture is free: on a finished run every stat box is already inert
// — MoX drops its timing toggle on `runComplete` and Blitz on `timerDone`, both because an ended
// strip is a result readout rather than a control — so the strip had a tap going spare and no
// competing meaning. It is also the right place for it: the thing you tap to see the solves is the
// thing showing you the number they add up to.
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
  // "Run breakdown" (MoX) or "Round breakdown" (Blitz). The mode owns the word for its own unit of
  // play — Blitz has no runs and MoX has no rounds — and this component owns nothing but the layout.
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
  useModalEscape(true, onClose, false) //  buttons only — no text box to guard
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
            without pushing it off the card. Every time here goes through fmtTime — the ROUNDED
            formatter — because all five are aggregates or bests, not single solve times; the rows
            below use truncTime, which is the WCA split this app has always kept (lib/modeFormat).
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
          <Figure label="Fastest" value={fmtTime(summary.fastest)} />
          <Figure label="Slowest" value={fmtTime(summary.slowest)} />
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
                  and the card it names can be matched by eye. Fixed width + tabular-nums so three
                  digits do not shove the dates out of column. */}
              <span className="w-8 shrink-0 tabular-nums text-(--mut-color)">{r.n}.</span>
              <span className="flex-1 min-w-0 text-(--tx-100-80)">
                {fmtDate(r.question.y, r.question.m, r.question.d, r.question._fmt)}
              </span>
              {/* ⚠ whitespace-nowrap, for the reason every other time readout in the app carries it:
                  since the em-dash ceiling came off the formatters a long solve reads "1m 2.34s",
                  and that space is a line-break opportunity that would split one number across two
                  lines in this narrow column. A dash here means the card contributed no time — a
                  miss, or a correct answer that came after a wrong one. */}
              <span className="shrink-0 tabular-nums whitespace-nowrap text-(--tx-200-80)">
                {truncTime(r.time)}
              </span>
              {/* THE QUIET ACCENT on the fastest and the slowest solve — the honest stand-in for
                  "trimmed" in an app that does not trim: it points at the two solves a trimmed
                  average would have thrown away, and then keeps them in the mean, which is exactly
                  what this mode does. A WORD, not a colour: a colour alone says nothing to a screen
                  reader and nothing to a colour-blind player, and this panel's whole job is to be
                  checkable. Neither is drawn when every time is identical — see runBreakdown. */}
              {i === fastestIdx && <span className="shrink-0 text-(--mut-color)">fastest</span>}
              {i === slowestIdx && <span className="shrink-0 text-(--mut-color)">slowest</span>}
              {r.mark && <span className="shrink-0 text-(--mut-color)">{MARK_WORDS[r.mark]}</span>}
            </li>
          ))}
        </ul>
        <div className="px-4 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="w-full px-3 py-2 rounded-xl text-sm font-medium border surface-toggle text-(--tx-100-80)"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.getElementById('root')!,
  )
}
