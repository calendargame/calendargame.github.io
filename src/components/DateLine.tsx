// DateLine — the big date on every mode's card, and the room it is given (Round 26, Q7).
//
// ★ THE DATE IS CENTRED, AND STOPS SHORT OF THE CARD NUMBER'S CORNER BY THE SAME INSET ON BOTH
// SIDES (the owner's ruling). The card number (components/CardNumber, "Q12" while browsing back)
// keeps its place at the card's top-right corner; the date line sits between two equal side
// columns, each exactly as wide as the widest number of `numberDigits` digits, in the number's own
// type (CardNumberSizer — so the inset is the device font's, never a pixel guess). `numberDigits` is
// the digit count of the highest number the badge can show now (gameReducer's topCardNumber): the
// corner grows a digit only when the count does. The right column is the number's corner; the left
// one mirrors it, which is what keeps the date centred on the card. So the number and the date can
// never touch, at any size, in any font. The columns are there whether or not the number is
// showing: the date's size must not change when browsing back begins. On a card wide enough that the
// widest date would not reach the corner anyway, they cost the date nothing (it is at full size,
// centred, either way); they make it smaller only where it would otherwise meet the number.
//
// ★ ONE SIZE PER CARD, FROM THE WIDEST DATE THE CARD CAN SHOW (lib/dateLineFit). Which dates those
// are is `formats` — every format a date on this card can carry: the one Date Format sets (all five
// while Random Format is on), and the format of every date the mode is holding (one browsed back
// to keeps the format it was drawn in, so a format change cannot leave a wider one without room).
// `partial` adds Deduction's dates with a piece missing. Nothing about the date being SHOWN is read,
// so the size never changes from one question to the next.
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import type { FormatId } from '../lib/format.js'
import { fitDateLine, refitDateLine } from '../lib/dateLineFit.js'
import { DATE_LINE_CLASS } from './controlClasses.js'
import { CardNumberSizer } from './CardNumber.jsx'

export default function DateLine({
  formats,
  partial = false,
  numberDigits,
  children,
}: {
  formats: readonly FormatId[]
  partial?: boolean
  numberDigits: number
  children: ReactNode
}) {
  const line = useRef<HTMLDivElement>(null)
  const shapes = `${formats.join(' ')}${partial ? ' partial' : ''}`
  // Watched for as long as it is mounted…
  useLayoutEffect(() => fitDateLine(line.current), [])
  // …and a change of what the card can show, or of the corner it keeps, is a change of size, decided
  // before the frame is drawn.
  useLayoutEffect(() => {
    if (line.current) refitDateLine(line.current)
  }, [shapes, numberDigits])
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-1">
      <CardNumberSizer digits={numberDigits} />
      <div ref={line} data-date-shapes={shapes} className={DATE_LINE_CLASS}>
        {children}
      </div>
      <CardNumberSizer digits={numberDigits} />
    </div>
  )
}
