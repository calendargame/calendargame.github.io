// @vitest-environment jsdom
//
// tests/designTrials.dom.test.jsx — ⚠ TEMPORARY, with lib/designTrials (which lists everything that
// goes once the owner has picked). What is pinned: the trials are offered on the test site and a dev
// server and NOWHERE ELSE — above all not on the live site — and a pick is on <html> at once and
// kept on the device.
import { describe, it, expect, beforeEach } from 'vitest'
import { trialsOffered, setTrial, TRIALS_KEY } from '../src/lib/designTrials'

describe('lib/designTrials', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.trialStats
    delete document.documentElement.dataset.trialX
  })

  it('is offered on the test site and a dev server only', () => {
    expect(trialsOffered('test.calendargame.app', 'production')).toBe(true)
    expect(trialsOffered('localhost', 'development')).toBe(true)
    expect(trialsOffered('calendargame.app', 'production')).toBe(false)
    expect(trialsOffered('127.0.0.1', 'production')).toBe(false) // the browser lane's build
    expect(trialsOffered('localhost', 'test')).toBe(false) // this suite
  })

  it('puts a pick on <html> at once, and keeps it on the device', () => {
    setTrial('statsFrame', 'c')
    setTrial('deleteX', 'plain')
    expect(document.documentElement.dataset.trialStats).toBe('c')
    expect(document.documentElement.dataset.trialX).toBe('plain')
    expect(JSON.parse(localStorage.getItem(TRIALS_KEY))).toEqual({
      statsFrame: 'c',
      deleteX: 'plain',
    })
  })
})
