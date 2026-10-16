// @vitest-environment jsdom
//
// STORAGE FULL × PRESETS AND AMNESIC — a save the device refused must never land anywhere but the
// place it was for, and must not be lost while the app stays open.
//
// What went wrong (round 23's review, reproduced here as it was found): a refused save was remembered
// only as "this STORE is unsaved", and the next write that fit re-saved "whatever that store holds
// now" through the store's own adapter. A preset switch, a preset delete and an Amnesic toggle all
// write the registry FIRST — which fits — while the stores still hold the outgoing preset or copy and
// the adapter already points at the incoming one. So a 500-card preset was overwritten with a 4-card
// one, and a guest's session was written over the permanent stats. And with the save refused outright
// (no retry at all), a switch away and back re-read the older copy off the device and the newest
// answers were gone, under a notice that said they were kept until the app closed.
//
// The rule now (store/storageHealth): a refused save is held under its own destination — read back
// from there, retried to there, forgotten when that place is deleted.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, cleanup, act, within, fireEvent } from '@testing-library/react'
import {
  resetAppState,
  mountApp,
  tap,
  openSettings,
  openModal,
  modalCard,
  pressBack,
  isSettingsOpen,
} from './helpers/settingsPanel.jsx'
import { readDate, correctDayName, statValue } from './helpers/modeScreen.jsx'
import { useProgress } from '../src/store/progress.js'
import { useSettings } from '../src/store/settings.js'
import { usePresets, presetKey, PRESET_STORE_KEYS } from '../src/store/presets.js'
import {
  createPreset,
  renamePreset,
  switchPreset,
  deletePreset,
  setPresetAmnesic,
  isPresetFactory,
} from '../src/store/presetControl.js'
import { useStorageHealth, isHolding } from '../src/store/storageHealth.js'
import { installNameRooms, PX_PER_CHARACTER } from './helpers/nameRooms.js'
import {
  useStorageUsage,
  watchStorageUsage,
  forgetStorageUsage,
  DOCUMENTED_LIMITS,
} from '../src/store/storageUsage.js'

const realSetItem = Storage.prototype.setItem
const quota = () => new DOMException('The quota has been exceeded.', 'QuotaExceededError')
const stats = (n) => ({
  played: n,
  good: n,
  streak: n,
  best: n,
  times: Array.from({ length: n }, (_, i) => 1 + (i % 7) / 10),
})
const progressKey = (id = 1) => presetKey(PRESET_STORE_KEYS.progress, id)
const savedClassic = (id = 1, area = localStorage) =>
  JSON.parse(area.getItem(progressKey(id)) ?? 'null')?.state?.stats?.classic
const liveClassic = () => useProgress.getState().stats.classic

afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
  vi.restoreAllMocks()
})

// localStorage as a real device models it: one allowance for everything, and a write is refused when
// the total would pass it.
describe('a full device (one shared allowance)', () => {
  let cap
  const used = () => {
    let n = 0
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      n += k.length + (localStorage.getItem(k) ?? '').length
    }
    return n
  }
  beforeEach(() => {
    resetAppState()
    cap = Infinity
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (this === window.localStorage) {
        const old = this.getItem(key)
        const delta = (old === null ? key.length : 0) + String(value).length - (old?.length ?? 0)
        if (used() + delta > cap) throw quota()
      }
      return realSetItem.call(this, key, value)
    })
  })

  // Preset 2 is the player's main preset (500 cards); preset 1 a small one (3), holding one more
  // answer the full device refused.
  function fillWithAnUnsavedAnswer() {
    const main = createPreset('Main')
    useProgress.getState().setModeStats('classic', stats(3))
    switchPreset(main.id)
    useProgress.getState().setModeStats('classic', stats(500))
    switchPreset(1)
    cap = used() // exactly full
    useProgress.getState().setModeStats('classic', stats(4))
    expect(useStorageHealth.getState().unsaved).toBe(true)
    expect(savedClassic(1).played).toBe(3)
    return main
  }

  it('a preset switch never writes the outgoing preset over the incoming one — and the way back keeps the unsaved answer', () => {
    const main = fillWithAnUnsavedAnswer()
    switchPreset(main.id)
    expect(savedClassic(main.id).played).toBe(500)
    expect(liveClassic().played).toBe(500)
    switchPreset(1)
    expect(liveClassic().played).toBe(4) // the refused answer is still there
    expect(useStorageHealth.getState().unsaved).toBe(true)
  })

  it('deleting the preset you are on never writes it into its neighbour, and forgets its unsaved data', () => {
    const main = fillWithAnUnsavedAnswer()
    deletePreset(1)
    expect(savedClassic(main.id).played).toBe(500)
    expect(liveClassic().played).toBe(500)
    expect(localStorage.getItem(progressKey(1))).toBe(null) // …and it was not written back out
    expect(useStorageHealth.getState().unsaved).toBe(false) // nothing is left waiting
  })

  it('deleting ANOTHER preset makes room, and the unsaved answer is saved — to its own preset', () => {
    const main = fillWithAnUnsavedAnswer()
    deletePreset(main.id)
    expect(savedClassic(1).played).toBe(4)
    expect(liveClassic().played).toBe(4)
    expect(useStorageHealth.getState().unsaved).toBe(false)
  })

  it('an unsaved settings change stays with its own preset', () => {
    const main = createPreset('Main')
    switchPreset(main.id)
    useSettings.getState().setMinY(1900)
    switchPreset(1)
    useSettings.getState().setMinY(1600)
    cap = used()
    useSettings.getState().setMinY(16000) // one character longer → refused
    expect(useStorageHealth.getState().unsaved).toBe(true)
    switchPreset(main.id)
    expect(useSettings.getState().minY).toBe(1900)
    switchPreset(1)
    expect(useSettings.getState().minY).toBe(16000)
  })

  // ★ A PRESET NAME HAS NO LENGTH LIMIT, so a rename is the one registry change that can be too big
  // for the device — a pasted book. It is REFUSED WHOLE rather than held like the saves above: a
  // name that cannot be saved never could be, and every later registry change (a new preset, a
  // switch) rides in the same save and would go unsaved with it.
  describe('a name the device has no room to save', () => {
    const REGISTRY = 'cg-presets-v1'
    const BOOK = 'All work and no play. '.repeat(20_000).trim()
    const settle = () => {
      const p2 = createPreset('Timed')
      renamePreset(1, 'Mornings')
      cap = used() + 1000 // room for a longer name, not for a book
      return p2
    }

    it('is refused whole: the name it had is intact on the device and in memory', () => {
      settle()
      const before = localStorage.getItem(REGISTRY)
      expect(renamePreset(1, BOOK)).toBe('no-room')
      expect(localStorage.getItem(REGISTRY)).toBe(before) // not a byte of it changed
      expect(usePresets.getState().presets.map((p) => p.name)).toEqual(['Mornings', 'Timed'])
      // …and a name that does fit is still taken afterwards.
      expect(renamePreset(1, 'Weekend Mornings')).toBe('renamed')
      expect(JSON.parse(localStorage.getItem(REGISTRY)).state.presets[0].name).toBe(
        'Weekend Mornings',
      )
    })

    it('nothing is held for it, and the app is not told the device is full', () => {
      settle()
      const stop = watchStorageUsage()
      try {
        const limit = useStorageUsage.getState().limit
        expect(renamePreset(1, BOOK)).toBe('no-room')
        expect(isHolding(localStorage)).toBe(false)
        expect(useStorageHealth.getState()).toMatchObject({ unsaved: false, noticeOpen: false })
        // A refused SAVE teaches the app the device is full at what it holds — untrue here: the
        // device is as empty as it was, and its measured limit stands.
        expect(useStorageUsage.getState().limit).toBe(limit)
        expect(limit).toBe(DOCUMENTED_LIMITS[0])
        expect(localStorage.getItem('cg-storage-limit-v1')).toBe(null)
        expect(useStorageUsage.getState().warning).toBe(false)
      } finally {
        stop()
        forgetStorageUsage()
      }
    })

    it('the registry goes on being saved: a new preset, a switch, and a move all land', () => {
      settle()
      expect(renamePreset(1, BOOK)).toBe('no-room')
      const p3 = createPreset('Guest')
      switchPreset(p3.id)
      const saved = JSON.parse(localStorage.getItem(REGISTRY)).state
      expect(saved.presets.map((p) => p.name)).toEqual(['Mornings', 'Timed', 'Guest'])
      expect(saved.activeId).toBe(p3.id)
      expect(useStorageHealth.getState().unsaved).toBe(false)
    })

    it('on a device that is simply FULL, one more letter is refused the same way — and a shorter name is taken, and lets the held saves land', () => {
      const main = fillWithAnUnsavedAnswer() // the device is exactly full, an answer is waiting
      const before = localStorage.getItem(REGISTRY)
      expect(renamePreset(main.id, 'Main!')).toBe('no-room')
      expect(localStorage.getItem(REGISTRY)).toBe(before)
      expect(useStorageHealth.getState().unsaved).toBe(true) // the answer is still waiting
      // Shortening a name makes room: 4 characters back is enough for nothing here…
      expect(renamePreset(main.id, 'M')).toBe('renamed')
      // …but it is saved, and what was waiting is tried again at once.
      expect(JSON.parse(localStorage.getItem(REGISTRY)).state.presets[1].name).toBe('M')
    })

    // ★ "…AND SAYS SO" HAS TO BE TRUE ON EVERY WAY OF LEAVING THE BOX. The rename is attempted when
    // the box loses the keyboard, whatever took it — and the first build of the note was cleared
    // again by the very tap that had caused it (another row's box), or went down with the card (a
    // tap on the dim). So: the note stays under its row until the player next TYPES in a name box,
    // and a tap outside the card that has just had a name refused does not also close the card.
    describe('in Manage Presets, the row says why — whichever way the box was left', () => {
      const NOTE = 'This device has no room to save that name, so it was not changed.'
      const card = () => modalCard('presets')
      const queryCard = () => screen.queryByRole('dialog', { name: 'Presets' })
      const boxes = () => within(card()).getAllByRole('textbox', { name: 'Preset name' })
      const rowOf = (i) => boxes()[i].parentElement
      const notes = () => within(card()).queryAllByText(NOTE, { ignore: '[aria-live] *' })
      const said = () => card().querySelector('[aria-live]').textContent
      const scrim = () => card().closest('[data-settings-modal]')
      let before
      // Manage Presets open on "Mornings" and "Timed", the keyboard in row `i`, a book typed there.
      const typeABook = (i = 1) => {
        settle()
        mountApp()
        openSettings()
        openModal('presets')
        before = localStorage.getItem(REGISTRY)
        act(() => boxes()[i].focus())
        act(() => fireEvent.change(boxes()[i], { target: { value: BOOK } }))
        expect(boxes()[i].value).toBe(BOOK) // typing it is never refused
      }
      // The refusal, as every route must leave it: nothing written, the box back to the saved
      // name, ONE note under that row and no other, and the words in the live region.
      const expectRefused = (i = 1) => {
        expect(localStorage.getItem(REGISTRY)).toBe(before)
        expect(boxes().map((b) => b.value)).toEqual(['Mornings', 'Timed'])
        expect(notes()).toHaveLength(1)
        expect(within(rowOf(i)).getByText(NOTE).getAttribute('aria-hidden')).toBe('true')
        expect(said()).toBe(NOTE)
        expect(useStorageHealth.getState()).toMatchObject({ unsaved: false, noticeOpen: false })
      }
      // A real tap: the press, the keyboard leaving the box for whatever was pressed, the click.
      const tapOn = (el) =>
        act(() => {
          fireEvent.pointerDown(el)
          if (el.tabIndex >= 0) el.focus()
          else document.activeElement?.blur()
          fireEvent.click(el)
        })

      it('Enter', () => {
        typeABook()
        act(() => fireEvent.keyDown(boxes()[1], { key: 'Enter' }))
        expectRefused()
        expect(card().querySelector('[aria-live]').getAttribute('aria-live')).toBe('polite')
        expect(screen.queryByText(/out of room for Calendar Game/)).toBeNull()
      })

      it('Enter attempts the save ONCE — not once for the key and again for the blur it causes', () => {
        typeABook()
        const attempts = () =>
          Storage.prototype.setItem.mock.calls.filter(([key]) => key === REGISTRY).length
        const already = attempts()
        act(() => fireEvent.keyDown(boxes()[1], { key: 'Enter' }))
        expect(attempts() - already).toBe(1)
        expect(document.activeElement).not.toBe(boxes()[1]) // …and Enter still leaves the box
        expectRefused()
      })

      it('Tab, to the row`s own grip', () => {
        typeABook()
        act(() =>
          within(rowOf(1))
            .getByRole('button', { name: /^Reorder / })
            .focus(),
        )
        expectRefused()
      })

      it('tapping ANOTHER row`s name box — the note is not wiped by the box that took the keyboard', () => {
        typeABook()
        tapOn(boxes()[0])
        expect(document.activeElement).toBe(boxes()[0])
        expectRefused()
        // It is still there after the frame that drew it, and while the other box is merely held.
        act(() => fireEvent.focusIn(boxes()[0]))
        expectRefused()
      })

      it('tapping a grip, a ✕, or New Preset', () => {
        typeABook()
        tapOn(within(rowOf(0)).getByRole('button', { name: /^Reorder / }))
        expectRefused()
        cleanup()
        document.getElementById('root')?.remove()
        resetAppState()
        cap = Infinity

        typeABook()
        tapOn(within(card()).getByRole('button', { name: 'New Preset' }))
        expect(boxes().map((b) => b.value)).toEqual(['Mornings', 'Timed', 'Preset 3'])
        expect(within(rowOf(1)).getByText(NOTE)).toBeTruthy()
        expect(notes()).toHaveLength(1)
        expect(said()).toBe(NOTE)
        // The ✕ of the row itself: the preset goes (it holds nothing, so there is no question), and
        // its note goes with it — it does not move to another row, and nothing is left being said.
        tapOn(within(rowOf(1)).getByRole('button', { name: 'Delete Timed' }))
        expect(boxes().map((b) => b.value)).toEqual(['Mornings', 'Preset 3'])
        expect(notes()).toHaveLength(0)
        expect(said()).toBe('')
      })

      it('a tap on the dim: the card STAYS, with the note — and the next tap closes it', () => {
        typeABook()
        tapOn(scrim())
        expect(queryCard()).not.toBeNull()
        expectRefused()
        tapOn(scrim())
        expect(queryCard()).toBeNull()
        expect(localStorage.getItem(REGISTRY)).toBe(before)
      })

      it('…also on a browser that leaves the keyboard in the box when the dim is tapped', () => {
        typeABook()
        act(() => {
          fireEvent.pointerDown(scrim())
          fireEvent.click(scrim()) // no blur came with the press
        })
        expect(queryCard()).not.toBeNull()
        expectRefused()
      })

      it('a tap on the dim with a name that DOES save closes the card at once, name kept', () => {
        typeABook()
        act(() => fireEvent.change(boxes()[1], { target: { value: 'Sprints' } }))
        tapOn(scrim())
        expect(queryCard()).toBeNull()
        expect(usePresets.getState().presets[1].name).toBe('Sprints')
      })

      it('a refusal does not make a LATER, unrelated tap on the dim miss', () => {
        typeABook()
        act(() => fireEvent.keyDown(boxes()[1], { key: 'Enter' }))
        expectRefused()
        tapOn(scrim())
        expect(queryCard()).toBeNull()
      })

      it('the app going to the background, and coming back to the same box', () => {
        typeABook()
        act(() => fireEvent.blur(boxes()[1])) // the window lost the keyboard
        expectRefused()
        act(() => fireEvent.focusIn(boxes()[1])) // …and has it again, on the box it left
        expectRefused()
      })

      // Back is a way of LEAVING the box (Q17): the rename is attempted as every other way of leaving
      // attempts it. Refused, the Back is spent on the news — and the card, which a real Back has
      // already taken off the stack, puts itself back so the next Back has something to close.
      it('Android Back: the card STAYS, with the note — and the next Back closes it, the ⚙ panel still open', async () => {
        typeABook()
        await pressBack()
        expect(queryCard()).not.toBeNull()
        expectRefused()
        await pressBack()
        expect(queryCard()).toBeNull()
        expect(isSettingsOpen()).toBe(true)
        expect(localStorage.getItem(REGISTRY)).toBe(before)
      })

      it('Android Back with a name that DOES save closes the card at once, name kept', async () => {
        typeABook()
        act(() => fireEvent.change(boxes()[1], { target: { value: 'Sprints' } }))
        await pressBack()
        expect(queryCard()).toBeNull()
        expect(isSettingsOpen()).toBe(true)
        expect(usePresets.getState().presets[1].name).toBe('Sprints')
      })

      it('Escape is a discard, not an attempt: nothing is refused, so nothing is said', () => {
        typeABook()
        act(() => fireEvent.keyDown(boxes()[1], { key: 'Escape' }))
        expect(boxes().map((b) => b.value)).toEqual(['Mornings', 'Timed'])
        expect(notes()).toHaveLength(0)
        expect(said()).toBe('')
        expect(
          Storage.prototype.setItem.mock.calls.filter(([key]) => key === REGISTRY),
        ).toHaveLength(
          3, // the three saves `settle` made, and none since
        )
      })

      it('it is said once: the words stay one element while it shows, whatever else is drawn', () => {
        typeABook()
        act(() => fireEvent.keyDown(boxes()[1], { key: 'Enter' }))
        const words = [...card().querySelector('[aria-live]').children].find(
          (el) => el.textContent === NOTE,
        )
        expect(words).toBeTruthy()
        tapOn(boxes()[0])
        tapOn(within(card()).getByRole('button', { name: 'New Preset' }))
        expect(words.isConnected).toBe(true)
        expect(said()).toBe(NOTE)
      })

      it('it goes when the player next TYPES in a name box, and a name that fits is then taken', () => {
        typeABook()
        tapOn(boxes()[0])
        expectRefused()
        act(() => fireEvent.change(boxes()[0], { target: { value: 'Morning' } }))
        expect(notes()).toHaveLength(0)
        expect(said()).toBe('')
        act(() => fireEvent.keyDown(boxes()[0], { key: 'Enter' }))
        expect(usePresets.getState().presets[0].name).toBe('Morning')
        expect(notes()).toHaveLength(0)
      })

      it('beside the "cut short" note: each is its own line under its own row, and said by itself', () => {
        typeABook()
        const cells = installNameRooms(5 * PX_PER_CHARACTER) // "Mornings" is eight: too long
        try {
          tapOn(boxes()[0])
          const CUT = 'Some places will show this name cut short.'
          expect(within(rowOf(1)).getByText(NOTE)).toBeTruthy()
          expect(within(rowOf(0)).getByText(CUT)).toBeTruthy()
          expect(
            [...card().querySelector('[aria-live]').children].map((el) => el.textContent),
          ).toEqual([NOTE, CUT])
        } finally {
          cells.restore()
        }
      })
    })
  })

  it('a preset holding only unsaved play is not factory-fresh', () => {
    const p2 = createPreset()
    switchPreset(p2.id)
    cap = used()
    useProgress.getState().setModeStats('classic', stats(2))
    expect(localStorage.getItem(progressKey(p2.id))).toBe(null) // never reached the device
    switchPreset(1)
    expect(isPresetFactory(p2.id, true)).toBe(false)
  })
})

describe('a full session area, and the Amnesic toggle', () => {
  let refuseSession
  beforeEach(() => {
    resetAppState()
    sessionStorage.clear()
    refuseSession = false
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (this === window.sessionStorage && refuseSession && key === progressKey()) throw quota()
      return realSetItem.call(this, key, value)
    })
  })

  it("Amnesic off: the guest's unsaved session is thrown away, never written over the permanent stats", () => {
    useProgress.getState().setModeStats('classic', stats(500)) // the owner's permanent stats
    setPresetAmnesic(1, 'full')
    expect(liveClassic().played).toBe(0)
    useProgress.getState().setModeStats('classic', stats(2))
    refuseSession = true
    useProgress.getState().setModeStats('classic', stats(3))
    expect(useStorageHealth.getState().unsaved).toBe(true)
    setPresetAmnesic(1, 'off')
    expect(savedClassic().played).toBe(500)
    expect(liveClassic().played).toBe(500)
    expect(useStorageHealth.getState().unsaved).toBe(false)
    // …and a later guest starts from zero: the refused session did not come back.
    refuseSession = false
    setPresetAmnesic(1, 'full')
    expect(liveClassic().played).toBe(0)
    expect(savedClassic(1, sessionStorage)).toBeUndefined()
  })

  it("a switch away and back keeps a guest's unsaved session", () => {
    const p2 = createPreset()
    setPresetAmnesic(1, 'full')
    refuseSession = true
    useProgress.getState().setModeStats('classic', stats(3))
    switchPreset(p2.id)
    switchPreset(1)
    expect(liveClassic().played).toBe(3)
  })
})

describe('on the mounted app', () => {
  const pinReadable = () =>
    act(() => {
      const s = useSettings.getState()
      s.setRandomFormat(false)
      s.setDateFormat('numeric-ymd')
      s.setMinY(1583)
      s.setMaxY(10000)
    })
  const answerRight = () => tap(screen.getByRole('button', { name: correctDayName(readDate()) }))

  it('answers given while the device is full survive a switch to another preset and back', () => {
    resetAppState()
    mountApp()
    pinReadable()
    tap(screen.getByRole('button', { name: 'New' }))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === progressKey()) throw quota()
      return realSetItem.call(this, key, value)
    })
    answerRight()
    answerRight()
    expect(statValue('Score')).toBe('2/2')
    let p2
    act(() => {
      p2 = createPreset()
    })
    act(() => switchPreset(p2.id))
    expect(statValue('Score')).toBe('0/0')
    act(() => switchPreset(1))
    expect(statValue('Score')).toBe('2/2')
  })
})
