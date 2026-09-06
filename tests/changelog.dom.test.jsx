// @vitest-environment jsdom
//
// The changelog + update-signal dots (round-6 Q6). src/changelog holds the hand-maintained
// plain-words per-DAY entries (newest first; a second same-day deploy RESTATES that day's net
// effect versus production inside the one entry rather than prepending a second log — the round-7
// combine policy, ordering amended in round-11 Q6 — so dates stay unique). Round-8 Q8 made that
// array the published set exactly: the popup renders CHANGELOG as-is, so the ten-day cap is
// enforced at SOURCE (pinned below) and the oldest entry moves to CHANGELOG-ARCHIVE.md instead of
// piling up here. That retired the render-time slice, and with it the separate changelogLimit.dom
// file which mocked a larger data set behind that slice — the popup can no longer discard
// anything, so the cap can no longer be a rendering question. The two light-blue dots are the persisted
// breadcrumb to the popup. ⚠ THE TWO NO LONGER FIRE TOGETHER (2026-08-10): the Q2 build-stamp
// detection marks the GEAR flag on every build change (including one the real Updating flow just
// bridged — only the SCREEN is suppressed then), but marks the CHANGELOG flag only when the newest
// entry has actually changed since this device last looked. The cases that discriminate are below,
// and they matter because the pre-existing "lights BOTH" case passes either way: it stores no
// signature, which is the migration branch, where the old behaviour is deliberately preserved.
// Opening ⚙ Settings retires the gear's dot, and the first tap on the footer's Changelog link
// (right of Check for updates) retires the link's. The popup follows the established settings-
// modal contract (focus-on-open, capture Escape, close-with-settings, Android Back, the shared
// Tab trap, the [data-settings-modal] marker). Round-8 Q7 split the one dot into the two forms
// its two hosts can actually carry (components/UpdateDot: a corner badge for the ⚙ icon button,
// an in-flow marker for the text link), so the assertions below read the marker element's own
// data-update-dot / data-lit attributes — the host's className no longer says anything about it.
// Visual truth — where the dot lands, coexistence with the violet bar, themes — is on-device
// territory per the standing lesson; these tests pin the logic and the DOM-level rendering.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, within, cleanup, fireEvent, act } from '@testing-library/react'
import { useModePrefs } from '../src/store/modePrefs.js'
import {
  mountApp,
  openSettings,
  closeSettings,
  gear,
  modalCard,
  resetAppState,
} from './helpers/settingsPanel.jsx'
import { BUILD_STAMP_KEY, writeBuildStamp } from '../src/lib/buildStamp.js'
import { APP_VERSION } from '../src/appVersion.js'
import {
  CHANGELOG,
  GEAR_DOT_KEY,
  CHANGELOG_DOT_KEY,
  CHANGELOG_SEEN_KEY,
  changelogSignature,
  changelogChanged,
  readUpdateDot,
  markUpdateDot,
  clearUpdateDot,
} from '../src/changelog.js'

const OLD_STAMP = '2020-01-01T00:00:00.000Z' // any build that is not the running one

// ── Harness (tests/helpers/settingsPanel, plus this file's own dot accessors) ──
// Prefix match, exactly like the gear's: the link's accessible name GROWS to 'Changelog, update'
// while its dot is lit (an sr-only word — the marker element itself is aria-hidden). The exact
// names are asserted in both states below; this helper just has to find the button in either.
const changelogLink = () => screen.getByRole('button', { name: /^Changelog/ })
const openChangelog = () => act(() => fireEvent.click(changelogLink()))
// The two update markers, found by the attribute components/UpdateDot publishes — never by a class
// on the host. That is the round-8 Q7 contract: the hosts mount DIFFERENT forms of the same dot.
const gearMark = () => gear().querySelector('[data-update-dot]')
const linkMark = () => changelogLink().querySelector('[data-update-dot]')
const changelogTitle = () => screen.queryByText("What's new")
const changelogDialog = () => modalCard("What's new")

describe('changelog data (src/changelog)', () => {
  it('every entry is an ISO-dated, non-empty plain-words list, newest first, one per day', () => {
    expect(CHANGELOG.length).toBeGreaterThanOrEqual(2)
    for (const en of CHANGELOG) {
      expect(en.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(en.items.length).toBeGreaterThan(0)
      for (const it of en.items) expect(it.trim().length).toBeGreaterThan(0)
    }
    const dates = CHANGELOG.map((en) => en.date)
    expect([...dates].sort().reverse()).toEqual(dates) // newest-first (ISO sorts lexically)
    // One entry per Pacific day (the round-7 same-day COMBINE policy): a second same-day deploy
    // rewrites that day's existing entry to the day's net effect versus production, rather than
    // adding a twin-dated card (round-11 Q6 settled the rewrite; the card count is the same
    // either way). Uniqueness is what makes the ordering pin above STRICT, and it protects the
    // popup's key={en.date} React-key contract.
    expect(new Set(dates).size).toBe(dates.length)
  })

  it('holds at most ten days — the cap is the DATA, not the rendering (round-8 Q8)', () => {
    // Trimmed at source: the popup renders the array as-is, so an eleventh day would SHIP; move
    // the oldest entry to CHANGELOG-ARCHIVE.md when adding a new day.
    expect(CHANGELOG.length).toBeLessThanOrEqual(10)
  })

  it('the nothing-visible fallback line is verbatim, and never shares its entry (round 16)', () => {
    // The charter's newest rule, made structural. A deploy with nothing a player can see still gets
    // an entry, because the update dot fires on ANY build change and would otherwise point at a
    // three-day-old list. Two halves, and the charter states both as absolutes:
    //   NEVER REWORDED — identical every time so a returning player recognises it at a glance.
    //   A FALLBACK, NEVER AN ADDITION — the moment a deploy has one visible change this line is
    //   deleted, so "nothing you can see changed" can never sit beside a line saying otherwise.
    //   That second half is the one a same-day MERGE gets wrong: yesterday's placeholder must be
    //   DROPPED when today's real lines land on the same date, not kept above them.
    // Matched loosely (a phrase, case-insensitively) and then asserted strictly, so a nearly-right
    // rewrite is caught rather than slipping past as an unrecognised line.
    const CANONICAL =
      'Nothing you can see changed this time — just work underneath to keep things running smoothly.'
    for (const en of CHANGELOG) {
      const placeholders = en.items.filter((it) => /nothing you can see changed/i.test(it))
      if (placeholders.length === 0) continue
      expect(placeholders, `${en.date}: the fallback line appears more than once`).toHaveLength(1)
      expect(
        placeholders[0],
        `${en.date}: the nothing-visible line has been reworded. The charter says never to reword ` +
          `it — a returning player is meant to recognise it without reading it.`,
      ).toBe(CANONICAL)
      expect(
        en.items,
        `${en.date}: the nothing-visible line is sharing an entry with real changes. It is a ` +
          `FALLBACK, never an addition — delete it and let the real lines stand alone.`,
      ).toEqual([CANONICAL])
    }
  })
})

describe('changelogSignature / changelogChanged — "is there something new to READ?"', () => {
  const entry = (date, ...items) => ({ date, items })

  it('is the NEWEST entry only — its date and its lines', () => {
    const sig = changelogSignature([entry('2026-08-10', 'a', 'b'), entry('2026-08-09', 'c')])
    expect(sig).toContain('2026-08-10')
    expect(sig).toContain('a')
    expect(sig).toContain('b')
    expect(sig).not.toContain('c')
  })

  it('★ does NOT change when an OLD entry rolls off into the archive', () => {
    // The false positive that killed hashing the whole visible list: rule 14 moves the eleventh day
    // to CHANGELOG-ARCHIVE.md, so the rendered list changes while nothing NEW has been added. A
    // player would get a dot leading to something they read a fortnight ago.
    const withOld = [entry('2026-08-10', 'a'), entry('2026-07-01', 'ancient')]
    const rolled = [entry('2026-08-10', 'a')]
    expect(changelogSignature(rolled)).toBe(changelogSignature(withOld))
  })

  it('★ DOES change when a second same-day deploy adds a line to the existing entry', () => {
    // The opposite miss, which killed comparing dates alone: this is exactly what v2.21.0 did.
    const before = [entry('2026-08-10', 'a')]
    const after = [entry('2026-08-10', 'a', 'b')]
    expect(changelogSignature(after)).not.toBe(changelogSignature(before))
  })

  it('changes when a line is reworded or deleted by the same-day net-effect restatement', () => {
    const a = [entry('2026-08-10', 'one', 'two')]
    expect(changelogSignature([entry('2026-08-10', 'one', 'TWO')])).not.toBe(changelogSignature(a))
    expect(changelogSignature([entry('2026-08-10', 'one')])).not.toBe(changelogSignature(a))
  })

  it('cannot collide however the lines are punctuated', () => {
    // Two entries whose lines differ only in where one ends and the next begins.
    expect(changelogSignature([entry('2026-08-10', 'ab', 'c')])).not.toBe(
      changelogSignature([entry('2026-08-10', 'a', 'bc')]),
    )
  })

  it('survives an empty list rather than throwing', () => {
    expect(changelogSignature([])).toBe('')
  })

  it('⚠ treats a MISSING stored signature as changed — the opposite of buildChanged, on purpose', () => {
    // buildChanged says a missing stamp is a first visit with nothing to announce. This is only
    // ever consulted AFTER buildChanged returned true, so a missing value here means an existing
    // installation on the one boot after this shipped — and the tie breaks toward showing the dot,
    // because a spurious dot costs a glance while a suppressed one costs the player the news.
    expect(changelogChanged(null, 'anything')).toBe(true)
  })

  it('is false only when the stored signature matches exactly', () => {
    expect(changelogChanged('same', 'same')).toBe(false)
    expect(changelogChanged('old', 'new')).toBe(true)
    expect(changelogChanged('', 'new')).toBe(true)
  })
})

describe('update-dot flags (plain localStorage)', () => {
  afterEach(() => {
    clearUpdateDot(GEAR_DOT_KEY)
    clearUpdateDot(CHANGELOG_DOT_KEY)
  })

  it('round-trips through the two cg-update-dot keys independently', () => {
    expect(readUpdateDot(GEAR_DOT_KEY)).toBe(false)
    markUpdateDot(GEAR_DOT_KEY)
    expect(localStorage.getItem('cg-update-dot-gear')).toBe('1')
    expect(readUpdateDot(GEAR_DOT_KEY)).toBe(true)
    expect(readUpdateDot(CHANGELOG_DOT_KEY)).toBe(false) // untouched
    clearUpdateDot(GEAR_DOT_KEY)
    expect(readUpdateDot(GEAR_DOT_KEY)).toBe(false)
  })

  it('blocked storage (privacy modes): reads mean no dots, writes are silent no-ops', () => {
    const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readUpdateDot(GEAR_DOT_KEY)).toBe(false)
    expect(() => markUpdateDot(GEAR_DOT_KEY)).not.toThrow()
    expect(() => clearUpdateDot(GEAR_DOT_KEY)).not.toThrow()
    getSpy.mockRestore()
    setSpy.mockRestore()
    removeSpy.mockRestore()
  })
})

describe('the two-stage breadcrumb (stamp → dots → cleared)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetAppState()
    // NOT part of the shared reset: sessionStorage is where the post-update splash-skip flag
    // lives, and this file mounts across a simulated build change on purpose.
    sessionStorage.clear()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
    document.getElementById('root')?.remove()
    sessionStorage.clear()
  })
  // Mount on a stale stamp (a detected build change) and ride out the 1s flash hold so the
  // Updating overlay is gone before any interaction.
  const bootAfterUpdate = () => {
    writeBuildStamp(OLD_STAMP)
    mountApp()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
  }

  // ⚠ THE TITLE NAMES THE MIGRATION BRANCH ON PURPOSE. This case stores no changelog signature, so
  // it takes the "nothing recorded yet" path and lights both — which is what it has always done and
  // must keep doing. It therefore passes identically before and after the 2026-08-10 gating, and
  // cannot be read as evidence that a build change alone lights the link's dot. It no longer does.
  it('a build change with NO signature recorded yet lights both dots (the migration branch)', () => {
    bootAfterUpdate()
    expect(gearMark()).toHaveAttribute('data-lit', 'true')
    expect(gear()).toHaveAttribute('aria-label', 'Settings (update)')
    expect(localStorage.getItem(GEAR_DOT_KEY)).toBe('1')
    expect(localStorage.getItem(CHANGELOG_DOT_KEY)).toBe('1')
    openSettings() // the link only exists inside the panel (this also retires the gear's dot)
    expect(linkMark()).toHaveAttribute('data-lit', 'true')
    // Both markers are aria-hidden, so each host states the news in its own accessible name: the
    // gear folds it into aria-label (asserted above), the link adds an sr-only word. The comma is
    // load-bearing — name-from-content trims each child before joining, so a separator written as
    // leading whitespace disappears and the two words run together.
    expect(screen.getByRole('button', { name: 'Changelog, update' })).toBe(changelogLink())
  })

  // ── The two dots stopped firing together on 2026-08-10 ─────────────────────────────────────
  // ⚠ THE CASE ABOVE CANNOT SEE THIS CHANGE, WHICH IS WHY THESE EXIST. It clears storage and sets
  // only the build stamp, so no changelog signature is stored — the migration branch — and both
  // dots light exactly as they always did. It passes identically before and after. Only a stored
  // signature discriminates, so each case below states what was previously seen.
  it('★ a build change whose changelog gained NOTHING lights the GEAR dot only', () => {
    // The owner's observation, in a test: v2.21.1 shipped on a day whose entry already stated the
    // day's net effect, so the charter correctly added no line — and everyone holding v2.21.0 got a
    // breadcrumb to something they had already read.
    localStorage.setItem(CHANGELOG_SEEN_KEY, changelogSignature(CHANGELOG))
    bootAfterUpdate()
    expect(localStorage.getItem(GEAR_DOT_KEY)).toBe('1')
    expect(localStorage.getItem(CHANGELOG_DOT_KEY)).toBeNull()
    // The gear still says an update landed — that is true, and the Updating screen already said so.
    expect(gear()).toHaveAttribute('aria-label', 'Settings (update)')
    openSettings()
    expect(linkMark()).toHaveAttribute('data-lit', 'false')
    expect(screen.getByRole('button', { name: 'Changelog' })).toBe(changelogLink())
  })

  it('a build change whose changelog DID gain something lights both', () => {
    localStorage.setItem(CHANGELOG_SEEN_KEY, JSON.stringify(['1999-01-01', 'an older entry']))
    bootAfterUpdate()
    expect(localStorage.getItem(GEAR_DOT_KEY)).toBe('1')
    expect(localStorage.getItem(CHANGELOG_DOT_KEY)).toBe('1')
    openSettings()
    expect(linkMark()).toHaveAttribute('data-lit', 'true')
  })

  it('the MIGRATION boot (no signature stored yet) lights both — nobody loses a pending dot', () => {
    // The one boot after this ships. A missing signature is NOT treated as "nothing new", because
    // by then buildChanged has already proved this is an existing installation rather than a first
    // visit — so the safe answer is the old behaviour, and the tie breaks toward showing the dot.
    expect(localStorage.getItem(CHANGELOG_SEEN_KEY)).toBeNull()
    bootAfterUpdate()
    expect(localStorage.getItem(CHANGELOG_DOT_KEY)).toBe('1')
  })

  it('restamps what was seen on EVERY boot, so the next build compares against this one', () => {
    bootAfterUpdate()
    expect(localStorage.getItem(CHANGELOG_SEEN_KEY)).toBe(changelogSignature(CHANGELOG))
  })

  it('an unread link dot SURVIVES a later build that adds nothing to the changelog', () => {
    // Marking is what got gated, not clearing. Someone who never opened the changelog must keep
    // their dot through an internal deploy — the gate must not become a way to lose news.
    localStorage.setItem(CHANGELOG_DOT_KEY, '1')
    localStorage.setItem(CHANGELOG_SEEN_KEY, changelogSignature(CHANGELOG))
    bootAfterUpdate()
    expect(localStorage.getItem(CHANGELOG_DOT_KEY)).toBe('1')
  })

  it('first-ever visit: no stamp, no dots', () => {
    mountApp()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(localStorage.getItem(GEAR_DOT_KEY)).toBeNull()
    expect(localStorage.getItem(CHANGELOG_DOT_KEY)).toBeNull()
    expect(gearMark()).toHaveAttribute('data-lit', 'false')
    expect(gear()).toHaveAttribute('aria-label', 'Settings')
    openSettings()
    // Unlit is a STATE, not an absence: the marker element is in the DOM either way, so the link's
    // text can never move when a build lands (index.css hides the unlit box with visibility, which
    // jsdom cannot lay out — the node's presence plus data-lit is the whole testable contract).
    expect(linkMark()).toHaveAttribute('data-lit', 'false')
    expect(screen.getByRole('button', { name: 'Changelog' })).toBe(changelogLink())
  })

  it('the two hosts mount DIFFERENT forms of the one marker (round-8 Q7)', () => {
    bootAfterUpdate()
    // The ⚙ icon button gets the corner badge, and is the marker's containing block by its OWN
    // literal class — not by whichever of the two indicator classes happens to be applied.
    expect(gearMark()).toHaveAttribute('data-update-dot', 'corner')
    expect(gearMark().parentElement).toBe(gear())
    expect(gear().className.split(/\s+/)).toContain('relative')
    // The round-6 recipe shared one class between both hosts; nothing may wear it again.
    expect(gear().className).not.toContain('update-dot')
    openSettings()
    const link = changelogLink()
    // The text link gets the in-flow marker — a sibling of the text, never on top of it — and the
    // underline sits on the text span alone so the rule cannot paint across the gap to the dot.
    expect(linkMark()).toHaveAttribute('data-update-dot', 'inline')
    expect(linkMark().parentElement).toBe(link)
    expect(link.className).not.toContain('underline')
    const text = link.querySelector('span')
    expect(text.textContent).toBe('Changelog')
    expect(text.className).toContain('underline')
  })

  it('the post-update suppression boot (cg-skip-boot-hold) still lights the dots (no signature stored) — only the screen is suppressed', () => {
    writeBuildStamp(OLD_STAMP)
    sessionStorage.setItem('cg-skip-boot-hold', '1')
    mountApp()
    expect(document.querySelector('.boot-updating')).toBeNull() // no second screen back-to-back…
    expect(localStorage.getItem(GEAR_DOT_KEY)).toBe('1') // …but the changelog still has news
    expect(localStorage.getItem(CHANGELOG_DOT_KEY)).toBe('1')
    expect(gearMark()).toHaveAttribute('data-lit', 'true')
  })

  it('the gear can wear the update dot and the violet modified bar at once (both marks, combined aria-label)', () => {
    act(() => useModePrefs.getState().setFlashMs(800)) // live state ≠ defaults → gear-modified
    bootAfterUpdate()
    // A real child element and a ::after pseudo-element coexist with no ordering constraint — the
    // round-6 recipe had to claim ::before to fit alongside .gear-modified's bar.
    expect(gear().className).toContain('gear-modified')
    expect(gearMark()).toHaveAttribute('data-lit', 'true')
    expect(gear()).toHaveAttribute('aria-label', 'Settings (modified, update)')
  })

  it('opening Settings clears the gear dot only — the link dot keeps pointing onward', () => {
    bootAfterUpdate()
    openSettings()
    expect(localStorage.getItem(GEAR_DOT_KEY)).toBeNull()
    expect(localStorage.getItem(CHANGELOG_DOT_KEY)).toBe('1')
    expect(linkMark()).toHaveAttribute('data-lit', 'true')
    closeSettings() // the gear renders its closed-state classes, now dotless
    expect(gearMark()).toHaveAttribute('data-lit', 'false')
    expect(gear()).toHaveAttribute('aria-label', 'Settings')
  })

  it('the link dot survives settings open/close cycles until the link is first tapped', () => {
    bootAfterUpdate()
    openSettings()
    closeSettings() // gear dot now retired, link dot untouched
    openSettings() // reopen
    expect(linkMark()).toHaveAttribute('data-lit', 'true')
    // With the gear's dot already retired, the link's sr-only word is the ONLY update signal a
    // screen reader still has — the reason the marker is not left silently decorative.
    expect(screen.getByRole('button', { name: 'Changelog, update' })).toBe(changelogLink())
    openChangelog() // the first tap: opens the popup AND retires the link's dot
    expect(changelogTitle()).toBeInTheDocument()
    expect(localStorage.getItem(CHANGELOG_DOT_KEY)).toBeNull()
    act(() => fireEvent.click(within(changelogDialog()).getByRole('button', { name: 'Close' })))
    expect(linkMark()).toHaveAttribute('data-lit', 'false')
    expect(screen.getByRole('button', { name: 'Changelog' })).toBe(changelogLink())
  })

  it('the dots persist across boots via the flags (a later same-build boot re-lights nothing but loses nothing)', () => {
    bootAfterUpdate()
    const current = localStorage.getItem(BUILD_STAMP_KEY)
    cleanup()
    document.getElementById('root')?.remove()
    mountApp() // same build now — no new detection…
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(localStorage.getItem(BUILD_STAMP_KEY)).toBe(current)
    expect(gearMark()).toHaveAttribute('data-lit', 'true') // …the flags alone carried the dots over
    openSettings()
    expect(linkMark()).toHaveAttribute('data-lit', 'true')
  })
})

describe('the Changelog popup (modal parity + content)', () => {
  beforeEach(() => {
    resetAppState()
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })
  const openPopup = () => {
    openSettings()
    openChangelog()
  }

  it('renders EVERY entry — dates through the user Date Format setting, items as the plain-words list', () => {
    mountApp()
    openPopup()
    const dialog = changelogDialog()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(document.activeElement).toBe(dialog) // focus landed IN the dialog on open
    // One bulleted list per entry, all inside the popup's own scroll region. Nothing is held back:
    // round-8 Q8 removed the render-time slice, so the whole array draws and the ten-day cap is the
    // data-shape guard above instead.
    const lists = within(dialog).getAllByRole('list')
    expect(lists).toHaveLength(CHANGELOG.length)
    const scrollRegion = dialog.querySelector('.overflow-y-auto')
    for (const l of lists) expect(scrollRegion.contains(l)).toBe(true)
    // EVERY entry's own Pacific date renders, driven through the Date Format setting (the factory
    // Written MDY renders numerically — the Last-Updated recipe).
    // ⚠ DERIVED FROM CHANGELOG, NEVER HARD-CODED. Until 2026-09-05 this asserted three literal
    // dates, and it broke the very first time the ten-day cap rotated: 2026-07-17 aged out into
    // CHANGELOG-ARCHIVE.md and the test failed on data that had correctly left the array. A test
    // that names specific rows of the data it is checking is a test with an expiry date on it —
    // this reads the array instead, so it now covers every entry and survives every rotation.
    for (const en of CHANGELOG) {
      const [y, m, d] = en.date.split('-').map(Number)
      expect(
        within(dialog).getByText(`${m}/${d}/${y}`),
        `${en.date} should render as ${m}/${d}/${y}`,
      ).toBeInTheDocument()
    }
    // Newest day first, each line verbatim.
    expect(
      within(lists[0])
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(CHANGELOG[0].items)
    expect(
      within(lists[1])
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(CHANGELOG[1].items)
    // Input-free by construction: the one control is Close.
    expect(within(dialog).queryAllByRole('textbox')).toHaveLength(0)
    expect(within(dialog).getAllByRole('button')).toHaveLength(1)
  })

  it('wears the settings scroll recipe: py-4 card, the px-4 lane inside the scroll region, px-4 title and Close rows (round-7 Q5)', () => {
    mountApp()
    openPopup()
    const dialog = changelogDialog()
    const scrollRegion = dialog.querySelector('.overflow-y-auto')
    // The card owns vertical padding only; the horizontal 1rem lives INSIDE the scroller (the
    // scrollbar's text-free lane) and on the title and Close rows — components/scrollRegion.
    expect(dialog.className).toContain('py-4')
    expect(dialog.className.split(/\s+/)).not.toContain('p-4')
    expect(scrollRegion.className).toContain('px-4')
    expect(scrollRegion.className).toContain('overscroll-contain')
    // The title's px-4 moved onto its ROW on 2026-08-10, when the version joined it — the lane is a
    // property of the row, and the title element itself is now a span inside it carrying only type.
    // (Why a span and not the row: the row would drag the version into the dialog's accessible name.
    // The version cases below and tests/appVersion.dom pin that.)
    const titleRow = dialog.querySelector('#changelog-title').parentElement
    expect(titleRow.className).toContain('px-4')
    expect(dialog.querySelector('#changelog-title').className.split(/\s+/)).not.toContain('px-4')
    const closeRow = within(dialog).getByRole('button', { name: 'Close' }).parentElement
    expect(closeRow.className).toContain('px-4')
  })

  it('shows the app version on the heading row, right of the title (2026-08-10)', () => {
    mountApp()
    openPopup()
    const dialog = changelogDialog()
    // The REAL value, so this file follows every future bump on its own. (That it comes from the
    // module rather than a literal is proved in tests/appVersion.dom, which mocks the module — no
    // in-process assertion here could tell the two apart.)
    const version = within(dialog).getByText(`v${APP_VERSION}`)
    const titleRow = dialog.querySelector('#changelog-title').parentElement
    expect(version.parentElement).toBe(titleRow)
    // Right-aligned by the row's justify-between, and on the heading's baseline rather than centred
    // on it — what makes two type sizes read as one line.
    expect(titleRow.className).toContain('justify-between')
    expect(titleRow.className).toContain('items-baseline')
    // ⚠ ORDER IS DOM ORDER, NOT PIXELS. jsdom has no layout, so "right of the title" is unverifiable
    // here; what is verifiable is that the version follows the title in the row, which is what
    // justify-between then places right (and what a screen reader reads in that order).
    expect(titleRow.children[0]).toBe(dialog.querySelector('#changelog-title'))
    expect(titleRow.children[1]).toBe(version)
    // The decided styling: demoted three ways and no further. text-xs and normal weight beside the
    // semibold heading, tabular-nums so the digits do not jitter between versions, and the SAME text
    // token the entry bullets use — deliberately NOT the muted marker token, which is calibrated for
    // decorative punctuation and measures roughly 40% dimmer on the four DARK themes (the render
    // site carries the measured figures; jsdom computes no colours, so this pins the token only).
    const cls = version.className.split(/\s+/)
    expect(cls).toContain('text-xs')
    expect(cls).toContain('tabular-nums')
    expect(cls).toContain('text-(--tx-200-80)')
    expect(cls.join(' ')).not.toContain('font-semibold')
    expect(cls.join(' ')).not.toContain('--mut-color')
  })

  it('★ the version did NOT join the dialog’s accessible name', () => {
    mountApp()
    openPopup()
    // The card is aria-labelledby="changelog-title", so whatever carries that id IS the name a
    // screen reader announces on every open. The id wraps ONLY the words; the version is a sibling.
    // getByRole matches a string EXACTLY against the computed name, so this is the whole assertion.
    expect(screen.getByRole('dialog', { name: "What's new" })).toBeInTheDocument()
    expect(document.getElementById('changelog-title').textContent).toBe("What's new")
    expect(screen.queryByRole('dialog', { name: `What's new v${APP_VERSION}` })).toBeNull()
  })

  it('edge fades track scroll position inside the popup (the shared scroll-state listener, round-7 Q5)', () => {
    mountApp()
    openPopup()
    const region = changelogDialog().querySelector('.overflow-y-auto')
    // jsdom has no layout — teach the region a scrollable geometry, then drive scrollTop through
    // real scroll events against the useScrollEdgeState listener attached on open.
    Object.defineProperties(region, {
      scrollHeight: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 200 },
    })
    act(() => fireEvent.scroll(region)) // still at the top: content extends below only
    expect(region.className).toContain('fade-scroll-bottom')
    region.scrollTop = 100
    act(() => fireEvent.scroll(region)) // mid-scroll: content past both edges
    expect(region.className).toContain('fade-scroll-both')
    region.scrollTop = 200
    act(() => fireEvent.scroll(region)) // at the bottom: content extends above only
    expect(region.className).toContain('fade-scroll-top')
    expect(region.className).not.toContain('fade-scroll-both')
  })

  it('Close, scrim mousedown/click, and Escape dismiss the popup only — the settings panel survives', () => {
    mountApp()
    openPopup()
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Close' })))
    expect(changelogTitle()).toBeNull()
    expect(screen.getByRole('button', { name: 'Reset Settings' })).toBeInTheDocument()
    openChangelog()
    // The settings click-outside handler must treat the scrim as "inside" (the shared
    // [data-settings-modal] marker)…
    const scrim = document.querySelector('[data-settings-modal]')
    act(() => fireEvent.mouseDown(scrim))
    expect(screen.getByRole('button', { name: 'Reset Settings' })).toBeInTheDocument()
    // …and a scrim CLICK cancels only the popup.
    act(() => fireEvent.click(scrim))
    expect(changelogTitle()).toBeNull()
    expect(screen.getByRole('button', { name: 'Reset Settings' })).toBeInTheDocument()
    openChangelog()
    act(() => fireEvent.keyDown(document.body, { key: 'Escape' })) // capture-phase popup handler wins
    expect(changelogTitle()).toBeNull()
    expect(screen.getByRole('button', { name: 'Reset Settings' })).toBeInTheDocument()
  })

  it('closing Settings closes the popup with it (child flow of the panel)', () => {
    mountApp()
    openPopup()
    expect(changelogTitle()).toBeInTheDocument()
    act(() => fireEvent.click(gear())) // any settings close counts
    expect(changelogTitle()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reset Settings' })).toBeNull()
  })

  it('the single-button Tab trap wraps in place on Close; the mode dropdown stays suppressed', () => {
    mountApp()
    openPopup()
    const close = screen.getByRole('button', { name: 'Close' })
    act(() => {
      close.focus()
      fireEvent.keyDown(close, { key: 'Tab' })
    })
    expect(document.activeElement).toBe(close)
    act(() => fireEvent.keyDown(close, { key: 'Tab', shiftKey: true }))
    expect(document.activeElement).toBe(close)
    // The app-wide Tab shortcut bails while a settings modal is up (the [data-settings-modal]
    // guard) — the mode dropdown must not open behind the aria-modal dialog.
    act(() => fireEvent.keyDown(window, { key: 'Tab' }))
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(changelogTitle()).toBeInTheDocument()
  })

  it('Android Back closes the popup first, then Settings (LIFO overlay stack)', async () => {
    mountApp()
    // Flush jsdom's queued history traversals until quiescent (the saveDefaults.dom pattern):
    // earlier tests' UI closes each ran popOverlay's guarded history.back(), whose to-be-ignored
    // popstate fires on a later task and would otherwise swallow the first synthetic Back below.
    await act(async () => {
      let quiet = 0
      let seen = 0
      const count = () => {
        seen++
      }
      window.addEventListener('popstate', count)
      for (let i = 0; i < 20 && quiet < 2; i++) {
        seen = 0
        await new Promise((r) => setTimeout(r, 0))
        quiet = seen === 0 ? quiet + 1 : 0
      }
      window.removeEventListener('popstate', count)
    })
    // This file's heavy open/close churn can also EXHAUST jsdom's history: a guarded
    // history.back() with no earlier entry never fires its popstate at all, leaving ignorePop
    // stale forever — no amount of flushing delivers a traversal that will never come. Prime it
    // out while nothing is open: a stale flag is consumed here, and with a clean flag the empty
    // overlay stack makes this dispatch a no-op either way.
    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    openSettings()
    openChangelog()
    expect(changelogTitle()).toBeInTheDocument()
    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    expect(changelogTitle()).toBeNull()
    expect(screen.getByRole('button', { name: 'Reset Settings' })).toBeInTheDocument() // settings survived the first Back
    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    expect(screen.queryByRole('button', { name: 'Reset Settings' })).toBeNull()
  })

  it('the Changelog link sits RIGHT of Check for updates in the same footer row', () => {
    mountApp()
    openSettings()
    const check = screen.getByRole('button', { name: 'Check for updates' })
    const link = changelogLink()
    expect(check.parentElement).toBe(link.parentElement)
    expect(check.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('the metadata row anchors its ends and keeps the ring-gap floor — and no longer shares the saved-defaults row’s class', () => {
    mountApp()
    openSettings()
    // ⚠ THIS CASE REPLACES "both settings-footer link rows share one row class" (round-7 Q2). That
    // one asserted the two classNames were EQUAL, on the argument that the View/Clear row and this
    // one were the same kind of row. They are not any more: the saved-defaults pair moved into the
    // pinned button block and centres on the row's thirds, while this row spreads edge-to-edge, so
    // the hoisted token split in two (FOOTER_META_ROW_CLASS / FOOTER_DEFAULTS_ROW_CLASS). Keeping
    // the equality assertion would have meant a test that can only pass by re-uniting rows that
    // must differ, so what is pinned now is what each row separately promises.
    const metaRow = screen.getByRole('button', { name: 'Check for updates' }).parentElement
    // justify-between is the whole anchoring rule in one token: the stamp hard left, Changelog hard
    // right, and — because every footer link's px-1 is cancelled by an equal -mx-1, so the flex
    // margin boxes ARE the text boxes — the slack split into two EQUAL visible gaps, which is
    // "Check for updates sits exactly halfway between its two neighbours".
    expect(metaRow.className).toContain('justify-between')
    // gap-3 survives as the FLOOR under those two gaps (12px between margin boxes → ~4px between
    // the press-drag rings the px-1 draws), never as their size. Its legacy gap-2 left them
    // touching at 0px, which is the regression this half of the old case existed to catch.
    expect(metaRow.className).toContain('gap-3')
    // And the split is real: two different rows, two different classes.
    const defaultsRow = screen.getByRole('button', { name: 'View saved defaults' }).parentElement
    expect(defaultsRow).not.toBe(metaRow)
    expect(defaultsRow.className).not.toBe(metaRow.className)
  })
})
