import type { ElementType, ReactNode, Ref } from 'react'

// StatPanel — the horizontal stats strip (Score / Accuracy / Streak / Last /
// Average / Median) shown under the header in the timed/scored modes.
//
// Pure presentational: it renders whatever `stats` array it's given (each item
// {label, value, fn?, off?}) as equal-width cells separated by thin dividers.
// A cell with `fn` renders as a button; `off` strikes through the label and
// shows an em dash. Long fractional values (e.g. "1000/1000") auto-shrink so
// they don't overflow. `armedSpan` is the Bug-#4 affordance: when present it
// replaces stats[startIdx..endIdx] with one wide "Enable and Reset Stats?"
// confirmation button, using two 1px phantom spacers so the surrounding flex
// math (and the Streak-right divider position) stays pixel-identical.
//
// Extracted from main.jsx in Stage C, Step 4b (verbatim). No app state, no
// hooks — props in, JSX out.
//
// ⚠ The label's className keeps a SPACE before `${s.off…}` (`whitespace-nowrap ${`).
// It's required: Tailwind v4's source scanner silently drops any utility glued
// directly to `${` when that class appears nowhere else, which made the stat
// labels wrap. Don't "tidy" the space away. (Calendar Game layout bug-fix, 2026-06-01.)
export interface StatItem {
  label: string
  value: string | number
  fn?: (() => void) | null //  null = the stat is present but non-interactive (Save Stats off / non-toggleable mode)
  off?: boolean
}
export interface ArmedSpan {
  startIdx: number
  endIdx: number
  label: ReactNode
  onClick?: () => void
  btnRef?: Ref<HTMLButtonElement>
}
export default function StatPanel({ stats, armedSpan }: { stats: StatItem[]; armedSpan?: ArmedSpan | null }) {
  // For fractional values (Score, Streak as "X/Y"), shrink the value font
  // when either side reaches 1000+ or 10000+ to prevent overflow on long
  // sessions. Non-fractional values (Accuracy, Last, Average, Median)
  // stay at default size — they don't grow this way in practice.
  const sizeForValue = (val: string | number) => {
    const s = String(val)
    if (!s.includes('/')) return 'text-sm'
    const sideMax = Math.max(...s.split('/').map((p) => p.length))
    if (sideMax >= 5) return 'text-[10px]'
    if (sideMax >= 4) return 'text-xs'
    return 'text-sm'
  }
  return (
    <div className="mt-4 rounded-2xl panel flex overflow-hidden">
      {(() => {
        const items: ReactNode[] = []
        for (let i = 0; i < stats.length; i++) {
          if (armedSpan && i === armedSpan.startIdx) {
            const span = armedSpan.endIdx - armedSpan.startIdx + 1
            // Bug #4 aesthetic: no ring or rounded corners on the merged warning button.
            // The text change ('Enable and Reset Stats?') is the sole visual cue. The
            // standard vertical divider between Streak and this button is already
            // present (it was the Streak|Last divider in unarmed state) — no element
            // positions shift between armed and unarmed states.
            //
            // Phantom spacers: when the 3 time stat boxes merge into 1 warning button,
            // 2 internal dividers (Last|Avg and Avg|Med) disappear from the flex row.
            // Without compensation, those 2px get redistributed across the remaining
            // flex items, shifting the Streak-right divider 1px right and stretching
            // every box before it. Two 1px-wide transparent spacers — one before, one
            // after the button — restore exact unarmed flex math: Streak-right divider
            // is locked in place and the warning text sits exactly centered between
            // that divider and the panel's right edge.
            items.push(<div key="armed-spacer-l" className="w-px shrink-0" />)
            items.push(
              <button
                key="armed-warning"
                ref={armedSpan.btnRef}
                type="button"
                onClick={armedSpan.onClick}
                style={{ flex: span }}
                className="flex items-center justify-center py-2 text-xs font-medium"
              >
                {armedSpan.label}
              </button>,
            )
            items.push(<div key="armed-spacer-r" className="w-px shrink-0" />)
            if (armedSpan.endIdx < stats.length - 1) {
              items.push(
                <div
                  key={`d-armed-${i}`}
                  className="w-px h-8 self-center bg-purple-500/20 shrink-0"
                />,
              )
            }
            i = armedSpan.endIdx
            continue
          }
          const s = stats[i]
          const Tag: ElementType = s.fn ? 'button' : 'div'
          const props = s.fn ? { type: 'button' as const, onClick: s.fn } : {}
          const sz = sizeForValue(s.value)
          items.push(
            <Tag
              key={s.label}
              {...props}
              className="flex-1 flex flex-col items-center py-2 gap-0.5"
            >
              <span
                className={`text-xs text-purple-200/80 leading-none whitespace-nowrap ${s.off ? ' strike-center' : ''}`}
              >
                {s.label}
              </span>
              <span className={`${sz} font-semibold tabular-nums leading-tight mt-0.5`}>
                {s.off ? '—' : s.value}
              </span>
            </Tag>,
          )
          if (i < stats.length - 1) {
            items.push(
              <div key={`d-${i}`} className="w-px h-8 self-center bg-purple-500/20 shrink-0" />,
            )
          }
        }
        return items
      })()}
    </div>
  )
}
