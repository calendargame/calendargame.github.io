// @vitest-environment jsdom
//
// bootTheme.dom — index.html's PRE-REACT THEME SCRIPT, run for real against seeded storage.
//
// WHAT THAT SCRIPT IS FOR. It paints the saved theme onto <html> before React exists, so the first
// frame is already the right colour; without it the app flashes the OS default and then repaints.
// It is the one piece of app logic that cannot import anything — it runs while the module graph is
// still a <script src> the parser has not reached — so it carries its OWN copy of two facts that
// live in TypeScript elsewhere: how the settings store resolves a theme, and how store/presets
// composes a per-preset localStorage key.
//
// ★ WHY THE FILE EXISTS NOW. Settings PRESETS made the theme per-preset (the owner was explicit
// that not even the theme stays global), so the script can no longer read one fixed key — it has to
// resolve the ACTIVE preset first. That is a duplicated `presetKey`, and a duplicate with no test
// is a drift waiting to happen: the failure would be silent, cosmetic, and only on the boot of a
// device that is not on preset 1. So every case below composes its seed key by CALLING the real
// `presetKey`, and then asks the real script what it painted. If either side changes alone, these
// fail.
//
// ⚠ THE SCRIPT IS EXTRACTED FROM THE SHIPPED index.html, not copied here. A copy would pass
// forever while the file it is supposed to be guarding said something else.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { presetKey, PRESET_STORE_KEYS } from '../src/store/presets.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const html = readFileSync(join(root, 'index.html'), 'utf8')

// The inline boot script, picked out by the one thing only it does. index.html holds a second
// inline script (the rAF that stamps __bootShownAt), so "the first <script>" would be a coin flip
// the day someone reorders the head.
const bootScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1])
  .find((s) => s.includes('data-theme'))

// Run it exactly as the parser would. It reads window.matchMedia and localStorage, and writes
// <html>'s data-theme + background and the theme-color meta.
const runBootScript = () => new Function(bootScript)()

// The OS preference the script branches on. tests/setup/dom installs a matches:false stub; these
// cases need both answers, so they install their own and put the stub back afterwards.
const setSystemDark = (dark) => {
  window.matchMedia = (query) => ({
    matches: dark,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })
}

// A settings payload in the shape the store persists it, seeded at the key the REAL key math says
// belongs to that preset.
const seedSettings = (presetId, state) =>
  localStorage.setItem(
    presetKey(PRESET_STORE_KEYS.settings, presetId),
    JSON.stringify({ state, version: 1 }),
  )

// The registry, at its own global key — deliberately NOT run through presetKey, because the
// registry is the thing that says which preset you are on and is never namespaced.
const seedRegistry = (activeId, presets, openInPreset = 'last') =>
  localStorage.setItem(
    'cg-presets-v1',
    JSON.stringify({
      state: {
        presets: (presets ?? [1, activeId]).map((id) => ({ id, name: `Preset ${id}` })),
        activeId,
        nextId: activeId + 1,
        openInPreset,
      },
      version: 1,
    }),
  )

const painted = () => document.documentElement.getAttribute('data-theme')

const originalMatchMedia = window.matchMedia

describe('index.html boot theme script', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.style.background = ''
    document.head.innerHTML = '<meta name="theme-color" content="#0d1117">'
    setSystemDark(false)
  })
  afterEach(() => {
    window.matchMedia = originalMatchMedia
  })

  it('was actually found in the shipped index.html (the extraction cannot go blind)', () => {
    expect(bootScript).toBeTruthy()
    expect(bootScript).toContain('cg-settings-v1')
    expect(bootScript).toContain('cg-presets-v1') // it resolves the active preset
  })

  // ── Nothing saved, or nothing readable ──────────────────────────────────────────────────────

  it('falls back to the OS default when nothing is saved at all', () => {
    runBootScript()
    expect(painted()).toBe('light')
    setSystemDark(true)
    runBootScript()
    expect(painted()).toBe('dusk')
  })

  // ★★ THE "PRESET 1 IS THE DATA" PATH, and it is the one nearly every device is on: no registry
  // has ever been written (persist only writes on a set, and one preset says nothing a default
  // could not), so the script reads the bare base key exactly as it always did.
  it('reads the un-namespaced key when there is no registry — the untouched-device path', () => {
    seedSettings(1, { useSystem: false, manualTheme: 'nebula' })
    runBootScript()
    expect(painted()).toBe('nebula')
  })

  it('resolves useSystem against the OS, per preset', () => {
    seedSettings(1, { useSystem: true, darkTheme: 'midnight', lightTheme: 'parchment' })
    runBootScript()
    expect(painted()).toBe('parchment')
    setSystemDark(true)
    runBootScript()
    expect(painted()).toBe('midnight')
  })

  // ── The preset resolution ───────────────────────────────────────────────────────────────────

  // ★★ THE REGRESSION THIS FILE EXISTS FOR. Before the theme went per-preset the script read one
  // fixed key; left that way, a player sitting on preset 3 would boot into PRESET 1's theme every
  // time and watch it repaint the moment React mounted — the exact flash the script exists to
  // prevent, reintroduced by the presets work.
  it('paints the ACTIVE preset’s theme, not preset 1’s', () => {
    seedSettings(1, { useSystem: false, manualTheme: 'parchment' })
    seedSettings(3, { useSystem: false, manualTheme: 'midnight' })
    seedRegistry(3)
    runBootScript()
    expect(painted()).toBe('midnight')
  })

  // The identity `presetKey(base, 1) === base` seen from the outside: a registry that says preset 1
  // must land on the very same key as no registry at all.
  it('an explicit activeId of 1 reads the same key as no registry at all', () => {
    seedSettings(1, { useSystem: false, manualTheme: 'nebula' })
    seedRegistry(1, [1])
    runBootScript()
    expect(painted()).toBe('nebula')
  })

  // ★ THE "OPEN IN" PIN (round-21 Q3). The script resolves it the same way store/presets' hydrate
  // `merge` does, so the first painted frame already wears the pinned preset's theme — otherwise
  // it would paint the last-active preset's and App's hydrate would repaint a frame later.
  it('paints the PINNED preset’s theme when openInPreset names a live preset', () => {
    seedSettings(1, { useSystem: false, manualTheme: 'parchment' })
    seedSettings(2, { useSystem: false, manualTheme: 'nebula' })
    seedRegistry(1, [1, 2], 2) // active is 1, but the pin says open in 2
    runBootScript()
    expect(painted()).toBe('nebula')
  })

  it('ignores an openInPreset that names no preset and uses the persisted activeId', () => {
    seedSettings(1, { useSystem: false, manualTheme: 'parchment' })
    seedSettings(2, { useSystem: false, manualTheme: 'nebula' })
    seedRegistry(2, [1, 2], 9) // pin is a dead id → fall back to activeId 2
    runBootScript()
    expect(painted()).toBe('nebula')
  })

  it('treats openInPreset "last" as no pin at all', () => {
    seedSettings(1, { useSystem: false, manualTheme: 'parchment' })
    seedSettings(2, { useSystem: false, manualTheme: 'nebula' })
    seedRegistry(2, [1, 2], 'last')
    runBootScript()
    expect(painted()).toBe('nebula')
  })

  it('follows the active preset across a range of ids', () => {
    for (const id of [2, 3, 7, 42]) {
      seedSettings(id, { useSystem: false, manualTheme: 'midnight' })
      seedRegistry(id)
      document.documentElement.removeAttribute('data-theme')
      runBootScript()
      expect(painted(), `preset ${id}`).toBe('midnight')
    }
  })

  // ── Storage that lies ───────────────────────────────────────────────────────────────────────

  // An unreadable registry leaves the script on preset 1, which is the honest guess: it is where
  // every device starts and where an ignorant build looks. store/presets' normalizeRegistry repairs
  // the registry itself moments later and App's theme effect repaints.
  it('a corrupt registry falls back to preset 1 rather than throwing', () => {
    seedSettings(1, { useSystem: false, manualTheme: 'nebula' })
    localStorage.setItem('cg-presets-v1', '{"state":{"activeId":')
    expect(() => runBootScript()).not.toThrow()
    expect(painted()).toBe('nebula')
  })

  // An activeId naming a preset with no saved settings is not an error — a preset that has never
  // been opened has nothing on disk. The OS default is the same landing a missing payload has
  // always had.
  it('an active preset with nothing saved lands on the OS default', () => {
    seedSettings(1, { useSystem: false, manualTheme: 'nebula' })
    seedRegistry(4)
    runBootScript()
    expect(painted()).toBe('light')
  })

  it('a truncated settings payload for the active preset lands on the OS default', () => {
    seedRegistry(2)
    localStorage.setItem(presetKey(PRESET_STORE_KEYS.settings, 2), '{"state":{"manual')
    expect(() => runBootScript()).not.toThrow()
    expect(painted()).toBe('light')
  })

  // ── What else the first frame gets ──────────────────────────────────────────────────────────

  // The toolbar colour and the document canvas are stamped from the SAME resolved theme, so a
  // preset switch that changes the theme cannot leave either at preset 1's colour on the first
  // frame. (The map itself mirrors each theme's --tc in src/index.css; that pairing is a separate
  // subject and is not what this case is asserting.)
  it('stamps the toolbar colour and the html background from the active preset’s theme', () => {
    seedSettings(2, { useSystem: false, manualTheme: 'parchment' })
    seedRegistry(2)
    runBootScript()
    expect(document.querySelector("meta[name='theme-color']").content).toBe('#f0e8d5')
    expect(document.documentElement.style.background).toContain('240, 232, 213')
  })
})
