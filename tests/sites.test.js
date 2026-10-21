// The two sites (src/sites.ts) and how each end reads the table: the build picks its site from CI's
// repository (vite.config.js siteBuiltFor), and the running app recognises its site by hostname
// (siteAtHostname — what error reporting is gated on).
import { describe, it, expect } from 'vitest'
import { LIVE_SITE, TEST_SITE, SITES, siteAtHostname } from '../src/sites.ts'
import { siteBuiltFor } from '../vite.config.js'

describe('the two sites', () => {
  it('are two origins of their own — the live domain, and the test subdomain of it', () => {
    expect(SITES).toEqual([LIVE_SITE, TEST_SITE])
    expect(LIVE_SITE.origin).toBe('https://calendargame.app')
    expect(TEST_SITE.origin).toBe('https://test.calendargame.app')
    // An origin, never an address with a path: each site is the root of its own domain.
    for (const site of SITES) expect(new URL(site.origin).origin).toBe(site.origin)
  })

  it('each tags its error reports with its own environment', () => {
    expect(LIVE_SITE.environment).toBe('production')
    expect(TEST_SITE.environment).toBe('staging')
  })
})

describe('siteBuiltFor — which site a build is for', () => {
  it('names each CI repository’s own site', () => {
    expect(siteBuiltFor('calendargame/calendargame.github.io')).toBe(LIVE_SITE)
    expect(siteBuiltFor('calendargame/test_version')).toBe(TEST_SITE)
  })

  it('makes a local build (no repository) the TEST site’s, so it can never pass for live', () => {
    expect(siteBuiltFor(undefined)).toBe(TEST_SITE)
    expect(siteBuiltFor('')).toBe(TEST_SITE)
  })

  it('refuses any other repository, by name, rather than guess a site', () => {
    expect(() => siteBuiltFor('someone/fork')).toThrow(/"someone\/fork".*neither of the two sites/)
  })
})

describe('siteAtHostname — which site a page is served from', () => {
  it('knows the two hostnames', () => {
    expect(siteAtHostname('calendargame.app')).toBe(LIVE_SITE)
    expect(siteAtHostname('test.calendargame.app')).toBe(TEST_SITE)
  })

  it('knows nothing else — a laptop, a LAN address, a tunnel, a look-alike, GitHub’s own name', () => {
    for (const hostname of [
      'localhost',
      '127.0.0.1',
      '[::1]',
      '192.168.1.20',
      'abc.trycloudflare.com',
      'www.calendargame.app',
      'calendargame.app.evil.example',
      'calendargame.github.io',
      '',
    ])
      expect(siteAtHostname(hostname)).toBeNull()
  })
})
