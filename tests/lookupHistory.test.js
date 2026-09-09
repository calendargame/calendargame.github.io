import { describe, it, expect } from 'vitest'
import {
  LOOKUP_HISTORY_CAP,
  addLookupEntry,
  moveEntryToTop,
  mergeForDisplay,
  normalizeLookupEntries,
} from '../src/store/lookupHistory.js'

// lookupHistory.test.js — the pure logic behind store/lookupHistory (Q1, round 20). Mirrors
// progress.test.js's split: the pure rewrites/validators are unit-tested here (Node); the
// persisted-store wiring (localStorage/sessionStorage, hydrate, the amnesic session mechanism) is
// tests/lookupHistory.dom.test.js, which needs jsdom storage. normalizeLookupEntries and its
// describe block below moved here VERBATIM from progress.test.js when Lookup history left that
// store — the validation itself is unchanged by the move.

// ── addLookupEntry: the WINDOW ───────────────────────────────────────────────────────────────
describe('lookupHistory — addLookupEntry', () => {
  it('prepends, newest to the front', () => {
    const a = { id: 'a', y: 1776, m: 7, d: 4 }
    const b = { id: 'b', y: 1900, m: 1, d: 1 }
    expect(addLookupEntry([a], b)).toEqual([b, a])
  })

  it('caps at LOOKUP_HISTORY_CAP, dropping the oldest off the end', () => {
    const dated = (i) => ({ id: `h${i}`, y: 1900 + (i % 120), m: (i % 12) + 1, d: (i % 28) + 1 })
    const over = Array.from({ length: LOOKUP_HISTORY_CAP + 25 }, (_, i) => dated(i))
    const kept = over.reduce((prev, entry) => addLookupEntry(prev, entry), [])
    expect(kept).toHaveLength(LOOKUP_HISTORY_CAP)
    expect(kept[0]).toEqual(over[over.length - 1])
    expect(kept.at(-1)).toEqual(over[over.length - LOOKUP_HISTORY_CAP])
    expect(kept).not.toContainEqual(over[0])
  })
})

// ── moveEntryToTop: re-asking a question you already have ───────────────────────────────────
// Extracted from main.tsx's inline rewrite (Q1, round 20) so both the permanent list and the
// session-only overflow apply the exact same array surgery.
describe('lookupHistory — moveEntryToTop', () => {
  const a = { id: 'a', y: 1, m: 1, d: 1 }
  const b = { id: 'b', y: 2, m: 2, d: 2 }
  const c = { id: 'c', y: 3, m: 3, d: 3 }

  it('moves a middle entry to the front, preserving the order of the rest', () => {
    expect(moveEntryToTop([a, b, c], 'b')).toEqual([b, a, c])
  })

  it('is a no-op when the entry is already at the front', () => {
    const list = [a, b, c]
    expect(moveEntryToTop(list, 'a')).toBe(list) // same reference: no new array for a no-op
  })

  it('is a no-op when the id is not found', () => {
    const list = [a, b, c]
    expect(moveEntryToTop(list, 'nope')).toBe(list)
  })

  it('is a no-op on an empty list', () => {
    expect(moveEntryToTop([], 'a')).toEqual([])
  })
})

// ── mergeForDisplay: the session overflow shown ahead of the permanent list ─────────────────
describe('lookupHistory — mergeForDisplay', () => {
  const a = { id: 'a', y: 1, m: 1, d: 1 }
  const b = { id: 'b', y: 2, m: 2, d: 2 }
  const s1 = { id: 's1', y: 3, m: 3, d: 3 }
  const s2 = { id: 's2', y: 4, m: 4, d: 4 }

  it('is just the permanent list when there is no session overflow', () => {
    expect(mergeForDisplay([a, b], [])).toEqual([a, b])
  })

  it('shows the session overflow ahead of the permanent list, newest of each first', () => {
    expect(mergeForDisplay([a, b], [s2, s1])).toEqual([s2, s1, a, b])
  })

  it('an empty permanent list with a session overflow is just the overflow', () => {
    expect(mergeForDisplay([], [s1])).toEqual([s1])
  })

  it('both empty is empty', () => {
    expect(mergeForDisplay([], [])).toEqual([])
  })

  // The merged DISPLAY list is capped again at LOOKUP_HISTORY_CAP (see the function's own header
  // comment): two buckets each individually capped at 100 could otherwise show up to 200 rows.
  it('re-caps the merge at LOOKUP_HISTORY_CAP, favoring the session overflow', () => {
    const perm = Array.from({ length: LOOKUP_HISTORY_CAP }, (_, i) => ({
      id: `p${i}`,
      y: 1900,
      m: 1,
      d: 1,
    }))
    const session = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, y: 2000, m: 1, d: 1 }))
    const merged = mergeForDisplay(perm, session)
    expect(merged).toHaveLength(LOOKUP_HISTORY_CAP)
    // The whole session overflow survives — it is always newest — and the tail of the permanent
    // list (its oldest entries) is what gives up its spots.
    expect(merged.slice(0, 10)).toEqual(session)
    expect(merged.slice(10)).toEqual(perm.slice(0, LOOKUP_HISTORY_CAP - 10))
  })
})

// ── the lookup-history normalizer: shape + validation (Q2; moved here verbatim, Q1 round 20) ────
// label/weekday/result were snapshots of how the date read at lookup time; the card derives all
// three now, so the stored copies were not merely redundant but WRONG after a Date Format change.
// The VALIDATION half matters just as much: LookupCard carries no per-field guards any more, so an
// entry that survives this filter is one the card can render. The pure function is unit-tested
// here; the localStorage/sessionStorage → rehydrate path (where it runs on EVERY load, in EITHER
// bucket) is in lookupHistory.dom.
describe('lookupHistory — normalizeLookupEntries', () => {
  it('keeps the date and the id, drops the rendered text', () => {
    expect(
      normalizeLookupEntries([
        { id: 'a', label: 'July 4, 1776', weekday: 'Thursday', result: 'r', y: 1776, m: 7, d: 4 },
      ]),
    ).toEqual([{ id: 'a', y: 1776, m: 7, d: 4 }])
  })

  it('keeps the gap marker — it is an input, not a rendering', () => {
    expect(
      normalizeLookupEntries([
        {
          id: 'g',
          label: 'x',
          weekday: 'Does Not Exist',
          result: 'r',
          y: 1582,
          m: 10,
          d: 10,
          isGap: true,
        },
      ]),
    ).toEqual([{ id: 'g', y: 1582, m: 10, d: 10, isGap: true }])
  })

  it('is idempotent on an already-current entry, and passes an empty history through', () => {
    const cur = [{ id: 'a', y: 1776, m: 7, d: 4 }]
    expect(normalizeLookupEntries(cur)).toEqual(cur)
    expect(normalizeLookupEntries([])).toEqual([])
  })

  it('drops junk elements instead of throwing (it reads untrusted storage)', () => {
    expect(
      normalizeLookupEntries([null, { id: 'a', y: 1, m: 1, d: 1 }, undefined, 'nope']),
    ).toEqual([{ id: 'a', y: 1, m: 1, d: 1 }])
  })

  // The guard the card leans on. A truncated write, an interrupted serialize or a hand-edited key
  // can leave an object that IS an object but can't answer "which date?" — it must not reach the
  // render, where it would produce MONTH[NaN] and a blank weekday.
  it('drops entries missing or corrupting any of id/y/m/d', () => {
    expect(
      normalizeLookupEntries([
        { id: 'x' }, // truncated: no date at all
        { id: 'y', y: 1776, m: 7 }, // partial date
        { id: 'z', y: 1776, m: 'seven', d: 4 }, // wrong type
        { id: 'n', y: NaN, m: 7, d: 4 }, // NaN is a number and still unusable
        { y: 1776, m: 7, d: 4 }, // no id — the React key and the selection handle
        { id: 'ok', y: 1776, m: 7, d: 4 },
      ]),
    ).toEqual([{ id: 'ok', y: 1776, m: 7, d: 4 }])
  })

  // It is the sole owner of the shape, so it also owns "there is no history".
  it('returns an empty history for a non-array payload', () => {
    expect(normalizeLookupEntries(undefined)).toEqual([])
    expect(normalizeLookupEntries(null)).toEqual([])
    expect(normalizeLookupEntries('nope')).toEqual([])
  })

  // ── The date must be REAL, not merely number-shaped (round-11 Q2) ───────────────────────────
  // Number-shaped is not enough now that the card answers rather than refuses: the day-number
  // arithmetic underneath rolls February 30 into March and would print a confident weekday for a
  // date that never happened. Same either-calendar rule Lookup validates with — a date counts if a
  // calendar it can be read in has it.
  it('drops days no calendar has', () => {
    expect(
      normalizeLookupEntries([
        { id: 'a', y: 1776, m: 2, d: 30 }, // February never has 30 days, under either rule
        { id: 'b', y: 1776, m: 4, d: 31 }, // April has 30
        { id: 'c', y: 1776, m: 1, d: 32 },
        { id: 'd', y: 1776, m: 1, d: 0 },
        { id: 'e', y: 1776, m: 13, d: 1 }, // MONTH[12] is undefined
        { id: 'f', y: 1776, m: 0, d: 1 },
        { id: 'ok', y: 1776, m: 7, d: 4 },
      ]),
    ).toEqual([{ id: 'ok', y: 1776, m: 7, d: 4 }])
  })

  // The either-calendar half. February 29, 1500 is a real Julian date and no Gregorian date at all;
  // 1900's is neither, because the Julian rule has stopped applying by then.
  it('keeps a pre-reform February 29 that only the Julian rule grants, and only that', () => {
    expect(
      normalizeLookupEntries([
        { id: 'jul', y: 1500, m: 2, d: 29 },
        { id: 'both', y: 1200, m: 2, d: 29 },
        { id: 'neither', y: 1900, m: 2, d: 29 },
        { id: 'plain', y: 1500, m: 2, d: 28 },
      ]),
    ).toEqual([
      { id: 'jul', y: 1500, m: 2, d: 29 },
      { id: 'both', y: 1200, m: 2, d: 29 },
      { id: 'plain', y: 1500, m: 2, d: 28 },
    ])
  })

  // Whole numbers, for the same reason: month 1.5 indexes MONTH to `undefined` and day 1.5 lands on
  // a weekday belonging to no day. A gap entry is still an ordinary October date to this check.
  it('requires whole numbers, and lets the gap days through as ordinary October dates', () => {
    expect(
      normalizeLookupEntries([
        { id: 'a', y: 1776.5, m: 7, d: 4 },
        { id: 'b', y: 1776, m: 1.5, d: 4 },
        { id: 'c', y: 1776, m: 7, d: 4.5 },
        { id: 'gap', y: 1582, m: 10, d: 10, isGap: true },
      ]),
    ).toEqual([{ id: 'gap', y: 1582, m: 10, d: 10, isGap: true }])
  })

  // Deliberately NOT bounded to Lookup's 1–10000 years: an out-of-range year still names a real
  // date and still reads correctly, so there is nothing wrong to drop — unlike an impossible day,
  // which can only be answered wrongly. Pinned so the omission reads as a decision, not an oversight.
  it('leaves a year outside the input range alone — it is unusual, not impossible', () => {
    const odd = [{ id: 'a', y: 20000, m: 7, d: 4 }]
    expect(normalizeLookupEntries(odd)).toEqual(odd)
  })
})
