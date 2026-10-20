// tests/hydrationReportGuard.test.js — EVERY SAVED STORE REPORTS A LOAD THAT THREW.
//
// zustand's `persist` swallows whatever a store's load throws unless the store hands it an
// `onRehydrateStorage` callback (store/hydrationReport says why it matters, and how it went unseen
// once). So every `persist(` in src must name `reportedHydration` - a new store that does not fails
// here.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = join(__dirname, '..', 'src')
const files = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : []
  })
const code = (text) =>
  text
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')

describe('every persisted store reports a load that threw', () => {
  it('each file has as many reportedHydration( as persist( calls', () => {
    const off = {}
    let stores = 0
    for (const p of files(SRC)) {
      const text = code(readFileSync(p, 'utf8'))
      const persists = (text.match(/\bpersist\(/g) ?? []).length
      if (persists === 0) continue
      stores += persists
      const reported = (text.match(/onRehydrateStorage: reportedHydration[<(]/g) ?? []).length
      if (reported !== persists) off[relative(SRC, p).replace(/\\/g, '/')] = { persists, reported }
    }
    expect(off).toEqual({})
    expect(stores).toBeGreaterThanOrEqual(7) // (the guard is looking at the stores at all)
  })
})
