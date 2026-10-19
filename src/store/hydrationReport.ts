// store/hydrationReport.ts — EVERY SAVED STORE REPORTS A LOAD THAT THREW (Round 26).
//
// zustand's `persist` runs a store's load (read the saved copy, migrate it, merge it in) inside its
// own try/catch, and hands whatever was thrown to ONE place: the callback `onRehydrateStorage`
// returns. A store without that callback loses the error without a trace - the store simply keeps
// what it held before the load, and nothing anywhere says the saved copy was never read. That is how
// a fault in the ⚙ settings store's load went unseen during Round 26's build: the store opened on its
// factory values, every test that did not look at a saved setting passed, and nothing was reported.
//
// So every persisted store's `onRehydrateStorage` is built here, and a load that threw is reported the
// way store/progress has always reported its own (`captureError`, to Sentry on a deployed build, under
// a `tripwire` naming the store). A store that also has work to do after a good load passes it as
// `then`; it is not run after a load that threw. tests/hydrationReportGuard pins that every `persist`
// in src goes through here.
import { captureError } from '../observability/sentry.js'

/** `onRehydrateStorage` for a persisted store: a load that threw is reported under `tripwire`; a good
 *  one runs `then` (when given) with the state as loaded. */
export function reportedHydration<S>(
  tripwire: string,
  then?: (state: S | undefined) => void,
): () => (state: S | undefined, error?: unknown) => void {
  return () => (state, error) => {
    if (error !== undefined) {
      captureError(error instanceof Error ? error : new Error(String(error)), { tripwire })
      return
    }
    then?.(state)
  }
}
