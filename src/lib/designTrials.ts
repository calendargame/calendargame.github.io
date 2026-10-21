// lib/designTrials.ts — ⚠ TEMPORARY (Round 28): looks the owner is choosing between, put side by side
// on the TEST SITE so he can switch between them on his own phone. NOTHING HERE MAY REACH THE LIVE
// SITE: the commit that adds it is pushed to the test site only, and the switch shows itself only on
// the test site's address (and a dev server), so even a build of it served anywhere else is today's
// app. Once he has picked, the pick is built in for good and ALL of this goes: this file, its section
// in components/SettingsPanel, the DESIGN TRIALS block in index.css, the trial class on the
// manager's ✕, tests/designTrials.dom.test.jsx, and the saved key on test-site devices (a one-line
// removal in the cleanup, which reads it once and deletes it).
//
// Each trial is a value on <html> (data-trial-*), which index.css keys the alternatives to, so a
// switch repaints at once with no component knowing which look is on.
//   • STATS FRAME — the stats strip inside Amnesic's dashed frame (Queue Q2, owner 2026-10-21: "do you
//     think we should keep the border that is around the stats panel ... otherwise it makes that
//     weird visual color change"): Today, as shipped; A, the strip keeps its whole solid border,
//     under the dashes too; B, a solid line only where the dashes do not run — the strip's bottom
//     edge, above the Best lines, under Full; C, no inner border, and the strip's tint fills the
//     whole dashed frame, Best lines included, under Full.
//   • DELETE ✕ — the ✕ beside each preset in Manage Presets (owner 2026-10-21): Button, as shipped,
//     or Plain, the ✕ alone with no button drawn round it.
import { useSyncExternalStore } from 'react'
import { siteAtHostname } from '../sites.js'
import { readItem, writeItem } from '../store/storageHealth.js'

const STATS_FRAMES = ['today', 'a', 'b', 'c'] as const
const DELETE_XS = ['button', 'plain'] as const
export type StatsFrameTrial = (typeof STATS_FRAMES)[number]
export type DeleteXTrial = (typeof DELETE_XS)[number]
export interface Trials {
  statsFrame: StatsFrameTrial
  deleteX: DeleteXTrial
}

const SHIPPED: Trials = { statsFrame: 'today', deleteX: 'button' }
export const TRIALS_KEY = 'cg-design-trials'

/** Whether this page offers the trials: the test site, and a dev server. */
export const trialsOffered = (hostname: string, mode: string): boolean =>
  siteAtHostname(hostname)?.name === 'test' || mode === 'development'

/** Whether THIS page offers them. */
export const trialsHere = (): boolean => trialsOffered(location.hostname, import.meta.env.MODE)

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  list.some((o) => o === v)

function load(): Trials {
  try {
    const saved = JSON.parse(readItem(localStorage, TRIALS_KEY) ?? '{}') as Partial<Trials>
    return {
      statsFrame: isOneOf(STATS_FRAMES, saved.statsFrame) ? saved.statsFrame : SHIPPED.statsFrame,
      deleteX: isOneOf(DELETE_XS, saved.deleteX) ? saved.deleteX : SHIPPED.deleteX,
    }
  } catch {
    return SHIPPED
  }
}

let current: Trials = SHIPPED
const listeners = new Set<() => void>()

const paint = (t: Trials): void => {
  const root = document.documentElement
  root.dataset.trialStats = t.statsFrame
  root.dataset.trialX = t.deleteX
}

/** Called once at boot: puts the saved trials on <html> where they are offered; nothing otherwise. */
export function startDesignTrials(): void {
  if (!trialsHere()) return
  current = load()
  paint(current)
}

export function setTrial<K extends keyof Trials>(key: K, value: Trials[K]): void {
  current = { ...current, [key]: value }
  paint(current)
  writeItem(localStorage, TRIALS_KEY, JSON.stringify(current))
  for (const l of listeners) l()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
export const useTrials = (): Trials => useSyncExternalStore(subscribe, () => current)
