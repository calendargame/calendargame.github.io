// tests/engine/bestPool.test.js — engine/bestPool: the Best shown for a set-up is the best over every
// record filed for the same dates, against an independent oracle that knows only the rounds.
import { describe, it, expect } from 'vitest'
import {
  poolKeys,
  bestOfAox,
  bestOfBlitz,
  bestOfSudden,
  shownAoxBest,
  shownBlitzBest,
  shownSuddenBest,
} from '../../src/engine/bestPool.js'
import { isNewBest, SCOPED_ROUND_ID } from '../../src/engine/roundId.js'
import { mulberry32 } from '../helpers/rng.js'
import { roundMap, ROUND_ID } from '../helpers/roundScreen.js'

// One pool: the in-effect key K (Julian off, every chance Random) and three keys the builds before
// Round 26 filed the same set-up's rounds under (a Julian Chance that did nothing with Julian off).
const K = 'm60|written-mdy|random|random|random|1-10000|false'
const SAME = [
  'm60|written-mdy|random|random|25|1-10000|false',
  'm60|written-mdy|random|random|50|1-10000|false',
  'm60|written-mdy|random|random|100|1-10000|false',
]
// Not the pool: the generator fault (Julian on, 1900-2100, a Julian Chance there, Leap Year Chance
// 100%) maps to the in-effect key of its own set-up but on different dates; and other set-ups.
const FAULT = 'm60|written-mdy|100|random|50|1900-2100|true'
const FAULT_K = 'm60|written-mdy|100|random|random|1900-2100|true'
const OTHER = [
  'm60|written-mdy|random|random|random|1-9999|false',
  'n60|written-mdy|random|random|random|1-10000|false',
  'garbage',
]

describe('poolKeys', () => {
  it('K itself, and every key that maps to K on the same dates — nothing else', () => {
    const map = Object.fromEntries([K, ...SAME, FAULT, ...OTHER].map((k) => [k, {}]))
    expect(poolKeys(map, K).sort()).toEqual([K, ...SAME].sort())
    expect(poolKeys(map, FAULT_K)).toEqual([]) // the faulty pool is never shown under its corrected key
    expect(poolKeys(map, FAULT)).toEqual([FAULT]) // (an older build, keyed on it, sees its own record)
  })
})

describe('bestOfBlitz against the oracle', () => {
  it('shown = the best any round in the pool reached, held by the earliest round to reach it, with that round’s other number', () => {
    const rnd = mulberry32(7)
    for (let trial = 0; trial < 300; trial++) {
      const keys = [K, ...SAME, FAULT, OTHER[0]]
      const filed = roundMap('blitzBest')
      const rounds = []
      let id = 1000
      const n = 1 + Math.floor(rnd() * 25)
      for (let i = 0; i < n; i++) {
        const key = keys[Math.floor(rnd() * keys.length)]
        const good = Math.floor(rnd() * 6)
        const best = Math.min(good, Math.floor(rnd() * 6))
        id += 1 + Math.floor(rnd() * 3)
        rounds.push({ key, id: ROUND_ID(id), good, best })
        filed.file(key, ROUND_ID(id), { score: good, streak: best })
      }
      const pool = rounds.filter((r) => r.key === K || SAME.includes(r.key))
      const shown = shownBlitzBest(filed.map(), K)
      const scored = pool.filter((r) => r.good > 0 || r.best > 0)
      if (scored.length === 0) {
        expect(shown).toBe(undefined)
        continue
      }
      const topScore = Math.max(...pool.map((r) => r.good))
      const topStreak = Math.max(...pool.map((r) => r.best))
      // The earliest round to reach each top value; a value of 0 is held by nobody (no record).
      const scoreHolder = topScore > 0 ? pool.find((r) => r.good === topScore) : null
      const streakHolder = topStreak > 0 ? pool.find((r) => r.best === topStreak) : null
      expect(shown.score).toBe(topScore)
      expect(shown.scoreRoundId).toBe(scoreHolder ? scoreHolder.id : null)
      if (scoreHolder) expect(shown.scoreStreak).toBe(scoreHolder.best)
      expect(shown.streak).toBe(topStreak)
      expect(shown.streakRoundId).toBe(streakHolder ? streakHolder.id : null)
      if (streakHolder) expect(shown.streakScore).toBe(streakHolder.good)
    }
  })
  it('a tie goes to the earlier round: a lower clock id; an id that is not a clock’s before any; none first', () => {
    const scoped = {
      score: 9,
      scoreStreak: 1,
      scoreRoundId: SCOPED_ROUND_ID + 5,
      streak: 2,
      streakScore: 9,
      streakRoundId: SCOPED_ROUND_ID + 5,
    }
    const clock = { ...scoped, scoreStreak: 2, scoreRoundId: 30, streakRoundId: 30 }
    for (const order of [
      [scoped, clock],
      [clock, scoped],
    ])
      expect(bestOfBlitz(order)).toEqual(scoped)

    const a = {
      score: 9,
      scoreStreak: 4,
      scoreRoundId: 50,
      streak: 2,
      streakScore: 1,
      streakRoundId: 50,
    }
    const b = {
      score: 9,
      scoreStreak: 7,
      scoreRoundId: 20,
      streak: 2,
      streakScore: 3,
      streakRoundId: null,
    }
    for (const order of [
      [a, b],
      [b, a],
    ])
      expect(bestOfBlitz(order)).toEqual({
        score: 9,
        scoreStreak: 7,
        scoreRoundId: 20,
        streak: 2,
        streakScore: 3,
        streakRoundId: null,
      })
  })
  it('a record from before Round 26 brings "not recorded" for its companion, never a guess', () => {
    const old = { score: 12, scoreRoundId: 3, streak: 5, streakRoundId: 4 }
    expect(bestOfBlitz([old])).toEqual({
      score: 12,
      scoreStreak: null,
      scoreRoundId: 3,
      streak: 5,
      streakScore: null,
      streakRoundId: 4,
    })
  })
})

describe('bestOfAox against the oracle', () => {
  it('per metric the fastest at display precision, the earliest run to reach it, with its companion', () => {
    const rnd = mulberry32(11)
    const head = (k) => k.replace(/^m60/, '10|false')
    const kK = head(K)
    const keys = [K, ...SAME, FAULT].map(head)
    for (let trial = 0; trial < 300; trial++) {
      const filed = roundMap('aoxBest')
      const runs = []
      let id = 5000
      const n = 1 + Math.floor(rnd() * 20)
      for (let i = 0; i < n; i++) {
        const key = keys[Math.floor(rnd() * keys.length)]
        const avg = (150 + Math.floor(rnd() * 20)) / 100
        const med = (150 + Math.floor(rnd() * 20)) / 100
        id += 1 + Math.floor(rnd() * 3)
        runs.push({ key, id: ROUND_ID(id), avg, med })
        filed.file(key, ROUND_ID(id), { avg, med })
      }
      const pool = runs.filter((r) => r.key !== head(FAULT))
      const shown = shownAoxBest(filed.map(), kK)
      if (pool.length === 0) {
        expect(shown).toBe(undefined)
        continue
      }
      const fastAvg = Math.min(...pool.map((r) => r.avg))
      const fastMed = Math.min(...pool.map((r) => r.med))
      const avgHolder = pool.find((r) => r.avg === fastAvg)
      const medHolder = pool.find((r) => r.med === fastMed)
      expect(shown).toEqual({
        avg: fastAvg,
        avgMed: avgHolder.med,
        avgRoundId: avgHolder.id,
        med: fastMed,
        medAvg: medHolder.avg,
        medRoundId: medHolder.id,
      })
    }
  })
  it('a record holding only one metric leaves the other to whoever holds it', () => {
    const avgOnly = {
      avg: 2,
      avgMed: 2.5,
      avgRoundId: 9,
      med: null,
      medAvg: null,
      medRoundId: null,
    }
    const both = { avg: 3, avgMed: 3, avgRoundId: 4, med: 1.5, medAvg: 3, medRoundId: 4 }
    expect(bestOfAox([avgOnly, both])).toEqual({
      avg: 2,
      avgMed: 2.5,
      avgRoundId: 9,
      med: 1.5,
      medAvg: 3,
      medRoundId: 4,
    })
    expect(bestOfAox([])).toBe(undefined)
  })
})

describe('bestOfSudden', () => {
  it('the highest score, the earliest round on a tie', () => {
    const filed = roundMap('suddenBest')
    for (const [key, good, id] of [
      [K, 4, 30],
      [SAME[0], 6, 31],
      [SAME[1], 6, 12],
      [FAULT, 9, 40],
    ])
      filed.file(key, ROUND_ID(id), { score: good })
    expect(shownSuddenBest(filed.map(), K)).toEqual({ score: 6, roundId: ROUND_ID(12) })
    expect(bestOfSudden([])).toBe(undefined)
  })
})

describe('the door', () => {
  it('K’s own record can be lower than what is shown, and the ★ follows the shown holder only', () => {
    const legacy = {
      score: 10,
      scoreStreak: 4,
      scoreRoundId: 7,
      streak: 4,
      streakScore: 10,
      streakRoundId: 7,
    }
    const filed = roundMap('blitzBest')
    const mapNow = () => ({ [SAME[1]]: legacy, ...filed.map() })
    // A new round beats K's own (absent) record, but not the legacy one.
    filed.file(K, ROUND_ID(900), { score: 8, streak: 3 })
    const shown = shownBlitzBest(mapNow(), K)
    expect(mapNow()[K].score).toBe(8)
    expect(shown.score).toBe(10)
    expect(isNewBest(shown.scoreRoundId, ROUND_ID(900))).toBe(false) // no ★: not the pool's Best
    // Only a round that beats the whole pool lights it.
    filed.file(K, ROUND_ID(901), { score: 11, streak: 2 })
    expect(isNewBest(shownBlitzBest(mapNow(), K).scoreRoundId, ROUND_ID(901))).toBe(true)
  })
  it('the same map and key give the same answer object; a new map is read afresh', () => {
    const map = {
      [K]: {
        score: 1,
        scoreStreak: 1,
        scoreRoundId: 1,
        streak: 1,
        streakScore: 1,
        streakRoundId: 1,
      },
    }
    expect(shownBlitzBest(map, K)).toBe(shownBlitzBest(map, K))
    const next = {
      ...map,
      [SAME[0]]: {
        score: 5,
        scoreStreak: 0,
        scoreRoundId: 2,
        streak: 0,
        streakScore: null,
        streakRoundId: null,
      },
    }
    expect(shownBlitzBest(next, K).score).toBe(5)
    expect(shownBlitzBest(map, K).score).toBe(1)
  })
})
