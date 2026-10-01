// @vitest-environment jsdom
//
// THE GUIDE'S ACCESSIBILITY SECTION, PINNED TO THE FACTS IT CLAIMS.
//
// ★ WHY THIS FILE EXISTS AT ALL, and it is not "coverage". Every other claim the How-to-Play guide
// makes describes behaviour the suite already drives, so a change that falsified one would go red
// somewhere. The Accessibility section is different in one specific way: four of its sentences
// describe things the app DOES NOT DO — no focus ring, no pinch-zoom, unnamed history buttons and
// mode-screen sliders, and a game loop that withholds a button by dimming it without saying so
// (the ⚙ footer and Show Codes being the two places that do say so). Fixing any of those is a
// strict improvement that no existing test would notice, and the instant it lands the guide is
// lying to a reader who came to it precisely to find out what is supported. That asymmetry is the
// whole reason for the file: an ordinary regression test fails when the app gets WORSE, and these
// cases fail when it gets BETTER, so the sentence gets corrected in the same change that earns it.
//
// ★ WHAT IS DELIBERATELY NOT HERE. The section's POSITIVE claims — the six named picker groups,
// the four named switches, both named Year Range boxes, the four modal focus traps, the accordions'
// aria-expanded/aria-controls — are already pinned, by name, in tests/settings.dom, the
// settingsPanel behaviour net and tests/expander.dom. Restating them here would be a second copy of
// a contract that already has an owner, and the round-14 lesson about a shared fact stated twice
// applies to tests as much as to code. This file adds only what nothing else can see.
//
// ★ HOW TO USE A FAILURE HERE. Do not delete the case. Each one names the guide sentence it
// protects; when it goes red, the app has changed and the sentence in
// src/components/GuidePage.tsx is now false. Rewrite the sentence, then re-bless the case to
// describe the new truth — or, if the gap is closed outright, delete the sentence and the case
// together, in one commit.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { App } from '../src/main.jsx'

const repoFile = (...parts) =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', ...parts), 'utf8')

// The DECLARATIONS only. index.css documents itself heavily and its comments quote the very rules
// some of these pins depend on, so reading the prose would let a deleted rule keep passing (the
// same stripping tests/guideScroll.dom does, for the same reason).
const cssCode = repoFile('src', 'index.css').replace(/\/\*[\s\S]*?\*\//g, '')

// CustomSelect portals into #root, so the harness must provide one (see app-mount.dom).
function mountApp() {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  return render(<App />)
}
const pressKey = (key) =>
  act(() => {
    fireEvent.keyDown(window, { key })
  })

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

describe('the guide names its Accessibility section and puts it where the section says it is', () => {
  it('renders Accessibility immediately after Keyboard Input', () => {
    // The section's own text says the keys live "under Keyboard Input above" and the ⚙ footer
    // paragraph now ends "(See Accessibility.)". Both are directions to a reader with a finger on
    // an accordion, so both are false if the section is dropped or moved above the one it defers
    // to. Pinning the PAIR rather than an index keeps every other reshuffle of the guide free.
    const { container } = mountApp()
    pressKey('h')
    const titles = [...container.querySelectorAll('[id^="guide-sec-"] > button')].map((b) =>
      b.textContent.replace('▼', '').trim(),
    )
    expect(titles).toContain('Accessibility')
    expect(titles[titles.indexOf('Accessibility') - 1]).toBe('Keyboard Input')
  })
})

describe('the four gaps the Accessibility section admits to — each fails when the app improves', () => {
  it('GAP 1: no focus ring is drawn anywhere', () => {
    // Protects: "Nothing on the site draws a focus ring… inside the popups above, Tab moves with
    // nothing drawn to say where it went." Two halves, because the app states the gap twice: the
    // blanket suppression on buttons, and .focus-ring surviving on element classNames as a
    // deliberate no-op with NO rule behind it (index.css says so in prose — this asserts the code).
    expect(cssCode).toContain('button:focus,select:focus{outline:none}')
    expect(cssCode).not.toMatch(/\.focus-ring[^{]*\{/)
  })

  it('GAP 2: pinch-zoom is still switched off in the viewport meta', () => {
    // Protects: "Pinch-to-zoom is switched off deliberately." index.html calls this the one thing
    // holding the Lighthouse Accessibility audit down and tells you not to "fix" it — so this case
    // is not arguing with that decision, only making sure the guide stops claiming it the day the
    // owner reverses it.
    expect(repoFile('index.html')).toContain('user-scalable=no')
  })

  it('GAP 3: the history buttons and the mode-screen timer sliders still have no names', () => {
    // Protects: "the < and > history buttons are only their symbols, and the timer sliders on the
    // Flash and Blitz screens have no name of their own (the copies inside Save Defaults do)."
    // Asked of the real DOM rather than the source, because "has no accessible name" is a property
    // of the rendered element and an aria-label could arrive from any of several directions.
    // EVERY one of them, not a specimen: App mounts all five mode screens at once (only one is
    // shown), so a first-match query would silently pin whichever screen happens to render first
    // and let the other four grow a name unnoticed. The same fact is why no key press is needed to
    // reach Flash's slider — and why the only range inputs on screen at mount are the mode-screen
    // ones, since DefaultsCard's named copies exist only while the Save Defaults popup is up.
    const { container } = mountApp()
    for (const [key, glyph] of [
      ['ArrowLeft', '<'],
      ['ArrowRight', '>'],
    ]) {
      const btns = [...container.querySelectorAll(`button[data-key="${key}"]`)]
      expect(btns.length, `no ${key} history button rendered`).toBeGreaterThan(0)
      for (const btn of btns) {
        expect(btn.getAttribute('aria-label')).toBeNull()
        expect(btn.textContent.trim()).toBe(glyph)
      }
    }
    const sliders = [...container.querySelectorAll('input[type="range"]')]
    expect(sliders.length, 'no mode-screen timer sliders rendered').toBeGreaterThan(0)
    for (const s of sliders) expect(s.getAttribute('aria-label')).toBeNull()
  })

  it('GAP 4: the game loop withholds by dimming alone — with Show Codes the one exception', () => {
    // Protects: "The three buttons at the foot of the ⚙ menu, and Show Codes, are marked
    // unavailable while they're greyed. The rest of the game's buttons… are only dimmed."
    //
    // ⚠ THE EXCEPTION IS THE POINT, and it is why this case is a universal and not a specimen. The
    // sentence originally read "a greyed button elsewhere in the game is only dimmed" — writing
    // this assertion is what caught that Show Codes has carried aria-disabled since round 8, so the
    // blanket claim was false and the guide was corrected before it shipped. Sweeping every
    // dimmed button is what keeps the pair honest in both directions: a new announced button
    // fails the first loop, and Show Codes losing its announcement fails the second.
    //
    // ⚠ THE SWEEP IS EVERY DIMMED BUTTON, NOT EVERY DIMMED data-key BUTTON, and the difference is
    // the whole point of a universal. The sentence says "the rest of the game's buttons", and
    // several of them carry no data-key at all — AoX's Allow Mistakes and One-by-One, Blitz's two
    // config toggles, Deduction's sub-type rows. None of those happens to be dimmed at mount today,
    // so this costs nothing; the day one grows an aria-disabled, or the day one of them is dimmed
    // at mount, the guard is already looking. A sweep keyed to data-key would have gone on passing.
    const { container } = mountApp()
    const dimmed = [...container.querySelectorAll('button')].filter((b) =>
      b.className.includes('opacity-60'),
    )
    expect(
      dimmed.length,
      'nothing was withheld at mount — the sweep would be vacuous',
    ).toBeGreaterThan(0)
    for (const b of dimmed) {
      expect(b.className).toContain('pointer-events-none')
      if (b.getAttribute('data-key') === 'C') continue // Show Codes — the documented exception
      expect(
        b.getAttribute('aria-disabled'),
        `${b.getAttribute('data-key') ?? b.textContent.trim()} now announces itself unavailable — update the guide`,
      ).toBeNull()
    }
    const codes = container.querySelector('button[data-key="C"].opacity-60')
    expect(codes, 'no withheld Show Codes button to check the exception against').not.toBeNull()
    expect(codes.getAttribute('aria-disabled')).toBe('true')
  })
})

describe('the one positive claim in the section that only the stylesheet can answer', () => {
  it('reduce motion zeroes decorative durations and leaves the countdown bar alone', () => {
    // Protects the Motion paragraph. The token: --motion-scale drops to 0 under the OS setting, and
    // every decorative duration multiplies by it. Then an absence — the bar's fill is written inline
    // per frame as a transform, with no duration in the stylesheet to scale, which is exactly why
    // "countdown bars are unchanged" is true. An added transition on .bar>span would silently make
    // that sentence wrong, so the absence is pinned.
    expect(cssCode).toContain(':root{--motion-scale:1}')
    expect(cssCode).toContain('@media (prefers-reduced-motion: reduce){:root{--motion-scale:0}}')
    expect(cssCode).toMatch(/\.expander\{[^}]*var\(--motion-scale\)/)
    const barFill = cssCode.match(/\.bar>span\{([^}]*)\}/)
    expect(barFill, 'index.css: no .bar>span rule').not.toBeNull()
    expect(barFill[1]).not.toContain('transition')
    expect(barFill[1]).not.toContain('--motion-scale')
  })

  // ★ ROUND 16 — THE SENTENCE THIS PROTECTS CHANGED SHAPE, AND SO DID THE RISK.
  // Until round 16 the paragraph ended by NAMING the two decorative things that ignored the OS
  // setting ("the three pulsing dots on the loading screen, and the short colour fade a button does
  // as you press it"), because --motion-scale had only two consumers. Round 16 scaled all four
  // stragglers and the paragraph now opens "nothing decorative moves" — a claim about EVERYTHING in
  // the stylesheet, not about a list. Naming the six consumers one by one would pin what is there
  // and stay silent about what gets ADDED, which is the only way this sentence can go false now.
  // So the pin is a SWEEP with a named exemption list, in this file's own spirit: it fails when the
  // app gains an animation, not when it loses one.
  it('every timed declaration in index.css is either scaled or a named functional exemption', () => {
    // The exemptions are the app's functional motion, in index.css's own words: "the .bar countdown
    // (transform:scaleX, set inline in JS) and the color flashes (.flash-*, which are state
    // feedback, not movement)". The countdown carries no stylesheet duration at all (pinned above),
    // so the flashes are the whole list. If a genuinely functional animation is ever added, ADD IT
    // HERE with a reason — do not widen the regex.
    const FUNCTIONAL = [
      'animation:flashGood .55s ease-out forwards',
      'animation:flashBad .55s ease-out forwards',
    ]
    // Every transition/animation shorthand and every -duration/-delay longhand. Comments are already
    // stripped from cssCode, so index.css's own prose about ".2s" cannot answer for a deleted rule.
    const timed = cssCode.match(/(?:transition|animation)(?:-duration|-delay)?\s*:[^;}]*/g) ?? []
    expect(
      timed.length,
      'index.css declares no timings at all — the sweep is vacuous',
    ).toBeGreaterThan(5)
    const unscaled = timed.filter(
      (d) => !d.includes('var(--motion-scale)') && !FUNCTIONAL.includes(d),
    )
    expect(
      unscaled,
      'a timed declaration in index.css ignores --motion-scale. Either multiply its duration by ' +
        'var(--motion-scale), or — if it is genuinely functional motion — add it to FUNCTIONAL above ' +
        'AND correct the guide, whose Motion paragraph currently claims nothing decorative moves.',
    ).toEqual([])
    // And the four the round actually fixed, by name, so a revert is reported as a revert rather
    // than as an unfamiliar new rule.
    for (const sel of ['.surface-button', '.surface-toggle', '.btn-solid', '.boot-d'])
      expect(
        cssCode,
        `${sel} no longer multiplies its duration by --motion-scale (round 16)`,
      ).toMatch(new RegExp(`\\${sel}\\{[^}]*var\\(--motion-scale\\)`))
  })
})
