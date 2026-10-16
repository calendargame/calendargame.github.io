// @vitest-environment jsdom
// storageUsage — the early "storage is getting full" warning (store/storageUsage, the ⚙ panel's
// "Storage used" line, components/StorageUsagePopup).
//
// What is pinned: the BREAKDOWN (every key counted, sorted to the right owner; a chunk nobody names
// counts toward the size and not toward the number of times); the COUNT (kept by the storage door,
// right the moment a save or a removal lands — after Reset Stats, Clear History and a preset delete
// on a filled device — and never by re-reading); the LIMIT (measured once per device, with a quota
// of several sizes; when it is taken — as the app starts, and when ⚙ or the popup opens — and when
// it may not be; what is shown on a device that cannot be measured; what a refused save teaches,
// and that it teaches it once); the popup opening by itself ONCE per upward crossing of 80% — never
// while the player is busy, not on a reload, not while usage stays above, again after a drop and a
// rise; the warning that stays (the
// line's colour, the gear's dot) and what does and does not clear it; and its place beside the
// storage-full notice.
import { readFileSync } from 'node:fs'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, cleanup, within, act, render, fireEvent } from '@testing-library/react'
import {
  useStorageUsage,
  readStorageUsage,
  refreshStorageUsage,
  watchStorageUsage,
  measureStorageLimit,
  announceStorageWarning,
  forgetStorageUsage,
  storageUsed,
  percentText,
  percentSpoken,
  shorterNamesWouldEndWarning,
  DOCUMENTED_LIMITS,
  MAX_STORAGE_LIMIT,
  STORAGE_WARN_PERCENT,
} from '../src/store/storageUsage.js'
import {
  useStorageHealth,
  writeItem,
  tryWriteItem,
  readItem,
  removeItem,
  storageSpaceFreed,
  forgetStorageHealth,
  measureRoom,
  SCRATCH_KEY,
} from '../src/store/storageHealth.js'
import { useProgress, makeProgressDefaults } from '../src/store/progress.js'
import { usePresets } from '../src/store/presets.js'
import { useModePrefs } from '../src/store/modePrefs.js'
import { useSettings } from '../src/store/settings.js'
import { useJulianRange } from '../src/store/julianRange.js'
import { useLookupHistory } from '../src/store/lookupHistory.js'
import {
  createPreset,
  renamePreset,
  switchPreset,
  deletePreset,
  setPresetAmnesic,
} from '../src/store/presetControl.js'
import { resetStatsFreesRoom } from '../src/store/amnesic.js'
import { usePlayerBusy } from '../src/lib/playerBusy.js'
import {
  GEAR_DOT_KEY,
  CHANGELOG_DOT_KEY,
  CHANGELOG_SEEN_KEY,
  markUpdateDot,
  clearUpdateDot,
  readUpdateDot,
  writeChangelogSeen,
} from '../src/changelog.js'
import { BUILD_STAMP_KEY, writeBuildStamp } from '../src/lib/buildStamp.js'
import { seedSealed, chunkId } from './helpers/progressWorld.js'
import { readDate, correctDayName } from './helpers/modeScreen.jsx'
import {
  resetAppState,
  mountApp,
  openSettings,
  closeSettings,
  panel,
  gear,
  tap,
  pressKey,
} from './helpers/settingsPanel.jsx'

const CHROMIUM = DOCUMENTED_LIMITS[0]
const SAFARI = DOCUMENTED_LIMITS[1] // about half of Chromium's
const LIMIT_KEY = 'cg-storage-limit-v1'
const WARNED_KEY = 'cg-storage-warned-v1'
const FILLER = 'zz-test-filler'
// Past the warning line of Chromium's limit, with room left for the app's own saves.
const fill = (chars = 4_300_000) => localStorage.setItem(FILLER, 'x'.repeat(chars - FILLER.length))
const empty = () => localStorage.removeItem(FILLER)
// A page load: everything the page knew is gone, and the device stands measured at `limit`
// (Chromium's unless given; null = never measured).
const freshPage = (limit) => forgetStorageUsage(limit)
const usage = () => useStorageUsage.getState()
const everything = () =>
  Object.entries({ ...localStorage }).reduce((sum, [k, v]) => sum + k.length + v.length, 0)
const long = (n) => ({
  played: n,
  good: n,
  streak: 3,
  best: 40,
  times: Array.from({ length: n }, (_, i) => 2 + (i % 977) / 100),
})
const unmountApp = () => {
  cleanup()
  document.getElementById('root')?.remove()
}
// Found by the name a screen reader is given — which never has a "<" in it: the one figure written
// with that sign is SAID "under 0.1%" (store/storageUsage's percentSpoken).
const popup = () =>
  screen.queryByRole('dialog', { name: /^Storage used: (\d+\.\d%|under 0\.1%|not measured yet)$/ })
const line = () => panel().getByRole('button', { name: /^Storage used: / })
// What an element SHOWS: its text without the words kept for a screen reader alone.
const shownText = (el) => {
  const copy = el.cloneNode(true)
  for (const spoken of copy.querySelectorAll('.sr-only')) spoken.remove()
  return copy.textContent
}
// What it SAYS: its text without what is drawn for the eye alone.
const spokenText = (el) => {
  const copy = el.cloneNode(true)
  for (const drawn of copy.querySelectorAll('[aria-hidden="true"]')) drawn.remove()
  return copy.textContent
}
const gearLit = () => gear().querySelector('[data-update-dot]').getAttribute('data-lit') === 'true'
// What the gear's dot is saying — which is its colour (components/UpdateDot; index.css).
const gearReason = () => gear().querySelector('[data-update-dot]').getAttribute('data-reason')
const quotaError = () => new DOMException('The quota has been exceeded.', 'QuotaExceededError')
const realSetItem = Storage.prototype.setItem
// The device takes `limit` characters in all (keys and values), as a browser counts them.
function deviceLimit(limit) {
  const real = Storage.prototype.setItem
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    if (this === localStorage) {
      const was = this.getItem(key)
      const after =
        everything() - (was === null ? 0 : key.length + was.length) + key.length + value.length
      if (after > limit) throw quotaError()
    }
    return real.call(this, key, value)
  })
}
const scratchWrites = (writes) => writes.mock.calls.filter(([key]) => key === SCRATCH_KEY)
// What a mode screen reports of its question (lib/playerBusy): a running solve clock — a timed,
// unanswered casual question — or, with `live`, a round, run or flash under way.
function Clock({ runs, live = false }) {
  usePlayerBusy(live ? 'live' : runs ? 'clock' : null)
  return null
}
// One event of a finger's press, as a phone sends it (jsdom's own pointer events carry no pointer,
// and it has no layout to say what is under the finger: `under` is that, for lib/pointerGestures).
const finger = (type, el, under = null) => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 })
  Object.defineProperties(e, {
    pointerId: { value: 1 },
    isPrimary: { value: true },
    pointerType: { value: 'touch' },
  })
  document.elementFromPoint = () => under
  try {
    act(() => {
      el.dispatchEvent(e)
    })
  } finally {
    delete document.elementFromPoint
  }
}
// "The player has just become free" is said from the next task: let it be said.
const settled = () => act(() => new Promise((resolve) => setTimeout(resolve)))

let stop = () => {}
const watch = () => {
  stop()
  stop = watchStorageUsage()
}

beforeEach(() => {
  resetAppState()
  forgetStorageHealth()
  freshPage()
})
afterEach(() => {
  stop()
  stop = () => {}
  unmountApp()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('what is filling the device', () => {
  it('counts every key, and sorts it to its owner', () => {
    localStorage.clear()
    const state = makeProgressDefaults()
    state.stats = { ...state.stats, classic: long(3000), flash: long(400) }
    state.blitzBest = { a: { score: 3, streak: 2, scoreRoundId: 1, streakRoundId: 1 } }
    seedSealed({ put: (k, v) => localStorage.setItem(k, v) }, state)
    // A chunk no save names (a deep Override left it): it takes room, it holds no counted time.
    const orphan = JSON.stringify(long(250).times)
    localStorage.setItem(`cg-times-v1:classic:4.${chunkId(orphan)}`, orphan)
    // Preset 2, plain; its settings; the shared Lookup history; something that is nobody's.
    const two = makeProgressDefaults()
    two.stats = { ...two.stats, dedYear: long(120) }
    localStorage.setItem('cg-progress-v1~p2', JSON.stringify({ state: two, version: 5 }))
    localStorage.setItem('cg-settings-v1~p2', '{"state":{"theme":"dusk"},"version":9}')
    localStorage.setItem(
      'cg-lookup-v1',
      JSON.stringify({ state: { history: [1, 2, 3] }, version: 1 }),
    )
    localStorage.setItem('cg-presets-v1', '{"state":{},"version":1}')

    const reading = readStorageUsage(localStorage)
    expect(reading.used).toBe(everything())
    expect(reading.rows.reduce((sum, row) => sum + row.chars, 0)).toBe(everything())
    expect(reading.rows.map((r) => r.chars)).toEqual(
      reading.rows.map((r) => r.chars).sort((a, b) => b - a),
    )
    const times = (presetId, silo) =>
      reading.rows.find((r) => r.kind === 'times' && r.presetId === presetId && r.silo === silo)
    // 3,000 times: the sealed count plus the tail — the orphan's 250 are not times anyone has…
    expect(times(1, 'classic').count).toBe(3000)
    // …but its room is counted, under the mode whose Reset Stats gets it back.
    const chunks = Object.entries({ ...localStorage }).filter(([k]) =>
      k.startsWith('cg-times-v1:classic:'),
    )
    expect(chunks).toHaveLength(11 + 1)
    expect(times(1, 'classic').chars).toBeGreaterThan(
      chunks.reduce((sum, [k, v]) => sum + k.length + v.length, 0),
    )
    expect(times(1, 'flash').count).toBe(400)
    expect(times(2, 'dedYear').count).toBe(120)
    expect(reading.rows.find((r) => r.kind === 'lookup')).toMatchObject({ count: 3 })
    expect(
      reading.rows
        .filter((r) => r.kind === 'preset')
        .map((r) => r.presetId)
        .sort(),
    ).toEqual([1, 2])
    expect(reading.rows.find((r) => r.kind === 'other').chars).toBe(
      'cg-presets-v1'.length + '{"state":{},"version":1}'.length,
    )
  })

  it('preset names are an owner of their own, counted as they are written in the save', () => {
    localStorage.clear()
    // A quote and a backslash are two characters each in a save; an emoji is two; a half emoji an
    // older build left behind is written out as six.
    const names = ['Weekend', 'He said "hi"', 'back\\slash', '🎉🎉', 'Weeke\ud83d', 'Preset 6']
    const registry = JSON.stringify({
      state: {
        presets: names.map((name, i) => ({ id: i + 1, name, amnesic: false })),
        activeId: 1,
        nextId: 7,
        openInPreset: 'last',
      },
      version: 1,
    })
    localStorage.setItem('cg-presets-v1', registry)
    localStorage.setItem('cg-settings-v1', '{"state":{"theme":"dusk"},"version":9}')
    const written = names.map((name) => JSON.stringify(name).length - 2)
    expect(written).toEqual([7, 14, 11, 4, 11, 8])
    const reading = readStorageUsage(localStorage)
    const row = reading.rows.find((r) => r.kind === 'names')
    expect(row.chars).toBe(written.reduce((a, b) => a + b))
    // Shortening can give back all of each name but one character — the first, as it is written.
    expect(row.spare).toBe(row.chars - (1 + 1 + 1 + 2 + 1 + 1))
    // Nothing is counted twice: the rest of the list is "everything else", and the rows still come
    // to exactly what the device holds.
    expect(reading.rows.find((r) => r.kind === 'other').chars).toBe(
      'cg-presets-v1'.length + registry.length - row.chars,
    )
    expect(reading.rows.reduce((sum, r) => sum + r.chars, 0)).toBe(everything())
    expect(reading.used).toBe(everything())
  })

  it('no preset list on the device, or one that cannot be read, is no row at all', () => {
    localStorage.clear()
    localStorage.setItem('cg-settings-v1', '{"state":{},"version":9}')
    expect(readStorageUsage(localStorage).rows.some((r) => r.kind === 'names')).toBe(false)
    for (const broken of [
      'not json',
      '{"state":{"presets":7}}',
      '{"state":{"presets":[{"name":5}, null]}}',
    ]) {
      localStorage.setItem('cg-presets-v1', broken)
      const reading = readStorageUsage(localStorage)
      expect(reading.rows.some((r) => r.kind === 'names')).toBe(false)
      expect(reading.rows.reduce((sum, r) => sum + r.chars, 0)).toBe(everything())
    }
  })

  describe('shorterNamesWouldEndWarning — would shortening names, and nothing else, be enough', () => {
    const LIMIT = 1000 // the line is at 800
    const rows = (names, spare, rest) => [
      { kind: 'preset', presetId: 1, chars: rest },
      { kind: 'names', chars: names, spare },
    ]
    it('yes exactly when what is held, less what the names could give back, is UNDER the line', () => {
      expect(shorterNamesWouldEndWarning(rows(300, 298, 600), LIMIT)).toBe(true) // 900 → 602
      expect(shorterNamesWouldEndWarning(rows(300, 101, 600), LIMIT)).toBe(true) // 900 → 799
      // Exactly on the line is still a warning: not enough.
      expect(shorterNamesWouldEndWarning(rows(300, 100, 600), LIMIT)).toBe(false) // 900 → 800
      expect(shorterNamesWouldEndWarning(rows(300, 298, 900), LIMIT)).toBe(false) // 1200 → 902
    })
    it('never without names to shorten, or on a device that could not be measured', () => {
      expect(
        shorterNamesWouldEndWarning([{ kind: 'preset', presetId: 1, chars: 100 }], LIMIT),
      ).toBe(false)
      expect(shorterNamesWouldEndWarning(rows(5, 0, 100), LIMIT)).toBe(false) // one-letter names
      expect(shorterNamesWouldEndWarning(rows(300, 298, 600), null)).toBe(false)
    })
  })

  it('reads the device and nothing else: a session copy is not counted', () => {
    localStorage.clear()
    sessionStorage.setItem('cg-progress-v1', 'x'.repeat(5000))
    expect(readStorageUsage(localStorage).used).toBe(0)
  })

  it('a percentage is shown to one decimal place, and never reads above 100', () => {
    expect(percentText(0, CHROMIUM)).toBe('0.0%')
    expect(percentText(3, 1000)).toBe('0.3%')
    expect(percentText(1234, 10_000)).toBe('12.3%')
    expect(percentText(CHROMIUM, CHROMIUM)).toBe('100.0%')
    expect(percentText(CHROMIUM * 3, CHROMIUM)).toBe('100.0%')
  })

  // Rounded, 79.96% would read "80.0%" with no warning beside it, and 99.96% would read "100.0%"
  // on a device that still takes a save.
  it('the last digit is cut, never rounded up: a figure is shown only once it is reached', () => {
    expect(percentText(7996, 10_000)).toBe('79.9%')
    expect(percentText(7999, 10_000)).toBe('79.9%')
    expect(percentText(8000, 10_000)).toBe('80.0%')
    expect(percentText(9996, 10_000)).toBe('99.9%')
    expect(percentText(CHROMIUM - 1, CHROMIUM)).toBe('99.9%')
    // Exact at every tenth, on a real limit: the arithmetic is in whole characters.
    for (let tenths = 1; tenths <= 1000; tenths++) {
      const reached = Math.ceil((tenths * SAFARI) / 1000)
      expect(percentText(reached, SAFARI)).toBe(`${(tenths / 10).toFixed(1)}%`)
      if (tenths > 1)
        expect(percentText(reached - 1, SAFARI)).toBe(`${((tenths - 1) / 10).toFixed(1)}%`)
    }
  })

  it('something under a tenth of a percent reads "<0.1%", never "0.0%": only nothing is zero', () => {
    expect(percentText(1, CHROMIUM)).toBe('<0.1%')
    expect(percentText(9, 10_000)).toBe('<0.1%')
    expect(percentText(10, 10_000)).toBe('0.1%')
  })

  // "<" has no reliable reading aloud. The one figure written with it has words to be said in its
  // place; every other figure is said as it is written, so it has none.
  it('…and is SAID "under 0.1%": the only figure with words of its own', () => {
    expect(percentSpoken(percentText(1, CHROMIUM))).toBe('under 0.1%')
    expect(percentSpoken('<0.1%')).toBe('under 0.1%')
    for (const chars of [0, 10, 1234, 7999, 8000, 10_000, 30_000])
      expect([chars, percentSpoken(percentText(chars, 10_000))]).toEqual([chars, null])
  })
})

describe('the count is kept by the storage door, and is right the moment a change lands', () => {
  // The figure and the warning are two readings of one count, and must never disagree: "80.0%" with
  // no warning, or the warning beside "79.9%". Checked either side of the line, on a device whose
  // limit makes neither 79.9% nor 80% a whole number of characters.
  it('the warning is on exactly when the figure reads 80.0% or more', () => {
    const limit = 1_000_003
    freshPage(limit)
    const line80 = Math.ceil((STORAGE_WARN_PERCENT * limit) / 100)
    const at = (chars) => {
      empty()
      fill(chars - everything())
      refreshStorageUsage()
      expect(storageUsed()).toBe(chars)
      return usage()
    }
    // 79.96% — rounded, this read "80.0%" (and as a whole number, "80%") with the warning off.
    expect(at(Math.round(limit * 0.7996))).toMatchObject({ figure: '79.9%', warning: false })
    expect(at(line80 - 1)).toMatchObject({ figure: '79.9%', warning: false })
    expect(at(line80)).toMatchObject({ figure: '80.0%', warning: true })
    for (let chars = line80 - 600; chars <= line80 + 600; chars += 7) {
      const { figure, warning } = at(chars)
      expect(parseFloat(figure) >= STORAGE_WARN_PERCENT).toBe(warning)
      expect(warning).toBe(chars >= line80)
    }
  })

  it('follows every save and removal without reading the device again', () => {
    watch()
    const passes = vi.spyOn(Storage.prototype, 'key')
    useProgress.getState().setModeStats('classic', long(10))
    expect(storageUsed()).toBe(everything())
    useProgress.getState().setModeStats('classic', long(4000))
    expect(storageUsed()).toBe(everything())
    useLookupHistory.getState().setHistory([{ id: 'a', y: 2024, m: 3, d: 4 }])
    expect(storageUsed()).toBe(everything())
    useProgress.getState().setModeStats('classic', long(0))
    useLookupHistory.getState().setHistory([])
    passes.mockClear() // (the helper above lists the keys itself)
    useProgress.getState().setModeStats('classic', long(5))
    useProgress.getState().setModeStats('classic', long(6))
    expect(passes).not.toHaveBeenCalled() // an answer costs one addition, not a pass over the keys
    expect(storageUsed()).toBe(everything())
  })

  // The three remedies the popup names, on a device small enough that the test data is the bulk.
  // (Before: the reading was taken by a store subscriber, which runs BEFORE the save that follows
  // the change and before a preset's keys are removed — the line stayed at 100% until ⚙ reopened.)
  describe('after each way of making room, on a filled device', () => {
    beforeEach(() => freshPage(40_000))
    const shownIsTrue = () => {
      expect(usage().figure).toBe(percentText(everything(), 40_000))
      expect(usage().warning).toBe(everything() * 100 >= STORAGE_WARN_PERCENT * 40_000)
    }

    it('Reset Stats', () => {
      watch()
      useProgress.getState().setModeStats('classic', long(6500))
      expect(usage()).toMatchObject({ figure: '100.0%', warning: true })
      useProgress.getState().setModeStats('classic', long(0))
      shownIsTrue()
      expect(usage().warning).toBe(false)
    })

    it('Clear History', () => {
      watch()
      useLookupHistory
        .getState()
        .setHistory(
          Array.from({ length: 900 }, (_, i) => ({ id: `e${i}`, y: 1000 + i, m: 3, d: 4 })),
        )
      expect(usage().warning).toBe(true)
      useLookupHistory.getState().setHistory([])
      shownIsTrue()
      expect(usage().warning).toBe(false)
    })

    it('deleting a preset', () => {
      const big = createPreset('big')
      switchPreset(big.id)
      useProgress.getState().setModeStats('classic', long(6500))
      switchPreset(1)
      watch()
      expect(usage().warning).toBe(true)
      deletePreset(big.id)
      shownIsTrue()
      expect(usage().warning).toBe(false)
    })

    it('on the mounted app: the line, its colour, and the gear dot are right at once', () => {
      useProgress.getState().setModeStats('classic', long(6500))
      // ⚠ THE LIMIT IS NOT THE 40,000 THIS GROUP REMEMBERS ONCE ⚙ HAS OPENED. The device holds more
      // than that, so the remembered limit reads as wrong and opening ⚙ measures it afresh. A
      // measurement here would find the test runner's own, far larger, allowance — so this device
      // takes nothing more (its scratch key is refused), and its limit is measured as exactly what
      // it holds at that moment. That is the figure the line is a percentage of, however much the
      // app's own markers (the changelog's seen-stamp among them) happen to weigh in this build.
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
        if (key === SCRATCH_KEY) throw quotaError()
        return realSetItem.call(this, key, value)
      })
      mountApp()
      pressKey('Escape') // the popup the crossing opened
      expect(gearLit()).toBe(true)
      expect(gearReason()).toBe('storage')
      const held = everything()
      expect(held).toBeGreaterThan(40_000)
      openSettings()
      expect(usage().limit).toBe(held)
      expect(line().className).toContain('storage-warn')
      act(() => useProgress.getState().setModeStats('classic', long(0)))
      expect(line().className).not.toContain('storage-warn')
      expect(line().textContent).toBe(`Storage used: ${percentText(everything(), held)}`)
      expect(storageUsed()).toBe(everything()) // the boot's own markers included
      expect(gearLit()).toBe(false)
    })

    // The gear's one dot has two reasons and was the update's blue for both. Its colour now says
    // which: amber for the storage warning — the colour of the line it points at — and amber when
    // both are true.
    it('the gear dot is the storage warning`s colour while there is one, an update`s otherwise', () => {
      mountApp()
      act(() => markUpdateDot(GEAR_DOT_KEY)) // an update landed: the dot is lit, and it is news
      expect(gearLit()).toBe(true)
      expect(gearReason()).toBe('update')
      act(() => useProgress.getState().setModeStats('classic', long(6500))) // …and now the warning too
      pressKey('Escape')
      expect(gearLit()).toBe(true)
      expect(gearReason()).toBe('storage') // both are live: storage wins
      act(() => useProgress.getState().setModeStats('classic', long(0)))
      expect(gearLit()).toBe(true) // the update is still unseen
      expect(gearReason()).toBe('update')
    })

    it('…and the stylesheet gives that reason the "Storage used" line`s own amber, in every theme', () => {
      const css = readFileSync('src/index.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      // One value per theme row, worn by the dot and by the line: amber on the dark themes (which
      // take the root row's), a deeper amber on the two light ones.
      const row = (selector) =>
        css.split(/\r?\n/).find((line) => line.startsWith(`${selector}{--bg1:`))
      expect(row(':root')).toContain(
        '--storage-amber:rgba(251,191,36,.95);--storage-warn:var(--storage-amber)',
      )
      for (const theme of ['light', 'parchment'])
        expect(row(`[data-theme="${theme}"]`)).toContain('--storage-warn:rgba(180,83,9,.95)')
      for (const theme of ['dusk', 'midnight', 'nebula'])
        expect(row(`[data-theme="${theme}"]`)).not.toContain('--storage-warn')
      expect((css.match(/--storage-warn:/g) ?? []).length).toBe(3)
      expect(css).toContain(
        '[data-update-dot][data-reason="storage"]{background:var(--storage-warn)}',
      )
      expect(css).toContain('.storage-warn{color:var(--storage-warn)}')
      // On the OPEN gear — filled with the brand purple in every theme — the light themes' deeper
      // amber is too weak to see, and this dot stays lit while the menu is open: there it is the
      // dark themes' bright amber whatever the theme. A more specific selector, so it wins.
      expect((css.match(/--storage-amber:/g) ?? []).length).toBe(1)
      expect(css).toContain(
        '.btn-solid>[data-update-dot][data-reason="storage"]{background:var(--storage-amber)}',
      )
      // The amber rule comes AFTER the light themes' blue one. The two selectors weigh the same,
      // so the later one wins — placed before it, a light theme's storage dot would stay blue.
      const blueLight = css.indexOf('[data-theme="light"] [data-update-dot],')
      const amber = css.indexOf('[data-update-dot][data-reason="storage"]{')
      expect(blueLight).toBeGreaterThan(-1)
      expect(amber).toBeGreaterThan(blueLight)
    })
  })

  it('a change made by another tab is counted from the browser’s own report of it', () => {
    watch()
    const before = storageUsed()
    localStorage.setItem('cg-settings-v1~p7', 'x'.repeat(5000)) // the other tab's write, as seen here
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'cg-settings-v1~p7',
        newValue: 'x'.repeat(5000),
        storageArea: localStorage,
      }),
    )
    expect(storageUsed()).toBe(everything())
    expect(storageUsed()).toBe(before + 'cg-settings-v1~p7'.length + 5000)
    localStorage.clear() // …and a clear there is counted again from nothing
    window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: localStorage }))
    expect(storageUsed()).toBe(0)
  })

  // The browser's report arrives after the fact, carrying the text the OTHER tab wrote. If this page
  // has saved to the same place since, that text is the older one — and the count used to be moved
  // by it.
  it('a report that arrives after this page has saved there again is counted as what is there now', () => {
    watch()
    const KEY = 'cg-lookup-v1'
    const theirs = 'x'.repeat(4000)
    localStorage.setItem(KEY, theirs) // the other tab's save…
    writeItem(localStorage, KEY, 'mine') // …then this page's, before the report of theirs arrives
    window.dispatchEvent(
      new StorageEvent('storage', { key: KEY, newValue: theirs, storageArea: localStorage }),
    )
    expect(localStorage.getItem(KEY)).toBe('mine')
    expect(storageUsed()).toBe(everything())
  })

  // src/changelog may import nothing, so it writes its own keys and names each to the door; the
  // build stamp goes through the door outright. (Before: neither was heard of until the next page
  // load or the popup opening, and the count was short — or long — by exactly those keys.)
  it('the update dots, the changelog’s seen-stamp, and the build stamp are counted as they land', () => {
    watch()
    const passes = vi.spyOn(Storage.prototype, 'key')
    const exact = () => {
      const counted = storageUsed()
      passes.mockClear() // (the helper below lists the keys itself)
      expect(counted).toBe(everything())
    }
    const before = storageUsed()
    markUpdateDot(GEAR_DOT_KEY)
    expect(storageUsed()).toBe(before + GEAR_DOT_KEY.length + 1)
    markUpdateDot(GEAR_DOT_KEY) // again: the same key, nothing more
    expect(storageUsed()).toBe(before + GEAR_DOT_KEY.length + 1)
    markUpdateDot(CHANGELOG_DOT_KEY)
    exact()
    clearUpdateDot(GEAR_DOT_KEY)
    exact()
    clearUpdateDot(GEAR_DOT_KEY) // nothing there to remove
    clearUpdateDot(CHANGELOG_DOT_KEY)
    expect(storageUsed()).toBe(before)
    writeChangelogSeen('x'.repeat(5000)) // a long entry…
    exact()
    writeChangelogSeen('x'.repeat(40)) // …then a short one over it
    exact()
    writeBuildStamp('2026-10-06T00:00:00.000Z')
    exact()
    writeBuildStamp('2026-10-07T00:00:00.000Z')
    exact()
    expect(passes).not.toHaveBeenCalled() // each one moved the count; none of them read the device
  })

  it('…and one the device refuses changes nothing, and is counted as nothing', () => {
    watch()
    const before = storageUsed()
    deviceLimit(everything() + 10)
    markUpdateDot(GEAR_DOT_KEY)
    writeChangelogSeen('x'.repeat(5000))
    writeBuildStamp('2026-10-06T00:00:00.000Z')
    expect(storageUsed()).toBe(before)
    expect(storageUsed()).toBe(everything())
    expect(useStorageHealth.getState().unsaved).toBe(false) // best-effort: nothing is held for them
  })

  it('on the mounted app the count is the device, from the first screen on', () => {
    writeBuildStamp('an-earlier-build') // an update landed: the boot lights both dots
    mountApp()
    expect(readUpdateDot(GEAR_DOT_KEY)).toBe(true)
    expect(readUpdateDot(CHANGELOG_DOT_KEY)).toBe(true)
    expect(storageUsed()).toBe(everything())
    openSettings() // …which clears the gear's
    expect(readUpdateDot(GEAR_DOT_KEY)).toBe(false)
    expect(storageUsed()).toBe(everything())
    act(() => markUpdateDot(GEAR_DOT_KEY))
    expect(storageUsed()).toBe(everything())
    act(() => clearUpdateDot(CHANGELOG_DOT_KEY))
    expect(storageUsed()).toBe(everything())
    expect(popup()).toBeNull() // (nothing above counted the device afresh)
  })

  // ★ THE PROPERTY ALL OF THE ABOVE ARE CASES OF: whatever is done to the device, in whatever
  // order, the running count equals a full reading of it after every single step. 6,000 steps of
  // everything that can touch localStorage — saves through the door (held or not, refused or not,
  // on a device small enough that plenty are refused), removals, another tab's writes, removals and
  // clears, a measurement, and the writers outside the stores: the dots, the seen-stamp, the build
  // stamp. The session's area takes a share of the steps too, and must never move the count.
  it('no drift: after each of 6,000 mixed steps the count equals a full reading of the device', () => {
    let seed = 12345
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    const pick = (list) => list[Math.floor(rnd() * list.length)]
    freshPage(null)
    deviceLimit(30_000)
    watch()
    const keys = [
      'cg-progress-v1',
      'cg-progress-v1~p2',
      'cg-times-v1:classic:0.abc',
      'cg-times-v1~p2:flash:3.zz.1',
      'cg-lookup-v1',
      'cg-settings-v1',
      'zzz-other',
      LIMIT_KEY,
      WARNED_KEY,
      GEAR_DOT_KEY,
      CHANGELOG_DOT_KEY,
      CHANGELOG_SEEN_KEY,
      BUILD_STAMP_KEY,
    ]
    const elsewhere = (area, key, newValue) =>
      window.dispatchEvent(new StorageEvent('storage', { key, newValue, storageArea: area }))
    const steps = [
      (area, key, text) => writeItem(area, key, text),
      (area, key, text) => tryWriteItem(area, key, text),
      (area, key) => removeItem(area, key),
      () => storageSpaceFreed(),
      (area, key) => readItem(area, key),
      () => measureStorageLimit(),
      // Another tab: a write (if the device takes it), a removal, its measurement passing through,
      // and — rarely — a clear.
      (area, key, text) => {
        try {
          area.setItem(key, text)
        } catch {
          return
        }
        elsewhere(area, key, text)
      },
      (area, key) => {
        area.removeItem(key)
        elsewhere(area, key, null)
      },
      (area) => {
        try {
          area.setItem(SCRATCH_KEY, 'x'.repeat(50))
          elsewhere(area, SCRATCH_KEY, 'x'.repeat(50))
        } catch {
          /* no room for it */
        }
        area.removeItem(SCRATCH_KEY)
        elsewhere(area, SCRATCH_KEY, null)
      },
      (area) => {
        if (rnd() > 0.02) return
        area.clear()
        elsewhere(area, null, null)
      },
      // The writers outside the stores.
      () => markUpdateDot(pick([GEAR_DOT_KEY, CHANGELOG_DOT_KEY])),
      () => clearUpdateDot(pick([GEAR_DOT_KEY, CHANGELOG_DOT_KEY])),
      (area, key, text) => writeChangelogSeen(text),
      (area, key, text) => writeBuildStamp(text.slice(0, 24)),
    ]
    const drift = []
    for (let step = 0; step < 6000 && drift.length < 5; step++) {
      const key = pick(keys)
      const text = 'v'.repeat(Math.floor(rnd() * rnd() * 9000))
      const area = rnd() < 0.2 ? sessionStorage : localStorage
      const at = Math.floor(rnd() * steps.length)
      steps[at](area, key, text)
      if (storageUsed() !== everything())
        drift.push({ step, at, key, by: storageUsed() - everything() })
      if (localStorage.getItem(SCRATCH_KEY) !== null)
        drift.push({ step, at, scratch: 'left behind' })
    }
    expect(drift).toEqual([])
  })
})

// What the popup and the storage-full notice may truthfully recommend (store/amnesic's
// resetStatsFreesRoom, and the two remedies that hold under every value).
describe.each(['off', 'stats', 'full'])(
  'what makes room while the preset is on Amnesic: %s',
  (mode) => {
    const manyLookups = Array.from({ length: 900 }, (_, i) => ({
      id: `e${i}`,
      y: 1000 + i,
      m: 3,
      d: 4,
    }))
    beforeEach(() => {
      freshPage(100_000)
      useProgress.getState().setModeStats('classic', long(6500)) // saved, on Off
      useLookupHistory.getState().setHistory(manyLookups)
      if (mode !== 'off') setPresetAmnesic(1, mode)
      watch()
    })

    it(`Reset Stats ${mode === 'off' ? 'frees the mode’s solve times' : 'clears the session’s copy and frees nothing'}`, () => {
      expect(resetStatsFreesRoom(mode)).toBe(mode === 'off')
      const saved = localStorage.getItem('cg-progress-v1')
      const before = storageUsed()
      useProgress.getState().setModeStats('classic', long(3)) // play, on whichever copy is live
      useProgress.getState().setModeStats('classic', long(0)) // Reset Stats
      if (mode === 'off') expect(before - storageUsed()).toBeGreaterThan(40_000)
      else {
        expect(storageUsed()).toBe(before)
        expect(localStorage.getItem('cg-progress-v1')).toBe(saved)
      }
    })

    it('Clear History frees the Lookup history', () => {
      const before = storageUsed()
      useLookupHistory.getState().setHistory([])
      expect(before - storageUsed()).toBeGreaterThan(30_000)
    })

    it('deleting a preset frees everything it holds — the one you are on included', () => {
      createPreset('spare')
      const before = storageUsed()
      deletePreset(1)
      expect(before - storageUsed()).toBeGreaterThan(40_000)
      expect(localStorage.getItem('cg-progress-v1')).toBeNull()
    })
  },
)

// ── The limit ─────────────────────────────────────────────────────────────────────────────────

// A storage area with a quota, counting what a measurement costs it.
function fakeArea(limit, held = 0) {
  const map = new Map()
  if (held) map.set('held', 'h'.repeat(held - 4))
  const size = () => [...map].reduce((sum, [k, v]) => sum + k.length + v.length, 0)
  const cost = { tries: 0, written: 0 }
  return {
    cost,
    keys: () => [...map.keys()],
    getItem: (k) => map.get(k) ?? null,
    removeItem: (k) => void map.delete(k),
    setItem(k, v) {
      cost.tries++
      const was = map.get(k)
      if (size() - (was === undefined ? 0 : k.length + was.length) + k.length + v.length > limit)
        throw quotaError()
      cost.written += k.length + v.length
      map.set(k, v)
    },
  }
}
const guessesFor = (held) => DOCUMENTED_LIMITS.map((limit) => limit - held)

describe('measuring how much more a device will take', () => {
  it('a documented limit is confirmed exactly, in one large write that fits and one that does not', () => {
    for (const limit of DOCUMENTED_LIMITS) {
      const area = fakeArea(limit, 1000)
      expect(measureRoom(area, MAX_STORAGE_LIMIT - 1000, guessesFor(1000), 4096)).toBe(limit - 1000)
      // The empty key, the guess, the guess plus one — and, for the smaller limit, the larger
      // limit's guess refused first (a refused write stores nothing).
      expect(area.cost.tries).toBeLessThanOrEqual(4)
      expect(area.cost.written).toBe(SCRATCH_KEY.length + limit - 1000)
      expect(area.keys()).toEqual(['held']) // the scratch key is gone
    }
  })

  it('any other limit is found to within the tolerance, never above it, in a bounded number of tries', () => {
    for (const limit of [3_000_000, 1_234_567, 7_777_777, 40_000]) {
      for (const held of [0, 1000, limit - 300, limit - 5, limit]) {
        const area = fakeArea(limit, held)
        const room = measureRoom(area, MAX_STORAGE_LIMIT - held, guessesFor(held), 4096)
        expect(room).toBeLessThanOrEqual(limit - held)
        expect(room).toBeGreaterThanOrEqual(Math.min(limit - held, SCRATCH_KEY.length) - 16)
        expect(limit - held - room).toBeLessThan(4096 + SCRATCH_KEY.length)
        expect(area.cost.tries).toBeLessThanOrEqual(20)
        expect(area.keys()).toEqual(held ? ['held'] : [])
      }
    }
  })

  it('a device that is already nearly full costs next to nothing to measure', () => {
    const held = CHROMIUM - 3000
    const area = fakeArea(CHROMIUM, held)
    expect(measureRoom(area, MAX_STORAGE_LIMIT - held, guessesFor(held), 4096)).toBe(3000)
    expect(area.cost.written).toBeLessThan(4000)
  })

  it('a device with no limit in reach is written to at the most it will ever try, and no further', () => {
    const area = fakeArea(Infinity, 500)
    expect(measureRoom(area, MAX_STORAGE_LIMIT - 500, guessesFor(500), 4096)).toBe(
      MAX_STORAGE_LIMIT - 500,
    )
    // The empty key; the larger guess and one past it, both fitting; then the most — and that is
    // all (the smaller guess is below what is already known to fit, and is never tried).
    expect(area.cost.tries).toBe(4)
  })

  it('a scratch key left by a crash is removed before anything is measured', () => {
    const area = fakeArea(50_000)
    area.setItem(SCRATCH_KEY, 'x'.repeat(40_000))
    expect(measureRoom(area, MAX_STORAGE_LIMIT, [], 1)).toBe(50_000)
    expect(area.keys()).toEqual([])
  })

  it('anything but "no room" is not swallowed, and still leaves no scratch key', () => {
    const area = fakeArea(50_000)
    area.setItem = () => {
      throw new Error('disk on fire')
    }
    expect(() => measureRoom(area, 1000, [], 1)).toThrow('disk on fire')
    expect(area.keys()).toEqual([])
  })
})

describe('the limit', () => {
  it('is not known on a device that has not been measured: no percentage, no warning', () => {
    freshPage(null)
    fill()
    refreshStorageUsage()
    expect(usage()).toMatchObject({ limit: null, figure: null, warning: false, popupOpen: false })
  })

  // Safari's documented allowance — the size the old assumed figure got wrong by half — and one
  // no browser documents.
  it.each([
    ['half of Chromium’s', SAFARI, true],
    ['a size nobody documents', 3_333_333, false],
  ])(
    'is measured as the app starts, before anything is on screen — a device whose limit is %s',
    (_name, limit, exact) => {
      freshPage(null)
      useProgress.getState().setModeStats('classic', long(3000))
      const writes = deviceLimit(limit)
      measureStorageLimit() // the entry's call, ahead of the first render
      if (exact) expect(usage().limit).toBe(limit)
      else {
        expect(usage().limit).toBeLessThanOrEqual(limit)
        expect(usage().limit).toBeGreaterThan(limit - 4200)
      }
      expect(usage().figure).toBe(percentText(everything(), usage().limit))
      expect(localStorage.getItem(SCRATCH_KEY)).toBeNull()
      expect(localStorage.getItem(LIMIT_KEY)).toBe(String(usage().limit))
      // …and it is not measured again: not when ⚙ or the popup opens, not on the next page.
      writes.mockClear()
      measureStorageLimit()
      usage().openPopup()
      usage().closePopup()
      freshPage(null)
      measureStorageLimit()
      watch()
      expect(scratchWrites(writes)).toHaveLength(0)
      expect(usage().limit).toBe(Number(localStorage.getItem(LIMIT_KEY)))
    },
  )

  // A browser that gives the site no room at all: nothing is saved, and the first character is
  // refused. "Used 0 of 0" was taken as a measurement, and the line read "Storage used: NaN%".
  it('a device that holds nothing and takes nothing is not measured: a dash, never "NaN%"', () => {
    freshPage(null)
    localStorage.clear()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (this === localStorage) throw quotaError()
      return realSetItem.call(this, key, value)
    })
    measureStorageLimit() // the app's start
    expect(usage()).toMatchObject({ limit: null, figure: null, warning: false })
    mountApp()
    pressKey('Escape') // the storage-full notice, if the app's first save was refused
    openSettings() // …and ⚙ tries again
    expect(usage()).toMatchObject({ limit: null, figure: null, warning: false })
    expect(line().textContent).toBe('Storage used: —not measured yet')
    tap(line())
    expect(popup().querySelector('#storage-usage-title').textContent).toBe(
      'Storage used: not measured yet',
    )
    expect(popup().textContent).toMatch(/couldn.t be measured, so there are no percentages/)
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/)
  })

  it('the measurement at the start opens nothing: there is no screen yet to open it over', () => {
    freshPage(null)
    fill(SAFARI - 20_000)
    deviceLimit(SAFARI)
    measureStorageLimit()
    expect(usage().limit).toBe(SAFARI)
    expect(usage()).toMatchObject({
      figure: expect.stringMatching(/^99\.\d%$/),
      warning: true,
      popupOpen: false,
    })
    watch() // the app is on screen, and nobody is busy
    expect(usage().popupOpen).toBe(true)
  })

  // The device used to be measured from a poll that needed no solve clock running — and a casual
  // mode with its timing shown always has one, so there it was never measured at all; and an open
  // popup held the poll off, the Storage used popup included.
  it('a timed question on screen does not stop ⚙, or the popup, from measuring', () => {
    freshPage(null)
    deviceLimit(SAFARI)
    render(<Clock runs={true} />)
    watch()
    expect(usage().limit).toBeNull()
    usage().openPopup() // "Storage used: —", tapped
    expect(usage()).toMatchObject({ limit: SAFARI, popupOpen: true })
    expect(usage().figure).toBe(percentText(everything(), SAFARI))
  })

  it('it is not taken while a round, run, or flash is under way, or while a save is held', () => {
    freshPage(null)
    deviceLimit(SAFARI)
    watch()
    const { rerender } = render(<Clock live />)
    measureStorageLimit()
    expect(usage().limit).toBeNull()
    rerender(<Clock />)

    act(() => useStorageHealth.setState({ unsaved: true }))
    measureStorageLimit()
    expect(usage().limit).toBeNull()
    act(() => useStorageHealth.setState({ unsaved: false }))

    measureStorageLimit() // nothing in the way any more
    expect(usage().limit).toBe(SAFARI)
  })

  it('a refused save teaches a limit at once, and it is measured properly when nothing is refused', () => {
    freshPage(null)
    const limit = 1_000_000
    fill(990_000)
    deviceLimit(limit)
    watch()
    writeItem(localStorage, 'cg-big', 'y'.repeat(50_000)) // refused, and held
    expect(useStorageHealth.getState().unsaved).toBe(true)
    // What the device held when it said no — short of the truth by up to the refused save.
    expect(usage().limit).toBe(everything())
    expect(usage().figure).toBe('100.0%')
    expect(localStorage.getItem(LIMIT_KEY)).toMatch(/^\d+\?$/)
    measureStorageLimit()
    expect(usage().limit).toBe(everything()) // not measured while a save is held
    // …a later page, with nothing being refused, starts from what was learned, then measures.
    forgetStorageHealth()
    freshPage(null)
    refreshStorageUsage()
    expect(usage().figure).toBe('100.0%')
    measureStorageLimit()
    expect(usage().limit).toBeLessThanOrEqual(limit)
    expect(usage().limit).toBeGreaterThan(limit - 4200)
    expect(usage().figure).toMatch(/^99\.\d%$/)
    expect(localStorage.getItem(LIMIT_KEY)).toBe(String(usage().limit))
  })

  // ★ THE WHOLE EPISODE: refuse, make room, land. The limit a refusal teaches used to be taught
  // again on every change while the save was held — so the remedy the notice recommends, which
  // empties the device, taught "the limit is the little that is left": 100% and the warning on a
  // device that was 2% full, written down for every other tab and the next open to inherit.
  it('the limit a refusal teaches is taught ONCE: making room while the save is held does not shrink it', () => {
    const LIMIT = 60_000
    const closeTo = (limit) => {
      expect(limit).toBeLessThanOrEqual(LIMIT)
      expect(limit).toBeGreaterThan(LIMIT - 4200)
    }
    freshPage(null)
    deviceLimit(LIMIT)
    measureStorageLimit()
    watch()
    closeTo(usage().limit)
    expect(localStorage.getItem(LIMIT_KEY)).toBe(String(usage().limit))
    let n = 1000
    for (; !useStorageHealth.getState().unsaved; n += 200)
      useProgress.getState().setModeStats('classic', long(n))
    const taught = usage().limit
    expect(taught).toBe(everything())
    expect(taught).toBeGreaterThan(LIMIT * 0.9)
    expect(usage().figure).toBe('100.0%')
    const marker = localStorage.getItem(LIMIT_KEY)
    expect(marker).toMatch(/^\d+\?$/)

    useProgress.getState().setModeStats('classic', long(0)) // Reset Stats: the held save now fits
    expect(useStorageHealth.getState().unsaved).toBe(false)
    expect(usage().limit).toBe(taught)
    expect(localStorage.getItem(LIMIT_KEY)).toBe(marker)
    expect(usage().figure).toBe(percentText(everything(), LIMIT))
    expect(parseFloat(usage().figure)).toBeLessThan(10)
    expect(usage().warning).toBe(false)

    measureStorageLimit() // the next time ⚙ opens: measured properly, and remembered as such
    closeTo(usage().limit)
    expect(localStorage.getItem(LIMIT_KEY)).toBe(String(usage().limit))
  })

  it('a device that fills while the SESSION’s area is already refusing still teaches its limit', () => {
    const real = Storage.prototype.setItem
    let full = false
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (this === sessionStorage || (full && key === 'cg-big')) throw quotaError()
      return real.call(this, key, value)
    })
    watch()
    writeItem(sessionStorage, 'cg-progress-v1', 'y')
    expect(usage().limit).toBe(CHROMIUM) // a refusal in sessionStorage teaches nothing about the device
    full = true
    writeItem(localStorage, 'cg-big', 'y')
    expect(usage().limit).toBe(everything())
  })

  it('a save refused before the count began is heard when it begins', () => {
    deviceLimit(1000)
    writeItem(localStorage, 'cg-big', 'y'.repeat(5000)) // one of the app's own, as it loaded
    expect(useStorageHealth.getState().unsaved).toBe(true)
    watch()
    expect(usage()).toMatchObject({ limit: everything(), figure: '100.0%' })
  })

  it('usage found above the remembered limit means the limit was wrong: it is measured again', () => {
    freshPage(2000) // a limit remembered from some earlier, smaller allowance
    fill(100_000)
    deviceLimit(SAFARI)
    measureStorageLimit() // the next start
    expect(usage().limit).toBe(SAFARI)
    expect(usage().warning).toBe(false)
  })

  it('a second tab is told the limit by the first one’s marker, and does not measure', () => {
    freshPage(null)
    const writes = deviceLimit(SAFARI)
    watch()
    localStorage.setItem(LIMIT_KEY, String(SAFARI))
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: LIMIT_KEY,
        newValue: String(SAFARI),
        storageArea: localStorage,
      }),
    )
    expect(usage().limit).toBe(SAFARI)
    measureStorageLimit()
    expect(scratchWrites(writes)).toHaveLength(0)
  })

  // With no limit there is no percentage — which used to read as "back under the line", so the
  // marker was cleared and the popup shown a second time once the device had been measured.
  it('an announced crossing stays announced while there is no reading', () => {
    fill()
    watch()
    expect(usage().popupOpen).toBe(true)
    usage().closePopup()
    expect(localStorage.getItem(WARNED_KEY)).toBe('1')
    stop()
    localStorage.removeItem(LIMIT_KEY)
    freshPage(null) // the next page, on a device whose remembered limit is gone
    deviceLimit(CHROMIUM)
    watch()
    expect(usage().figure).toBeNull()
    expect(localStorage.getItem(WARNED_KEY)).toBe('1')
    measureStorageLimit()
    expect(usage()).toMatchObject({ warning: true, popupOpen: false })
  })
})

describe('a measurement is invisible to everything that keeps track of saved data', () => {
  it('the scratch key is not counted, not listed, and another tab’s is not "your data changed"', () => {
    watch()
    const real = Storage.prototype.setItem
    const refuse = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === 'cg-held') throw quotaError()
      return real.call(this, key, value)
    })
    writeItem(localStorage, 'cg-held', 'mine') // a save this page is holding
    const before = storageUsed()
    // Another tab is measuring: its scratch key appears here, and the browser reports it.
    localStorage.setItem(SCRATCH_KEY, 'x'.repeat(100_000))
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: SCRATCH_KEY,
        newValue: 'x'.repeat(100_000),
        storageArea: localStorage,
      }),
    )
    expect(storageUsed()).toBe(before)
    expect(readItem(localStorage, 'cg-held')).toBe('mine') // still held
    // …and it was not retried on the strength of it.
    expect(refuse.mock.calls.filter(([key]) => key === 'cg-held')).toHaveLength(1)
    refreshStorageUsage() // a full count while it is there
    expect(storageUsed()).toBe(before)
    expect(readStorageUsage(localStorage).used).toBe(before)
    usage().openPopup()
    expect(usage().rows.reduce((sum, row) => sum + row.chars, 0)).toBe(before)
  })

  it('a save is never refused because of a scratch key: the key goes, and the save is tried again', () => {
    watch()
    deviceLimit(60_000)
    localStorage.setItem(SCRATCH_KEY, 'x'.repeat(50_000)) // left by a crash, or another tab's
    expect(writeItem(localStorage, 'cg-lookup-v1', 'y'.repeat(20_000))).toBe(true)
    expect(localStorage.getItem(SCRATCH_KEY)).toBeNull()
    expect(useStorageHealth.getState()).toMatchObject({ unsaved: false, noticeOpen: false })
    // …and a save that does not fit with it gone is refused as ever.
    expect(writeItem(localStorage, 'cg-big', 'y'.repeat(70_000))).toBe(false)
    expect(useStorageHealth.getState().unsaved).toBe(true)
  })

  it('a scratch key left by a crash is not counted at the next open, and goes at the measurement', () => {
    freshPage(null)
    localStorage.setItem(SCRATCH_KEY, 'x'.repeat(200_000))
    deviceLimit(SAFARI)
    refreshStorageUsage()
    expect(storageUsed()).toBe(everything() - SCRATCH_KEY.length - 200_000)
    measureStorageLimit()
    expect(localStorage.getItem(SCRATCH_KEY)).toBeNull()
    expect(usage().limit).toBe(SAFARI)
  })
})

describe('the popup opens by itself once per upward crossing of the line', () => {
  beforeEach(() => watch()) // the app is on screen: only then is there anything to open it over

  it('opens on the crossing — and not again while usage stays above, nor on a reload', () => {
    refreshStorageUsage()
    expect(usage()).toMatchObject({ warning: false, popupOpen: false })
    fill()
    refreshStorageUsage()
    expect(parseFloat(usage().figure)).toBeGreaterThanOrEqual(STORAGE_WARN_PERCENT)
    expect(usage()).toMatchObject({ warning: true, popupOpen: true })
    usage().closePopup()
    refreshStorageUsage()
    expect(usage()).toMatchObject({ warning: true, popupOpen: false })
    freshPage() // a reload, or the app closed and opened again: the device remembers
    refreshStorageUsage()
    expect(usage()).toMatchObject({ warning: true, popupOpen: false })
  })

  it('a drop back under and a later rise is a NEW crossing', () => {
    fill()
    refreshStorageUsage()
    usage().closePopup()
    empty()
    refreshStorageUsage()
    expect(usage()).toMatchObject({ warning: false, popupOpen: false })
    expect(localStorage.getItem(WARNED_KEY)).toBeNull()
    fill()
    refreshStorageUsage()
    expect(usage()).toMatchObject({ warning: true, popupOpen: true })
  })

  it('does not open by itself while the device is refusing saves — the storage-full notice speaks', () => {
    useStorageHealth.setState({ unsaved: true, noticeOpen: true })
    fill()
    refreshStorageUsage()
    expect(usage()).toMatchObject({ warning: true, popupOpen: false })
    // …and the crossing counts as announced: it does not pop up afterwards either.
    useStorageHealth.setState({ unsaved: false, noticeOpen: false })
    refreshStorageUsage()
    expect(usage().popupOpen).toBe(false)
  })

  it('tapping the line always opens it, warning or not — and above the line that IS the announcement', async () => {
    usage().openPopup()
    expect(usage()).toMatchObject({ warning: false, popupOpen: true })
    usage().closePopup()
    const { rerender } = render(<Clock runs={true} />)
    fill()
    refreshStorageUsage()
    expect(usage()).toMatchObject({ warning: true, popupOpen: false }) // waiting for the clock
    usage().openPopup()
    usage().closePopup()
    rerender(<Clock runs={false} />) // the clock stops: nothing is left to announce
    await settled()
    expect(usage().popupOpen).toBe(false)
  })

  it('never over a timed question: it waits for the clock to stop — the line and the dot do not', async () => {
    const { rerender } = render(<Clock runs={true} />)
    fill()
    refreshStorageUsage()
    expect(usage()).toMatchObject({ warning: true, popupOpen: false })
    expect(localStorage.getItem(WARNED_KEY)).toBeNull() // not "announced" until it has been
    // A reload before it could open does not lose it.
    freshPage()
    watch()
    expect(usage()).toMatchObject({ warning: true, popupOpen: false })
    rerender(<Clock runs={false} />) // an answered card, an ended round, a page with no clock
    await settled()
    expect(usage().popupOpen).toBe(true)
    expect(localStorage.getItem(WARNED_KEY)).toBe('1')
  })

  // One screen's clock stops and the next one's starts inside a single commit (a mode letter, a
  // preset switch, a Deduction type change). "The last clock stopped" used to be said in the gap
  // between the two, and the popup opened over the fresh question.
  it('not in the gap between one timed screen and the next', async () => {
    const Screens = ({ on }) => (
      <>
        <Clock runs={on === 'classic'} />
        <Clock runs={on === 'deduction'} />
      </>
    )
    const { rerender } = render(<Screens on="classic" />)
    fill()
    refreshStorageUsage()
    rerender(<Screens on="deduction" />) // the earlier sibling stops, the later one starts
    await settled()
    expect(usage().popupOpen).toBe(false)
    rerender(<Screens on="classic" />) // …and the other way round
    await settled()
    expect(usage().popupOpen).toBe(false)
    rerender(<Screens on="lookup" />)
    await settled()
    expect(usage().popupOpen).toBe(true)
  })

  it('not while a text box has the keyboard: it waits for the box to be left', async () => {
    const box = document.createElement('input')
    const next = document.createElement('input')
    const button = document.createElement('button')
    document.body.append(box, next, button)
    try {
      box.focus()
      fill()
      refreshStorageUsage()
      expect(usage()).toMatchObject({ warning: true, popupOpen: false })
      next.focus() // from one box straight into another: still typing
      await settled()
      expect(usage().popupOpen).toBe(false)
      button.focus()
      await settled()
      expect(usage().popupOpen).toBe(true)
    } finally {
      box.remove()
      next.remove()
      button.remove()
    }
  })

  it('…or for the player to open ⚙, which is stepping away from the question by choice', () => {
    render(<Clock runs={true} />)
    fill()
    refreshStorageUsage()
    expect(usage().popupOpen).toBe(false)
    announceStorageWarning(true)
    expect(usage().popupOpen).toBe(true)
  })

  it('…but not from a round, a run, or a flash: that keeps running behind the menu', async () => {
    const { rerender } = render(<Clock live />)
    fill()
    refreshStorageUsage()
    announceStorageWarning(true)
    expect(usage().popupOpen).toBe(false)
    rerender(<Clock />)
    await settled()
    expect(usage().popupOpen).toBe(true)
  })

  it('a device too full to take the "already warned" marker still warns only once per page', async () => {
    fill()
    const real = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === WARNED_KEY) throw quotaError()
      return real.call(this, key, value)
    })
    refreshStorageUsage()
    expect(usage().popupOpen).toBe(true)
    usage().closePopup()
    expect(localStorage.getItem(WARNED_KEY)).toBeNull()
    // Everything that could reopen it: a recount, ⚙ opening, the clock stopping, a save.
    refreshStorageUsage()
    announceStorageWarning(true)
    const { rerender } = render(<Clock runs={true} />)
    rerender(<Clock runs={false} />)
    await settled()
    useProgress.getState().setModeStats('classic', long(3))
    expect(usage()).toMatchObject({ warning: true, popupOpen: false })
  })
})

describe('on the mounted app', () => {
  it('⚙ always shows "Storage used: N.N%", and tapping it opens the breakdown as a stacked popup', () => {
    useProgress.getState().setModeStats('classic', long(4000))
    mountApp()
    expect(popup()).toBeNull()
    openSettings()
    // One decimal place, in figures that all take the same width, so the line does not shift as
    // it counts.
    expect(line().textContent).toBe(`Storage used: ${percentText(everything(), CHROMIUM)}`)
    expect(line().textContent).toMatch(/^Storage used: \d+\.\d%$/)
    expect(line().className).toContain('tabular-nums')
    expect(line().className).not.toContain('storage-warn')
    tap(line())
    const card = popup()
    expect(card).not.toBeNull()
    const title = card.querySelector('#storage-usage-title')
    expect(title.textContent).toBe(`Storage used: ${percentText(everything(), CHROMIUM)}`)
    expect(title.className).toContain('tabular-nums')
    // The shared popup shell: its scrim, and the status-bar strip of the popup in front.
    const scrim = card.closest('[data-settings-modal]')
    expect(scrim.querySelector('[data-status-bar-dim]')).not.toBeNull()
    // It names the real controls, and never the word for the mechanism.
    const text = card.textContent
    for (const control of ['Reset Stats', 'Clear History', 'Manage Presets'])
      expect(text).toContain(control)
    expect(text).not.toMatch(/localStorage/i)
    pressKey('Escape')
    expect(popup()).toBeNull()
    expect(panel()).not.toBeNull() // only the popup closed; ⚙ is still open under it
  })

  it('past 80% it opens by itself once — not after a reload — and the warning stays', () => {
    fill()
    mountApp()
    expect(popup()).not.toBeNull()
    expect(popup().textContent).toContain('running out of room')
    pressKey('Escape')
    expect(popup()).toBeNull()
    unmountApp()
    freshPage()
    mountApp() // the reload
    expect(popup()).toBeNull()
    expect(gearLit()).toBe(true)
    expect(gear().getAttribute('aria-label')).toContain('storage almost full')
    // Opening ⚙ does NOT put the dot out while usage is still above the line…
    openSettings()
    expect(gearLit()).toBe(true)
    expect(line().className).toContain('storage-warn')
    expect(line().textContent).toContain('almost full')
    closeSettings()
    expect(gearLit()).toBe(true)
    // …it goes out when usage drops back under.
    act(() => {
      empty()
      refreshStorageUsage()
    })
    openSettings()
    expect(gearLit()).toBe(false)
    expect(line().className).not.toContain('storage-warn')
  })

  it('the update dot keeps its own rule: opening ⚙ clears THAT reason and only that one', () => {
    fill()
    refreshStorageUsage()
    usage().closePopup()
    markUpdateDot(GEAR_DOT_KEY)
    mountApp()
    expect(gearLit()).toBe(true)
    openSettings()
    expect(readUpdateDot(GEAR_DOT_KEY)).toBe(false) // the update breadcrumb was read
    expect(gearLit()).toBe(true) // the storage warning still stands
    empty()
    act(() => refreshStorageUsage())
    expect(gearLit()).toBe(false)
    // …and with no storage warning, the update dot alone behaves as it always has.
    closeSettings()
    act(() => markUpdateDot(GEAR_DOT_KEY))
    expect(gearLit()).toBe(true)
    openSettings()
    expect(gearLit()).toBe(false)
  })

  it('names each preset’s share when there is more than one', () => {
    createPreset('Weekend')
    useProgress.getState().setModeStats('classic', long(9000))
    mountApp()
    openSettings()
    tap(line())
    const rows = within(popup())
      .getAllByRole('listitem')
      .map((li) => li.textContent)
    expect(rows.some((t) => /^Preset 1: Classic solve times \(9,000\)\d+\.\d%$/.test(t))).toBe(true)
  })

  describe('preset names in the breakdown', () => {
    const ADVICE = /Shortening your preset names would be enough on its own to end this warning/
    // What each row of the breakdown SHOWS (not the words kept for a screen reader beside "<0.1%").
    const rowTexts = () =>
      within(popup())
        .getAllByRole('listitem')
        .filter((li) => !li.closest('.list-disc'))
        .map(shownText)
    const advice = () =>
      within(popup())
        .getAllByRole('listitem')
        .filter((li) => li.closest('.list-disc'))
    const openBreakdown = () => {
      mountApp()
      openSettings()
      tap(line())
    }
    // A name of `chars` characters on preset 1, a second preset beside it.
    const nameOf = (chars) => {
      createPreset('Weekend')
      renamePreset(1, 'n'.repeat(chars))
    }

    it('are one row, "Preset names", with their share written like every other', () => {
      nameOf(600_000)
      openBreakdown()
      const { rows } = readStorageUsage(localStorage)
      const names = rows.find((r) => r.kind === 'names')
      expect(names.chars).toBe(600_000 + 'Weekend'.length)
      expect(rowTexts()[0]).toBe(`Preset names${percentText(names.chars, CHROMIUM)}`) // the largest
      expect(percentText(names.chars, CHROMIUM)).toBe('11.4%')
      // The rows still come to the headline or a little under it, never more ("<0.1%" is under a
      // tenth, counted here as nothing).
      const figure = (text) => (/<0\.1%$/.test(text) ? 0 : parseFloat(text.match(/([\d.]+)%$/)[1]))
      const headline = figure(shownText(popup().querySelector('#storage-usage-title')))
      expect(
        rowTexts()
          .map(figure)
          .reduce((a, b) => a + b),
      ).toBeLessThanOrEqual(headline + 1e-9)
      expect(rowTexts().at(-1)).toMatch(/^Everything else/)
    })

    it('ordinary names are a small owner like any other: listed among the first few, "<0.1%"', () => {
      createPreset('Weekend')
      openBreakdown()
      expect(rowTexts()).toContain('Preset names<0.1%')
    })

    it('on a device with one untouched preset there is no preset list saved, and no row', () => {
      openBreakdown()
      expect(rowTexts().join('|')).not.toMatch(/Preset names/)
    })

    it('says nothing about names while there is no warning, however long they are', () => {
      nameOf(3_000_000) // more than half the device, and under the line
      openBreakdown()
      expect(usage().warning).toBe(false)
      expect(popup().textContent).not.toMatch(ADVICE)
    })

    it('says nothing about names when the warning is on but shortening them could not end it', () => {
      nameOf(500_000)
      fill(4_300_000) // the device is past the line without the names
      openBreakdown()
      expect(usage().warning).toBe(true)
      expect(popup().textContent).not.toMatch(ADVICE)
    })

    it('suggests shortening them — first — exactly when that alone would end the warning', () => {
      nameOf(4_300_000)
      openBreakdown()
      expect(usage().warning).toBe(true)
      expect(advice()[0].textContent).toMatch(ADVICE)
      expect(advice()[0].textContent).toMatch(/Manage Presets/)
      // …said once, beside the other ways to make room, not instead of them.
      expect(advice().filter((li) => ADVICE.test(li.textContent))).toHaveLength(1)
      expect(advice().length).toBeGreaterThan(1)
      expect(advice().some((li) => /Clear History/.test(li.textContent))).toBe(true)
    })

    it('says only what is true in every state that shows it — two default names, ten characters over the line', () => {
      // "Shortening them alone would end the warning" is true even here: the names are 16
      // characters, 14 of which could go, and the device is 10 over the line. What is NOT true
      // here is that the names are taking up much of the room — so the advice does not say so.
      const line80 = (CHROMIUM * STORAGE_WARN_PERCENT) / 100
      createPreset()
      fill() // past the line
      openBreakdown() // …so everything the app writes about a warning has landed
      act(() => usage().closePopup())
      const filler = FILLER.length + localStorage.getItem(FILLER).length
      fill(filler + (line80 + 10 - everything()))
      expect(everything()).toBe(line80 + 10)
      act(() => usage().openPopup())
      expect(everything()).toBe(line80 + 10) // nothing more was written by opening it
      expect(usage().warning).toBe(true)
      expect(usePresets.getState().presets.map((p) => p.name)).toEqual(['Preset 1', 'Preset 2'])
      expect(advice()[0].textContent).toBe(
        'Shortening your preset names would be enough on its own to end this warning (⚙ → Global → Manage Presets).',
      )
      expect(popup().textContent).not.toMatch(/taking up/)
      expect(rowTexts()).toContain('Preset names<0.1%')
    })

    it('…to the character: one short of enough says nothing, enough says it', () => {
      const line80 = (CHROMIUM * STORAGE_WARN_PERCENT) / 100
      nameOf(600_000)
      fill(4_000_000) // past the line
      openBreakdown() // …so everything the app writes about a warning has landed
      expect(usage().warning).toBe(true)
      act(() => usage().closePopup())
      const names = readStorageUsage(localStorage).rows.find((r) => r.kind === 'names')
      // Size the filler so that, with every name cut to one character, the device would sit EXACTLY
      // on the line — which is still a warning.
      const filler = FILLER.length + localStorage.getItem(FILLER).length
      const exact = filler + (line80 - (everything() - names.spare))
      fill(exact)
      expect(everything() - names.spare).toBe(line80)
      act(() => usage().openPopup())
      expect(usage().warning).toBe(true)
      expect(popup().textContent).not.toMatch(ADVICE)
      // One character less on the device, and shortening the names alone would end it.
      act(() => usage().closePopup())
      fill(exact - 1)
      act(() => usage().openPopup())
      expect(everything() - names.spare).toBe(line80 - 1)
      expect(usage().warning).toBe(true)
      expect(popup().textContent).toMatch(ADVICE)
    })
  })

  it('a preset with a very long name is named by its start, in a row that may break anywhere', () => {
    const book = 'All work and no play. '.repeat(20_000).trim()
    renamePreset(1, book)
    createPreset('Weekend')
    useProgress.getState().setModeStats('classic', long(9000))
    mountApp()
    openSettings()
    tap(line())
    const row = within(popup())
      .getAllByRole('listitem')
      .find((li) => li.textContent.includes('Classic solve times'))
    expect(row.textContent).toMatch(
      new RegExp(`^${book.slice(0, 80)}…: Classic solve times \\(9,000\\)\\d+\\.\\d%$`),
    )
    expect(row.firstElementChild.className).toContain('wrap-anywhere')
    expect(row.firstElementChild.className).toContain('min-w-0')
    expect(popup().textContent.length).toBeLessThan(3000)
  })

  it('a preset named with a letter under a pile of accents has that letter boxed in its row, like every quoted name', () => {
    const pile = '\u0301\u0302\u0303'.repeat(100)
    renamePreset(1, `Z${pile}algo`)
    createPreset('Weekend')
    useProgress.getState().setModeStats('classic', long(9000))
    mountApp()
    openSettings()
    tap(line())
    const rows = within(popup())
      .getAllByRole('listitem')
      .filter((li) => !li.closest('.list-disc'))
    const named = rows.find((li) => li.textContent.includes('Classic solve times'))
    expect(named.textContent).toMatch(/algo: Classic solve times \(9,000\)/)
    expect([...named.querySelectorAll('.stacked-character')].map((b) => b.textContent)).toEqual([
      `Z${pile}`,
    ])
    // Rows that quote no name, or an ordinary one, hold no box at all.
    expect(popup().querySelectorAll('.stacked-character')).toHaveLength(
      rows.filter((li) => li.textContent.includes('algo')).length,
    )
  })

  it('the storage-full notice opens on top of it, and closes first', () => {
    mountApp()
    openSettings()
    tap(line())
    act(() => useStorageHealth.setState({ unsaved: true, noticeOpen: true }))
    const notice = screen.getByRole('dialog', { name: /^Your progress isn.t being saved$/ })
    const scrims = [...document.querySelectorAll('[data-settings-modal]')]
    expect(scrims.at(-1).contains(notice)).toBe(true)
    expect(scrims.filter((s) => s.querySelector('[data-status-bar-dim]'))).toHaveLength(1)
    pressKey('Escape')
    expect(screen.queryByRole('dialog', { name: /^Your progress isn.t being saved$/ })).toBeNull()
    expect(popup()).not.toBeNull()
  })
})

describe('on the mounted app, while a date is being typed into Lookup', () => {
  // It used to open two seconds after the app did, with the keyboard in the box, and take it.
  it('the popup waits for the box to be left', async () => {
    fill()
    mountApp()
    pressKey('Escape') // the popup the crossing opened at once: nobody was busy
    act(() => {
      empty()
      refreshStorageUsage()
    })
    pressKey('L')
    const box = document.querySelector('input[type="text"]')
    act(() => box.focus())
    act(() => {
      fill() // a new crossing, with the keyboard in the box
      refreshStorageUsage()
    })
    expect(gearLit()).toBe(true)
    expect(popup()).toBeNull()
    expect(document.activeElement).toBe(box)
    act(() => box.blur())
    await settled()
    expect(popup()).not.toBeNull()
  })

  // ⚙ is open, a Year Range box has the keyboard, and the player presses the other one. A press
  // moves the keyboard in two steps with a gap between them, and the popup used to open in the gap
  // — over the menu, with the keyboard taken off the box that had just been pressed.
  it('a press from one text box into another does not open it, or take the keyboard', async () => {
    fill()
    mountApp()
    pressKey('Escape')
    act(() => {
      empty()
      refreshStorageUsage()
    })
    openSettings()
    const [from, to] = panel().getAllByRole('textbox')
    act(() => from.focus())
    act(() => {
      fill()
      refreshStorageUsage()
    })
    expect(popup()).toBeNull()
    await act(async () => {
      from.blur() // the press: the first box is left…
      await Promise.resolve() // …what the page queued in answer runs…
      await Promise.resolve()
      to.focus() // …and then the pressed box has the keyboard
    })
    await settled()
    expect(popup()).toBeNull()
    expect(document.activeElement).toBe(to)
    expect(localStorage.getItem(WARNED_KEY)).toBeNull()
    act(() => to.blur())
    await settled()
    expect(popup()).not.toBeNull()
  })

  // The top bar's lists act as the finger goes down too: the list opens, the keyboard leaves the
  // box, the player is free — and the popup is drawn under a finger that has not come up yet.
  it('the tap on a top-bar list that frees the player cannot close the popup either', async () => {
    fill()
    mountApp()
    pressKey('Escape')
    act(() => {
      empty()
      refreshStorageUsage()
    })
    pressKey('L')
    const box = document.querySelector('input[type="text"]')
    act(() => box.focus())
    act(() => {
      fill()
      refreshStorageUsage()
    })
    expect(popup()).toBeNull()
    const modeButton = screen.getByRole('button', { name: /^Mode,/ })
    finger('pointerdown', modeButton)
    await settled()
    expect(popup()).not.toBeNull()
    const scrim = popup().closest('[data-settings-modal]')
    finger('pointerup', modeButton, scrim)
    act(() => fireEvent.click(scrim))
    expect(popup()).not.toBeNull()
    tap(scrim)
    expect(popup()).toBeNull()
  })
})

describe('on the mounted app, with a timed question on screen', () => {
  const answer = (name) => tap(screen.getByRole('button', { name }))
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  beforeEach(() => {
    const s = useSettings.getState()
    s.setRandomFormat(false)
    s.setDateFormat('numeric-ymd')
    s.setMinY(1583)
    s.setMaxY(10000)
    useJulianRange.getState().applyJulianRange({ julianMinY: 1583, julianMaxY: 10000 })
    useModePrefs.getState().setClassicTimingOff(false) // Classic's times are shown, so recorded
  })

  it('the popup does not open over it; the dot lights at once; a wrong answer is the moment', () => {
    mountApp()
    expect(popup()).toBeNull()
    act(() => {
      fill()
      refreshStorageUsage()
    })
    expect(gearLit()).toBe(true)
    expect(popup()).toBeNull()
    answer(correctDayName(readDate())) // right, and on to the next question: its clock is running
    expect(popup()).toBeNull()
    const right = correctDayName(readDate())
    answer(DAYS.find((day) => day !== right)) // judged: no time will be taken from this card
    expect(popup()).not.toBeNull()
  })

  it('a device already past the line when the app opens: it still waits for the question', () => {
    fill()
    mountApp()
    expect(gearLit()).toBe(true)
    expect(popup()).toBeNull()
  })

  it('opening ⚙ is the moment too', () => {
    mountApp()
    act(() => {
      fill()
      refreshStorageUsage()
    })
    expect(popup()).toBeNull()
    openSettings()
    expect(popup()).not.toBeNull()
  })

  // On a phone the gear acts as the finger goes DOWN, so the waiting popup is drawn under a finger
  // that is still on the glass — and the rest of that tap, the click included, is sent to what is
  // under the finger by then: the popup's dim. It used to be read as a tap outside: the popup was
  // gone some twenty milliseconds after it opened, with "already warned" written down.
  it('the tap that opens ⚙ cannot close the popup it brought up; a tap on the dim afterwards does', () => {
    mountApp()
    act(() => {
      fill()
      refreshStorageUsage()
    })
    finger('pointerdown', gear()) // the finger lands: ⚙ opens, and the popup with it
    const scrim = popup().closest('[data-settings-modal]')
    finger('pointerup', gear(), scrim) // a finger's own events stay on what it landed on…
    act(() => {
      fireEvent.mouseDown(scrim) // …and the ones the browser adds after it go to what is there now
      fireEvent.mouseUp(scrim)
      fireEvent.click(scrim)
    })
    expect(popup()).not.toBeNull()
    expect(localStorage.getItem(WARNED_KEY)).toBe('1')
    tap(scrim) // a press that goes down on the dim, and comes up there
    expect(popup()).toBeNull()
  })

  it('with timing hidden nothing is being timed, and it opens at once', () => {
    useModePrefs.getState().setClassicTimingOff(true)
    mountApp()
    act(() => {
      fill()
      refreshStorageUsage()
    })
    expect(popup()).not.toBeNull()
  })

  // A casual mode with its timing shown always has a question on the clock — which is exactly where
  // the device used never to be measured, and the line stayed on its dash.
  it('a device not measured yet is measured as ⚙ opens: the line shows a number at once', () => {
    freshPage(null)
    deviceLimit(SAFARI)
    mountApp()
    expect(usage().figure).toBeNull()
    openSettings()
    expect(usage().limit).toBe(SAFARI)
    // Read as a screen reader hears it, so the test holds whatever the figure is: a device holding
    // under a tenth of a percent (how much that is moves with what the app itself keeps, such as the
    // newest changelog entry's length) shows "<0.1%" and SAYS "under 0.1%".
    const written = percentText(everything(), SAFARI)
    expect(line()).toHaveAccessibleName(`Storage used: ${percentSpoken(written) ?? written}`)
  })

  it('on a device that cannot be measured the line shows a dash, and says why', () => {
    freshPage(null)
    useProgress.getState().setModeStats('classic', long(40))
    // The measurement fails for a reason that is not "no room": there is nothing to learn from it.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === SCRATCH_KEY) throw new DOMException('The operation is insecure.', 'SecurityError')
      return realSetItem.call(this, key, value)
    })
    mountApp()
    openSettings()
    // On screen: a dash, the app's sign for "no number to show". Read aloud: the reason.
    expect(line().textContent).toBe('Storage used: —not measured yet')
    expect(line().querySelector('[aria-hidden="true"]').textContent).toBe('—')
    expect(line().querySelector('.sr-only').textContent).toBe('not measured yet')
    expect(line().className).not.toContain('storage-warn')
    tap(line())
    const card = popup()
    expect(card).not.toBeNull()
    // The popup has the room to say it in words, and says what happens next.
    expect(card.querySelector('#storage-usage-title').textContent).toBe(
      'Storage used: not measured yet',
    )
    expect(card.textContent).toMatch(/couldn.t be measured, so there are no percentages/)
    expect(card.textContent).toMatch(/tries again each time it starts, and each time you open ⚙/)
    // What is saved is still listed by name — with no figure beside anything.
    const rows = within(card)
      .getAllByRole('listitem')
      .map((li) => li.textContent)
    expect(rows).toContain('Classic solve times (40)')
    expect(card.textContent).not.toMatch(/%/)
  })
})

// ── WHAT THE POPUP LISTS, ON A DEVICE WITH LITTLE ON IT ──────────────────────────────────────────
// Everything under 1% used to be gathered into one line, so a device with little saved showed a
// single row — "Everything saved <1%" — that named nothing. The largest owners are now listed by
// name whatever they hold.
describe('the breakdown names what is saved at every size', () => {
  beforeEach(() => resetAppState())
  afterEach(unmountApp)
  const rowItems = () =>
    within(popup())
      .getAllByRole('listitem')
      .filter((li) => !li.closest('.list-disc'))
  const rowsShown = () => rowItems().map(shownText)

  it('an almost-empty device: each thing saved is named, with its share to one decimal beside it', () => {
    useProgress.getState().setModeStats('classic', long(12))
    useLookupHistory.getState().setHistory([{ id: 'a', y: 2001, m: 1, d: 1 }])
    mountApp()
    openSettings()
    tap(line())
    const rows = rowsShown()
    // Each owner's own figure, by the one rule the headline uses — "<0.1%" for the smallest, and
    // never "0.0%" beside something that is there.
    const { rows: owners } = readStorageUsage(localStorage)
    const share = (kind) => percentText(owners.find((row) => row.kind === kind).chars, CHROMIUM)
    expect(rows).toContain(`Classic solve times (12)${share('times')}`)
    expect(rows).toContain(`Lookup history (1)${share('lookup')}`)
    expect(rows).toContain(`Bests, settings, and saved defaults${share('preset')}`)
    expect(share('lookup')).toBe('<0.1%')
    for (const row of rows) expect(row).toMatch(/(<0\.1|[1-9]\d*\.\d|0\.[1-9])%$/)
    expect(rows.join('|')).not.toMatch(/Everything saved/)
    // A mode nobody has played is not named: "Flash solve times (0)" would be a line about nothing.
    expect(rows.join('|')).not.toMatch(/\(0\)/)
    expect(rows).toHaveLength(4)
    // The app's own few keys are nobody's to clear: they are the one unnamed line, and the last.
    expect(rows.at(-1)).toMatch(/^Everything else(<0\.1|\d+\.\d)%$/)
  })

  // ★ WHAT IS SHOWN, AND WHAT IS SAID. A device that holds almost nothing shows "<0.1%" in all three
  // places a percentage is drawn — the ⚙ line, the popup's title, a row of the breakdown — and a
  // screen reader has no reliable reading of "<": in each of them it is given "under 0.1%" instead,
  // and what is on screen is exactly what it was.
  // ⚠ ON THE LARGEST LIMIT, so the case is about how the figure is SAID and not about how big the
  // app's own saves happen to be this round: on Chromium's limit a device holding only the app's own
  // keys sat 9 characters under 0.1% — the newest changelog entry's signature (cg-changelog-seen) is
  // most of it and grows with every entry — and Round 26's Julian-on Year Range key took it over.
  it('"<0.1%" is said "under 0.1%" on the ⚙ line, in the title, and in every row that shows it', () => {
    freshPage(MAX_STORAGE_LIMIT)
    useLookupHistory.getState().setHistory([{ id: 'a', y: 2001, m: 1, d: 1 }])
    mountApp()
    openSettings()
    expect(percentText(everything(), MAX_STORAGE_LIMIT)).toBe('<0.1%') // the whole device, not just a row
    // The ⚙ line.
    expect(shownText(line())).toBe('Storage used: <0.1%')
    expect(spokenText(line())).toBe('Storage used: under 0.1%')
    expect(panel().getByRole('button', { name: 'Storage used: under 0.1%' })).toBe(line())
    tap(line())
    // The popup's title, which is the dialog's name.
    const title = popup().querySelector('#storage-usage-title')
    expect(shownText(title)).toBe('Storage used: <0.1%')
    expect(spokenText(title)).toBe('Storage used: under 0.1%')
    expect(screen.getByRole('dialog', { name: 'Storage used: under 0.1%' })).toBe(popup())
    // Every row: it shows what the one rule writes, and says that — or the words for it.
    const rows = rowItems()
    expect(rows.length).toBeGreaterThan(1)
    for (const row of rows) {
      const shown = shownText(row).match(/(<0\.1|\d+\.\d)%$/)[0]
      expect(shown).toBe('<0.1%') // on this device every owner is that small
      expect(spokenText(row)).toBe(shownText(row).replace('<0.1%', 'under 0.1%'))
      expect(spokenText(row)).not.toContain('<')
    }
  })

  it('a figure that is a plain number is drawn as text alone — nothing hidden, nothing added', () => {
    useProgress.getState().setModeStats('classic', long(4000))
    mountApp()
    openSettings()
    expect(percentSpoken(percentText(everything(), CHROMIUM))).toBeNull()
    expect(line().querySelector('[aria-hidden], .sr-only')).toBeNull()
    tap(line())
    const title = popup().querySelector('#storage-usage-title')
    expect(title.querySelector('[aria-hidden], .sr-only')).toBeNull()
    const big = rowItems().find((li) => /^Classic solve times/.test(li.textContent))
    expect(big.querySelector('[aria-hidden], .sr-only')).toBeNull()
    expect(big.textContent).toMatch(/^Classic solve times \(4,000\)\d+\.\d%$/)
  })

  it('largest first; small owners past the first five are gathered, large ones never are', () => {
    freshPage(1_000_000)
    for (let i = 0; i < 4; i++) createPreset(`P${i + 2}`)
    // Preset 1: one big owner and four small ones.
    useProgress.getState().setModeStats('classic', long(9000))
    for (const silo of ['flash', 'dedDay', 'dedMonth', 'dedYear'])
      useProgress.getState().setModeStats(silo, long(30))
    mountApp()
    openSettings()
    tap(line())
    const rows = rowsShown()
    expect(rows[0]).toMatch(/^Preset 1: Classic solve times \(9,000\)\d+\.\d%$/)
    expect(rows.at(-1)).toMatch(/^Everything else/)
    expect(rows.length).toBe(6) // the five largest, and the rest in one line
  })
})

// ── "TO MAKE ROOM" SAYS ONLY WHAT IS TRUE FOR THE PRESET YOU ARE ON ──────────────────────────────
// Reset Stats frees room only while Amnesic is Off (store/amnesic's resetStatsFreesRoom, proved
// against the device in the group above). Both popups used to recommend it whatever the value.
describe.each([
  ['off', null],
  ['stats', 'Stats Only'],
  ['full', 'Full'],
])('the advice while the preset is on Amnesic: %s', (mode, label) => {
  beforeEach(() => {
    resetAppState()
    act(() => setPresetAmnesic(1, mode))
  })
  afterEach(unmountApp)
  const bullets = (card) => [...card.querySelectorAll('.list-disc li')].map((li) => li.textContent)

  it('the Storage used popup', () => {
    mountApp()
    openSettings()
    tap(line())
    const advice = bullets(popup())
    // The two that work under every value are always offered.
    expect(advice.some((t) => /^Clear History, on the Lookup page, empties/.test(t))).toBe(true)
    expect(
      advice.some((t) => /^Deleting a preset you no longer use removes everything/.test(t)),
    ).toBe(true)
    const offered = advice.some((t) => /^Reset Stats, on a mode.s own screen, clears/.test(t))
    expect(offered).toBe(resetStatsFreesRoom(mode))
    if (label === null) expect(advice).toHaveLength(3)
    else {
      // Named, because it is the first thing a player reaches for — as something that will NOT
      // help here, with the value by its name and what to do instead.
      const warning = advice.find((t) => /^Reset Stats won.t make room/.test(t))
      expect(warning).toContain(`Amnesic is on ${label}`)
      expect(warning).toMatch(/set Amnesic to Off first/)
      expect(advice.at(-1)).toBe(warning)
    }
  })

  it('the storage-full notice', () => {
    mountApp()
    act(() => useStorageHealth.setState({ unsaved: true, noticeOpen: true }))
    const notice = screen.getByRole('dialog', { name: /^Your progress isn.t being saved$/ })
    expect(notice.textContent).toMatch(/delete a preset you no longer use/)
    if (label === null) {
      expect(notice.textContent).toMatch(/or use\s+Reset Stats in a mode whose history/)
      expect(notice.textContent).not.toMatch(/won.t\s+make room/)
    } else {
      expect(notice.textContent).toMatch(/Clear History, on the Lookup page/)
      expect(notice.textContent).toMatch(
        new RegExp(`Reset Stats won.t\\s+make room while this preset.s Amnesic is on ${label}`),
      )
      expect(notice.textContent).not.toMatch(/or use\s+Reset Stats in a mode whose history/)
    }
    expect(notice.textContent).toMatch(/saved by itself/)
  })
})
