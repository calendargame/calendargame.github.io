// @vitest-environment jsdom
//
// amnesicClose — WHAT MAKES A CLOSE A CLOSE (store/amnesicClose; design-amnesic-close.md 2).
//
// Every window of the app holds a SHARED Web Lock for its whole life; at boot it asks for the lock
// EXCLUSIVELY "if available". Granted means no other window of the app is alive: a reload (this tab's
// browsing-session marker is set) or a COLD OPEN AFTER A CLOSE - and only then the forget runs and the next
// session is counted - when it owes a forget: a close with every preset on Off writes nothing. Not granted
// means other windows are alive: the window joins their session. Pinned here, with several documents of
// one origin on a fake lock manager (tests/helpers/fakeLocks):
//   • a cold open forgets; a reload does not - by the browser's own navigation entry, never by the tab's
//     sessionStorage, which a tab the browser discarded or restored keeps; a window joining others does
//     not, though its tab is new;
//   • simultaneous cold opens: exactly ONE opener, and the others join after its forget;
//   • a forget a full device held is owed, and the next window to join runs it;
//   • a tab back into a session that has since ended (the back-forward cache, or a discarded tab
//     reloading) drops what it kept for that session;
//   • a browser without Web Locks joins and never forgets.
// What the forget DOES to the saved progress is tests/amnesic.dom's.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { joinSession } from '../src/store/amnesicClose.js'
import {
  readSessionCounter,
  writeSessionCounter,
  currentSession,
  forgetJoinedSession,
} from '../src/store/amnesicWindow.js'
import { openBrowsingSession } from '../src/store/browsingSession.js'
import { setPresetAmnesic } from '../src/store/presetControl.js'
import { useProgress } from '../src/store/progress.js'
import { PRESET_STORE_KEYS } from '../src/store/presets.js'
import { readSessionHistory, writeSessionHistory } from '../src/store/sessionHistory.js'
import { readSessionRound, writeSessionRound } from '../src/store/sessionRound.js'
import { fakeLockManager } from './helpers/fakeLocks.js'
import { resetAppState } from './helpers/settingsPanel.jsx'

let locks
let handle = null
// How the document being booted was loaded, as the browser says it: its navigation entry's type, and
// whether it is a tab the browser had discarded in the background and is bringing back.
let navType = 'navigate'
let discarded = false
beforeEach(() => {
  resetAppState()
  sessionStorage.clear()
  locks = fakeLockManager()
  navType = 'navigate'
  discarded = false
  Object.defineProperty(navigator, 'locks', { configurable: true, get: () => handle })
  Object.defineProperty(document, 'wasDiscarded', { configurable: true, get: () => discarded })
  vi.spyOn(performance, 'getEntriesByType').mockImplementation((type) =>
    type === 'navigation' ? [{ type: navType }] : [],
  )
})
afterEach(() => {
  delete navigator.locks
  delete document.wasDiscarded
  handle = null
  vi.restoreAllMocks()
})

// Document `doc` boots - loaded `as` the browser says (a navigation, unless told) - with its own handle
// on the lock manager, then the app's boot (src/main.tsx awaits it), then - as the mounted app does - its
// browsing session marked open.
const boot = async (doc, { as = 'navigate', wasDiscarded = false } = {}) => {
  navType = as
  discarded = wasDiscarded
  handle = locks.forDoc(doc)
  await joinSession()
  openBrowsingSession()
}
// …started, not awaited (several documents booting at once).
const startBoot = (doc) => {
  handle = locks.forDoc(doc)
  return joinSession().then(() => openBrowsingSession())
}
// Document `doc` is gone; when it was its tab's last (a close of the tab, not a reload), the tab's
// sessionStorage goes with it - and with it, in this one test realm, the session the page had joined.
const gone = (doc, { tabClosed }) => {
  locks.close(doc)
  if (tabClosed) sessionStorage.clear()
  forgetJoinedSession()
}
// One answer of Classic, on the preset the app is on (one at a time, as a screen saves).
const answer = () => {
  const s = useProgress.getState().stats.classic
  useProgress.getState().setModeStats('classic', {
    ...s,
    played: s.played + 1,
    good: s.good + 1,
    streak: s.streak + 1,
    best: Math.max(s.best, s.streak + 1),
  })
}
const played = () => useProgress.getState().stats.classic.played
const progressText = () => localStorage.getItem(PRESET_STORE_KEYS.progress)

describe('close detection', () => {
  it('a cold open after every window closed: the forget runs and the next session is counted', async () => {
    await boot('A') // (the first open of all is a cold open too - one that owes nothing, and writes nothing)
    expect(localStorage.getItem('cg-session-v1')).toBeNull()
    expect(locks.holders()).toEqual(['A:shared'])
    answer()
    setPresetAmnesic(1, 'full')
    answer()
    answer()
    gone('A', { tabClosed: true })
    await boot('B')
    expect(readSessionCounter()).toEqual({ n: 1, pending: [] })
    expect(currentSession()).toBe(1)
    expect(JSON.parse(progressText()).state.stats.classic.played).toBe(1)
    expect(locks.holders()).toEqual(['B:shared'])
  })

  it('a reload is not a close: nothing is forgotten, and the session goes on', async () => {
    await boot('A')
    setPresetAmnesic(1, 'full')
    answer()
    gone('A', { tabClosed: false }) // the page goes; its tab, and the tab's marker, stay
    await boot('A2', { as: 'reload' })
    expect(readSessionCounter().n).toBe(0)
    expect(currentSession()).toBe(0)
    expect(played()).toBe(1)
  })

  it('a window opening beside another is not a close, though its tab is new', async () => {
    await boot('A')
    setPresetAmnesic(1, 'full')
    answer()
    sessionStorage.clear() // (a new tab: no marker of its own)
    await boot('B')
    expect(readSessionCounter().n).toBe(0)
    expect(played()).toBe(1)
    expect(locks.holders().sort()).toEqual(['A:shared', 'B:shared'])
    // …and closing one of the two is not a close either: the other keeps the session open
    gone('A', { tabClosed: true })
    sessionStorage.clear()
    await boot('C')
    expect(readSessionCounter().n).toBe(0)
    expect(played()).toBe(1)
  })

  it('cold opens at the same moment: exactly one opener, and the others join after its forget', async () => {
    await boot('A')
    setPresetAmnesic(1, 'full')
    answer()
    gone('A', { tabClosed: true })
    const booted = [startBoot('B'), startBoot('C'), startBoot('D')]
    await Promise.all(booted)
    expect(readSessionCounter()).toEqual({ n: 1, pending: [] }) // one close, counted once
    expect(currentSession()).toBe(1) // every joiner is in the session after it
    expect(played()).toBe(0)
    expect(locks.holders().sort()).toEqual(['B:shared', 'C:shared', 'D:shared'])
  })

  it('a forget the device refused is owed, and the next window to join runs it', async () => {
    await boot('A')
    setPresetAmnesic(1, 'stats')
    answer()
    answer()
    // (a close whose forget a full device refused, as the opener wrote it down)
    writeSessionCounter({ n: 1, pending: [{ presetId: 1, e: '0:1', full: false }] })
    sessionStorage.clear()
    await boot('B') // A is still open: B joins, and runs what is owed
    expect(readSessionCounter()).toEqual({ n: 1, pending: [] })
    expect(played()).toBe(0)
  })

  it('a browser without Web Locks joins, and never forgets', async () => {
    setPresetAmnesic(1, 'full')
    answer()
    handle = undefined
    await joinSession()
    expect(localStorage.getItem('cg-session-v1')).toBeNull()
    expect(played()).toBe(1)
  })

  it('a close with nothing played since the switch-on finds nothing to forget, and writes nothing', async () => {
    await boot('A')
    setPresetAmnesic(1, 'full')
    gone('A', { tabClosed: true })
    const before = JSON.stringify({ ...localStorage })
    await boot('B')
    expect(JSON.stringify({ ...localStorage })).toBe(before)
  })

  it('a close with every preset on Off owes nothing, and writes nothing', async () => {
    await boot('A')
    setPresetAmnesic(1, 'stats')
    answer()
    setPresetAmnesic(1, 'off') // off again before the close: everything is kept
    gone('A', { tabClosed: true })
    const before = JSON.stringify({ ...localStorage })
    await boot('B')
    expect(JSON.stringify({ ...localStorage })).toBe(before)
    expect(played()).toBe(1)
  })
})

describe('a tab back into a session that has ended', () => {
  const park = () => {
    writeSessionHistory(1, 'classic', '{}', true)
    writeSessionRound(1, 'blitz', { engine: {} })
  }
  const kept = () => [readSessionHistory(1, 'classic'), readSessionRound(1, 'blitz')]

  // ★ A TAB THE BROWSER DISCARDED, OR RESTORED, KEEPS ITS sessionStorage - the browsing-session marker
  // included - and can come back after every window of the app had gone: that is a close, and it is seen.
  for (const [how, load] of [
    ['a discarded tab brought back', { as: 'reload', wasDiscarded: true }],
    ['a closed tab the browser restores', { as: 'back_forward' }],
    ['a tab opened again at the address', { as: 'navigate' }],
  ])
    it(`${how}, with no other window alive: a cold open - the forget runs, and what it kept goes`, async () => {
      await boot('A')
      setPresetAmnesic(1, 'full')
      answer()
      answer()
      park()
      gone('A', { tabClosed: false }) // (its sessionStorage stays: the marker, the parks)
      await boot('A2', load)
      expect(played()).toBe(0)
      expect(readSessionCounter()).toEqual({ n: 1, pending: [] })
      expect(kept()).toEqual([null, null])
    })

  it('a discarded tab brought back beside a window still open joins: nothing is forgotten', async () => {
    await boot('A')
    setPresetAmnesic(1, 'full')
    answer()
    await boot('B')
    gone('A', { tabClosed: false })
    await boot('A2', { as: 'reload', wasDiscarded: true })
    expect(played()).toBe(1)
  })

  it('a reload into the same session keeps it', async () => {
    await boot('A')
    setPresetAmnesic(1, 'full')
    answer()
    park()
    gone('A', { tabClosed: false })
    await boot('A2', { as: 'reload' })
    expect(kept()).toEqual(['{}', { engine: {} }])
    expect(played()).toBe(1)
  })

  it('a tab whose session ended while it was away drops what it kept, though nothing is forgotten here', async () => {
    await boot('A')
    park()
    writeSessionCounter({ n: 2, pending: [] }) // (meanwhile: a close elsewhere that forgot something)
    await boot('B') // (alive beside A - a join)
    gone('A', { tabClosed: false })
    await boot('A2', { as: 'reload' })
    expect(kept()).toEqual([null, null])
    expect(currentSession()).toBe(2)
  })

  it('back from the back-forward cache into a session that has ended: it drops what it kept', async () => {
    await boot('A')
    park()
    const show = (persisted) => {
      const event = new Event('pageshow')
      Object.defineProperty(event, 'persisted', { value: persisted })
      window.dispatchEvent(event)
    }
    show(true) // back, the session still running: nothing goes
    expect(kept()).toEqual(['{}', { engine: {} }])
    writeSessionCounter({ n: 2, pending: [] }) // (closed and opened again elsewhere)
    show(false) // an ordinary load: not this handler's
    expect(kept()).toEqual(['{}', { engine: {} }])
    show(true)
    expect(kept()).toEqual([null, null])
  })
})
