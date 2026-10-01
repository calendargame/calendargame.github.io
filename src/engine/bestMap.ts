// ─────────────────────────────────────────────────────────────────────────
// engine/bestMap.ts — filing one configuration's Best record into its saved map.
//
// Every all-time Best in the app lives in a map keyed by the exact configuration it was set under
// (store/progress' blitzBest / suddenBest / suddenAmBest / aoxBest), and every write to one of those
// maps is the same act: put this config's record there, or — when the round or run that created the
// record no longer earns one — take the key away again. A config with NO record has NO key: a record
// that says "nothing" (a score of 0, a mean of null) reads on screen exactly like no record, but it
// is not one — it makes a preset that holds nothing look played-in (Full Reset stays lit, a delete
// asks first). So `undefined` REMOVES the key, in both timed modes.
//
// Returns the SAME map when nothing changes, so a reconcile that lands where it already was is not a
// store write (and not a re-render).
// ─────────────────────────────────────────────────────────────────────────
export function fileBest<T extends object>(
  map: Record<string, T>,
  key: string,
  rec: T | undefined,
): Record<string, T> {
  const cur: T | undefined = map[key]
  if (rec === undefined) {
    if (!(key in map)) return map
    const next = { ...map }
    delete next[key]
    return next
  }
  if (cur && (Object.keys(rec) as (keyof T)[]).every((k) => cur[k] === rec[k])) return map
  return { ...map, [key]: rec }
}
