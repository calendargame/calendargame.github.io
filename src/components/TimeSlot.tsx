import type { CSSProperties, ReactNode, Ref } from 'react'
import SliderValueEditor from './SliderValueEditor.jsx'
import { SLIDER_READOUT_WIDEST } from '../lib/modeFormat.js'

// TimeSlot — ONE SLOT: A TIME LIMIT'S SLIDER, AND THE COUNTDOWN IT SETS. Blitz's (Round 26, Q12, the
// owner's idea) and Flash's (Round 26, the owner's go after he had Blitz's on his phone): one
// component, so the two modes' slots cannot come to differ. The two halves were never useful at the
// same moment — idle, a countdown under the slider only repeated the slider's own number; while the
// clock runs, the slider was a dimmed control nobody could move — so they share one row:
//   • IDLE — the slider and its value box (tap the value to type).
//   • WHILE THE CLOCK IS UP (`up`: from Begin until Reset in Blitz; in Flash from Begin until the
//     flash is answered right or reset, and while a Reveal or Show Codes holds it frozen) — the same
//     track is the countdown. The slider fades out, thumb and fill with it, and the countdown's track
//     fades in exactly over it: the same size, the same unfilled colour (the range rules in
//     index.css), full at the start and draining from there. The value box's place shows the time
//     left, in the same cell and the same type, so the number never moves. A countdown that has
//     stopped stays on screen where it stopped until the mode puts the slider back. Nothing changes
//     size: the input stays mounted under the countdown, so the track keeps its box, and the value
//     cell keeps the widest-value strut.
//   • The cross-fade is decorative and runs on --motion-scale (index.css's .range-slot /
//     .range-clock): with Reduce Motion it is instant. The drain itself is the countdown's functional
//     motion, transform:scaleX on its fill (`barRef`, which the mode drives: Blitz a frame at a time,
//     Flash by one transition per flash).
//   • KEYBOARD AND SCREEN READERS: while it is a countdown the slider is disabled (not operable, not
//     focusable) and hidden from assistive tech, the value box with it; what is there instead is a
//     timer, read as "Time left" and its value — `timeLeft`, or what the mode writes into `timeRef`.
export default function TimeSlot({
  up,
  min,
  max,
  step,
  value,
  onChange,
  onCommit,
  label,
  fill,
  inputMode,
  format,
  toText = String,
  fromText,
  barRef,
  timeRef,
  timeLeft,
}: {
  up: boolean
  min: number
  max: number
  step: number
  value: number
  /** The slider moved (or the value box committed, unless `onCommit` says otherwise). */
  onChange: (value: number) => void
  onCommit?: (value: number) => void
  /** The slider's name, and its value box's. */
  label: string
  /** How far along its track the slider's fill reaches (its --rng-fill). */
  fill: string
  inputMode: 'decimal' | 'numeric'
  format: (value: number) => string
  toText?: (value: number) => string
  fromText?: (typed: number) => number
  barRef: Ref<HTMLSpanElement>
  timeRef?: Ref<HTMLSpanElement>
  timeLeft?: ReactNode
}) {
  return (
    <div className="mt-3 flex items-center gap-2">
      <span className="relative flex-1 min-w-0">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(+e.target.value)}
          disabled={up}
          aria-hidden={up || undefined}
          aria-label={label}
          style={{ '--rng-fill': fill } as CSSProperties}
          className={`range-slot block w-full ${up ? 'opacity-0' : 'opacity-100'}`}
        />
        <span aria-hidden="true" className={`range-clock ${up ? 'opacity-100' : 'opacity-0'}`}>
          <span ref={barRef} />
        </span>
      </span>
      {/* The value cell: the value box and the time left stacked in ONE grid area, so they share a
          box — the value box's widest-value strut sets it, and both are one text-xs line in it, on
          one baseline. (The flex wrapper keeps the value box's inline-block from sitting on a line
          of the row's own, larger, text.) */}
      <span className="grid shrink-0">
        <span className={`col-start-1 row-start-1 flex ${up ? 'invisible' : 'visible'}`}>
          <SliderValueEditor
            // A new limit (Blitz's Per Round and Per Question have different ones) is a new box.
            key={label}
            value={value}
            min={min}
            max={max}
            snap={step}
            disabled={up}
            inputMode={inputMode}
            label={label}
            format={format}
            toText={toText}
            fromText={fromText}
            widest={SLIDER_READOUT_WIDEST}
            onCommit={onCommit ?? onChange}
          />
        </span>
        <span
          role="timer"
          className={`col-start-1 row-start-1 whitespace-nowrap tabular-nums text-xs text-right ${up ? 'visible' : 'invisible'}`}
        >
          <span className="sr-only">Time left </span>
          <span ref={timeRef}>{timeLeft}</span>
        </span>
      </span>
    </div>
  )
}
