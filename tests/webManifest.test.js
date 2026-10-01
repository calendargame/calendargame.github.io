// The PWA web app manifest's portrait lock: `orientation: 'portrait'` hard-locks every
// ANDROID install to portrait at the OS level (iOS parses + ignores the key; the in-app
// rotate-back overlay covers those platforms — see main.tsx RotateOverlay). vite-plugin-pwa
// JSON-serializes vite.config.js's exported webManifest entries as-is into the built
// dist/manifest.webmanifest (it only adds the base-derived start_url/scope + lang), so pinning
// the object + its JSON serialization here pins the built manifest without running a build —
// the appleStartupImages.test.js style: driven on the SOURCE of the shipped artifact,
// exported like swapBlockingStylesheet.
import { describe, it, expect } from 'vitest'
import { webManifest } from '../vite.config.js'

describe('PWA web manifest (vite.config.js webManifest)', () => {
  it('locks orientation to portrait — the Android half of the portrait lock', () => {
    expect(webManifest.orientation).toBe('portrait')
    // The exact byte sequence the built manifest.webmanifest ships (JSON.stringify emits
    // no spaces) — the regression pin the spec demands.
    expect(JSON.stringify(webManifest)).toContain('"orientation":"portrait"')
  })

  it('keeps standalone display — the orientation lock only binds in an installed (standalone) context', () => {
    expect(webManifest.display).toBe('standalone')
  })
})
