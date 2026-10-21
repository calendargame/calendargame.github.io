// THE ⚙ MENU'S PINNED FOOT — three information lines (Round 26): Contact; Storage used; Last Updated
// with Check for updates at the right — and Changelog at the right end of the Contact line when
// that whole line fits, else of the Storage used line (after v2.30.2, the owner's ruling; components/
// SettingsPanel's changelogOnContact measures it). components/controlClasses' FOOTER_META_ROW_CLASS
// says how the two-item lines are built; this is where they are measured.
//   • At EVERY window from 320 to 460 wide and 568 to 956 tall: nothing runs out of the foot, the
//     items of a line share one line box (same top, same height, the line exactly as tall as them),
//     the first item is hard left and a pair's last hard right, the gaps between the foot's lines
//     are all equal — including a line a pair has had to break onto — and Changelog is on the
//     Contact line exactly when that line, laid out whole, fits the foot with a pixel to spare.
//   • At every PHONE size: each pair is on ONE line, so the foot is exactly three lines — at an
//     iPhone's size in the iPhone's width of font too (below), and in a wide font (Verdana, or
//     DejaVu Sans where there is no Verdana) at every phone size.
// Round 25's foot broke Changelog onto a line of its own on the owner's 430-wide iPhone, 12.7px
// below the line above where every other line sat 2.1px apart; both halves of that are pinned here.
//
// ★ RUN TWICE: AS IT IS, AND IN THE IPHONE'S WIDTH OF FONT. The iPhone's system font sets these
// words wider than the Windows laptop's (Round 25 measured ~7.5%), so "it fits here" is not "it
// fits on his phone". The second run raises the foot's font size — rem-relative, so it still
// scales with the window — until the foot's words are as wide as a tenth over the laptop's
// (IPHONE_EM: a margin on the 7.5%), and never lowers it.
// ⚠ A FACTOR, NOT A FIXED TENTH, because the machines differ. The Linux CI runner's font is already
// wider than the laptop's, and a tenth on top of IT stood for no phone at all: Round 26's first
// test-site run broke the stamp's line at 360×800 that way. Measured against the laptop's widths,
// the second run means the same font width on every machine — and where a machine's own font is
// already wider, it is simply that font.
// ⚠ AND THE IPHONE'S WIDTH ONLY AT AN IPHONE'S SIZE in the phone sweep. An Android phone sets these
// words in its own font (Roboto, about as wide as the laptop's); the lane's own font stands in for
// it. The full sweep makes both runs at every window: there a break is allowed, and only its look
// is held.
//
// ⚠ WHERE A PAIR MAY BREAK. Only in a window narrower than any phone and as tall as one (an iPad's
// 320px Slide Over): the root size that height gives cannot fit "Last Updated: …" beside "Check for
// updates" there. The line then breaks, the second item stays at the right, and the gap stays the
// foot's own — which the first half of the sweep holds it to.
import {
  test,
  expect,
  openApp,
  openSettings,
  resizeTo,
  appReady,
  textRectOf,
  rectOf,
  SAME_PX,
  THEMES,
  settled,
  type Rect,
} from './support/app'
import type { Locator, Page } from '@playwright/test'

const WIDTHS = Array.from({ length: 15 }, (_, i) => 320 + i * 10)
const HEIGHTS = [568, 640, 700, 760, 820, 880, 956]
// Phones in use (CSS pixels): the narrowest iPhone and every current one, and the common Androids.
const IPHONES: [number, number][] = [
  [320, 568],
  [375, 667],
  [375, 812],
  [390, 844],
  [393, 852],
  [402, 874],
  [414, 896],
  [428, 926],
  [430, 932],
  [440, 956],
]
const ANDROIDS: [number, number][] = [
  [360, 640],
  [360, 740],
  [360, 800],
  [412, 915],
]
// The foot's stamp line, "Last Updated: 10/16/2026 00:18" and "Check for updates", in ems of the
// foot's font: 14.29 and 8.84 as the Windows laptop's WebKit sets them (Round 26; its Chromium,
// 14.07 and 8.72), a tenth wider for the iPhone. The stand-in for the iPhone's font is "these words
// this wide", whatever font the machine has.
const IPHONE_EM = (14.29 + 8.84) * 1.1
const IPHONE_WORDS = 'Last Updated: 10/16/2026 00:18Check for updates'
/** How much larger the foot's font must be set for its words to be as wide as an iPhone sets
 *  them — never smaller than the machine's own (1). */
const iphoneFactor = (foot: Locator) =>
  foot.evaluate(
    (el, { words, target }) => {
      const probe = document.createElement('span')
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-size:100px'
      probe.textContent = words
      el.appendChild(probe)
      const em = probe.getBoundingClientRect().width / 100
      probe.remove()
      return Math.max(1, target / em)
    },
    { words: IPHONE_WORDS, target: IPHONE_EM },
  )
const runs = async (foot: Locator) => [1, await iphoneFactor(foot)]
/** Set the foot's text `factor` times its size (1: as it is), and let the page follow — the
 *  Changelog fit included, which a change of the foot's size calls again. */
async function setFactor(foot: Locator, factor: number) {
  await foot.evaluate((el: HTMLElement, factor) => {
    el.style.fontSize = factor === 1 ? '' : `calc(0.6875rem * ${factor})`
  }, factor)
  await settled(foot.page())
}
// A font wider than any phone's: Verdana where the machine has it, DejaVu Sans (the Linux runner's
// own) where it does not.
const WIDE_FONT = 'Verdana, "DejaVu Sans", sans-serif'
const FONTS = [null, WIDE_FONT] as const
async function forceFont(page: Page, font: string | null) {
  if (font) await page.addStyleTag({ content: `html{font-family:${font} !important}` })
}
// The room the Contact line must have left for Changelog to join it (SettingsPanel's
// FOOT_FIT_SAFETY_PX): a line that fits only to a fraction of a pixel is not the line it joins.
const SAFETY_PX = 1
const named = (width: number, height: number, factor: number) =>
  `at ${width}×${height}${factor === 1 ? '' : `, text ×${factor.toFixed(3)} (an iPhone's width)`}`
// Two boxes laid out on one line can differ by the browsers' grain; a line is a line within this.
const LINE_PX = 0.5

interface Foot {
  content: { left: number; right: number }
  /** Each of the foot's lines as laid out: its own box, and the boxes of the items in it. */
  lines: { box: Rect; items: Rect[] }[]
}

const measure = (foot: Locator): Promise<Foot> =>
  foot.evaluate((el) => {
    // An item's place is its box less its side padding: a link's px-1 (the press-drag ring's room)
    // is cancelled by an equal -mx-1, so what is left is where its text sits in the flow.
    const box = (e: Element) => {
      const r = e.getBoundingClientRect()
      const { top, bottom, height } = r
      const cs = getComputedStyle(e)
      const left = r.left + parseFloat(cs.paddingLeft)
      const right = r.right - parseFloat(cs.paddingRight)
      return { left, top, right, bottom, width: right - left, height }
    }
    const s = getComputedStyle(el)
    const outer = el.getBoundingClientRect()
    return {
      content: {
        left: outer.left + parseFloat(s.paddingLeft),
        right: outer.right - parseFloat(s.paddingRight),
      },
      // Every line is a flex row, and its items are its children: two, or Storage used alone.
      lines: [...el.children].map((line) => ({
        box: box(line),
        items: [...line.children].map(box),
      })),
    }
  })

/**
 * Where Changelog is (the foot line it is in: 1 Contact, 2 Storage used), and whether the Contact
 * line would fit with it: a copy of the Contact item and of the link, laid out whole in a copy of a
 * two-item line (the stamp's line's own classes, at its widest), against the foot's content width.
 */
const changelogPlace = (foot: Locator) =>
  foot.evaluate((el, safety) => {
    const link = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('Changelog'),
    )!
    const line = [...el.children].indexOf(link.parentElement!) + 1
    const probe = document.createElement('div')
    probe.className = el.children[2].className
    probe.style.cssText = 'position:absolute;visibility:hidden;width:max-content'
    probe.append(el.children[0].firstElementChild!.cloneNode(true), link.cloneNode(true))
    el.append(probe)
    const need = probe.getBoundingClientRect().width
    probe.remove()
    const s = getComputedStyle(el)
    const room = el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight)
    return { line, spare: room - safety - need, need, room }
  }, SAFETY_PX)
// The app adds up the items' widths; the copy above is laid out whole. The two agree to the
// browsers' grain, so within LINE_PX of the threshold either line is right.
async function expectChangelogPlaced(foot: Locator, at: string) {
  const { line, spare, need, room } = await changelogPlace(foot)
  const why = `${at}: Changelog's line (the Contact line needs ${need.toFixed(2)}px of ${room.toFixed(2)}px)`
  if (spare >= LINE_PX) expect(line, why).toBe(1)
  else if (spare < -LINE_PX) expect(line, why).toBe(2)
  else expect([1, 2], why).toContain(line)
  return line
}

/** The visual lines of the foot, top to bottom: each item, grouped with the items it shares a
 *  line box with. A pair that has broken is two visual lines. */
const visualLines = (foot: Foot) =>
  foot.lines.flatMap(({ items }) => {
    const out: Rect[][] = []
    for (const item of items) {
      const line = out.find((l) => Math.abs(l[0].top - item.top) <= LINE_PX)
      if (line) line.push(item)
      else out.push([item])
    }
    return out
  })

test('the foot’s lines: nothing runs out, each pair on one line box anchored at both ends, and equal gaps between lines', async ({
  page,
}) => {
  test.setTimeout(300_000)
  await openApp(page)
  const foot = (await openSettings(page)).locator('.popover-sticky-footer')
  await expect(foot.getByRole('button', { name: 'Check for updates' })).toBeVisible()
  let broke = 0
  for (const factor of await runs(foot))
    for (const height of HEIGHTS)
      for (const width of WIDTHS) {
        await resizeTo(page, width, height)
        await setFactor(foot, factor)
        const at = named(width, height, factor)
        const now = await measure(foot)
        await expectChangelogPlaced(foot, at)
        for (const [i, { box, items }] of now.lines.entries()) {
          for (const item of items) {
            expect(item.left, `${at}: line ${i + 1} runs out on the left`).toBeGreaterThanOrEqual(
              now.content.left - SAME_PX,
            )
            expect(item.right, `${at}: line ${i + 1} runs out on the right`).toBeLessThanOrEqual(
              now.content.right + SAME_PX,
            )
          }
          const [first, last] = [items[0], items[items.length - 1]]
          expect(
            Math.abs(first.left - now.content.left),
            `${at}: line ${i + 1}, hard left`,
          ).toBeLessThanOrEqual(SAME_PX)
          if (items.length > 1)
            expect(
              Math.abs(last.right - now.content.right),
              `${at}: line ${i + 1}, hard right`,
            ).toBeLessThanOrEqual(SAME_PX)
          const one = Math.abs(first.top - last.top) <= LINE_PX
          if (!one) broke++
          else {
            expect(
              Math.abs(first.height - last.height),
              `${at}: line ${i + 1}, one height`,
            ).toBeLessThanOrEqual(LINE_PX)
            expect(
              Math.abs(box.height - first.height),
              `${at}: line ${i + 1} is as tall as its items`,
            ).toBeLessThanOrEqual(LINE_PX)
          }
        }
        const lines = visualLines(now)
        const gaps = lines
          .slice(1)
          .map(
            (line, i) =>
              Math.min(...line.map((r) => r.top)) - Math.max(...lines[i].map((r) => r.bottom)),
          )
        expect(
          Math.max(...gaps) - Math.min(...gaps),
          `${at}: the gaps between the foot's lines (${gaps.map((g) => g.toFixed(2)).join(', ')})`,
        ).toBeLessThanOrEqual(LINE_PX / 5)
      }
  // The sweep reached the one case the foot allows a break in — or there is nothing to say about it.
  expect(broke, 'windows where a pair broke onto a second line').toBeGreaterThan(0)
})

for (const font of FONTS)
  test(`at every phone size each pair is on one line, and Changelog is on the Contact line exactly when it fits — ${font ?? "the machine's own font"}`, async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await openApp(page)
    await forceFont(page, font)
    const foot = (await openSettings(page)).locator('.popover-sticky-footer')
    if (font)
      expect(await foot.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^Verdana/)
    // The iPhone's width of font stands in for the machine's own; a wide font is wide already.
    const iphone = font ? [1] : await runs(foot)
    const placed = new Set<number>()
    for (const [phones, factors] of [
      [IPHONES, iphone],
      [ANDROIDS, [1]],
    ] as const)
      for (const factor of factors)
        for (const [width, height] of phones) {
          await resizeTo(page, width, height)
          await setFactor(foot, factor)
          const at = named(width, height, factor)
          placed.add(await expectChangelogPlaced(foot, at))
          expect(visualLines(await measure(foot)).length, at).toBe(3)
        }
    // Both places are reached, so both are held: the sweep is not all one arrangement.
    expect([...placed].sort(), 'the lines Changelog was found on').toEqual([1, 2])
  })

// THE TWO RIGHT-HAND ITEMS SHARE ONE RIGHT EDGE, AND THE CHANGELOG DOT HANGS PAST IT (Round 26).
// "Changelog" used to keep a slot in flow for its update dot, so its text ended ~6px short of
// "Check for updates" below it. The dot now hangs past the end of the word, out of flow
// (components/UpdateDot's `trailing`): the two words' right edges meet, and the lit dot is drawn
// whole, in the foot's own side padding, inside the menu — in every theme, at the narrowest and
// widest phones, on whichever line Changelog is (the machine's font puts it on the Contact line at
// these sizes, the wide font on the Storage used line at 390 wide).
for (const theme of THEMES)
  for (const font of FONTS)
    test(`${theme}: "Changelog" and "Check for updates" end at one edge, with the lit dot whole beside it — ${font ?? "the machine's own font"}`, async ({
      page,
    }) => {
      await openApp(page, { theme })
      // A changelog that has gained something since this device last looked: the link's dot lit.
      await page.evaluate(() => window.localStorage.setItem('cg-update-dot-changelog', '1'))
      await page.reload()
      await appReady(page)
      await forceFont(page, font)
      const panel = await openSettings(page)
      const changelog = panel.getByRole('button', { name: /^Changelog/ })
      const check = panel.getByRole('button', { name: 'Check for updates' })
      const dot = changelog.locator('[data-update-dot]')
      await expect(dot).toHaveAttribute('data-lit', 'true')
      for (const [width, height] of [
        [320, 568],
        [390, 844],
        [440, 956],
      ]) {
        await resizeTo(page, width, height)
        const at = `${theme} at ${width}×${height}`
        // The word's own glyphs: its text node alone (a range over the span would take in the dot).
        const word = await changelog
          .locator('span')
          .first()
          .evaluate((el) => {
            const range = document.createRange()
            range.selectNodeContents(el.firstChild!)
            const { left, right } = range.getBoundingClientRect()
            return { left, right }
          })
        const other = await textRectOf(check)
        expect(
          Math.abs(word.right - other.right),
          `${at}: the two right edges`,
        ).toBeLessThanOrEqual(0.5)
        const [d, card] = await Promise.all([rectOf(dot), rectOf(panel)])
        expect(d.width, `${at}: the dot is drawn`).toBeGreaterThan(0)
        expect(d.left, `${at}: the dot past the word`).toBeGreaterThanOrEqual(word.right)
        expect(d.right, `${at}: the dot inside the menu`).toBeLessThanOrEqual(card.right - SAME_PX)
        expect(await dot.evaluate((el) => getComputedStyle(el).visibility)).toBe('visible')
      }
    })
