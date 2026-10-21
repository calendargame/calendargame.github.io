// scripts/sentryRelease.mjs — the release error reports name, and when a build uploads its source
// maps (and refuses to build when it must and cannot). git is injected, so nothing here runs a process.
import { describe, it, expect } from 'vitest'
import {
  DEV_RELEASE,
  GIT_COMMIT_ARGS,
  readCommit,
  releaseName,
  sentryUploadPlan,
  uploadFailure,
} from '../scripts/sentryRelease.mjs'

const SHA = '790a328f1c2b3d4e5f60718293a4b5c6d7e8f901'

describe('the release name', () => {
  it('is the version the owner reads in the app, and the commit that makes it exact', () => {
    expect(releaseName('2.30.3', SHA)).toBe('calendar-game@2.30.3+790a328f1c2b')
  })

  it('differs for two commits that carry one version (each site refuses only its own numbers)', () => {
    expect(releaseName('2.31.0', SHA)).not.toBe(
      releaseName('2.31.0', '0123456789abcdef0123456789abcdef01234567'),
    )
  })

  it('is never mistaken for a build outside `vite build`', () => {
    expect(DEV_RELEASE).toBe('calendar-game@dev')
  })
})

describe('readCommit', () => {
  it('asks git for HEAD, and returns the 40-digit commit', () => {
    const asked = []
    expect(readCommit((args) => (asked.push(args), `${SHA}\n`))).toBe(SHA)
    expect(asked).toEqual([GIT_COMMIT_ARGS])
    expect(GIT_COMMIT_ARGS).toEqual(['rev-parse', 'HEAD'])
  })

  it('throws, by name, rather than invent one', () => {
    expect(() =>
      readCommit(() => {
        throw new Error('not a git repository')
      }),
    ).toThrow(/sentry-release: could not run git.*not a git repository/)
    expect(() => readCommit(() => 'HEAD\n')).toThrow(/sentry-release: .* not a commit/)
  })
})

describe('sentryUploadPlan — does this build upload its source maps?', () => {
  it('a deploy build (GitHub Actions) with the token: yes', () => {
    expect(sentryUploadPlan({ command: 'build', githubActions: 'true', token: 'sntrys_x' })).toBe(
      true,
    )
  })

  it('a deploy build WITHOUT the token: it refuses to build, and says how to fix it', () => {
    for (const token of [undefined, ''])
      expect(() => sentryUploadPlan({ command: 'build', githubActions: 'true', token })).toThrow(
        /sentry-upload: .*SENTRY_AUTH_TOKEN is not set.*Nothing has been published.*Build the site/,
      )
  })

  it('a laptop’s build: never, token or not — it is not a deploy', () => {
    for (const token of [undefined, 'sntrys_x'])
      expect(sentryUploadPlan({ command: 'build', githubActions: undefined, token })).toBe(false)
  })

  it('dev, Vitest, and `vite preview` (not a build): never, and never a throw — even in CI', () => {
    expect(sentryUploadPlan({ command: 'serve', githubActions: 'true', token: undefined })).toBe(
      false,
    )
  })
})

describe('uploadFailure', () => {
  it('stops the build saying what failed, that nothing shipped, and what to do', () => {
    const failure = uploadFailure(new Error('API request failed (http status: 401)'))
    expect(failure).toBeInstanceOf(Error)
    expect(failure.message).toMatch(/^sentry-upload: the source-map upload to Sentry failed/)
    expect(failure.message).toContain('Nothing has been published and no version is spent')
    expect(failure.message).toContain("'Re-run failed jobs'")
    expect(failure.message).toMatch(/What Sentry said: API request failed \(http status: 401\)$/)
    expect(uploadFailure('odd').message).toMatch(/What Sentry said: odd$/)
  })
})
