// ─────────────────────────────────────────────────────────────────────────
// engine/timesPool.ts — what is KNOWN about a pool of solve times, kept beside it, so the stat
// strip's Mean and Median and the invariant walk's check of the times cost the same however many
// times a player has.
//
// WHY (Round 26, Q1). Every solve time is kept (store/progress), so a casual mode's pool grows
// without bound, and three things walked the WHOLE pool on every answer: the Mean (a sum of every
// time), the Median (a selection over a copy of every time), and engine/invariants' "every time is a
// finite, non-negative number". Measured at 100,000 times (scripts/measureAnswerCost.mjs) they were
// most of what an answer cost once the save stopped rewriting every time (store/progressStorage's
// sealing).
//
// ★ THE POOL ITSELF DOES NOT CHANGE. It stays a plain `number[]`, immutable, a new array per change,
// exactly as the engine, the stores, the save and every older build know it. What is new is a
// SUMMARY of an array, held in a WeakMap keyed by the array — so it lives exactly as long as
// something still holds that array, and a Summary NEVER references another array (no chain of
// parents for the garbage collector to keep alive behind the newest pool).
//
// ★ BIT-IDENTICAL BY CONSTRUCTION, not "close":
//   • MEAN. `sum` is the same left-to-right fold from 0 that engine/stats' calcAvg computes; an
//     append is `prev.sum + t`, which IS that fold carried one step further. Any other change (an
//     Override's splice) folds again from 0, in order.
//   • MEDIAN. A sorted Float64Array holds the pool's very doubles; the middle of it is the value a
//     full sort puts there, and the lower and upper middles are added in the order calcMed always
//     added them. A pool with a value the buffer cannot order exactly (anything that is not a
//     finite, non-negative number other than −0) gets no buffer and is selected from scratch, as
//     before — engine/invariants reports such a pool anyway.
//   • HASH. The rolling hash of the times in order (timesHash) is the same kind of fold, carried one
//     step by an append; the windows-in-sync door (store/syncCounts) names a silo's times by it.
//   • In a development build and the tests, every 64th Summary made from an earlier one is checked
//     against a from-scratch fold and selection, and a disagreement throws where it was made
//     (auditTimesPool turns that up to every one, for a deep fuzz sweep).
//
// ★ BOUNDED MEMORY. The sorted buffer (8 bytes a time, with spare room at the end) is OWNED by one
// Summary at a time: an append or a splice hands it on to the new pool's Summary, which keeps the
// value it needs (its median) as a plain number. So there is one buffer per pool that is the newest
// of its line — about 0.8 MB at 100,000 times — and every older pool React or a store still holds
// costs a few fixed-size numbers. A pool whose buffer has already been handed on (a second change
// made from the same pool — rare: two engines never share one) builds its own by sorting, once.
// A pool with no Summary yet (one just loaded, restored, or built elsewhere) is summed and SELECTED
// from scratch, linearly, and builds no buffer until an answer is first added to it — that one
// answer pays one sort (about 10 ms at 100,000 times on a laptop), every later one pays an insert.
//
// ⚠ AN ARRAY THAT HAS A SUMMARY MUST NEVER BE CHANGED IN PLACE. Nothing in the app does (the engine
// is a pure reducer, and a development build freezes every state — engine/freeze); a pool built
// anywhere else is built whole before it is first asked about.
// ─────────────────────────────────────────────────────────────────────────

/** The pool's sorted doubles, `n` of them at the front of `a`. */
interface SortedBuffer {
  a: Float64Array
  n: number
}

interface Summary {
  /** The sum of every time, folded left to right from 0 — calcAvg's own expression. */
  readonly sum: number
  /** The rolling hash of every time, in order (timesHash, below), as its two 32-bit lanes. */
  readonly h1: number
  readonly h2: number
  /** Every time is a finite, non-negative number (engine/invariants asks). */
  readonly valid: boolean
  /** Every time is one the sorted buffer can hold (isSortable, below). */
  readonly sortable: boolean
  /** The median calcMed returns for this pool, or null for an empty one. */
  readonly median: number | null
  /** The sorted buffer, while this Summary still owns it (see the header). */
  buf: SortedBuffer | null
}

const SUMMARIES = new WeakMap<readonly number[], Summary>()

const isTime = (t: unknown): boolean => typeof t === 'number' && Number.isFinite(t) && t >= 0
// What the sorted buffer can hold and still answer bit-identically: a time, and not −0 (a sort puts
// −0 before 0 where a selection treats them as one value, so the two could hand back different
// zeros). engine/stats' solveTimeFromMs never makes a −0, and JSON cannot carry one.
const isSortable = (t: unknown): boolean => isTime(t) && !Object.is(t, -0)

// ── THE ROLLING HASH OF A POOL (Round 26, Q2: the sync tag's `h`, store/syncCounts) ──
// Two 32-bit lanes, each time mixed in by its exact double bits (read little-endian, so every engine
// agrees), left to right from a fixed seed. A fold, so the hash of a longer pool is the hash of the
// shorter one carried on — an append costs one step, and the hash of the first n times of any pool is
// the same fold stopped at n (prefixHash). Not cryptographic: a clash only ever makes two different
// pools of the SAME length and counts read as one, which the sync tag's counts already narrow.
const HASH_SEED1 = 0xdeadbeef
const HASH_SEED2 = 0x41c6ce57
const BITS = new DataView(new ArrayBuffer(8))
type Lanes = { h1: number; h2: number }
function mixTime(h: Lanes, t: number): Lanes {
  BITS.setFloat64(0, t, true)
  const lo = BITS.getUint32(0, true)
  const hi = BITS.getUint32(4, true)
  let h1 = Math.imul(h.h1 ^ lo, 2654435761)
  h1 = Math.imul(h1 ^ hi, 2246822507)
  let h2 = Math.imul(h.h2 ^ hi, 1597334677)
  h2 = Math.imul(h2 ^ lo, 3266489909)
  return { h1: h1 ^ (h1 >>> 15), h2: h2 ^ (h2 >>> 13) }
}
const lanesText = ({ h1, h2 }: Lanes): string =>
  (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)

// The fold calcAvg computes, the two flags, and the hash, in one pass.
function fold(times: readonly number[]): {
  sum: number
  valid: boolean
  sortable: boolean
  h1: number
  h2: number
} {
  let sum = 0
  let valid = true
  let sortable = true
  let h: Lanes = { h1: HASH_SEED1, h2: HASH_SEED2 }
  for (let i = 0; i < times.length; i++) {
    const t = times[i]
    sum = sum + t
    h = mixTime(h, t)
    if (!isSortable(t)) {
      sortable = false
      if (!isTime(t)) valid = false
    }
  }
  return { sum, valid, sortable, h1: h.h1, h2: h.h2 }
}

/** The rolling hash of a pool's times, in order — from its Summary (an append costs one step), or for a
 *  pool with none (one read back from storage, say) folded once, the hash alone, and kept: nothing of a
 *  Summary's median or sorted buffer is worked out for a pool that is only being compared. */
/** The rolling hash of a pool's times, in order — from its Summary (an append costs one step), or, for a
 *  pool with none (one just read back from storage), folded once and kept: the hash alone, nothing of a
 *  Summary's median or sorted buffer worked out for a pool that is only being compared (Round 26: the
 *  windows-in-sync door fingerprints every pool it reads). */
export const timesHash = (times: readonly number[]): string => lanesText(lanesOf(times))
const HASHES = new WeakMap<readonly number[], Lanes>()
function lanesOf(times: readonly number[]): Lanes {
  const s = SUMMARIES.get(times)
  if (s) return s
  let l = HASHES.get(times)
  if (!l) {
    l = { h1: HASH_SEED1, h2: HASH_SEED2 }
    for (let i = 0; i < times.length; i++) l = mixTime(l, times[i])
    HASHES.set(times, l)
  }
  return l
}
/** The hash of `times` with `t` added at its end — without making that pool (an append, as it would read). */
export const timesHashAppended = (times: readonly number[], t: number): string =>
  lanesText(mixTime(lanesOf(times), t))
/** The rolling hash of the first `n` times of a pool (a fresh fold, linear in `n`). */
export function prefixHash(times: readonly number[], n: number): string {
  if (n >= times.length) return timesHash(times)
  let h: Lanes = { h1: HASH_SEED1, h2: HASH_SEED2 }
  for (let i = 0; i < n; i++) h = mixTime(h, times[i])
  return lanesText(h)
}

// ── The median by SELECTION, for a pool with no buffer — linear, and the same doubles a sort gives ──
// Hoare selection: rearranges `a` so that a[k] is the value a full ascending sort would put there,
// with every a[i<k] <= a[k] <= every a[i>k], and returns it. Median-of-three pivot, so sorted,
// reversed and duplicate-heavy pools (all ordinary for solve times) stay linear.
function selectInPlace(a: Float64Array, k: number): number {
  let lo = 0
  let hi = a.length - 1
  while (lo < hi) {
    const x = a[lo]
    const y = a[(lo + hi) >> 1]
    const z = a[hi]
    const pivot = x < y ? (y < z ? y : x < z ? z : x) : x < z ? x : y < z ? z : y
    let i = lo
    let j = hi
    while (i <= j) {
      while (a[i] < pivot) i++
      while (a[j] > pivot) j--
      if (i <= j) {
        const tmp = a[i]
        a[i] = a[j]
        a[j] = tmp
        i++
        j--
      }
    }
    if (k <= j) hi = j
    else if (k >= i) lo = i
    else break
  }
  return a[k]
}
// It works on a Float64Array COPY: the pool itself is in play order, and "Last" reads its end.
function selectedMedian(times: readonly number[]): number | null {
  if (!times.length) return null
  const a = Float64Array.from(times)
  const k = a.length >> 1
  const upper = selectInPlace(a, k)
  if (a.length % 2) return upper
  // selectInPlace leaves everything below index k at or under a[k], so the lower middle is their max.
  let lower = a[0]
  for (let i = 1; i < k; i++) if (a[i] > lower) lower = a[i]
  return (lower + upper) / 2
}

// ── The sorted buffer ──
function sortedBuffer(times: readonly number[], room: number): SortedBuffer {
  const a = new Float64Array(Math.max(16, times.length + room))
  a.set(times)
  a.subarray(0, times.length).sort()
  return { a, n: times.length }
}
const middleOf = (b: SortedBuffer): number | null => {
  if (!b.n) return null
  const k = b.n >> 1
  return b.n % 2 ? b.a[k] : (b.a[k - 1] + b.a[k]) / 2
}
// The first index whose value is above `t` (where `t` goes, after any equal values).
function upperBound(b: SortedBuffer, t: number): number {
  let lo = 0
  let hi = b.n
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (b.a[mid] <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}
function insert(b: SortedBuffer, t: number): SortedBuffer {
  let { a } = b
  if (b.n === a.length) {
    const grown = new Float64Array(a.length * 2)
    grown.set(a)
    a = grown
  }
  const at = upperBound({ a, n: b.n }, t)
  a.copyWithin(at + 1, at, b.n)
  a[at] = t
  return { a, n: b.n + 1 }
}
// Take one value equal to `t` out (any one: equal doubles that are not ±0 are indistinguishable).
// Null when it is not there — which the buffer's construction rules out (it holds exactly its pool's
// values); the caller then sorts the new pool afresh rather than answer from a buffer it cannot trust.
function remove(b: SortedBuffer, t: number): SortedBuffer | null {
  const at = upperBound(b, t) - 1
  if (at < 0 || b.a[at] !== t) return null
  b.a.copyWithin(at, at + 1, b.n)
  return { a: b.a, n: b.n - 1 }
}

// ── The audit (development build and tests only) ──
let made = 0
let auditEvery = 64
/** Check every `every`th Summary made from an earlier one against a from-scratch fold and selection. */
export function auditTimesPool(every: number): void {
  auditEvery = Math.max(1, Math.floor(every))
}
function audited(times: readonly number[], s: Summary): Summary {
  if (import.meta.env.DEV && ++made % auditEvery === 0) {
    const f = fold(times)
    const median = selectedMedian(times)
    if (
      !Object.is(f.sum, s.sum) ||
      f.h1 !== s.h1 ||
      f.h2 !== s.h2 ||
      f.valid !== s.valid ||
      f.sortable !== s.sortable ||
      !Object.is(median, s.median)
    )
      throw new Error(
        `timesPool: the summary of ${times.length} times disagrees with a fresh one (sum ${s.sum} vs ${f.sum}, median ${s.median} vs ${median}, valid ${s.valid} vs ${f.valid})`,
      )
  }
  return s
}

// The buffer a change of `prev` starts from: its Summary's own, handed on; otherwise built by a sort.
function takeBuffer(prev: readonly number[], from: Summary): SortedBuffer {
  const b = from.buf ?? sortedBuffer(prev, Math.max(16, prev.length >> 3))
  from.buf = null
  return b
}

/** What is known about `times` — from its Summary, or worked out now (and kept) when it has none. */
export function summaryOf(times: readonly number[]): Summary {
  let s = SUMMARIES.get(times)
  if (!s) {
    s = { ...fold(times), median: selectedMedian(times), buf: null }
    SUMMARIES.set(times, s)
  }
  return s
}

/** The pool with `t` added at its end — the new array, its Summary already known. */
export function appended(prev: readonly number[], t: number): number[] {
  const next = [...prev, t] // a spread, never `concat` (engine/arrayCopy says why)
  const from = summaryOf(prev)
  const sum = from.sum + t
  const { h1, h2 } = mixTime(from, t)
  const valid = from.valid && isTime(t)
  const sortable = from.sortable && isSortable(t)
  let s: Summary
  if (sortable) {
    const buf = insert(takeBuffer(prev, from), t)
    s = { sum, h1, h2, valid, sortable, median: middleOf(buf), buf }
  } else s = { sum, h1, h2, valid, sortable, median: selectedMedian(next), buf: null }
  SUMMARIES.set(next, audited(next, s))
  return next
}

/**
 * The pool with the time at `at` taken out (when `removes`) and `insert` put in its place (when not
 * null) — an Override toggling one card's time in its own slot (engine/gameReducer's retime). The
 * new array, its Summary already known: the sum folded again from 0 (so it is calcAvg's exactly),
 * the sorted buffer handed on and changed by the same one or two values.
 */
export function retimed(
  prev: readonly number[],
  at: number,
  removes: boolean,
  insertTime: number | null,
): number[] {
  const next = [...prev] // a spread, never `slice` (engine/arrayCopy says why)
  if (removes) next.splice(at, 1)
  if (insertTime != null) next.splice(at, 0, insertTime)
  const f = fold(next)
  const from = summaryOf(prev)
  let s: Summary
  if (f.sortable && from.sortable) {
    let buf: SortedBuffer | null = takeBuffer(prev, from)
    if (removes) buf = remove(buf, prev[at])
    if (buf && insertTime != null) buf = insert(buf, insertTime)
    buf ??= sortedBuffer(next, 16)
    s = { ...f, median: middleOf(buf), buf }
  } else s = { ...f, median: selectedMedian(next), buf: null }
  SUMMARIES.set(next, audited(next, s))
  return next
}
