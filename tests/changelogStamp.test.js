// tests/changelogStamp.test.js — the deploy stamp and the changelog date, pinned (round 16, Q1).
//
// THE CLASS: two facts about one deploy kept in step by memory. Q1 half 1 took the stamp out of
// human hands (vite.config.js injects the build clock as __BUILD_TS__), which on its own would have
// left the changelog date as a chore nobody was prompted for any more. Half 2 is the guard —
// scripts/changelogStamp.mjs, wired as a build-FAILING vite plugin — that makes the newest entry's
// PACIFIC date and the stamp's Pacific date the same thing or no build at all.
//
// WHAT IS PINNED HERE is the comparison, not the wiring, on the precacheIntegrity precedent: the
// plugin is four lines of glue, while everything that can be subtly wrong lives in the conversion.
// The stamp is a UTC instant and the entry date is a Pacific calendar day, so the two disagree for
// the 7–8 hours between Pacific midnight and UTC midnight — every case below that names a time is
// standing in that window on purpose. Both offsets are exercised (PDT is UTC-7, PST is UTC-8), on
// both sides of both midnights, across both 2026 switchovers and across a year boundary, because a
// hand-written offset would pass half of these and fail the other half.
//
// ⚠ NOTHING HERE READS THE CLOCK. A case that compared the real changelog against `new Date()`
// would go red on the first day nobody deployed, which would make the suite a calendar rather than
// a test. The real CHANGELOG is checked against instants DERIVED from its own newest entry instead,
// which is day-drift-free and still proves the shipped data satisfies the guard that gates it.
import { describe, it, expect, vi } from 'vitest'
import {
  PACIFIC_TZ,
  pacificDate,
  assertPacificZone,
  newestEntryDate,
  checkChangelogStamp,
  describeChangelogStampMismatch,
} from '../scripts/changelogStamp.mjs'
import { CHANGELOG } from '../src/changelog.js'
import { BUILD_IS_DEPLOYED, DEPLOY_TS } from '../src/deployStamp.js'

const at = (iso) => pacificDate(new Date(iso))

describe('pacificDate — a UTC instant as the owner’s calendar day', () => {
  it('names the zone by IANA id, never by an offset', () => {
    expect(PACIFIC_TZ).toBe('America/Los_Angeles')
  })

  it('midday PDT: the stamp and the Pacific day agree, and the window is not open', () => {
    // 13:45 PDT — the shape of every stamp taken during a normal working afternoon.
    expect(at('2026-08-09T20:45:00Z')).toBe('2026-08-09')
  })

  it('SUMMER (PDT, UTC-7): the UTC date runs a day ahead from 17:00 Pacific onward', () => {
    expect(at('2026-08-09T23:59:59Z')).toBe('2026-08-09') // 16:59:59 PDT — same UTC day still
    expect(at('2026-08-10T00:00:00Z')).toBe('2026-08-09') // 17:00 PDT — UTC has rolled over, Pacific has not
    expect(at('2026-08-10T06:59:59Z')).toBe('2026-08-09') // 23:59:59 PDT — the last second of the entry's day
    expect(at('2026-08-10T07:00:00Z')).toBe('2026-08-10') // 00:00 PDT — and the first of the next
  })

  it('WINTER (PST, UTC-8): the same midnight sits one hour later in UTC', () => {
    expect(at('2026-01-15T07:59:59Z')).toBe('2026-01-14') // 23:59:59 PST
    expect(at('2026-01-15T08:00:00Z')).toBe('2026-01-15') // 00:00 PST
    // The pair that a hand-rolled offset cannot satisfy at once: 07:00Z is already the new Pacific
    // day in August and is still the old one in January.
    expect(at('2026-08-10T07:00:00Z')).toBe('2026-08-10')
    expect(at('2026-01-15T07:00:00Z')).toBe('2026-01-14')
  })

  it('SPRING FORWARD 2026-03-08: the midnight moves by an hour across the switch', () => {
    expect(at('2026-03-08T07:59:59Z')).toBe('2026-03-07') // 23:59:59 PST — still UTC-8
    expect(at('2026-03-08T08:00:00Z')).toBe('2026-03-08') // 00:00 PST
    expect(at('2026-03-09T06:59:59Z')).toBe('2026-03-08') // 23:59:59 PDT — now UTC-7
    expect(at('2026-03-09T07:00:00Z')).toBe('2026-03-09') // 00:00 PDT
  })

  it('FALL BACK 2026-11-01: the last PDT midnight, and the first PST one after it', () => {
    expect(at('2026-11-01T06:59:59Z')).toBe('2026-10-31') // 23:59:59 PDT
    expect(at('2026-11-01T07:00:00Z')).toBe('2026-11-01') // 00:00 PDT — the switch is at 09:00Z
    expect(at('2026-11-02T07:59:59Z')).toBe('2026-11-01') // 23:59:59 PST
    expect(at('2026-11-02T08:00:00Z')).toBe('2026-11-02') // 00:00 PST
  })

  it('a New Year deploy: the Pacific year is still the old one for eight UTC hours', () => {
    expect(at('2027-01-01T07:59:59Z')).toBe('2026-12-31')
    expect(at('2027-01-01T08:00:00Z')).toBe('2027-01-01')
  })

  it('always ISO YYYY-MM-DD, zero-padded — the exact form the entries are written in', () => {
    expect(at('2026-03-09T07:00:00Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(at('2026-01-05T20:00:00Z')).toBe('2026-01-05') // single-digit month AND day, both padded
  })
})

describe('assertPacificZone — the checker refuses to answer on a runtime that cannot convert', () => {
  it('passes on this runtime (Node ships the tz database)', () => {
    expect(() => assertPacificZone()).not.toThrow()
  })

  it('is what stands between a real verdict and a UTC-vs-UTC comparison', () => {
    // The proof instants it uses are chosen so that NO shift at all, and the WRONG shift, both
    // fail: 06:59:59Z on Aug 10 is Aug 9 in Pacific and Aug 10 in UTC, while 07:59:59Z on Jan 15
    // is Jan 14 only under UTC-8. Restating them here means a future edit that weakened the
    // self-check to something a UTC runtime could pass would break this case.
    expect(at('2026-08-10T06:59:59Z')).toBe('2026-08-09')
    expect(at('2026-01-15T07:59:59Z')).toBe('2026-01-14')
  })
})

describe('newestEntryDate — the one entry the guard is about', () => {
  it('takes the first entry, which the charter fixes as the newest', () => {
    expect(newestEntryDate([{ date: '2026-08-09' }, { date: '2026-08-08' }])).toBe('2026-08-09')
  })

  it('an empty changelog is a failure, not a pass — there is nothing to have dated', () => {
    expect(() => newestEntryDate([])).toThrow(/no entries/)
    expect(() => newestEntryDate(undefined)).toThrow(/no entries/)
  })

  it('a non-ISO date fails loudly rather than never matching anything', () => {
    expect(() => newestEntryDate([{ date: '8/9/2026' }])).toThrow(/ISO YYYY-MM-DD/)
    expect(() => newestEntryDate([{ date: '2026-8-9' }])).toThrow(/ISO YYYY-MM-DD/)
    expect(() => newestEntryDate([{}])).toThrow(/ISO YYYY-MM-DD/)
  })
})

describe('checkChangelogStamp — the verdict the build acts on', () => {
  const entries = [{ date: '2026-08-09', items: ['x'] }]

  it('same Pacific day → ok, however far into the UTC night the build runs', () => {
    // Both instants are 2026-08-09 in Pacific; the second is already 2026-08-10 in UTC, which is
    // the whole reason this guard converts instead of comparing ISO prefixes.
    expect(checkChangelogStamp(entries, new Date('2026-08-09T20:45:00Z')).ok).toBe(true)
    expect(checkChangelogStamp(entries, new Date('2026-08-10T06:59:59Z')).ok).toBe(true)
  })

  it('the two cases a raw UTC-prefix comparison would get exactly backwards', () => {
    // FALSE ALARM it would raise: 17:30 PDT on the 9th is already 2026-08-10 in UTC, so slicing
    // the stamp's first ten characters would reject a correctly-dated entry every evening.
    expect(checkChangelogStamp(entries, new Date('2026-08-10T00:30:00Z')).ok).toBe(true)
    // REAL failure it must still catch: half past midnight Pacific on the 10th. Seven hours later
    // in UTC, one calendar day later in the only calendar the changelog is written in.
    const slipped = checkChangelogStamp(entries, new Date('2026-08-10T07:30:00Z'))
    expect(slipped.ok).toBe(false)
    expect(slipped.found).toBe('2026-08-09')
    expect(slipped.expected).toBe('2026-08-10') // the deploy slipped past midnight Pacific
  })

  it('reports the stamp it judged, in UTC, so a broken build can be reasoned about', () => {
    const r = checkChangelogStamp(entries, new Date('2026-08-10T07:00:00Z'))
    expect(r.stamp).toBe('2026-08-10T07:00:00.000Z')
  })

  it('an entry dated the FUTURE fails too — the guard is equality, not a floor', () => {
    const r = checkChangelogStamp([{ date: '2026-08-12' }], new Date('2026-08-09T20:45:00Z'))
    expect(r).toMatchObject({ ok: false, found: '2026-08-12', expected: '2026-08-09' })
  })
})

describe('describeChangelogStampMismatch — what the broken build tells you to do', () => {
  const message = describeChangelogStampMismatch(
    checkChangelogStamp([{ date: '2026-08-09' }], new Date('2026-08-10T07:00:00Z')),
  )

  it('names both dates and the stamp, so no file has to be opened to understand it', () => {
    expect(message).toContain('2026-08-09') // what it found
    expect(message).toContain('2026-08-10') // what it expected
    expect(message).toContain('2026-08-10T07:00:00.000Z') // the stamp it judged
    expect(message).toContain('src/changelog.ts') // where to go
  })

  it('says what to do, including the same-day MERGE rule the charter imposes', () => {
    expect(message).toMatch(/FIX:/)
    expect(message).toMatch(/MERGE/)
  })

  it('names the past-midnight case explicitly — the one where BOTH ends may need moving', () => {
    expect(message).toMatch(/MIDNIGHT PACIFIC/)
    expect(message).toMatch(/BOTH ENDS MAY NEED MOVING/)
  })
})

describe('the real src/changelog.ts against the guard that gates it', () => {
  // 20:00Z is 12:00 or 13:00 Pacific depending on the season — always the same calendar day as its
  // date part, in either offset. Derived from the data, so this case cannot rot with the calendar.
  const noonPacificOn = (date) => new Date(`${date}T20:00:00Z`)
  const newest = CHANGELOG[0].date

  it('passes when built on its own newest entry’s Pacific day', () => {
    expect(checkChangelogStamp(CHANGELOG, noonPacificOn(newest)).ok).toBe(true)
  })

  it('and the guard genuinely bites: the next Pacific day fails against the same data', () => {
    const nextDay = new Date(`${newest}T20:00:00Z`)
    nextDay.setUTCDate(nextDay.getUTCDate() + 1)
    const r = checkChangelogStamp(CHANGELOG, nextDay)
    expect(r.ok).toBe(false)
    expect(r.found).toBe(newest)
  })
})

// ── The OTHER half of the build-time stamp: what the TEST ENVIRONMENT is handed ─────────────────
// ⚠ THIS PINS THE SENTINEL, NOT A DEPLOY DATE, and the distinction is the whole reason the case is
// allowed to exist. src/deployStamp.ts warns against asserting DEPLOY_TS, and that warning is about
// the DEPLOY date — a test that hard-coded a release day would have to be edited on every deploy and
// would be asserting the constant instead of the behaviour. The frozen 1970 value is the opposite
// kind of thing: it is a CONTRACT with vite.config.js's `define`, it never moves, and nothing else
// in the suite checks it. tests/buildStamp.dom deliberately captures the stamp at runtime and
// tests/settingsPanel.lifecycle.dom asserts only its rendered SHAPE — both of which a live clock
// satisfies exactly as well as the epoch does. So if `command` were ever resolved as 'build' under
// Vitest, or that ternary were edited, every stamp-touching case in the suite would quietly become
// clock-dependent and stay green while it happened. The absence of a fallback in deployStamp.ts
// proves only that SOME define arrives, never which branch. One line closes that hole.
describe('the deploy stamp under Vitest', () => {
  it('is the frozen sentinel, never the clock — the determinism half of the build-time stamp', () => {
    expect(DEPLOY_TS.toISOString()).toBe('1970-01-01T00:00:00.000Z')
  })

  // The ⚙ panel prints the stamp as a date only for a build that WAS deployed; a dev server, which
  // never was, says "development build" instead of drawing the sentinel as 12/31/1969. Vitest runs
  // in its own mode and must stay on the date side — every panel case that reads "Last Updated" is
  // a case about the line a player sees.
  it('counts as a deployed build under Vitest, and as not deployed only in Vite`s development mode', async () => {
    expect(BUILD_IS_DEPLOYED).toBe(true)
    vi.stubEnv('MODE', 'development')
    vi.resetModules()
    try {
      expect((await import('../src/deployStamp.js')).BUILD_IS_DEPLOYED).toBe(false)
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
    vi.stubEnv('MODE', 'production')
    try {
      expect((await import('../src/deployStamp.js')).BUILD_IS_DEPLOYED).toBe(true)
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })
})
