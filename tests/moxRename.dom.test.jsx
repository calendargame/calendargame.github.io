// @vitest-environment jsdom
//
// AoX became MoX, and "Average" became "Mean" (sub-group 3C). The rename is a naming fix and ONLY a
// naming fix — this app's headline figure is a straight arithmetic mean of every solve, it has never
// trimmed anything, and cubers reserve "average" for a trimmed figure while "Mo3" means exactly an
// untrimmed mean. So the words changed and nothing else did.
//
// ★ THE CASE THAT MATTERS IS THE LAST ONE: A BEST RECORDED BEFORE THE RENAME MUST STILL BE FOUND.
// The owner's condition on the whole change. It is safe because no saved key derives from a display
// name — the per-config Best key is built from the run length, Allow Mistakes, the format bucket,
// the three chances, the year range, and the calendar system — which ships ON (useJulian true). and the store field is `aoxBest` — but
// "it is safe because I read the code" is exactly the assurance this suite exists to replace. The
// test writes a Best under a key SPELLED OUT BY HAND, exactly as an older build would have stored it
// (and as it still sits in `aoxBest` on a returning player's device), then reads the number back off
// the renamed screen. Change any dimension of the key, or rename the stored field chasing the label,
// and this goes to "—". (The saved-payload round trip itself is tests/persistence.dom's subject; the
// claim here is that the KEY and the FIELD did not move.)
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { App } from '../src/main.jsx'
import { useSettings } from '../src/store/settings.js'
import { useProgress } from '../src/store/progress.js'

function mountApp() {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  return render(<App />)
}
const isHidden = (el) => {
  for (let n = el; n; n = n.parentElement) if (n.style && n.style.display === 'none') return true
  return false
}
const switchToMox = () =>
  act(() => {
    fireEvent.keyDown(window, { key: 'A' }) //  the shortcut is unchanged — it is a KEY, not a name
  })
// The visible text of the whole MoX screen, with the always-mounted hidden modes excluded.
const visibleText = () =>
  Array.from(document.querySelectorAll('span,div,button,p,li'))
    .filter((e) => !isHidden(e) && e.children.length === 0)
    .map((e) => e.textContent)
    .join(' | ')
const bestLine = (which) => {
  const els = Array.from(document.querySelectorAll('div')).filter(
    (e) => !isHidden(e) && e.textContent.trim().startsWith(`Best ${which}:`),
  )
  els.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)
  const m = els[0]?.textContent.match(/Best \w+:\s*(—|\d+\.\d{2}s)/)
  return m ? m[1] : null
}

// The factory settings this suite runs under, spelled out because the saved key below encodes them.
function pin() {
  localStorage.clear()
  const s = useSettings.getState()
  s.resetToFactory()
  s.setRandomFormat(false)
  s.setDateFormat('numeric-ymd')
  s.setMinY(1583)
  s.setMaxY(10000)
}

describe('MoX — the rename', () => {
  beforeEach(pin)
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('the mode is called MoX and the readouts are Mean — the word "Average" is gone', () => {
    mountApp()
    switchToMox()
    const text = visibleText()
    expect(text).toContain('MoX')
    expect(text).toContain('Mean')
    expect(bestLine('Mean')).not.toBeNull() //  the Best rows read "Best Mean" / "Best Median"
    expect(text).not.toContain('Average')
    expect(text).not.toContain('AoX')
    // The run-length prefix reads "Mo", so the field spells "Mo10" as one token.
    expect(screen.getByRole('textbox', { name: 'MoX run length' })).toBeInTheDocument()
  })

  it('a Best saved before the rename is still found under Best Mean', () => {
    // A payload as an older build wrote it: the config key spelled out, the field still `aoxBest`.
    // 10 = the factory run length; false = Allow Mistakes off; then the format bucket, the three
    // chances, the year range, and the calendar system — which ships ON (useJulian true).
    const SAVED_KEY = '10|false|numeric-ymd|random|random|random|1583-10000|true'
    act(() =>
      useProgress.getState().setAoxBest({
        [SAVED_KEY]: { avg: 3, avgMed: 3, avgRoundId: 1, med: 3, medAvg: 3, medRoundId: 1 },
      }),
    )
    mountApp()
    switchToMox()
    expect(bestLine('Mean')).toBe('3.00s')
    expect(bestLine('Median')).toBe('3.00s')
  })
})
