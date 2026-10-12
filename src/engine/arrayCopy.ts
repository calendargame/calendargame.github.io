// ─────────────────────────────────────────────────────────────────────────
// engine/arrayCopy.ts — how the reducer copies one of a state's arrays.
//
// ★ THE RULE: A STATE'S ARRAY IS COPIED WITH A SPREAD, NEVER WITH `slice`. The two build the same
// array — the same elements, in the same order, in a new array — and they cost the same on an
// ordinary one. They do not cost the same on a FROZEN one, and in a development build and under
// test every array of a state is frozen (engine/freeze):
//   • `slice` leaves its fast path on a frozen array. Measured (Node 24 and Chromium 145, the same
//     engine): a frozen thousand-card history takes about 30 µs to slice and about 0.3 µs to spread
//     — a hundred times — and a spread is as quick on a frozen array as on an ordinary one;
//   • and the copy `slice` hands back from a frozen array is one the JavaScript engine marks as
//     "may have gaps" (it has none), a mark every copy made from it afterwards keeps. A plain walk
//     of such a history measured about a fifth slower than a walk of the same cards copied by a
//     spread — and the reducer, engine/invariants, and a test's own checks all walk it.
// Measured over the whole engine fuzz survey (tests/engine/fuzz), old copies against new, both
// alternated in one process: 65.2 s to 60.8 s, 6.7% (the old engine against itself, the same way,
// read 0.3%). The slow calls themselves, priced one by one, were 2% of it; the rest is the second
// point. In a development build a Back over a five-thousand-card history went from 0.23 ms to
// 0.10 ms. A PRODUCTION build freezes nothing, so there the two forms were the same speed before
// and are now (measured press by press, in Node and in Chromium): a player is given nothing by
// this and loses nothing.
//
// What is here is the one copy a spread cannot write on its own. The whole-array copy needs no
// helper — it is `[...array]`, as gameReducer's `retime` has it.
// ⚠ ONE `slice` IS LEFT, on purpose: forgetOldestCards' `stack.slice(n)`. It runs when a history is
// parked, not on a press — 14 thousand times in the whole survey against 5.6 million for the four
// copies changed — and nothing measurable rests on it.
// ⚠ FOR AN ARRAY WITH NO GAPS, which every array of a state is: each is built from a literal, a
// spread, or text read back from the device, and none of those can leave an index without a value.
// (On an array that did have one, `slice` would keep the gap and a spread would put `undefined`
// in it.)
// ─────────────────────────────────────────────────────────────────────────

/** A new array holding everything in `list` but its last element — `list.slice(0, -1)`. */
export function withoutLast<T>(list: readonly T[]): T[] {
  const copy = [...list]
  copy.pop()
  return copy
}
