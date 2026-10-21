// DesignTrials — ⚠ TEMPORARY (Round 28): the ⚙ menu's "Test-site trials" section, where the owner
// switches between looks he is choosing among (lib/designTrials says which, why, and everything that
// goes once he has picked — this file included). It is the first thing in the menu so it is found at
// once, and it is drawn only where the trials are offered: the test site, and a dev server.
import { GroupLabel } from './primitives.jsx'
import { PillGroup } from './PillGroup.jsx'
import { PillTray } from './PillTray.jsx'
import {
  setTrial,
  useTrials,
  type DeleteXTrial,
  type StatsFrameTrial,
} from '../lib/designTrials.js'

const STATS_FRAME_OPTIONS: { value: StatsFrameTrial; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
  { value: 'c', label: 'C' },
]
const DELETE_X_OPTIONS: { value: DeleteXTrial; label: string }[] = [
  { value: 'button', label: 'Button' },
  { value: 'plain', label: 'Plain' },
]

export default function DesignTrials() {
  const trials = useTrials()
  return (
    <div className="space-y-2 pb-3 border-b border-(--bd-500-20)">
      <GroupLabel>Test-site trials</GroupLabel>
      <div className="text-xs text-(--tx-200-80)">
        Looks to choose between. Only the test site has this section, and it goes once you have
        picked.
      </div>
      <PillGroup className="space-y-1.5" label="Stats frame under Amnesic">
        <div className="text-xs text-(--tx-200-80)">Stats frame under Amnesic</div>
        <div className="text-[0.6875rem] text-(--tx-300-60)">
          A: the stats keep their whole border inside the dashes. B: a border only where the dashes
          do not run, above the Best lines. C: no inner border; the tint fills the whole dashed
          frame, Best lines included. B and C differ from Today only under Full.
        </div>
        <PillTray
          value={trials.statsFrame}
          onChange={(v) => setTrial('statsFrame', v)}
          options={STATS_FRAME_OPTIONS}
        />
      </PillGroup>
      <PillGroup className="space-y-1.5" label="Preset delete button">
        <div className="text-xs text-(--tx-200-80)">The ✕ beside each preset</div>
        <PillTray
          value={trials.deleteX}
          onChange={(v) => setTrial('deleteX', v)}
          options={DELETE_X_OPTIONS}
        />
      </PillGroup>
    </div>
  )
}
