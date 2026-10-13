// ONE TEST PER ENTRY IN support/app's KNOWN_PAGE_ERRORS, EACH PROVING THE DEFECT IS STILL THERE.
//
// The lane lets a listed error through so that tests which cannot avoid setting it off are not red
// for someone else's reason. That allowance must end when the defect does — and nobody remembers to
// delete an allow-list entry. So each test here FAILS WHEN ITS DEFECT IS FIXED: that failure is the
// instruction to delete the entry and the test together. A red test in this file is good news.
import { test, expect, openApp, resizeTo, pageErrorsOf, KNOWN_PAGE_ERRORS } from './support/app'

test('STILL BROKEN: the top bar’s height observer raises a ResizeObserver loop error when the window’s height changes (fixed? delete this test and its KNOWN_PAGE_ERRORS entry)', async ({
  page,
  context,
}) => {
  await openApp(page)
  expect(pageErrorsOf(context), 'nothing is raised by opening the app').toEqual([])
  // A shorter window is a smaller root font (index.css's html rule follows the height), which is
  // a shorter top bar — the change the observer answers.
  await resizeTo(page, 390, 600)
  await expect.poll(() => pageErrorsOf(context)).toEqual([`uncaught: ${KNOWN_PAGE_ERRORS[0]}`])
})
