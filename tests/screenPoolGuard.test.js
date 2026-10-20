// tests/screenPoolGuard.test.js — EVERY SCREEN WRITE GOES THROUGH store/screenPool.
//
// The door refuses a write named with a copy of the data that is no longer live, which is what keeps
// a screen drawn for one copy from writing into another (store/screenPool says why; tests/
// screenPool.gap.dom is the race). It only works if nothing goes round it, so: the raw Best and stats
// setters of store/progress, the windows-in-sync door a round's result is filed through
// (PROGRESS_DOOR), and store/sessionRound's write and discard of one round, are named in code by these
// files and no others —
//   • store/progress (where the setters live), store/sessionRound (where the round slots live), and
//     store/screenPool (the door);
//   • src/main.tsx's crash forgetter, forgetCrashedRound: it acts for the app, not for a screen — a
//     mode that crashed has no render left to name a copy, and it discards the live copy's round;
//   • store/amnesicClose's forget: it acts for the app at a cold open, before any screen is drawn, on
//     every preset whose Amnesic value says so (PROGRESS_DOOR.forget) — no screen exists to name one.
// A new reference fails here until it is either moved behind the door or added below with the reason
// it is not a screen's write.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = join(__dirname, '..', 'src')
const files = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : []
  })
const RAW =
  /\b(setModeStats|setBlitzBest|setSuddenBest|setSuddenAmBest|setAoxBest|PROGRESS_DOOR|writeSessionRound|discardSessionRound)\b/
const code = (line) => !/^\s*(\/\/|\*|\{\/\*)/.test(line)

const ALLOWED = {
  'main.tsx': ['discardSessionRound'],
  'store/amnesicClose.ts': ['PROGRESS_DOOR'],
  'store/progress.ts': [
    'PROGRESS_DOOR',
    'setAoxBest',
    'setBlitzBest',
    'setModeStats',
    'setSuddenAmBest',
    'setSuddenBest',
  ],
  'store/screenPool.ts': [
    'PROGRESS_DOOR',
    'discardSessionRound',
    'setModeStats',
    'writeSessionRound',
  ],
  'store/sessionRound.ts': ['discardSessionRound', 'writeSessionRound'],
}

describe('every write a mode screen makes goes through store/screenPool', () => {
  it('the raw setters and round slots are named only by the stores, the door, the crash forgetter, and the close', () => {
    const found = {}
    for (const p of files(SRC)) {
      const file = relative(SRC, p).replace(/\\/g, '/')
      for (const line of readFileSync(p, 'utf8').split('\n'))
        if (code(line))
          for (const m of line.matchAll(new RegExp(RAW, 'g'))) (found[file] ??= new Set()).add(m[1])
    }
    const named = Object.fromEntries(
      Object.entries(found).map(([file, set]) => [file, [...set].sort()]),
    )
    expect(named).toEqual(ALLOWED)
  })
})
