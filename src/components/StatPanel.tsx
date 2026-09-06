import { useRef, useLayoutEffect, useEffect } from 'react'
import type { ElementType, ReactNode, Ref } from 'react'
import { fitScale } from '../lib/statFit.js'

// StatPanel — the horizontal stats strip (Score / Accuracy / Streak / Last /
// Average / Median) shown under the header in the timed/scored modes.
//
// Pure presentational shell: it renders whatever `stats` array it's given (each item
// {label, value, fn?, off?}) as equal-width cells separated by thin dividers.
// A cell with `fn` renders as a button.
//
// ★ THE THREE SIGNALS (C1, round 16) — one meaning each, and NO STRIKETHROUGH ANYWHERE:
//   • an em dash (—)  = there is no data YET, but there could be. It is produced by the VALUE
//                       ITSELF (fmtTime/truncTime/fmtAccuracyPct return '—' with nothing recorded),
//                       and by `dimmed` below, which is the same statement at strip scale.
//   • BLANK           = this group is HIDDEN. Comes from `off` and from nothing else.
//                       ⚠ "HIDDEN", NOT "still recording", AND NOT "you turned it off" — both of
//                       those are true of most callers and false of some, and this panel cannot tell
//                       which caller it has. Recording continues for the scoring trio in every mode,
//                       and for the timing trio in Blitz/AoX (visual-only, Q8). It does NOT continue
//                       for the timing trio in Classic/Deduction/Flash: there `off` rides the same
//                       flag as useGameEngine's `tracking`, so hiding actually STOPS the clock and
//                       re-enabling after answering costs a full reset (modes/modeHooks
//                       toggleTimingOff). And `off` is not always the user's own doing: Classic and
//                       Deduction SHIP with timing hidden (store/modePrefs), so the most-seen blank
//                       in the app is a launch default nobody chose.
//   • DIM             = nothing is being recorded at all (Save Stats off). Comes from `dimmed`, and
//                       applies to the WHOLE STRIP — never to one cell, because "this cell is not
//                       recording" is not a state the app has.
// The full table this builds to:
//   group on, no data ....... the values, which read '—'      plain
//   group on, has data ...... the values                      plain
//   group OFF ............... value cells BLANK, labels stay  plain
//   Save Stats off .......... '—' in every value cell         whole strip dimmed
//   group off + Save off .... value cells BLANK               whole strip dimmed
// Blank beats dash: your own choice is the more specific statement, so it is the one shown.
//
// It replaced a scheme where ONE `off` flag — `scoringOff || !saveStats` in modeHooks — drove BOTH
// a label strikethrough and an em dash. Two different facts arrived as one bit, so Save Stats off
// struck every box and your per-group choices became invisible underneath it (they were never lost;
// scoringOff/timingOff persisted and came back). And a shown-but-empty stat already read as a dash,
// so a dash could mean either "hidden" or "nothing yet" and a tap's effect was unpredictable. The
// two facts are now two flags — `off` (yours, per group) and `dimmed` (the app's, whole strip).
//
// ⚠ THE VALUE CELL IS A FIXED-HEIGHT BOX AND THE VALUE IS CENTRED IN IT — `h-[1lh]` on the wrapper
// around each value span. It answers two things at once, and it replaced a NBSP the value span
// rendered when blank (which answered only the first, and only for a blank cell):
//   1. a BLANK cell still reserves its height. An empty inline box has no line box and therefore no
//      height, so a cell that rendered literally nothing would collapse and the whole strip would
//      jump the instant you toggled a group off.
//   2. a SHRUNKEN cell keeps the same height, which the strut never covered. The auto-fit below
//      sets a smaller font-size on the value span; a smaller span has a shorter line box, and in
//      this top-packed column that put its glyphs HIGHER than its un-shrunk neighbours' — the
//      owner's photo of "940/1001" sitting smaller AND higher than the "93.9%" beside it. It is the
//      same class as the ⚙ footer-button catch (SettingsPanel's fitFooterBtns, 2026-07-13): a
//      fitted size and an un-fitted strut in the same box do not share a line. Here the fix cannot
//      be that one's ("size the container so the strut shrinks WITH the text") — these six boxes fit
//      INDEPENDENTLY, so a shrinking strut would make each cell a different height. Instead the box
//      stops depending on its content: one base-size line box tall always, value centred inside it.
//      Sizes still differ between boxes — that is the auto-fit doing its job, and forcing every box
//      down to the longest value's size would be a worse defect — but they now sit on one line.
// `1lh` is the wrapper's OWN line box (its `text-sm leading-tight`), so this is self-maintaining in
// exactly the way the NBSP was: change the base type and the height follows, with no number here to
// drift out of sync. It is also not a fixed pixel height — rem-based, so it rides index.css's fluid
// root font like everything else (tests/heightGuard.test.js). And the unit costs no browser support
// this app did not already spend: Tailwind v4's own preflight ships a `min-height: 1lh` into our
// built CSS, and v4's floor (Safari 16.4) is the same release that shipped `lh`.
//
// ⚠ AND IT CARRIES A SCREEN-READER-ONLY "Off" (a sibling `sr-only` span, so the auto-fit target
// below stays a single plain text node). Blank is a perfectly good visual signal and no signal at
// all to someone who cannot see it; without this word the cleanest state would also be the silent
// one. The reserved height is silent either way — an empty box announces nothing.
//
// ⚠ THE DIM CARRIES A WORD TOO, FOR EXACTLY THE SAME REASON — one sr-only line at the top of the
// strip when `dimmed`. C1 promoted the dim to a first-class signal with a meaning of its own
// ("nothing is being recorded"), and a meaning that only exists as an opacity is no meaning at all
// to someone who cannot see it: without this line, Save Stats off and a strip that simply has no
// data yet both announce as six dashes. It sits on the strip and not on a cell because the fact is
// the strip's — the same reason `dimmed` is one flag rather than six. `sr-only` is absolutely
// positioned, so like the "Off" it costs no layout and moves no pixel.
//
// VALUE AUTO-FIT (Q3): each value box AUTO-FITS — a per-box measure-and-scale keeps any value, however
// long (a big Score "12345/67890", a long solve time), inside its own cell on every device, while short
// values stay at the normal size. The math is in fitScale; the wiring is the layout effect below. It
// replaced a tiered char-count shrink that only ran on fractional values and triggered on the longest
// SIDE (so "123/456" didn't shrink but the narrower "1000/2" did), and never shrank the time boxes.
//
// `armedSpan` is the Bug-#4 affordance: when present it replaces stats[startIdx..endIdx] with one wide
// "Enable and Reset Stats?" confirmation button, using two 1px phantom spacers so the surrounding flex
// math (and the Streak-right divider position) stays pixel-identical.
//
// Extracted from main.jsx in Stage C, Step 4b. ⚠ The label's className keeps a SPACE before `${s.off…}`
// (`whitespace-nowrap ${`). It's required: Tailwind v4's source scanner silently drops any utility glued
// directly to `${` when that class appears nowhere else, which made the stat labels wrap. Don't "tidy"
// the space away. (Calendar Game layout bug-fix, 2026-06-01.)
export interface StatItem {
  label: string
  value: string | number
  fn?: (() => void) | null //  null = the stat is present but non-interactive (Save Stats off / non-toggleable mode)
  off?: boolean //  the hide flag for this group, and ONLY that → the value cell renders blank (+ an sr-only "Off"). Never folded together with Save Stats — see the three-signal note above.
}
// The fixed-height box each value is CENTRED in — the height every cell keeps whether its value is
// blank, short, or shrunk by the auto-fit. Declared once, here, because it is also the element the
// fit measures against (`s.parentElement.clientWidth` in fitAll below), so its three jobs have to be
// read together. See the ⚠ note at the top of this file for the two defects it closes.
//   • h-[1lh] ......... one line box of the wrapper's OWN type — the text-sm/leading-tight it also
//                       carries, which is the base size the value span inherits. So the box is
//                       exactly as tall as an unshrunk value: nothing moves for a value that never
//                       shrinks, and a value that does shrink no longer shortens its own box.
//   • w-full .......... ⚠ REQUIRED, and not for looks. Without it this wrapper is a shrink-to-fit
//                       flex item, its `clientWidth` reports the VALUE's width instead of the
//                       CELL's, and fitAll would then read every box as ~8px too narrow and shrink
//                       it for ever. It is also what lets the centring below use the whole cell.
//   • items/justify ... centre the value in the box on both axes — the alignment fix itself.
const VALUE_CELL_CLASS =
  'mt-0.5 w-full h-[1lh] text-sm leading-tight flex items-center justify-center'
export interface ArmedSpan {
  startIdx: number
  endIdx: number
  label: ReactNode
  onClick?: () => void
}

// The armed-button ref is passed SEPARATELY from `armedSpan` (not nested inside it). Bundling a ref into
// a data object makes React's compiler treat every read of that object as a ref access during render, so
// it's kept apart: `armedSpan` is plain data, `armedBtnRef` is the ref, forwarded straight to the
// button's `ref=` (an allowed use).
export default function StatPanel({
  stats,
  dimmed,
  armedSpan,
  armedBtnRef,
}: {
  stats: StatItem[]
  // Nothing is being recorded (Save Stats off). The dim and the em dashes are ONE fact and are
  // therefore ONE flag: no mode can dim without dashing or dash without dimming, and no mode has to
  // remember to do both. It replaced five identical `<div className={saveStats ? '' : 'opacity-50'}>`
  // wrappers — one per mode screen — sitting beside five separate `!saveStats` terms folded into the
  // per-item `off`s. Every mode screen now passes `dimmed={!saveStats}` and says it once.
  //
  // ⚠ REQUIRED, not optional-with-a-default, and that is the point: a screen that FORGOT to dim
  // would keep showing live-looking readouts for stats nothing is recording, and no test that
  // doesn't already know to look for it would notice. Required makes the omission a compile error,
  // so a sixth mode cannot ship the bug — the enforcement lives in the type rather than in a guard
  // test that would have to remember to enumerate every call site.
  dimmed: boolean
  armedSpan?: ArmedSpan | null
  armedBtnRef?: Ref<HTMLButtonElement>
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  // Auto-fit every value box to its width: reset each value to the base font, measure its natural width
  // vs its cell's width, then set a font-size that fits (capped at the base). Batched (reset-all →
  // measure-all → apply-all) to avoid layout thrash. Runs after layout but BEFORE paint (useLayoutEffect)
  // so there's never a flash of oversized text; re-runs on a panel resize (ResizeObserver) and on
  // web-font load. `min-w-0` on the cells keeps each box at its 1/N share during the measure (a long
  // value overflows the fixed cell instead of widening it, so cell.clientWidth is the true target). In
  // jsdom (no layout → widths 0) fitScale returns 1, so this is a no-op and the value renders at base.
  // A BLANK cell (`off`) renders no text at all, so it measures 0 wide and fitScale returns 1 — no
  // shrink, and no path to a zero divisor either way (fitScale guards natural > 0 for exactly the
  // case where a value box measures nothing at all).
  // ⚠ THE SIZE GOES ON THE VALUE SPAN AND NOWHERE ELSE, and that is only safe because the span sits
  // inside VALUE_CELL_CLASS's fixed-height box — a fitted size on a content-sized box is the
  // misalignment this file's ⚠ note describes. `s.parentElement` IS that box (w-full, no padding,
  // so its clientWidth is the cell's); if the value ever grows another wrapper, this read has to
  // follow it or every box measures the wrong target.
  const fitAll = () => {
    const root = rootRef.current
    if (!root) return
    const spans = Array.from(root.querySelectorAll<HTMLElement>('[data-statval]'))
    spans.forEach((s) => {
      s.style.fontSize = '' // reset all to the base (text-sm) BEFORE measuring (avoids a feedback loop)
    })
    // ⚠ Both reads stay as they are — round 10's sub-pixel sweep (--bar-h in main.tsx, the guide's
    // panel heights) skipped them on purpose. scrollWidth is the ONLY platform measure of a
    // clamped span's NATURAL width; rect.width would report the CLAMPED width, a different number
    // rather than a sharper one. clientWidth excludes border and scrollbar where rect.width
    // includes both, so that swap would change which box is being fitted. Both feed a ratio, and
    // a rounded pixel of it is imperceptible in a font size.
    const measured = spans.map((s) => ({
      s,
      natural: s.scrollWidth,
      avail: (s.parentElement?.clientWidth ?? 0) - 8, // a little breathing room from the dividers
      base: parseFloat(getComputedStyle(s).fontSize) || 0,
    }))
    measured.forEach(({ s, natural, avail, base }) => {
      const scale = fitScale(natural, avail)
      s.style.fontSize = scale < 1 && base > 0 ? `${base * scale}px` : ''
    })
  }
  // No deps: the values can change on any render, so re-fit each time (cheap — a handful of spans, batched).
  useLayoutEffect(() => {
    fitAll()
  })
  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => fitAll())
    ro.observe(root)
    let cancelled = false
    if (typeof document !== 'undefined' && document.fonts?.ready)
      document.fonts.ready.then(() => {
        if (!cancelled) fitAll()
      })
    return () => {
      cancelled = true
      ro.disconnect()
    }
  }, [])

  return (
    <div
      ref={rootRef}
      className={`mt-4 rounded-2xl panel flex overflow-hidden ${dimmed ? ' opacity-50' : ''}`}
    >
      {/* The word that keeps the DIM from meaning nothing to a screen reader — see the header note.
          Absolutely positioned by `sr-only`, so it is outside the flex flow, adds no cell and costs
          no layout. First child so it is announced before the readouts it qualifies. */}
      {dimmed && <span className="sr-only">Stats are not being saved</span>}
      {(() => {
        const items: ReactNode[] = []
        for (let i = 0; i < stats.length; i++) {
          if (armedSpan && i === armedSpan.startIdx) {
            const span = armedSpan.endIdx - armedSpan.startIdx + 1
            // Bug #4 aesthetic: no ring or rounded corners on the merged warning button. The text change
            // ('Enable and Reset Stats?') is the sole visual cue. The standard vertical divider between
            // Streak and this button is already present (it was the Streak|Last divider in unarmed state)
            // — no element positions shift between armed and unarmed states.
            //
            // Phantom spacers: when the 3 time stat boxes merge into 1 warning button, 2 internal dividers
            // (Last|Avg and Avg|Med) disappear from the flex row. Without compensation, those 2px get
            // redistributed across the remaining flex items, shifting the Streak-right divider 1px right
            // and stretching every box before it. Two 1px-wide transparent spacers — one before, one after
            // the button — restore exact unarmed flex math: Streak-right divider is locked in place and the
            // warning text sits exactly centered between that divider and the panel's right edge.
            items.push(<div key="armed-spacer-l" className="w-px shrink-0" />)
            items.push(
              <button
                key="armed-warning"
                ref={armedBtnRef}
                type="button"
                onClick={armedSpan.onClick}
                style={{ flex: span }}
                className="flex items-center justify-center py-2 text-xs font-medium"
              >
                {armedSpan.label}
              </button>,
            )
            items.push(<div key="armed-spacer-r" className="w-px shrink-0" />)
            if (armedSpan.endIdx < stats.length - 1) {
              items.push(
                <div
                  key={`d-armed-${i}`}
                  className="w-px h-8 self-center bg-(--bg-500-20) shrink-0"
                />,
              )
            }
            i = armedSpan.endIdx
            continue
          }
          const s = stats[i]
          const Tag: ElementType = s.fn ? 'button' : 'div'
          const props = s.fn ? { type: 'button' as const, onClick: s.fn } : {}
          items.push(
            <Tag
              key={s.label}
              {...props}
              className="flex-1 min-w-0 flex flex-col items-center py-2 gap-0.5"
            >
              <span className="text-xs text-(--tx-200-80) leading-none whitespace-nowrap">
                {s.label}
              </span>
              {/* The fixed-height value cell — see VALUE_CELL_CLASS. It owns the base type
                  (text-sm/leading-tight) for BOTH itself and the span inside it, deliberately: `1lh`
                  is only the right height while the two agree, and one declaration cannot disagree
                  with itself. Don't re-add text-sm to the span. */}
              <div className={VALUE_CELL_CLASS}>
                {/* data-statval: the auto-fit target. It inherits the cell's base size; the layout
                    effect shrinks its inline font-size to fit when the value is too wide, and the
                    cell keeps it on its neighbours' line. `whitespace-nowrap` is load-bearing since
                    the em-dash ceiling came off the time formatters: a time of a minute or more now
                    reads "1m 2.34s" (lib/modeFormat), and that SPACE is a break opportunity the old
                    times never had — without this class the value
                    would wrap to two lines inside a one-line-tall box, and scrollWidth would report
                    the wrapped width rather than the natural one the fit needs. The text stays plain
                    DOM text — one node, no element children — so it reads normally to screen readers
                    and so `.textContent` is the value and nothing else. */}
                <span data-statval className="font-semibold tabular-nums whitespace-nowrap">
                  {s.off ? '' : dimmed ? '—' : s.value}
                </span>
              </div>
              {/* The word that keeps "blank" from meaning "silent" — see the header note. Absolutely
                  positioned by `sr-only`, so it is outside the flex flow and costs no layout. */}
              {s.off && <span className="sr-only">Off</span>}
            </Tag>,
          )
          if (i < stats.length - 1) {
            items.push(
              <div key={`d-${i}`} className="w-px h-8 self-center bg-(--bg-500-20) shrink-0" />,
            )
          }
        }
        return items
      })()}
    </div>
  )
}
