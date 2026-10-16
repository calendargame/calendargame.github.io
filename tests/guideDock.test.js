// tests/guideDock.test.js — ONE SHADOW, UNDER WHICHEVER EDGE THE TEXT IS SLIDING BENEATH.
//
// lib/guideDock decides, from five numbers read off the screen, how strong the open How-to-Play
// header's shadow is and how much of its own shadow the top bar keeps. It is pure arithmetic, so
// the hand-off can be proved here for EVERY position a scroll passes through — which no browser
// test can do, since a browser only shows the frames it happened to paint.
//
// The geometry below is what a real sticky header does, written out: it rides its section until its
// top reaches the line, sticks there while the section scrolls beneath it, and is carried out under
// the bar when the section's foot reaches its own.
import { describe, it, expect } from 'vitest'
import {
  dockShades,
  lineShare,
  releaseShades,
  restGeometry,
  arrivingShades,
  NO_DOCK,
  DOCK_SETTLE_PX,
  DOCK_LINE_BAND_PX,
  edgeBehindBar,
  DOCK_EDGE_PX,
} from '../src/lib/guideDock.js'

const RAMP = 24
const LINE = 71.765625 // a real bar's height: fractional
const HEAD_H = 44.5
const BORDER = 1

// The open header's geometry for a section whose wrapper top is at viewport y `wrapperTop` and
// which is `sectionH` tall — exactly what position:sticky; top:<line> produces.
const sticky = (wrapperTop, sectionH) => {
  const naturalTop = wrapperTop + BORDER
  const floorY = wrapperTop + sectionH - BORDER
  const headerTop = Math.min(Math.max(naturalTop, LINE), floorY - HEAD_H)
  return { lineY: LINE, headerTop, headerBottom: headerTop + HEAD_H, naturalTop, floorY }
}

describe('dockShades — the two strengths', () => {
  it('a header far below the line: no header shadow, the bar keeps all of its own', () => {
    expect(dockShades(sticky(LINE + 400, 1500), RAMP)).toEqual({ header: 0, barYield: 1 })
  })

  it('a header docked with nothing under it: neither — a section just opened does not look pinned', () => {
    // The wrapper's border is tucked behind the bar and the header's natural top is ON the line.
    expect(dockShades(sticky(LINE - BORDER, 1500), RAMP)).toEqual({ header: 0, barYield: 0 })
  })

  it('the settle pixel casts nothing: a whole-pixel landing may carry the header a fraction down', () => {
    for (const carried of [0.2, 0.6, DOCK_SETTLE_PX]) {
      const s = dockShades(sticky(LINE - BORDER - carried, 1500), RAMP)
      expect(s).toEqual({ header: 0, barYield: 0 })
    }
  })

  it('docked with text under it: the header’s shadow ramps in over the ramp, the bar keeps none', () => {
    const at = (depth) => dockShades(sticky(LINE - BORDER - depth, 1500), RAMP)
    expect(at(DOCK_SETTLE_PX + (RAMP - DOCK_SETTLE_PX) / 2).header).toBeCloseTo(0.5, 9)
    expect(at(RAMP).header).toBe(1)
    expect(at(700).header).toBe(1)
    for (const depth of [2, 12, 24, 700]) expect(at(depth).barYield).toBe(0)
  })

  it('the last stretch of a section: the header’s shadow fades out as the foot arrives', () => {
    // `room` px of section left below the header.
    const at = (room) => dockShades(sticky(LINE + HEAD_H + room + BORDER - 1500, 1500), RAMP)
    expect(at(200).header).toBe(1)
    expect(at(RAMP / 2).header).toBeCloseTo(0.5, 9)
    expect(at(0)).toEqual({ header: 0, barYield: 0 })
  })

  it('carried out under the bar: the bar’s shadow comes back over the ramp, the header’s stays off', () => {
    const at = (carried) => dockShades(sticky(LINE + HEAD_H + BORDER - 1500 - carried, 1500), RAMP)
    expect(at(DOCK_LINE_BAND_PX)).toEqual({ header: 0, barYield: 0 })
    const half = DOCK_LINE_BAND_PX + (RAMP - DOCK_LINE_BAND_PX) / 2
    expect(at(half).header).toBe(0)
    expect(at(half).barYield).toBeCloseTo(0.5, 9)
    expect(at(RAMP)).toEqual({ header: 0, barYield: 1 })
    expect(at(HEAD_H + 300)).toEqual({ header: 0, barYield: 1 })
  })

  it('a line that cannot be measured leaves the bar alone', () => {
    const g = { ...sticky(LINE + 10, 1500), lineY: NaN }
    expect(dockShades(g, RAMP)).toEqual(NO_DOCK)
  })

  it('NO_DOCK is "no header to consider": the bar is unaffected', () => {
    expect(NO_DOCK).toEqual({ header: 0, barYield: 1 })
  })
})

// ★★ THE HAND-OFF, PROVED FOR EVERY POSITION — the two things the owner must never see.
describe('dockShades — the hand-off across a whole scroll', () => {
  // Scroll a section from well below the line to well past it, a tenth of a pixel at a time, for a
  // short section (shorter than the two ramps), an ordinary one and a very long one. Each case
  // COUNTS the positions that break its rule and asserts once — tens of thousands of positions is
  // the point, and an assertion apiece would spend the run on bookkeeping.
  const STEP = 0.1
  const SECTIONS = [HEAD_H + 2 * BORDER + 20, 400, 6000]
  const sweep = (sectionH, visit) => {
    let positions = 0
    for (let top = LINE + 200; top >= LINE - sectionH - 200; top -= STEP, positions++) {
      const g = sticky(top, sectionH)
      visit(dockShades(g, RAMP), g)
    }
    return positions
  }

  it('NEVER BOTH: the header’s shadow and the bar’s are not on together at any position', () => {
    for (const sectionH of SECTIONS) {
      let both = 0
      let headerSeen = false
      let barSeen = false
      const positions = sweep(sectionH, (s) => {
        if (s.header > 0 && s.barYield > 0) both++
        headerSeen ||= s.header > 0
        barSeen ||= s.barYield > 0
      })
      expect(positions).toBeGreaterThan(3000)
      expect(both).toBe(0)
      expect(headerSeen && barSeen).toBe(true) // the sweep visited both states
    }
  })

  it('NEVER NEITHER WITH TEXT UNDER AN EDGE: off the line the bar is on; on it, the header is on whenever text is under it', () => {
    for (const sectionH of SECTIONS) {
      let barMissing = 0
      let headerMissing = 0
      sweep(sectionH, (s, g) => {
        const offLine = Math.abs(g.headerTop - g.lineY) > DOCK_LINE_BAND_PX
        if (offLine && !(s.barYield > 0)) barMissing++
        const textUnderHeader =
          g.headerTop - g.naturalTop > DOCK_SETTLE_PX && g.floorY - g.headerBottom > 0
        if (textUnderHeader && !(s.header > 0)) headerMissing++
      })
      expect([barMissing, headerMissing]).toEqual([0, 0])
    }
  })

  it('NO JUMPS: neither strength changes by more than the ramp allows between two positions', () => {
    // A tenth of a pixel of scroll can move either strength by at most STEP / (ramp − band); a
    // bigger step is a pop — a shadow snapping on or off mid-scroll.
    const maxStep = STEP / (RAMP - DOCK_SETTLE_PX) + 1e-9
    for (const sectionH of SECTIONS) {
      let prev = null
      let worst = 0
      sweep(sectionH, (s) => {
        if (prev)
          worst = Math.max(
            worst,
            Math.abs(s.header - prev.header),
            Math.abs(s.barYield - prev.barYield),
          )
        prev = s
      })
      expect(worst).toBeLessThanOrEqual(maxStep)
    }
  })

  it('both strengths stay inside 0…1', () => {
    for (const sectionH of SECTIONS) {
      let outside = 0
      sweep(sectionH, (s) => {
        for (const v of [s.header, s.barYield]) if (!(v >= 0 && v <= 1)) outside++
      })
      expect(outside).toBe(0)
    }
  })
})

// ── THE TWO MOMENTS THE POSITION ALONE GETS WRONG ─────────────────────────────────────────────
//
// ARRIVING. For the length of a section's opening, both strengths go from what was on screen at the
// tap to what they will be WHERE THE HEADER COMES TO REST, over the clock — never to what the
// header's place says on the frames in between.
describe('restGeometry — where a header will be at rest, from where it is and what is still to come', () => {
  it('with nothing still to come, it is where it is', () => {
    for (const top of [LINE + 300, LINE - BORDER, LINE - 400, LINE - 1480])
      expect(restGeometry(sticky(top, 1500), 0, 0)).toEqual(sticky(top, 1500))
  })

  it('what is still folding above, and what is left of the glide, bring its section up the page — and the stick places the header', () => {
    // 4,000px below the line with 4,000px still to fold away above it: it will rest ON the line.
    const far = sticky(LINE - BORDER + 4000, 1500)
    expect(dockShades(far, RAMP)).toEqual({ header: 0, barYield: 1 }) // where it IS: far away
    const landed = restGeometry(far, 4000, 0)
    expect(landed.headerTop).toBe(LINE)
    expect(dockShades(landed, RAMP)).toEqual({ header: 0, barYield: 0 }) // where it WILL be
    // …and coming up FURTHER than the line puts text under it: docked, a ramp's length deep.
    expect(dockShades(restGeometry(far, 4000 + RAMP, 0), RAMP)).toEqual({ header: 1, barYield: 0 })
    // Not far enough to reach the line: it rests where its section does, below it.
    const short = restGeometry(far, 4000 - 12.25, 0)
    expect(short.headerTop).toBeCloseTo(LINE + 12.25, 9)
    expect(dockShades(short, RAMP).barYield).toBeCloseTo(0.5, 9)
  })

  it('a header being brought DOWN to the line (held above it, the glide scrolling back) will rest on it with nothing under it', () => {
    // Tapped 40px above the line; part-way through, the header's own offset holds it 30px above and
    // the glide has 30px left to scroll back (a negative distance: the section comes DOWN).
    const natural = LINE - 30
    const held = {
      lineY: LINE,
      headerTop: natural,
      headerBottom: natural + HEAD_H,
      naturalTop: natural,
      floorY: natural + 1500,
    }
    const rest = restGeometry(held, -30, 0)
    expect([rest.naturalTop, rest.headerTop]).toEqual([LINE, LINE])
    expect(dockShades(rest, RAMP)).toEqual({ header: 0, barYield: 0 })
  })

  it('what its own panel has yet to open puts its section`s foot further down: room for the stick, and for a shadow to fall on', () => {
    // Just tapped, natural spot 40px above the line: closed, the section is its header and no more.
    const closed = sticky(LINE - BORDER - 40, HEAD_H + 2 * BORDER)
    expect(closed.headerTop).toBeCloseTo(LINE - 40, 9) // nowhere to stick: carried out with its section
    const open = restGeometry(closed, 0, 800)
    expect(open.headerTop).toBe(LINE) // …but open, it will be docked,
    expect(open.floorY - open.headerBottom).toBeCloseTo(760, 9)
    expect(dockShades(open, RAMP)).toEqual({ header: 1, barYield: 0 }) // with 40px under it.
  })

  it('never out of the bottom of its own section', () => {
    const g = restGeometry(sticky(LINE - 1000, 1500), 2000, 0)
    expect(g.headerBottom).toBeCloseTo(g.floorY, 9)
    expect(dockShades(g, RAMP).header).toBe(0)
  })
})

describe('ARRIVING — both strengths go from what was on screen to what they will be at rest, over the clock', () => {
  const FRAMES = 200
  // Every frame of an arrival: the largest change between two of them, the last one, and — checked
  // on each — one shadow's worth between the header and the bar.
  const sweep = (shadesAt, since = 0) => {
    let prev = null
    let worst = 0
    for (let i = 0; i <= FRAMES; i++) {
      const s = shadesAt(since + ((1 - since) * i) / FRAMES)
      if (prev)
        worst = Math.max(
          worst,
          Math.abs(s.header - prev.header),
          Math.abs(s.barYield - prev.barYield),
        )
      expect(s.header + s.barYield).toBeLessThanOrEqual(1 + 1e-12)
      prev = s
    }
    return { worst, end: prev }
  }
  const ON_THE_LINE = { header: 0, barYield: 0 } // docked, nothing under it
  const READ_UNDER = { header: 1, barYield: 0 } // docked, with text under it
  const BAR_WHOLE = { header: 0, barYield: 1 } // nothing docked: the bar's own

  it('on the frame of the tap it is exactly what was on screen, and at the end exactly what rest says', () => {
    for (const from of [BAR_WHOLE, ON_THE_LINE, { header: 0.3, barYield: 0.6 }])
      for (const rest of [ON_THE_LINE, READ_UNDER, BAR_WHOLE, { header: 0, barYield: 0.48 }]) {
        expect(arrivingShades({ from, since: 0, progress: 0 }, rest)).toEqual(from)
        expect(arrivingShades({ from, since: 0, progress: 1 }, rest)).toEqual(rest)
      }
  })

  // ★ THE HEADER ALREADY ON THE LINE — a section closed from its docked header and opened again.
  // By place the bar keeps nothing the moment it is open: that was all of the shadow in one frame.
  it('opened on the line: the bar gives its share up over the clock, and the header wears none', () => {
    const at = (progress) => arrivingShades({ from: BAR_WHOLE, since: 0, progress }, ON_THE_LINE)
    expect([at(0.25), at(0.5), at(0.75)]).toEqual([
      { header: 0, barYield: 0.75 },
      { header: 0, barYield: 0.5 },
      { header: 0, barYield: 0.25 },
    ])
    expect(sweep(at).worst).toBeLessThan(0.006) // a two-hundredth of the clock: that much shadow
  })

  // ★ THE SWAP — from one docked section to the next, the old one folding away above. The bar
  // keeps nothing at the tap and will keep nothing where the new header rests. By PLACE the header
  // is thousands of pixels from the line until the fold's last few, and the bar was owed its whole
  // shadow all the way — then none, over the ramp's 24px, which a tall fold crosses in three frames.
  it('from docked to docked: the bar keeps nothing at any frame — where by place it kept everything, then lost it in a few pixels', () => {
    const TALL = 5000
    // The tapped section starts 300px below the line, with TALL px folding away above it and the
    // glide scrolling 300 − TALL back to compensate (a negative distance): `e` of the way through,
    // the two together have brought it 300·e up the page.
    const frame = (e) => {
      const now = sticky(LINE - BORDER + 300 * (1 - e), 1500)
      const stillFolding = TALL * (1 - e)
      const glideLeft = (300 - TALL) * (1 - e)
      return {
        place: dockShades(now, RAMP),
        rest: dockShades(restGeometry(now, stillFolding + glideLeft, 0), RAMP),
      }
    }
    let placeWorst = 0
    let prevPlace = frame(0).place.barYield
    for (let i = 1; i <= FRAMES; i++) {
      const e = i / FRAMES
      const { place, rest } = frame(e)
      expect(rest).toEqual(ON_THE_LINE) // where it will rest is the same answer on every frame
      expect(arrivingShades({ from: ON_THE_LINE, since: 0, progress: e }, rest)).toEqual(
        ON_THE_LINE,
      )
      placeWorst = Math.max(placeWorst, Math.abs(place.barYield - prevPlace))
      prevPlace = place.barYield
    }
    expect(frame(0.5).place.barYield).toBe(1) // by place: the bar's whole shadow, mid-swap…
    expect(placeWorst).toBeGreaterThan(0.05) // …and gone at twelve times the clock's own rate.
  })

  it('a bar that was keeping nothing comes back the same way when the header will rest off the line', () => {
    const rest = { header: 0, barYield: 0.48 }
    const at = (progress) => arrivingShades({ from: ON_THE_LINE, since: 0, progress }, rest)
    let prev = at(0)
    for (let i = 1; i <= FRAMES; i++) {
      const s = at(i / FRAMES)
      expect(s.barYield).toBeGreaterThanOrEqual(prev.barYield - 1e-12)
      prev = s
    }
    const { worst, end } = sweep(at)
    expect(worst).toBeLessThan(0.006)
    expect(end).toEqual(rest)
  })

  it('what a reader has put under the header comes in over the clock, never by more than the bar has given up', () => {
    const at = (progress) => arrivingShades({ from: BAR_WHOLE, since: 0, progress }, READ_UNDER)
    expect(at(0.5)).toEqual({ header: 0.5, barYield: 0.5 })
    const { worst, end } = sweep(at)
    expect(worst).toBeLessThan(0.006)
    expect(end).toEqual(READ_UNDER)
  })

  // A close hands the header's shadow back to the bar over the fold (RELEASING). Opened again
  // part-way, the header is on the line with nothing under it: by place both are nothing at once.
  it.each([0.1, 0.4, 0.8])(
    'opened again %s of the way through its close: nothing changes on that frame, and both go on out',
    (q) => {
      const letGo = releaseShades(READ_UNDER, q)
      const at = (progress) => arrivingShades({ from: letGo, since: 0, progress }, ON_THE_LINE)
      expect(at(0)).toEqual(letGo)
      let prev = at(0)
      for (let i = 1; i <= FRAMES; i++) {
        const s = at(i / FRAMES)
        expect(s.header).toBeLessThanOrEqual(prev.header + 1e-12)
        expect(s.barYield).toBeLessThanOrEqual(prev.barYield + 1e-12)
        prev = s
      }
      const { worst, end } = sweep(at)
      expect(worst).toBeLessThan(0.006)
      expect(end).toEqual(ON_THE_LINE)
    },
  )

  // ★ SETTING OFF AGAIN. Where the header will rest can change in one frame — a reader takes the
  // page over mid-glide, scrolls it themselves, or turns the screen. The arrival starts again from
  // what is on screen (`from`, at `since`), for the new resting place, over what is left.
  it.each([0.05, 0.2, 0.5, 0.9])(
    'set off again at %s: nothing changes on that frame, and it comes to the new rest with no step the clock does not have',
    (since) => {
      const before = arrivingShades({ from: BAR_WHOLE, since: 0, progress: since }, ON_THE_LINE)
      const at = (progress) => arrivingShades({ from: before, since, progress }, READ_UNDER)
      expect(at(since)).toEqual(before)
      const { worst, end } = sweep(at, since)
      expect(worst).toBeLessThan(0.006)
      expect(end).toEqual(READ_UNDER)
    },
  )

  it('the header never wears more than the bar has given up, whatever it came in with', () => {
    const s = arrivingShades(
      { from: { header: 0.9, barYield: 0.5 }, since: 0, progress: 0.2 },
      { header: 0.9, barYield: 0.5 },
    )
    expect(s).toEqual({ header: 0.5, barYield: 0.5 })
  })

  it('a progress outside 0…1 is held to the ends, and an arrival set off on its last frame is at rest', () => {
    expect(arrivingShades({ from: BAR_WHOLE, since: 0, progress: -1 }, READ_UNDER)).toEqual(
      BAR_WHOLE,
    )
    expect(arrivingShades({ from: BAR_WHOLE, since: 0, progress: 2 }, READ_UNDER)).toEqual(
      READ_UNDER,
    )
    expect(arrivingShades({ from: BAR_WHOLE, since: 1, progress: 1 }, READ_UNDER)).toEqual(
      READ_UNDER,
    )
  })
})

describe('lineShare — what a header`s place alone allows the bar', () => {
  const at = (headerTop) => ({
    lineY: LINE,
    headerTop,
    headerBottom: headerTop + HEAD_H,
    naturalTop: headerTop,
    floorY: headerTop + 1500,
  })

  it('none on the line, all of it a ramp`s length off either way, and the ramp between', () => {
    const half = DOCK_LINE_BAND_PX + (RAMP - DOCK_LINE_BAND_PX) / 2
    expect(lineShare(at(LINE), RAMP)).toBe(0)
    expect(lineShare(at(LINE - half), RAMP)).toBeCloseTo(0.5, 9)
    expect(lineShare(at(LINE + half), RAMP)).toBeCloseTo(0.5, 9)
    expect(lineShare(at(LINE - RAMP), RAMP)).toBe(1)
    expect(lineShare(at(LINE + RAMP + 100), RAMP)).toBe(1)
  })

  it('a line that cannot be measured leaves the bar alone', () => {
    expect(lineShare({ ...at(LINE), lineY: NaN }, RAMP)).toBe(1)
  })
})

describe('RELEASING — a closed header hands its shadows back in step', () => {
  const docked = { header: 1, barYield: 0 }
  it('starts from exactly what was on screen, and ends with the header bare and the bar whole', () => {
    expect(releaseShades(docked, 0)).toEqual(docked)
    expect(releaseShades(docked, 1)).toEqual(NO_DOCK)
    expect(releaseShades({ header: 0.4, barYield: 0 }, 0)).toEqual({ header: 0.4, barYield: 0 })
    expect(releaseShades({ header: 0.4, barYield: 0 }, 1)).toEqual(NO_DOCK)
  })

  it('in between, what the header has let go of is what the bar has been given', () => {
    let prev = releaseShades(docked, 0)
    for (let i = 1; i <= 100; i++) {
      const s = releaseShades(docked, i / 100)
      expect(s.header + s.barYield).toBeCloseTo(1, 12)
      expect(s.header).toBeLessThanOrEqual(prev.header)
      expect(s.barYield).toBeGreaterThanOrEqual(prev.barYield)
      // No step is a jump: a hundredth of the fold moves either by a hundredth.
      expect(Math.abs(s.barYield - prev.barYield)).toBeLessThanOrEqual(0.01 + 1e-12)
      prev = s
    }
  })

  it('a header that was not docked had nothing to hand back, and nothing moves', () => {
    for (const p of [0, 0.3, 1]) expect(releaseShades(NO_DOCK, p)).toEqual(NO_DOCK)
  })

  it('a share the bar was already partly keeping only ever rises from there', () => {
    const from = { header: 0, barYield: 0.5 }
    expect(releaseShades(from, 0.5)).toEqual({ header: 0, barYield: 0.75 })
  })

  it('progress outside 0…1 is held at the ends', () => {
    expect(releaseShades(docked, -1)).toEqual(docked)
    expect(releaseShades(docked, 2)).toEqual(NO_DOCK)
  })
})

describe('edgeBehindBar — the docked header draws its section’s top border from the pixel it goes', () => {
  // The line under the bar at 70; the header's natural spot (just inside its section's top border).
  const at = (naturalTop) => ({
    lineY: 70,
    headerTop: 70,
    headerBottom: 125,
    naturalTop,
    floorY: 900,
  })
  it('is on from the moment the border is behind the bar: at the line, and above it', () => {
    expect(edgeBehindBar(at(70))).toBe(true)
    expect(edgeBehindBar(at(69.6))).toBe(true)
    expect(edgeBehindBar(at(-400))).toBe(true)
  })
  it('is off while any of the border can still be seen — a second line would double it', () => {
    expect(edgeBehindBar(at(70 + 2 * DOCK_EDGE_PX))).toBe(false)
    expect(edgeBehindBar(at(70.5))).toBe(false)
    expect(edgeBehindBar(at(300))).toBe(false)
  })
  it('allows one layout unit between two rectangles describing one edge, and no more', () => {
    expect(edgeBehindBar(at(70 + DOCK_EDGE_PX))).toBe(true)
  })
  it('answers to the place, not the shadow: a header just opened, nothing under it, is docked', () => {
    // headerTop === naturalTop: depth 0, so the header casts no shadow — and still wears its line.
    expect(
      edgeBehindBar({
        lineY: 70,
        headerTop: 69.8,
        headerBottom: 124.8,
        naturalTop: 69.8,
        floorY: 900,
      }),
    ).toBe(true)
  })
})
