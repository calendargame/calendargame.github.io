// writeCounts — WHAT EACH WINDOW WRITES, COUNTED IN A REAL BROWSER (design-q1-q2.md v4, 13.3 and G7).
// Three windows of this build on one device, then a window of the older build beside them
// (support/oldSite). Every write and removal each page makes to localStorage is logged from the first
// line of its code, so a write nobody asked for cannot hide in a test that only looks at the screen.
//   • G7: a page load writes nothing - with named exceptions, all on a device's FIRST open: Q7's
//     Julian-on Year Range pin (once per preset), the measurement of how much room the device gives
//     (store/storageUsage), and the two update stamps (lib/buildStamp, src/changelog) a first visit
//     has none of. A second window's load writes nothing at all. (A cold open after a close that
//     FORGETS - a preset on Amnesic: Stats Only or Full - writes that forget and the session counter:
//     store/amnesicClose, tests/browser/amnesicClose. A close that owes none writes nothing.)
//   • An answer: one write of the doc and one of its sync key, in the window that answered; nothing
//     in the others.
//   • An older window's write, with this build's windows awake: written back, by each window at most
//     ONCE, and then nothing more. (⚠ 13.3 predicted ONE write-back in all, "the second window sees
//     the stamped result". In a real browser the windows hear the older write at the same moment, in
//     their own processes, and each merges and writes before the others' write-backs reach it: in
//     the runs made, one per window, in both engines. They agree, so nothing follows. Recorded as a
//     finding: round26/part2-issues.md #13.)
import type { Page } from '@playwright/test'
import {
  test,
  expect,
  openApp,
  openSecondWindow,
  openOlderWindow,
  answerRight,
  answerRightOld,
} from './support/app'

// (runs at the start of every document in the context: the log is the page's own)
const COUNT = () => {
  const log: string[] = []
  ;(window as unknown as { __writes: string[] }).__writes = log
  const proto = Storage.prototype
  const setItem = proto.setItem
  const removeItem = proto.removeItem
  proto.setItem = function (key: string, value: string) {
    if (this === window.localStorage) log.push(`set ${key}`)
    return setItem.call(this, key, value)
  }
  proto.removeItem = function (key: string) {
    if (this === window.localStorage) log.push(`remove ${key}`)
    return removeItem.call(this, key)
  }
}
type Logged = { __writes: string[] }
const writes = (p: Page) => p.evaluate(() => (window as unknown as Logged).__writes.slice())
const forget = (p: Page) =>
  p.evaluate(() => void ((window as unknown as Logged).__writes.length = 0))
const keysOf = (log: string[]) =>
  [...new Set(log.map((w) => w.replace(/^(set|remove) /, '')))].sort()
const score = (p: Page) => p.locator('.panel:visible [data-statval]').first()
const AN_ANSWER = ['set cg-progress-v1', 'set cg-sync-v1|cg-progress-v1']

test('a load writes only its named first-open keys, a second window’s load nothing, and an answer one doc and its key', async ({
  page,
  context,
}) => {
  await context.addInitScript(COUNT)
  await openApp(page) // an empty device: its first open
  expect(keysOf(await writes(page))).toEqual(
    [
      'cg-julianrange-v1', // Q7's pin…
      'cg-sync-v1|cg-julianrange-v1', // …through the door, with its sync key
      'cg-storage-probe', // the measurement's scratch key, written and removed
      'cg-storage-limit-v1', // …and what it found
      'cg-last-build', // the update stamps a first visit has none of
      'cg-changelog-seen',
    ].sort(),
  )
  const second = await openSecondWindow(context)
  const third = await openSecondWindow(context)
  expect(await writes(second)).toEqual([])
  expect(await writes(third)).toEqual([])
  await forget(page)
  await answerRight(page)
  await expect(score(second)).toHaveText('1/1')
  await expect(score(third)).toHaveText('1/1')
  expect(await writes(page)).toEqual(AN_ANSWER)
  expect(await writes(second)).toEqual([])
  expect(await writes(third)).toEqual([])
})

test('an older window’s write is written back, at most once by each window awake, and then nothing more', async ({
  page,
  context,
}) => {
  await context.addInitScript(COUNT)
  await openApp(page)
  await answerRight(page)
  const windows = [page, await openSecondWindow(context), await openSecondWindow(context)]
  const old = await openOlderWindow(context)
  await expect(score(old)).toHaveText('1/1')
  for (const p of windows) await forget(p)
  await forget(old)
  await answerRightOld(old)
  expect(await writes(old)).toEqual(['set cg-progress-v1'])
  for (const p of windows) await expect(score(p)).toHaveText('2/2')
  // At least one window wrote the merge back - the doc, then its key - and none more than once. (A
  // window that hears another's write-back before it has written its own finds nothing to write.)
  const ONCE_OR_NOT = [[], AN_ANSWER]
  await expect
    .poll(async () => (await Promise.all(windows.map(writes))).filter((w) => w.length).length)
    .toBeGreaterThan(0)
  // …and nothing after it: one more answer here, seen in the other two, and each window's writes are
  // its write-back (or none) and, here, that answer.
  await page.getByRole('button', { name: 'New', exact: true }).and(page.locator(':visible')).click()
  await expect(async () => {
    await answerRight(page)
    await expect(score(page)).toHaveText('3/3', { timeout: 500 })
  }).toPass()
  for (const p of windows.slice(1)) await expect(score(p)).toHaveText('3/3')
  const mine = await writes(page)
  expect(ONCE_OR_NOT).toContainEqual(mine.slice(0, -AN_ANSWER.length))
  expect(mine.slice(-AN_ANSWER.length)).toEqual(AN_ANSWER)
  for (const p of windows.slice(1)) expect(ONCE_OR_NOT).toContainEqual(await writes(p))
  expect(await writes(old)).toEqual(['set cg-progress-v1'])
})
