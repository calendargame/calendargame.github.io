// @vitest-environment jsdom
// playerBusy — "is the player in the middle of something right now?" (lib/playerBusy), the one
// definition the app's own interruptions wait on: the storage warning's popup (store/storageUsage).
//
// What is pinned: the engine's half (engine/useGameEngine — a casual question waiting, not judged
// yet, whose first answer would record a time: on screen or behind a browsed card); each mode's half
// (Classic and Deduction while they are the page shown; a Flash from Begin until it is answered
// right or revealed; a Blitz round and a MoX run from Begin to their end, whatever card is showing
// and whether or not anything is recorded); a text box holding the keyboard; and that "free" is
// said only once it is true — never in the gap between one screen's clock and the next one's, nor
// in the gap a press leaves between one text box losing the keyboard and the next one getting it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, renderHook, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { useGameEngine } from '../src/engine/useGameEngine.js'
import { isPlayerBusy, isRoundLive, onPlayerFree } from '../src/lib/playerBusy.js'
import { useSettings } from '../src/store/settings.js'
import { useModePrefs } from '../src/store/modePrefs.js'
import { wday } from '../src/lib/calendar.js'
import { DAY } from '../src/lib/format.js'
import { App } from '../src/main.jsx'
import { resetAppState } from './helpers/settingsPanel.jsx'

const genDate = () => ({ y: 2024, m: 1, d: 1, _fmt: 'numeric-ymd', _jul: false })
const RIGHT = wday(2024, 1, 1)
const WRONG = (RIGHT + 1) % 7
const timed = {
  genDate,
  minY: 1583,
  maxY: 10000,
  useJulian: false,
  saveStats: true,
  timingOff: false,
  play: 'question',
}
// "Free" is said from the next task: let it be said.
const settled = () => act(() => new Promise((resolve) => setTimeout(resolve)))

afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
  vi.useRealTimers()
})

describe('the engine: a casual question keeps the player busy while it waits unjudged and its time would be kept', () => {
  it('from the question appearing, through a right answer (the next question is timed too)', () => {
    const { result } = renderHook(() => useGameEngine(timed))
    expect(isPlayerBusy()).toBe(true)
    expect(isRoundLive()).toBe(false)
    act(() => result.current.answer(RIGHT))
    expect(isPlayerBusy()).toBe(true)
  })

  it.each([
    ['a wrong answer', (eng) => eng.answer(WRONG)],
    ['Reveal', (eng) => eng.reveal()],
    ['Show Codes', (eng) => eng.showCodes(true)],
  ])(
    'ends at the first judgement — %s — and starts again with the next question',
    async (_name, judge) => {
      const { result } = renderHook(() => useGameEngine(timed))
      const free = vi.fn()
      const undo = onPlayerFree(free)
      act(() => judge(result.current))
      expect(isPlayerBusy()).toBe(false)
      await settled()
      expect(free).toHaveBeenCalledTimes(1)
      act(() => result.current.doNew())
      expect(isPlayerBusy()).toBe(true)
      undo()
    },
  )

  // The card ON SCREEN used to be the one asked. Browsing back shows an older, judged card — while
  // the question left waiting is still on the clock behind it.
  it('browsing back to an older card leaves the waiting question’s clock running', () => {
    const { result } = renderHook(() => useGameEngine(timed))
    act(() => result.current.answer(RIGHT)) // one card behind, a fresh question waiting
    act(() => result.current.back())
    expect(result.current.state.backDepth).toBe(1)
    expect(result.current.state.card.jul).toBeDefined() // the card on screen has been judged
    expect(isPlayerBusy()).toBe(true)
    act(() => result.current.forward())
    expect(isPlayerBusy()).toBe(true)
  })

  it.each([
    ['timing is hidden', { timingOff: true }],
    ['Save Stats is off', { saveStats: false }],
    ['its page is not the one shown', { play: 'idle' }],
  ])('not when %s', (_name, over) => {
    renderHook(() => useGameEngine({ ...timed, ...over }))
    expect(isPlayerBusy()).toBe(false)
  })

  // A round, a run, a flash: busy for as long as it lasts, whatever is recorded and whatever card
  // is showing — a judged card inside a live round used to read as a free moment.
  it('a round, run, or flash under way is busy throughout — recorded or not, judged card or not', async () => {
    const { result, rerender } = renderHook((props) => useGameEngine(props), {
      initialProps: { ...timed, play: 'live', timingOff: true, saveStats: false },
    })
    const free = vi.fn()
    const undo = onPlayerFree(free)
    expect(isRoundLive()).toBe(true)
    act(() => result.current.answer(WRONG))
    expect(result.current.state.card.jul).toBeDefined()
    expect(isRoundLive()).toBe(true)
    expect(isPlayerBusy()).toBe(true)
    await settled()
    expect(free).not.toHaveBeenCalled()
    rerender({ ...timed, play: 'idle', timingOff: true, saveStats: false }) // it ends
    expect(isRoundLive()).toBe(false)
    await settled()
    expect(free).toHaveBeenCalledTimes(1)
    undo()
  })

  it('a screen going away ends it, and says so', async () => {
    const { unmount } = renderHook(() => useGameEngine(timed))
    const free = vi.fn()
    const undo = onPlayerFree(free)
    unmount()
    expect(isPlayerBusy()).toBe(false)
    await settled()
    expect(free).toHaveBeenCalledTimes(1)
    undo()
    renderHook(() => useGameEngine(timed)).unmount()
    await settled()
    expect(free).toHaveBeenCalledTimes(1) // no longer listening
  })
})

describe('"free" is said once it is true, and only then', () => {
  it('not in the gap between one screen’s clock stopping and the next one’s starting', async () => {
    const Screens = ({ on }) => {
      useGameEngine({ ...timed, play: on === 'a' ? 'question' : 'idle' })
      useGameEngine({ ...timed, play: on === 'b' ? 'question' : 'idle' })
      return null
    }
    const { rerender } = render(<Screens on="a" />)
    const free = vi.fn()
    const undo = onPlayerFree(free)
    rerender(<Screens on="b" />)
    await settled()
    rerender(<Screens on="a" />)
    await settled()
    expect(free).not.toHaveBeenCalled()
    rerender(<Screens on="none" />)
    await settled()
    expect(free).toHaveBeenCalledTimes(1)
    undo()
  })

  it('a text box with the keyboard is busy; leaving it for something that is not one is free', async () => {
    const box = document.createElement('input')
    const other = document.createElement('input')
    const slider = Object.assign(document.createElement('input'), { type: 'range' })
    document.body.append(box, other, slider)
    const free = vi.fn()
    const undo = onPlayerFree(free)
    try {
      box.focus()
      expect(isPlayerBusy()).toBe(true)
      other.focus() // box to box: never free in between
      await settled()
      expect(free).not.toHaveBeenCalled()
      slider.focus() // a slider is an <input>, and nobody types in it
      expect(isPlayerBusy()).toBe(false)
      await settled()
      expect(free).toHaveBeenCalledTimes(1)
    } finally {
      undo()
      box.remove()
      other.remove()
      slider.remove()
    }
  })

  // A PRESS from one box into another is not one step, the way a script's move is: the browser
  // reports the first box left, runs everything the page queued in answer to that, and only then
  // gives the second box the keyboard. "Free" used to be said in that gap — and the popup waiting
  // on it opened and took the keyboard off the box the player had just pressed.
  it('a press from one text box into another is never free in between', async () => {
    const box = document.createElement('input')
    const other = document.createElement('input')
    document.body.append(box, other)
    const free = vi.fn()
    const undo = onPlayerFree(free)
    try {
      box.focus()
      box.blur() // the press: the first box is left, with nothing holding the keyboard yet…
      expect(isPlayerBusy()).toBe(false)
      await Promise.resolve() // …the page's queued answers to that run…
      await Promise.resolve()
      expect(free).not.toHaveBeenCalled()
      other.focus() // …and only now does the pressed box have it
      await settled()
      expect(free).not.toHaveBeenCalled()
      other.blur() // left for nothing: free, and said once
      await settled()
      expect(free).toHaveBeenCalledTimes(1)
    } finally {
      undo()
      box.remove()
      other.remove()
    }
  })
})

describe('each mode: what its screen reports', () => {
  const mountApp = () => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    return render(<App />)
  }
  const key = (k) => act(() => void fireEvent.keyDown(window, { key: k }))
  const click = (name) => act(() => void fireEvent.click(screen.getByRole('button', { name })))
  // The date on screen (numeric y-m-d, pinned below) — the one visible leaf that spells one.
  const shownDate = () => {
    const leaf = [...document.querySelectorAll('div, span')].find(
      (e) =>
        e.children.length === 0 &&
        /^-?\d+-\d+-\d+$/.test(e.textContent.trim()) &&
        e.offsetParent !== null,
    )
    const [y, m, d] = leaf.textContent.trim().split('-').map(Number)
    return { y, m, d }
  }
  const answerRight = () => {
    const { y, m, d } = shownDate()
    click(DAY[wday(y, m, d)])
  }
  const answerWrong = () => {
    const { y, m, d } = shownDate()
    click(DAY[(wday(y, m, d) + 1) % 7])
  }

  beforeEach(() => {
    resetAppState()
    const s = useSettings.getState()
    s.setRandomFormat(false)
    s.setDateFormat('numeric-ymd')
    s.setMinY(1583)
    s.setMaxY(10000)
  })

  it('Classic: only with its timing shown, only while it is the page on screen', () => {
    mountApp()
    expect(isPlayerBusy()).toBe(false) // timing is hidden out of the box
    act(() => useModePrefs.getState().setClassicTimingOff(false))
    expect(isPlayerBusy()).toBe(true)
    key('L') // Lookup: the question is still there, and nobody is being timed on it
    expect(isPlayerBusy()).toBe(false)
    key('H')
    expect(isPlayerBusy()).toBe(false)
    key('K')
    expect(isPlayerBusy()).toBe(true)
    answerWrong()
    expect(isPlayerBusy()).toBe(false)
  })

  it('Deduction: the puzzle type on screen, with its timing shown', () => {
    act(() => useModePrefs.getState().setDedTimingOff(false))
    mountApp()
    expect(isPlayerBusy()).toBe(false) // Classic is the page shown, and it is untimed
    key('D')
    expect(isPlayerBusy()).toBe(true)
    key('K')
    expect(isPlayerBusy()).toBe(false)
  })

  it('Blitz: from Begin until the round ends — a judged card inside it included, not the idle screen', () => {
    vi.useFakeTimers()
    mountApp()
    key('B')
    expect(isPlayerBusy()).toBe(false)
    click('Begin')
    expect(isRoundLive()).toBe(true)
    answerRight()
    expect(isRoundLive()).toBe(true)
    click('Reset')
    expect(isRoundLive()).toBe(false)
    expect(isPlayerBusy()).toBe(false)
  })

  it('Blitz with Allow Mistakes: a wrong pick leaves the round, and the player, in play', () => {
    vi.useFakeTimers()
    mountApp()
    key('B') // Allow Mistakes is on out of the box
    click('Begin')
    answerWrong()
    expect(isRoundLive()).toBe(true)
    expect(isPlayerBusy()).toBe(true)
  })

  it('Flash: from Begin, whether or not its timing is shown — not while it idles on the dash', () => {
    vi.useFakeTimers()
    mountApp()
    key('F')
    expect(isPlayerBusy()).toBe(false)
    click('Begin')
    expect(isRoundLive()).toBe(true)
    answerWrong() // judged, and the flash goes on: the date can still be answered
    expect(isRoundLive()).toBe(true)
    click('Reveal')
    expect(isRoundLive()).toBe(false)
  })

  it('MoX One-by-One: the whole run — the wait for Continue between two dates included', () => {
    vi.useFakeTimers()
    mountApp()
    key('A')
    click('One-by-One')
    expect(isPlayerBusy()).toBe(false)
    click('Begin')
    expect(isRoundLive()).toBe(true)
    answerRight() // the next date is loaded, and hidden
    expect(isRoundLive()).toBe(true)
    click('Continue')
    expect(isRoundLive()).toBe(true)
  })

  it('Lookup: while its date box has the keyboard', () => {
    mountApp()
    key('L')
    expect(isPlayerBusy()).toBe(false)
    const box = document.querySelector('input[type="text"]')
    act(() => box.focus())
    expect(isPlayerBusy()).toBe(true)
    act(() => box.blur())
    expect(isPlayerBusy()).toBe(false)
  })
})
