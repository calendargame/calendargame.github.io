// tests/modeFormat.test.js — the stat-strip time formatters (src/lib/modeFormat.ts).
//
// ★ WHY THIS FILE EXISTS. Both formatters used to return an em dash for `t >= 60`, so a 62-second
// solve and an empty stat box drew the same glyph — while StatPanel's three-signal contract
// (tests/statBoxSignals.dom.test.jsx) documents the dash as "there is no data YET". The ceiling is
// gone: a time is ALWAYS rendered as a time, and the dash means `t == null` and nothing else.
// Nothing pinned truncTime/fmtTime before this file, which is how a formatter and the panel it feeds
// came to document opposite meanings for the same character.
//
// The two halves worth reading twice:
//   • THE WCA HALF (regulation 9f1) — truncTime drops the third decimal, fmtTime rounds it, and
//     neither may drift a hundredth. The sweeps below assert the sub-minute output against an
//     independent statement of each rule (toFixed's own rounding; the measured time's digits with
//     the last two struck), so they would catch an implementation that merely looks equivalent —
//     which is what truncTime's first one was.
//   • THE CARRY, which is the trap the minutes shape introduced. Quantizing AFTER the split prints
//     "1m 60.00s" for 119.999. Both formatters therefore reduce to whole hundredths first.
//
// Node environment (no jsdom needed): modeFormat's only module-scope side effect is `isTouch`, which
// short-circuits on `typeof window !== 'undefined'`.
import { describe, it, expect } from 'vitest'
import { truncTime, fmtTime, fmtAccuracyPct } from '../src/lib/modeFormat.js'

const EM_DASH = '—'

describe('truncTime / fmtTime — the em dash means ONE thing: no data', () => {
  it('null is the only input that renders a dash', () => {
    expect(truncTime(null)).toBe(EM_DASH)
    expect(fmtTime(null)).toBe(EM_DASH)
  })

  // ★ THE DEFECT. Every one of these used to render EM_DASH — indistinguishable from "nothing
  // recorded yet" on a strip where the dash is documented to mean exactly that.
  it('a long time is a long time, never a dash — 60s, a minute-plus, an hour-plus', () => {
    for (const t of [60, 62.35, 600, 3600, 90000]) {
      expect(truncTime(t)).not.toBe(EM_DASH)
      expect(fmtTime(t)).not.toBe(EM_DASH)
    }
  })
})

describe('truncTime / fmtTime — the shape', () => {
  it('under a minute is unchanged: plain seconds to two decimals', () => {
    expect(truncTime(0)).toBe('0.00s')
    expect(fmtTime(0)).toBe('0.00s')
    expect(truncTime(9.999)).toBe('9.99s') // truncated
    expect(fmtTime(9.999)).toBe('10.00s') // rounded
    expect(fmtTime(0.05)).toBe('0.05s') // the leading zero of a sub-decisecond time survives
  })

  it('a minute or more takes the repo minutes shape — fmtBlitzT’s "2m 55s", to hundredths', () => {
    expect(fmtTime(60)).toBe('1m 0.00s')
    expect(fmtTime(62.35)).toBe('1m 2.35s')
    expect(truncTime(62.349)).toBe('1m 2.34s')
    expect(fmtTime(62.349)).toBe('1m 2.35s')
    expect(fmtTime(600)).toBe('10m 0.00s')
    expect(fmtTime(3599.99)).toBe('59m 59.99s')
  })

  it('an hour or more adds hours, and hours never roll over into days', () => {
    expect(fmtTime(3600)).toBe('1h 0m 0.00s')
    expect(fmtTime(3723.45)).toBe('1h 2m 3.45s')
    expect(fmtTime(90000)).toBe('25h 0m 0.00s') // 25 hours, not "1d 1h"
  })

  // Every unit below the largest one present is shown even when it is zero: dropping the empty
  // minute from 1h 4s would print "1h 4.00s", which reads as one hour four MINUTES at a glance.
  it('a zero minute inside an hour is still printed', () => {
    expect(fmtTime(3604)).toBe('1h 0m 4.00s')
  })

  // Seconds are NOT zero-padded, deliberately: fmtBlitzT is the repo's one minutes shape ("5m 0s")
  // and it does not pad. Pinned so a later "tidy" to "1m 02.34s" has to argue with this line.
  it('the seconds part is not zero-padded', () => {
    expect(fmtTime(62)).toBe('1m 2.00s')
    expect(fmtTime(60.5)).toBe('1m 0.50s')
  })
})

// ⚠ THE CARRY. A value that rounds UP across a boundary must move to the larger unit, not print a
// 60 inside the smaller one. This is why the formatters quantize to whole hundredths BEFORE
// splitting; the reverse order prints "1m 60.00s" and "59m 60.00s" and is the single most likely
// way for this code to be rewritten wrongly.
describe('the minute/hour boundary carries correctly', () => {
  it('a rounded time crosses into the next unit rather than printing 60', () => {
    expect(fmtTime(59.999)).toBe('1m 0.00s')
    expect(fmtTime(119.999)).toBe('2m 0.00s')
    expect(fmtTime(3599.999)).toBe('1h 0m 0.00s')
  })

  it('the same inputs TRUNCATED stay just under the boundary — both are right, and they differ', () => {
    expect(truncTime(59.999)).toBe('59.99s')
    expect(truncTime(119.999)).toBe('1m 59.99s')
    expect(truncTime(3599.999)).toBe('59m 59.99s')
  })
})

// ★ THE WCA HALF (regulation 9f1). fmtTime is asserted against its ORIGINAL expression
// (`t.toFixed(2) + 's'`), which the minutes shape must not have moved a hundredth below 60s.
// truncTime is NOT asserted against its original (`Math.floor(t * 100) / 100`), because that
// expression was the bug: it truncated the double rather than the measured time, and showed a 0.29s
// solve as "0.28s". It is asserted against the decimal digits of the time itself.
describe('WCA truncation / rounding is preserved exactly (regulation 9f1)', () => {
  const sweep = []
  for (let c = 0; c < 6000; c += 7) sweep.push(c / 100) // every 0.07s across the sub-minute range
  for (const t of [0.29, 1.13, 8.07, 35.855, 59.994, 0.005, 0.004]) sweep.push(t)

  // The truncation, done on PAPER: write the time out to the 0.1 ms it was measured to and strike
  // the last two digits. No floating-point arithmetic on the value at all.
  const struck = (t) => {
    const [whole, frac] = t.toFixed(4).split('.')
    return `${Number(whole)}.${frac.slice(0, 2)}s`
  }

  it('truncTime drops the third decimal of the time that was MEASURED', () => {
    for (const t of sweep) if (t < 60) expect(truncTime(t)).toBe(struck(t))
    expect(truncTime(9.999)).toBe('9.99s')
    expect(truncTime(35.855)).toBe('35.85s')
  })

  // ★ THE DEFECT, NAMED. 0.29 has no exact double — it is stored a hair below — so truncating the
  // double printed "0.28s": a hundredth FASTER than the solve. One in every few hundredths has this
  // shape, so the sweep is every hundredth there is under a minute.
  it('a time that IS a whole number of hundredths displays as exactly that — never one faster', () => {
    expect(truncTime(0.29)).toBe('0.29s')
    for (let c = 0; c < 6000; c++) expect(truncTime(c / 100)).toBe(`${(c / 100).toFixed(2)}s`)
  })

  it('never displays a time faster than the measured hundredth, anywhere on the 0.1 ms grid', () => {
    // Every 0.1 ms step across ten seconds, built the way a solve time is (engine/stats: a whole
    // count of 0.1 ms, divided down to seconds). The displayed hundredths must be the count with
    // its last two digits struck: never more, and never a hundredth less.
    for (let k = 0; k < 100000; k += 3) {
      const shown = truncTime(k / 10000)
      expect(shown).toBe(
        `${Math.floor(k / 10000)}.${String(Math.floor(k / 100) % 100).padStart(2, '0')}s`,
      )
    }
  })

  it('a time saved before the 0.1 ms grid — the same measurement with float noise on it — reads the same', () => {
    expect(truncTime(126913.4 / 1000 - 123456.7 / 1000)).toBe('3.45s') // 3.4567 measured
    expect(truncTime(0.28999999999999998)).toBe('0.29s')
    expect(truncTime(1.1299999999999999)).toBe('1.13s')
  })

  it('fmtTime still rounds exactly as toFixed(2) rounds', () => {
    for (const t of sweep) {
      const wanted = `${t.toFixed(2)}s`
      if (Number(t.toFixed(2)) < 60) expect(fmtTime(t)).toBe(wanted)
    }
  })

  // ⚠ THE REASON fmtTime READS ITS HUNDREDTHS OFF toFixed's OWN STRING rather than computing
  // Math.round(t * 100): the two disagree here, and only one of them matches what the app printed
  // before this change. 59.995 * 100 is 5999.500000000001 → Math.round 6000 → "1m 0.00s"; toFixed
  // sees the double as a hair below and prints "59.99". A shortcut here silently promotes a
  // sub-minute solve into the minutes shape.
  it('the quantizer matches toFixed, not Math.round(t * 100)', () => {
    expect(Math.round(59.995 * 100)).toBe(6000) // the shortcut's answer, pinned so the case stays real
    expect((59.995).toFixed(2)).toBe('59.99')
    expect(fmtTime(59.995)).toBe('59.99s')
  })
})

// The third formatter on the strip, here because it shares the dash and nothing else pinned it.
describe('fmtAccuracyPct — the same dash, the same one meaning', () => {
  it('dashes only when nothing has been played', () => {
    expect(fmtAccuracyPct(0, 0)).toBe(EM_DASH)
    expect(fmtAccuracyPct(0, 1)).toBe('0.0%')
    expect(fmtAccuracyPct(3, 4)).toBe('75.0%')
  })

  it('never inflates to 100% while a single answer is still wrong', () => {
    expect(fmtAccuracyPct(9999, 10000)).toBe('99.9%')
    expect(fmtAccuracyPct(10000, 10000)).toBe('100.0%')
  })
})
