// lib/changelogSignature.ts — the newest changelog entry as one short comparable string: what
// `cg-changelog-seen` (src/changelog, CHANGELOG_SEEN_KEY) holds, and what each boot compares it with.
// Why the newest entry alone, the migration case, and the null rule all live beside that key.
//
// ★ A SIGNATURE, NOT THE ENTRY (Round 26). It used to be the whole newest entry, stored verbatim on
// the reasoning that "a few hundred bytes costs nothing" - and a round's entry is not a few hundred
// bytes: Round 26's ran to about 8 KB, a key that sat in Storage used for nothing but a comparison.
// It is now the entry's date and a 53-bit hash of its date and lines (cyrb53, the hash the
// windows-in-sync door names content with). A clash would cost one missing dot, at odds of about
// one in 9 * 10^15 per update, and the date stays legible in devtools.
// ⚠ OLDER BUILDS share this key (live and the test site are one origin). They store the whole entry
// and compare it with theirs, so each side reads the other's value as different and lights the
// changelog dot - which is what a switch between two builds with different newest entries does in
// any case. Nothing is lost either way; the only cost is a dot, on a build switch that already
// showed the Updating screen.
// (Not in src/changelog itself: that file imports nothing, because the build loads it directly.)

import type { ChangelogEntry } from '../changelog.js'
import { cyrb53 } from '../store/syncStamp.js'

/** The newest entry's date and the hash of its date and lines - '' for an empty list. Pure. */
export const changelogSignature = (entries: readonly ChangelogEntry[]): string => {
  const newest = entries[0]
  // (JSON.stringify of the array, so where one line ends and the next begins is part of what is
  // hashed: two entries cannot read alike however their lines are punctuated)
  return newest ? `${newest.date}:${cyrb53(JSON.stringify([newest.date, ...newest.items]))}` : ''
}
