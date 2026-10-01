// scripts/changelogStamp.mjs — the deploy stamp and the changelog date, made unable to disagree
// (round 16, the second half of its deploy-stamp change).
//
// THE CLASS: two facts about the same deploy, written down in two places, kept in step by memory.
// src/deployStamp.ts says WHEN the build shipped; the newest entry in src/changelog.ts says WHICH
// PACIFIC DAY shipped it. The first half took the stamp out of human hands — it is now the build
// machine's own clock — which removes one of the two chores and, on its own, makes the situation
// WORSE: the surviving half is a step somebody used to remember beside a step nobody has to, and a
// divergence between them would now happen silently. So the two halves only make sense together.
// This is the second half: the build FAILS unless the newest changelog entry is dated the same
// Pacific calendar day the stamp lands on.
//
// WHY PACIFIC AT ALL: the charter at the top of src/changelog.ts fixes entry dates as the deploy's
// PACIFIC calendar date (the owner's day), while the stamp is a UTC instant. Those two disagree for
// the 7–8 hours between Pacific midnight and UTC midnight — 5:00 PM PDT is already tomorrow in UTC —
// and that window is exactly where this whole guard lives. The conversion therefore goes through the
// IANA zone (Intl + 'America/Los_Angeles'), never through a hand-written offset: PDT is UTC-7 and PST
// is UTC-8, the switch moves every year, and a build in March would be a day out if -8 were baked in.
// assertPacificZone() below refuses to produce a verdict at all on a runtime whose tz database does
// not actually perform that shift, because a checker that quietly compares two UTC dates would look
// exactly like a passing one.
//
// Wired as a build-FAILING vite plugin (vite.config.js, first in the plugin array so it fails before
// the expensive work), on the precacheIntegrity precedent and for the same reason: a check that lives
// in the CI workflow only runs where the workflow runs, and a local `npm run build` could still
// produce an artifact whose two dates disagree. The comparison half below is pure and exported so
// tests/changelogStamp.test.js can drive it with synthetic instants — including both sides of both
// midnights, and both offsets — without depending on the day the suite happens to run.

export const PACIFIC_TZ = 'America/Los_Angeles'

const PACIFIC_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: PACIFIC_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

// A UTC instant as its PACIFIC calendar date, ISO YYYY-MM-DD — the form the changelog entries use.
// formatToParts rather than format() so the assembly is ours: en-US would otherwise hand back
// M/D/YYYY, and re-parsing a localized string is the kind of step that works until a locale moves.
export function pacificDate(instant) {
  const parts = PACIFIC_PARTS.formatToParts(instant)
  const part = (type) => parts.find((p) => p.type === type)?.value
  const [year, month, day] = [part('year'), part('month'), part('day')]
  if (!year || !month || !day)
    throw new Error(
      `changelog-stamp: could not read a Pacific calendar date out of ${String(instant)}`,
    )
  return `${year.padStart(4, '0')}-${month}-${day}`
}

// Two instants whose Pacific dates are known, one in each offset, both one second before a Pacific
// midnight — so each proves BOTH that the zone shifted and that it shifted by the right amount:
//   • 2026-08-10T06:59:59Z is 2026-08-09 23:59:59 PDT (UTC-7) — a UTC-8 runtime would say 08-09 too,
//     but a runtime doing NO shift at all would say 08-10.
//   • 2026-01-15T07:59:59Z is 2026-01-14 23:59:59 PST (UTC-8) — a runtime frozen on PDT would say
//     01-15 here, so the pair together pins the seasonal switch and not merely "some offset".
const ZONE_PROOFS = [
  ['2026-08-10T06:59:59Z', '2026-08-09'],
  ['2026-01-15T07:59:59Z', '2026-01-14'],
]

// Refuse to answer on a runtime that cannot do the conversion this guard is entirely about. Node
// ships the tz database, so this passes everywhere we build today; it exists because the failure it
// covers is silent (a stripped-ICU runtime that treats an unknown zone as UTC would make every
// verdict below a comparison of two UTC dates, which is wrong for 7–8 hours of every day and right
// for the rest — the worst possible shape for a bug).
export function assertPacificZone() {
  for (const [iso, expected] of ZONE_PROOFS) {
    const got = pacificDate(new Date(iso))
    if (got !== expected)
      throw new Error(
        `changelog-stamp: this runtime cannot convert to ${PACIFIC_TZ} — ${iso} came back as ` +
          `${got}, and it is ${expected} in Pacific time. The check is refusing to run rather ` +
          `than compare two UTC dates and call it a verdict.`,
      )
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// The newest entry's date, validated. Newest-first ordering is the charter's and is pinned by
// tests/changelog.dom; what is enforced here is only that there IS a newest entry and that its date
// is the ISO form this comparison can be made in at all.
export function newestEntryDate(entries) {
  if (!Array.isArray(entries) || entries.length === 0)
    throw new Error('changelog-stamp: src/changelog.ts exports no entries to check')
  const date = entries[0]?.date
  if (typeof date !== 'string' || !ISO_DATE.test(date))
    throw new Error(
      `changelog-stamp: the newest changelog entry's date is ${JSON.stringify(date)}, which is ` +
        'not an ISO YYYY-MM-DD day. The charter in src/changelog.ts fixes that form.',
    )
  return date
}

// The verdict. Pure: hand it the entries and the instant the build was stamped with, and it says
// what the entry claims, what the stamp means in Pacific time, and whether they are the same day.
export function checkChangelogStamp(entries, buildInstant) {
  assertPacificZone()
  const found = newestEntryDate(entries)
  const expected = pacificDate(buildInstant)
  return { ok: found === expected, found, expected, stamp: buildInstant.toISOString() }
}

// What a broken build prints. Kept here rather than in the plugin so the exact wording is itself
// testable — the whole value of a guard like this is that the person who trips it knows what to do
// without going and reading the guard.
export function describeChangelogStampMismatch({ found, expected, stamp }) {
  return (
    `changelog-stamp: the newest changelog entry and this build's deploy stamp are not the same ` +
    `Pacific day.\n` +
    `  newest entry in src/changelog.ts : ${found}\n` +
    `  this build's Pacific date        : ${expected}   (stamped ${stamp}, UTC)\n` +
    `\n` +
    `Every deploy ships exactly one changelog entry dated its own Pacific calendar day — the ` +
    `charter at the top of src/changelog.ts. The stamp is no longer typed by hand: it is the ` +
    `clock at build time, so the entry is the end that moves.\n` +
    `\n` +
    `FIX: date the newest entry in src/changelog.ts ${expected}. If an entry for ${expected} ` +
    `already exists, MERGE this deploy's lines into it and restate that day's net effect — never ` +
    `add a second entry for the same day.\n` +
    `\n` +
    `⚠ IF A DEPLOY SLIPPED PAST MIDNIGHT PACIFIC, BOTH ENDS MAY NEED MOVING. The lines you wrote ` +
    `under ${found} describe the deploy that is now landing on ${expected}, so they belong under ` +
    `${expected} — and if ${found} already shipped, its published lines are settled history and ` +
    `stay put while the new day gets its own entry. Every rebuild takes a fresh stamp, so a build ` +
    `re-run after the next midnight will move the target date again.\n` +
    `\n` +
    `IF THIS DEPLOY CHANGES NOTHING A PLAYER CAN SEE — a re-run, or internal work only — you still ` +
    `owe an entry. The Updating screen and the GEAR dot fire on ANY build change, while the CHANGELOG ` +
    `dot fires only if this list gains something (src/changelog, CHANGELOG_SEEN_KEY) — so this line ` +
    `is what makes that breadcrumb lead somewhere instead of nowhere. Use the charter's fixed line, ` +
    `verbatim (never reworded, never alongside a real ` +
    `line):\n` +
    `\n` +
    `  {\n` +
    `    date: '${expected}',\n` +
    `    items: [\n` +
    `      'Nothing you can see changed this time — just work underneath to keep things running smoothly.',\n` +
    `    ],\n` +
    `  },\n` +
    `\n` +
    `⚠ TEN ENTRIES MAXIMUM. If adding this one makes eleven, move the OLDEST to ` +
    `CHANGELOG-ARCHIVE.md in the same change — otherwise you will trade this failure for a ` +
    `different one.`
  )
}
