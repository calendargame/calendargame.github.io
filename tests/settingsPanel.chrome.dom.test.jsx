// @vitest-environment jsdom
//
// THE SETTINGS PANEL'S CHROME — groups 11 and 12 of the settings-panel behaviour net (_settings_net_spec.md).
//
// This file is written against the CURRENT app, BEFORE the Settings panel is extracted out of
// App, so that the same text stays true on both sides of the move. That is the whole point: the
// falsifiable gate for the extraction is "this net passes with ZERO edits". Everything here is
// therefore routed through tests/helpers/settingsPanel.jsx and asserts what a user can SEE — a
// label, an offer, a mask, a shadow — never where in the tree the markup happens to live today.
//
// GROUP 11 — Check for updates. One variable drives four surfaces: the label (which IS the state),
// whether the control is operable, whether it wears the underline, and an abort-on-close effect.
// The abort is the only thing standing between a dismissed panel and a full-screen Updating
// overlay appearing afterwards, so that is the case that matters most here.
//
// GROUP 12 — panel geometry and the sticky footer, EXPRESSED AS BEHAVIOUR. jsdom has no layout
// engine, so a case that measures is a case that lies. What is real here is STRUCTURE: the footer
// is inside the card and outside the scroller, so it cannot scroll away. The edge indicators ARE
// fully drivable, because the edge hook reads three numbers off the scroller and jsdom lets us
// define all three.
//
// ⚠ WHERE THE LAYOUT CLASS PINS WENT, and why they are not here. This case used to also assert the
// card's raw Tailwind tokens — flex, flex-col, the max-h-[calc(100dvh…)] cap, min-h-0 on the
// scroller. Those tokens are load-bearing (lose min-h-0 and the flex child refuses to shrink, so
// the list never scrolls and the footer leaves the screen, with a fully green suite) but they are
// exactly the implementation detail this net forbids, and they are the assertions most likely to
// force an EDIT on the far side of the extraction — which would break the zero-edit gate they were
// meant to serve. Componentising the card, or moving the cap into index.css where the bar-height
// variable already lives, changes nothing a user meets and fails five of them. They now live in
// the PIXEL GATES describe at the foot of tests/settings.dom, which is the block this repo already
// declares as deliberately implementation-coupled and exempt from the abstraction. Nothing was
// dropped; it moved to the file that owns that kind of claim.
//
// NOT COVERED HERE, deliberately, and on the device checklist instead:
//   • G12.5 — the three footer captions sharing one font size and never falling below the 11px
//     floor. fitFooterBtns measures widths, every width in jsdom is 0, and the fit is a no-op.
//     Nothing below implies otherwise.
//   • G11.7's "…including when the build change is detected while the panel is ALREADY open".
//     The detection effect runs at mount and the panel mounts closed, so that ordering is
//     unreachable from a test; the [settingsOpen, gearDot] dep that covers it is a code-review
//     item. What IS swept below is the half that is reachable: every open route retires the dot.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, cleanup, act } from '@testing-library/react'
import {
  mountApp,
  resetAppState,
  openSettings,
  closeSettings,
  isSettingsOpen,
  OPEN_ROUTE_NAMES,
  panelEl,
  panelScroller,
  panelFades,
  footerShade,
  changelogLink,
  changelogDot,
  checkUpdatesControl,
  checkUpdatesState,
  gearDot,
  updatingOverlay,
  tap,
} from './helpers/settingsPanel.jsx'
import { SCROLL_REGION_CLASS } from '../src/components/scrollRegion.js'
import { BUILD_ID_META, UPDATE_CHECK_LABEL, UPDATE_RESULT_MS } from '../src/lib/updateCheck.js'
import { writeBuildStamp } from '../src/lib/buildStamp.js'
import { GEAR_DOT_KEY, CHANGELOG_DOT_KEY } from '../src/changelog.js'

// The applier reports to Sentry; mocked so nothing reaches the real buffered transport.
const sentry = vi.hoisted(() => ({ captureError: vi.fn(), initObservability: vi.fn() }))
vi.mock('../src/observability/sentry', () => sentry)

// Node ships a native global fetch, and G11 replaces it per test. Captured once here so the
// teardown can put the real one BACK rather than delete the property outright — deleting it left
// the worker with no fetch at all for anything that ran afterwards in this file.
const nativeFetch = globalThis.fetch

// ══════════════════════════════════════════════════════════════════════════════════════════════
// G11 — Check for updates
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('G11 — Check for updates: one state, four surfaces', () => {
  // Two well-formed build ids. The detector validates BOTH sides of its comparison and treats
  // anything unrecognisable as "no answer", so a malformed id would silently read as offline and
  // make every verdict assertion below agree with the wrong thing.
  const OWN_ID = 'a5983de731e1224c945b1abe288e502d'
  const NEWER_ID = 'f762bedd56f680561b8a8a1232c1fe1a'
  let buildMeta

  // The running build's identity, exactly as vite.config.js's buildIdentity plugin injects it.
  const setOwnBuildId = (id) => {
    buildMeta = document.createElement('meta')
    buildMeta.setAttribute('name', BUILD_ID_META)
    buildMeta.setAttribute('content', id)
    document.head.appendChild(buildMeta)
  }
  // The deployed build's identity file.
  const serveBuildId = (body) =>
    vi.fn(async (url, init) => {
      if (init?.signal?.aborted) throw new Error('aborted')
      return { ok: true, text: async () => body, url }
    })
  // A network that has not answered yet. `release()` answers it; an abort rejects it, which is
  // what a real fetch does and what the abort case has to be able to observe.
  const holdBuildId = (body) => {
    let release = () => {}
    const impl = vi.fn(
      (url, init) =>
        new Promise((resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')))
          release = () => resolve({ ok: true, text: async () => body, url })
        }),
    )
    return { impl, release: () => release() }
  }
  // Let the check's own chain (getRegistration → fetch → text) and any due timer run.
  const settle = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
  }
  const press = async () => {
    tap(checkUpdatesControl())
    await settle()
  }

  beforeEach(() => {
    vi.useFakeTimers()
    sentry.captureError.mockClear()
    resetAppState()
    // NOT part of the shared reset: sessionStorage carries the post-update splash-skip flag, and
    // the dot cases below mount across a simulated build change on purpose.
    sessionStorage.clear()
    setOwnBuildId(OWN_ID)
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
    document.getElementById('root')?.remove()
    buildMeta?.remove()
    globalThis.fetch = nativeFetch
    sessionStorage.clear()
  })

  it('reads its resting label, is operable and is underlined when nothing has been asked', () => {
    globalThis.fetch = serveBuildId(OWN_ID)
    mountApp()
    openSettings()
    expect(checkUpdatesState()).toEqual({
      label: UPDATE_CHECK_LABEL.idle,
      disabled: false,
      // The underline is the interaction signal, and at rest the control IS offering the
      // interaction. The three status labels below do not wear it.
      underlined: true,
    })
  })

  it('reads "Checking…", refuses the press, and drops the underline while a check is in flight', async () => {
    const held = holdBuildId(OWN_ID)
    globalThis.fetch = held.impl
    mountApp()
    openSettings()
    await press()
    expect(checkUpdatesState()).toEqual({
      label: UPDATE_CHECK_LABEL.checking,
      // The app's ONE deliberate exception to its CSS-only dim: the native attribute, so the
      // state the label reports is the state the control is actually in.
      disabled: true,
      underlined: false,
    })
    // Pressing it again does nothing — no second question goes to the network.
    await press()
    expect(held.impl).toHaveBeenCalledTimes(1)
    expect(checkUpdatesState().label).toBe(UPDATE_CHECK_LABEL.checking)
    await act(async () => {
      held.release()
      await vi.advanceTimersByTimeAsync(0)
    })
  })

  it('shows its verdict for the result window — operable but NOT underlined — then returns to rest', async () => {
    globalThis.fetch = serveBuildId(OWN_ID)
    mountApp()
    openSettings()
    await press()
    expect(checkUpdatesState()).toEqual({
      label: UPDATE_CHECK_LABEL.current,
      // Pressable (another press starts another check) but not OFFERING the same thing, so it
      // does not claim to: a status wearing the interaction signal is the mistake this guards.
      disabled: false,
      underlined: false,
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPDATE_RESULT_MS - 1)
    })
    expect(checkUpdatesState().label).toBe(UPDATE_CHECK_LABEL.current)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2)
    })
    expect(checkUpdatesState()).toEqual({
      label: UPDATE_CHECK_LABEL.idle,
      disabled: false,
      underlined: true,
    })
  })

  it('always reserves the width of its resting label, so the Changelog link beside it cannot shift', async () => {
    // WHAT IS REAL IN JSDOM: the control holds its resting label TWICE — an aria-hidden copy that
    // exists only to reserve width, plus the live one stacked on it — and the hidden copy keeps
    // saying the RESTING label whatever the live one currently reads. That reservation is the
    // whole mechanism by which the Changelog link cannot move. Whether the pixels actually hold
    // still is a device check; that the reservation exists in every state is not.
    const held = holdBuildId(OWN_ID)
    globalThis.fetch = held.impl
    mountApp()
    openSettings()
    const strut = () => checkUpdatesControl().querySelector('[aria-hidden="true"]')
    expect(strut().textContent).toBe(UPDATE_CHECK_LABEL.idle)
    await press()
    expect(checkUpdatesState().label).toBe(UPDATE_CHECK_LABEL.checking)
    expect(strut().textContent).toBe(UPDATE_CHECK_LABEL.idle)
    await act(async () => {
      held.release()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(checkUpdatesState().label).toBe(UPDATE_CHECK_LABEL.current)
    expect(strut().textContent).toBe(UPDATE_CHECK_LABEL.idle)
    // And the strut never becomes the control's name: the live label alone is what is announced.
    expect(screen.getByRole('button', { name: UPDATE_CHECK_LABEL.current })).toBe(
      checkUpdatesControl(),
    )
  })

  it('aborts a check in flight when the panel closes: no Updating screen appears behind the user', async () => {
    // ★ THE CASE THAT MATTERS MOST IN THIS GROUP. The network is about to say "there is a newer
    // build" — the answer that applies an update and raises the full-screen Updating overlay. The
    // user dismisses the panel first. Without the abort, that overlay arrives over a menu the user
    // has already closed, which is the app acting on its own.
    const held = holdBuildId(NEWER_ID)
    globalThis.fetch = held.impl
    mountApp()
    openSettings()
    await press()
    expect(checkUpdatesState().label).toBe(UPDATE_CHECK_LABEL.checking)
    closeSettings()
    expect(isSettingsOpen()).toBe(false)
    await act(async () => {
      held.release()
      // Deliberately short of the Updating screen's own minimum hold: if the abort had failed the
      // overlay would already be up by now, and stopping here keeps the failure clean instead of
      // letting the applier go on to unregister the service worker.
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(updatingOverlay()).toBe(null)
    // And the next open starts from rest, not from a stranded "Checking…".
    openSettings()
    expect(checkUpdatesState()).toEqual({
      label: UPDATE_CHECK_LABEL.idle,
      disabled: false,
      underlined: true,
    })
  })

  it('does nothing at all when the panel closes and no check was started during that open', async () => {
    // The close effect fires only when the check state MOVED while the panel was open. Its body is
    // idempotent, so a rewrite that fired it unconditionally would not be distinguishable in the
    // DOM — what this case pins is the observable half: opening and closing the panel is not
    // itself an update interaction. Nothing is asked of the network, no screen appears, and the
    // control is at rest on the way back in, now and after the result window has come and gone.
    const fetchImpl = serveBuildId(OWN_ID)
    globalThis.fetch = fetchImpl
    mountApp()
    openSettings()
    closeSettings()
    await settle()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(updatingOverlay()).toBe(null)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPDATE_RESULT_MS + 1)
    })
    openSettings()
    expect(checkUpdatesState()).toEqual({
      label: UPDATE_CHECK_LABEL.idle,
      disabled: false,
      underlined: true,
    })
  })

  // ── The gear's update dot ───────────────────────────────────────────────────────────────────
  // Mount on a stale build stamp — a detected build change — with the post-update splash skip set,
  // which lights both persisted dots (no changelog signature is stored here, so the changelog dot
  // takes its migration branch) while suppressing the Updating screen that would otherwise
  // sit over the app for a second. The dots are the subject; the screen is not.
  const bootAfterUpdate = () => {
    writeBuildStamp('2020-01-01T00:00:00.000Z')
    sessionStorage.setItem('cg-skip-boot-hold', '1')
    mountApp()
  }

  it.each(OPEN_ROUTE_NAMES)('retires the gear’s update dot when the panel opens via %s', (via) => {
    globalThis.fetch = serveBuildId(OWN_ID)
    bootAfterUpdate()
    expect(gearDot()).toBe('true')
    expect(localStorage.getItem(GEAR_DOT_KEY)).toBe('1')
    openSettings(via)
    expect(isSettingsOpen()).toBe(true)
    // Dark, but still THERE: the marker reserves its slot either way, so retiring it shifts
    // nothing. 'false' and "no marker at all" are different answers and only one of them is right.
    expect(gearDot()).toBe('false')
    expect(localStorage.getItem(GEAR_DOT_KEY)).toBeNull()
    // Closed by the G KEY whichever route opened it, and the key is forced rather than tidy: the
    // close route is not this case's subject (G1 owns route equivalence), but it has to actually
    // CLOSE. After the `gearPress` row's press-drag the controller still has the gear's click
    // suppression armed — jsdom never delivers the click that would consume it, and this describe
    // holds fake timers so the 1s fallback never fires either — so the default gear-tap close is a
    // silent no-op there, and the trailing assertion would pass on a panel that never shut. The
    // full account is at pressDragFromGear in the helper. `key` is not a click, so it lands on
    // every row; the assertion below makes any future regression fail loudly instead of passing.
    closeSettings('key')
    expect(isSettingsOpen()).toBe(false)
    // The dot stays retired — it is a persisted flag, so a rewrite that re-read it per render
    // would light it again on the way out.
    expect(gearDot()).toBe('false')
  })

  it('leaves the Changelog link’s own dot lit through open/close cycles until it is first tapped', () => {
    globalThis.fetch = serveBuildId(OWN_ID)
    bootAfterUpdate()
    openSettings()
    expect(changelogDot()).toBe('true')
    expect(localStorage.getItem(CHANGELOG_DOT_KEY)).toBe('1')
    closeSettings()
    openSettings()
    // The gear's stage of the breadcrumb is done; the link's still points onward, and with the
    // gear's dot retired its sr-only word is the only update signal a screen reader has left.
    expect(gearDot()).toBe('false')
    expect(changelogDot()).toBe('true')
    expect(screen.getByRole('button', { name: 'Changelog, update' })).toBe(changelogLink())
    tap(changelogLink())
    expect(changelogDot()).toBe('false')
    expect(localStorage.getItem(CHANGELOG_DOT_KEY)).toBeNull()
    expect(screen.getByRole('button', { name: 'Changelog' })).toBe(changelogLink())
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// G12 — Panel geometry and the sticky footer, expressed as behaviour
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('G12 — the panel scrolls its list, not itself', () => {
  // The scroller's three numbers are what the edge hook reads, and jsdom reports 0 for all three.
  // Defining them is not a fake: it is the only way to stand up "there is more list below" at all,
  // and every assertion afterwards is about what the app DOES with those numbers.
  const setExtent = (el, { scrollHeight, clientHeight }) =>
    Object.defineProperties(el, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, get: () => clientHeight },
    })
  const scrollTo = (el, top) => {
    el.scrollTop = top
    act(() => {
      el.dispatchEvent(new Event('scroll'))
    })
  }

  beforeEach(() => {
    resetAppState()
    // index.css is not loaded in jsdom, so the shadow ramp distance is stood up by hand at its
    // real value — and BEFORE the mount, because the hook reads it once when it attaches to the
    // scroller. Without it the ramp degrades to the boolean (full strength the moment the edge is
    // live), which is a real supported fallback and would make the ramp case say nothing.
    document.documentElement.style.setProperty('--fade-h', '24px')
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
    document.documentElement.style.removeProperty('--fade-h')
  })

  it('keeps the list in a scroll region with the footer inside the card but outside it', () => {
    // WHAT "STICKY" ACTUALLY MEANS HERE, and it is containment rather than a CSS position: there
    // is no position:sticky anywhere in the panel. The footer stays put because it simply is not
    // a thing the list can scroll — it is the card's own child, beside the scroller rather than
    // inside it. That is fully checkable without a layout engine, and it survives any
    // re-authoring of the markup the extraction performs.
    mountApp()
    openSettings()
    const card = panelEl()
    const list = panelScroller()
    // The footer's controls are resolved GLOBALLY, off `screen` — not through the panel scope,
    // which would find them by querying inside the card and make the first assertion true by
    // construction. Asked this way, a footer portaled out of the card fails the first and a footer
    // that ended up inside the scroller fails the second, which is the whole point of asking.
    const saveDefaults = screen.getByRole('button', { name: 'Save Defaults' })
    expect(card.contains(saveDefaults)).toBe(true)
    expect(list.contains(saveDefaults)).toBe(false)
    expect(
      list.compareDocumentPosition(saveDefaults) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    // And the list scrolls through the app's one shared scroll-region recipe rather than a local
    // copy of it — the recipe carries the scrollbar lane the fades below are measured against.
    // A published constant, not a Tailwind token: the app states this contract out loud.
    expect(list.className).toContain(SCROLL_REGION_CLASS)
  })

  it('feathers exactly the edges that have content past them, and neither when it fits by a hair', () => {
    mountApp()
    openSettings()
    const list = panelScroller()
    // A list that fits shows no feather at all.
    expect(panelFades()).toEqual({ top: false, bottom: false })

    setExtent(list, { scrollHeight: 1200, clientHeight: 400 })
    scrollTo(list, 0)
    expect(panelFades()).toEqual({ top: false, bottom: true }) // 800px still below
    scrollTo(list, 400)
    expect(panelFades()).toEqual({ top: true, bottom: true }) // content past both edges
    scrollTo(list, 800)
    expect(panelFades()).toEqual({ top: true, bottom: false }) // arrived at the end

    // …and the hair case, which is the one a naive rule gets wrong: a 3px overflow is inside the
    // bottom edge's arrival tolerance, so the user is at the end and nothing is feathered.
    setExtent(list, { scrollHeight: 403, clientHeight: 400 })
    scrollTo(list, 0)
    expect(panelFades()).toEqual({ top: false, bottom: false })
  })

  // G12.3 — REMOVED in the round-14 dedup pass. The footer shadow's ramp (full strength with 800px
  // below, 0.5 at 14px from the end, 0 on arrival) and the hair case that must read zero from BOTH
  // the shadow's side and the mask's are already pinned by the two cases in tests/settings.dom's
  // 'the sticky footer’s progressive boundary shadow' describe (~1081 and ~1100), against the same
  // numbers. Those are the STRONGER pair: the ramp case additionally captures the footer's class
  // list and re-asserts it unchanged at the end, which is the claim that the shadow became a
  // continuous --shade instead of a class toggled on and off. What survives here is the case below,
  // which is about the panel's SECOND open and has no counterpart there.

  it('never shows stale fade or shadow state from the previous open', () => {
    mountApp()
    openSettings()
    const first = panelScroller()
    setExtent(first, { scrollHeight: 1200, clientHeight: 400 })
    scrollTo(first, 400)
    expect(panelFades()).toEqual({ top: true, bottom: true })
    expect(Number(footerShade())).toBe(1)

    closeSettings()
    openSettings()
    // A fresh open measures a list that fits, so nothing is feathered…
    expect(panelFades()).toEqual({ top: false, bottom: false })
    // …and the footer's shadow is WRITTEN AT REST rather than left unset. That distinction is the
    // one that shipped a bug: the custom property's initial value is full strength, so a boundary
    // whose writer bailed without measuring wears a full black shadow with nothing to shadow.
    // '' would mean "never written"; the resting answer has to be an explicit zero.
    expect(footerShade()).not.toBe('')
    expect(Number(footerShade())).toBe(0)
  })
})
