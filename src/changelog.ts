// changelog.ts — the plain-words changelog (round-6 Q6): what each deploy changed, written for
// players, never developers. Hand-maintained: every deploy adds its lines here, a standing part
// of the deploy ritual.
//
// THE CHARTER (round-8 Q8; the two ordering rules amended round-11 Q6) — this array is exactly
// what ships and exactly what the popup draws:
//   • Newest first. Entry dates are the deploy's Pacific calendar date in ISO form (YYYY-MM-DD);
//     the popup renders them through the user's Date Format setting, so never encode a format here.
//     ★ THE NEWEST ENTRY'S DATE IS NOW ENFORCED BY THE BUILD (round 16, Q1). The deploy stamp is
//     taken from the clock at build time (src/deployStamp.ts), and scripts/changelogStamp.mjs —
//     wired first in vite.config.js's plugin array — FAILS the build unless the entry at the top of
//     this array is dated that stamp's PACIFIC day. So a deploy cannot ship without a changelog
//     entry, and cannot ship one dated a day it did not land on. The two disagree for the 7-8 hours
//     between Pacific midnight and UTC midnight, which is why the guard converts through the IANA
//     zone rather than slicing the stamp's ISO prefix.
//   • ONE entry per Pacific calendar DAY, never per deploy (the round-7 owner call) — so dates
//     stay unique, which is also the popup's per-entry React-key contract (key={en.date});
//     changelog.dom.test pins the uniqueness.
//   • ORDER WITHIN A DAY: MOST NOTICEABLE FIRST, related lines kept adjacent, `Fixed:` lines
//     last. Already the de-facto pattern (the 7/26 entry ends on one), written down in round-11
//     Q6. The entry is read top-down by someone who has just been handed the update, so the line
//     likeliest to be why they opened it leads; a fix nobody was waiting for closes.
//   • A SECOND DEPLOY ON THE SAME DAY RESTATES THAT DAY'S NET EFFECT VERSUS PRODUCTION — it does
//     not prepend a second log. (The charter said "prepend, newest lines first" until round-11
//     Q6; the practice on 2026-07-28 was already better and is what got codified.) A player only
//     ever sees the difference from the version they last had, so an intermediate state nobody
//     ran is not a change: MERGE a correction into the line it corrects, and DELETE outright a
//     line describing something the later deploy reverted. Worked example, 2026-07-28: round
//     10's hairline fix was merged into round 9's How-to-Play line, and round 9's "Date Format
//     now stacks" line was deleted because round 10 reverted it and no player ever saw it.
//     Lines already SHIPPED on an earlier day are settled history — never reordered or reworded
//     to suit a later rule.
//   • ★ A DEPLOY WITH NOTHING VISIBLE STILL GETS AN ENTRY. The owner's rule, set during round 15
//     and live from round 15 onward; round 16 is the round that finally wrote it HERE, because this
//     charter — not the backlog — is the copy a builder actually reads, and he asked for it to be
//     very, very clear. It is ONE line, and it is this line, VERBATIM, every single time:
//         "Nothing you can see changed this time — just work underneath to keep things running
//          smoothly."
//     WHY IT EXISTS. The GEAR dot fires on ANY build change: the build-stamp detection compares one
//     stamp against another and cannot tell a rewrite from a typo fix. So a purely internal deploy
//     still shows the Updating screen, still lights the gear dot, and still nudges the player to
//     come and read this list. If the newest entry is three days old, the notification pointed at
//     nothing and the app looks broken or dishonest. The player-noticeable rule exists to stop
//     JARGON, not to make the app go silent in the one moment it has just announced itself.
//     ★ AND SINCE 2026-08-10 THIS LINE HAS A SECOND, MECHANICAL JOB — writing it down because it
//     makes the rule harder to talk anyone out of. The CHANGELOG dot is now gated on this array
//     actually gaining something (CHANGELOG_SEEN_KEY below). So on an internal deploy this fallback
//     line IS what makes the breadcrumb honest: with it, the newest entry really is new and the dot
//     truthfully leads somewhere. Skip it and the player gets an Updating screen, a gear dot, and
//     then nothing at all to explain either. The line is no longer just good manners; it is the
//     thing that keeps the trail from breaking.
//     IT IS A FALLBACK, NEVER AN ADDITION. The moment a deploy has one genuinely visible change,
//     this line is DELETED and the real line stands alone. Never both — a real change plus "nothing
//     you can see changed" is a contradiction on the same date, and under the same-day rule above
//     that is exactly what a second deploy on a day that already has real lines would produce, so
//     the merge DROPS this line rather than keeping it.
//     NEVER REWORD IT. Identical every time, so a returning player recognises it at a glance
//     instead of reading it. And never dress it up: "performance improvements and bug fixes" is
//     marketing filler the owner has explicitly rejected, and is usually a lie as well.
//     ⚠ Use it only when there is genuinely nothing else to say. It is not a shortcut for a deploy
//     whose visible change is small or awkward to describe — that one gets described.
//   • TEN entries maximum, ever. When a new day would make it eleven, MOVE the oldest entry to
//     CHANGELOG-ARCHIVE.md at the repo root (no source file imports it, so retired history costs
//     the bundle nothing) — do not just let the array grow. Before round-8 the popup sliced the
//     latest ten at render time, which meant every day past the tenth was text downloaded by every
//     visitor on every update and then refused; the slice is gone, so an eleventh entry left here
//     would simply PUBLISH itself. changelog.dom.test pins the cap.
// Nothing earlier than the round-5 deploy was ever written down and nothing will be retro-written:
// the history is this array plus whatever has already aged out into the archive.
//
// Alongside the data live the two update-signal dot flags — the breadcrumb that leads a player here
// after an update. ⚠ THEY NO LONGER FIRE TOGETHER (2026-08-10): the build-change detection (the Q2
// effect in main.tsx) marks the GEAR dot on every build change, but marks the CHANGELOG dot only
// when the newest entry here has actually changed since this device last looked — see
// CHANGELOG_SEEN_KEY at the bottom of this file for why, and for the migration case. Opening ⚙
// Settings clears the gear button's dot; the first tap on the Changelog link clears the link's own.
// Plain localStorage like the build stamp (lib/buildStamp) — the flags describe the code that ran,
// not user data — and try/catch for the same reason: blocked storage (privacy modes) must never
// break boot, it just means no dots.

export type ChangelogEntry = {
  date: string // the day's Pacific date, ISO YYYY-MM-DD (unique — same-day deploys merge)
  items: string[] // short plain-words lines, one visible change each
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-09-09',
    items: [
      'Presets can now be reordered by dragging them — grab the handle beside a preset in ⚙ Settings → Manage Presets and drop it where you want it. With a handle selected by keyboard, the arrow keys do the same thing.',
      'The preset picker at the top of the screen now fills the space the app’s name used to take up, so a longer preset name has real room to show instead of disappearing behind an ellipsis right away.',
      'Lookup history is now shared across every preset, so you never have to remember which preset you looked something up in. It still isn’t added to permanently while a preset is Amnesic.',
      'Whether a preset was Amnesic is now part of what Save Defaults remembers and Reset Settings restores, alongside everything else those already covered.',
      'Dot Layout, in Settings → Display, is now a plain on/off switch instead of a Columns/Rows choice — and the small mark in the top-left corner only turns when Dots is your answer style, instead of staying turned with nothing on screen for it to match.',
      'View Saved Defaults and Clear Saved Defaults are now always both there at the bottom of the Settings menu; Clear dims and does nothing until there is something saved to clear, rather than disappearing.',
      'Fixed: in MoX and Blitz, a run that only tied your best mean or median could sometimes still show the new-best star, from a difference too small to ever see on screen. Only a run that is faster once rounded to the hundredth — same as what’s printed — counts as a new best now.',
    ],
  },
  {
    date: '2026-09-08',
    items: [
      'The app can now hold several separate set-ups at once, called presets. Each one keeps its own settings, stats, bests, saved defaults and lookup history, so a preset you practise in and a preset you experiment in never touch each other. Switch between them with the new picker at the top of the screen — press and slide down to it, the same way the mode picker works. Make, rename, reorder and delete presets under ⚙ Settings → Manage Presets.',
      'The top of the screen is rearranged to make room for that picker: logo on the far left, then the preset picker, then the mode picker, with the gear on the far right. The "Calendar Game" wordmark has gone to pay for the space.',
      'Any preset can be made Amnesic, under ⚙ Settings → Stats. While that is on, the preset records nothing — no stats, no bests, no lookup history — and everything from the session goes when the app closes. It is there for handing your phone to someone else, or for playing without it counting. Presets with it on are marked with an A in the picker.',
      'When a Blitz or MoX run finishes, tapping its row of stats now opens the whole run question by question, with your fastest and slowest marked and the mean, fastest and slowest shown together.',
      'AoX is now called MoX, and "average" is now "mean" everywhere it appeared. A cubing average throws away your fastest and slowest solve before averaging, and this app has never done that — so the old name was quietly claiming something the maths does not do. Nothing about the maths or your saved bests has changed, only the words.',
      'A new Dot Layout setting, under ⚙ Settings → Display, turns the seven dots a quarter turn: the weekday triples can run down the two side columns as before, or along the top and bottom rows. The mark in the top left corner turns with them.',
      'Buttons are easier to hit. Every button now covers its whole rectangle instead of stopping at its rounded corners, and the gap between two buttons splits evenly between them. The blank spaces stay blank on purpose, so sliding your finger onto one to cancel a press still works.',
      'The saved-defaults links at the foot of the Settings menu now sit in line with the three buttons above them rather than below.',
      'Every text box now selects what is already in it when you tap it, so you can type straight over it — and opening the Settings menu or a picker now puts the keyboard away.',
      'Fixed: the question number beside your Score is now a lifetime count, so the two finally agree. It used to count only the cards you could still page back through, which meant it could read Q1 next to a Score of 471/501.',
      'Fixed: a time of a minute or more now reads as a time — 1:04, or 1:02:30 — instead of a dash. A dash now means one thing only, that nothing has been recorded yet.',
      'Fixed: a long number in a stat box no longer rides higher than the numbers beside it when it shrinks to fit.',
      'Fixed: in Blitz, the time boxes stop responding to taps once a round has ended, which is what MoX already did.',
    ],
  },
  {
    date: '2026-09-05',
    items: [
      'Nothing you can see changed this time — just work underneath to keep things running smoothly.',
    ],
  },
  // ★ THE CAP HAS NOW BITTEN THREE TIMES. 2026-09-05 retired 2026-07-17; 2026-09-08 retired
  // 2026-07-19; adding 2026-09-09 above retired 2026-07-21 in the same change. The array is AT ten
  // — the next new day retires 2026-07-26 (see the ten-entry rule in the charter above).
  {
    date: '2026-08-10',
    items: [
      'This list now shows a version number in its top right corner, next to "What\'s new" — useful if you are ever asked which copy of the app you have.',
      'The dot beside Changelog now appears only when this list has actually gained something, so it never sends you to news you have already read. The dot on the gear still marks every update.',
      'How to Play now explains that a brand-new version can take up to about ten minutes to reach everywhere, so Check for updates can still answer "Up to date" just after one is released — asking again a little later finds it.',
    ],
  },
  // ⚠ THIS ENTRY WAS REWRITTEN BY THE SECOND DEPLOY OF 2026-08-09, under the charter's same-day
  // rule: one entry per Pacific day, restating that day's NET effect versus yesterday's build. The
  // first deploy shipped "Reset Settings and Full Reset now wait until you leave the year box"; the
  // second reversed exactly that on the owner's call, so the line describing it is GONE rather than
  // followed by its own contradiction. Everything else it shipped is still true and is untouched,
  // in its original order, with the day's new lines placed around it.
  {
    date: '2026-08-09',
    items: [
      'Stats you have hidden by tapping them now leave an empty box instead of a crossed-out one. A dash now means one thing only — nothing recorded yet — and when Save Stats is off the whole strip dims together, so you can still see at a glance which stats you hid yourself. Nothing is crossed out anywhere any more.',
      'How to Play has a new Accessibility section: what the app does for screen readers, keyboards and reduced-motion settings — and, said plainly, where it still falls short.',
      'With Reduce Motion turned on, a few animations that used to play anyway now hold still as well: the dots on the Updating screen, and the colour fades on buttons.',
      'Typing in a Year Range box now counts as a change straight away, for everything the Settings menu does about it: the violet bar under the ⚙ button, Save Defaults, Reset Settings and Full Reset all react to the typing instead of waiting for you to leave the box. Dates still come from the stored range until the year counts.',
      'The three buttons at the foot of the Settings menu now tell a screen reader when they are unavailable, instead of only looking grey — and on a computer the pointer shows the not-allowed cursor over them.',
      'Fixed: in Lookup, tapping a row in the History list now shows you which row you tapped. The row is tinted and gets a coloured edge down its left side. Tapping always did put that date back in the box above, but nothing on screen changed to say which one you had picked. On a computer, resting the pointer on a row now lights it up too, on every colour theme.',
      'Fixed: pressing Esc in a Year Range box now throws away what you typed and puts the stored year back. It used to do the opposite and keep the year you were trying to discard.',
      'Fixed: pressing Esc in a Year Range box no longer closes the whole Settings menu with it. It just leaves the box, and pressing Esc again closes the menu.',
      'Fixed: pressing Esc in the AoX run-length box now throws the typing away too, on the AoX screen and inside the Save Defaults box alike.',
      'Fixed: pressing Esc in the Lookup date box now throws away what you typed and puts back what was there before. That was the last box in the app without it, so Esc means the same thing everywhere now: throw this away and leave the box. Enter still means keep it and leave.',
      'Fixed: the three buttons at the foot of the Settings menu now do nothing at all while they are dimmed. Save Defaults could previously be opened with a keyboard when there was nothing to save.',
    ],
  },
  {
    date: '2026-08-08',
    items: [
      'How to Play now scrolls inside its own panel, the same way every other page in the app already did. Two things change with it: tapping the status bar no longer jumps the guide to the top, and dragging on the top bar itself no longer scrolls it.',
      'Lookup now keeps your 100 most recent dates instead of 20, and once there are two or more the History heading shows how many are saved. Older ones still drop off the bottom on their own.',
      'Settings now reads properly with a screen reader: the four On/Off switches and the two Year Range boxes each say which setting they belong to. Before this they had no name of their own, so they all announced alike.',
      'Fixed: on a very short window — or zoomed a long way in — the Save/View defaults box could push its own title and buttons off screen where you could not reach them. It now fits the screen and scrolls inside itself.',
    ],
  },
  {
    date: '2026-08-07',
    items: [
      'In Settings, Leap Year Chance and Jan/Feb Chance on Leap Years now come before the Julian Calendar settings, so the ones most people change sit nearer the top. How to Play covers them in the same new order.',
      'The mode menu no longer closes itself when the page scrolls — including a scroll that was already gliding when you opened it. Choosing a mode, tapping the page, pressing Esc or going Back all still close it.',
      'After an update, the brief "Updating" screen now always plays out fully, and the launch straight afterwards goes in without the usual opening pause.',
      'Fixed: a press on the settings gear or the mode menu button that the browser interrupts no longer opens the menu and shuts it again straight away.',
    ],
  },
  {
    date: '2026-08-02',
    items: [
      'Dates on or before October 4, 1582 can be read in two calendars, and Lookup now shows both — "Julian: Saturday" above "Gregorian: Wednesday" — instead of one chosen for you. The answer sits on three fixed lines: the date, then its reading or readings.',
      'February 29 of a year like 1500 is a real Julian date and no Gregorian date at all. Lookup now accepts it and answers "Gregorian: Does Not Exist", and Show Codes works through the calendar the date actually has.',
      'History rows say the same thing in short, so each stays on one line: "J: Sat · G: Wed" for an early date, and just the weekday on its own for every other one. Tap a row to see it spelled out in full above.',
      'The Julian Calendar setting no longer changes any Lookup answer. It only picks which calendar Show Codes teaches.',
      'Check for updates now really checks. The link reads "Checking…" while it looks, then answers "Up to date" or "No connection" in the same spot, and installs something only when there genuinely is a new version — so a press with nothing to get no longer throws away the copy that lets the app work offline.',
      'Opening the mode menu just after flicking the page no longer closes it again straight away: a scroll that was already gliding is left to finish, while a scroll you start with the menu open still closes it.',
      'Going back to the app from another page no longer sends How to Play to the top. A fresh launch, a reload and a Full Reset still start there.',
      'Fixed: the fades and shadows at the edges of a scrolling area now keep up when content grows or shrinks under them — opening Show Codes in Lookup, or a How to Play section — instead of holding the old answer until you next scroll.',
    ],
  },
  {
    date: '2026-07-28',
    items: [
      'Input, Julian Chance, Leap Year Chance and Jan/Feb Chance are now drawn as one connected strip of buttons in the settings menu, matching Date Format and the themes.',
      'A greyed-out setting now greys out all in one piece, instead of fading button by button.',
      'Opening a How to Play section no longer leaves a sliver of the section above it peeking out under the bar — except right at the bottom of the guide, where there is no page left to scroll.',
      'The shadow under the top bar now follows your scrolling instead of switching on and off, so it settles the instant the page does — including when you tap the status bar to jump to the top.',
      'How to Play keeps your place while the app is open: leave for a mode, play, and come back and the same section is still open at the same point on the page. Closing the app and launching it again, reloading it, or a Full Reset starts it fresh at the top; switching to another app and back keeps your place as before.',
      'In Deduction, the answer buttons are spaced the same in all three sub-modes — the day and year grids were a little tighter than the month one, so they no longer shift as you switch.',
      'In AoX, the run length box now stands exactly as tall as the Allow Mistakes and One-by-One buttons beside it.',
      'With a keyboard: click one option of a setting and the arrow keys then move along that setting, choosing each option as you land on it — without stepping the date behind the menu.',
      'The changelog popup is back to just the list and Close; the small grey note under it is gone, since How to Play already explains how far back the list goes.',
    ],
  },
  {
    date: '2026-07-26',
    items: [
      'The Lookup page no longer scrolls as a whole — only the history list moves, and it now uses whatever room your screen has instead of stopping at a fixed height.',
      'The answer line in Lookup always keeps its space, so nothing on the page shifts as answers come and go. Before your first lookup, or after Clear, it simply invites you to enter a date.',
      'Lookup works out every answer and every history row afresh, so changing your Date Format or the Julian Calendar setting updates the answer line and the whole list together.',
      'The five themes are now buttons in two labelled rows, Dark and Light, instead of hiding inside drop-down menus — and both rows always show, so the settings menu no longer changes height.',
      'Turning Use System Settings off now keeps whichever theme is already on screen.',
      'The app keeps your place when you switch away and come back, instead of jumping to the top — in How to Play and in the game screens alike. And a How to Play section you open now comes to rest just clear of the bar at the top, with its title fully readable.',
      'Tapping a value to type it — a timer, or the AoX Run Length — no longer nudges the row around it, and a longer number is no longer cut off as you type.',
      'In Deduction, the month answer buttons are now the same size as the year and day ones.',
      'The small light-blue dot now sits just after the word Changelog instead of on top of it, and the changelog itself keeps the ten most recent days that had an update.',
      'Fixed: in AoX, the codes panel no longer swaps what it shows while it is sliding shut.',
      'The Show Codes button now stands exactly as tall as the buttons beside it.',
      'The settings controls and the Show Codes button now describe themselves properly to screen readers.',
    ],
  },
]

// The two persisted update-signal dots (the breadcrumb's two stages).
export const GEAR_DOT_KEY = 'cg-update-dot-gear'
export const CHANGELOG_DOT_KEY = 'cg-update-dot-changelog'

export const readUpdateDot = (key: string): boolean => {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

// ★ THE DOTS ARE AN EXTERNAL STORE, AND THE SUBSCRIPTION BELOW IS WHAT MAKES THEM ONE.
// These flags live in localStorage, not in React. Until round 16 App mirrored them into two
// useStates and kept the mirror in step by calling setGearDot/setChangelogDot from inside effects —
// which is react-hooks/set-state-in-effect, and the textbook "you might not need an effect" case:
// the state was never a source of truth, only a copy of this one. The fix is to let components read
// the flags directly through useSyncExternalStore, so a write here re-renders every reader with no
// React state and no effect in between.
//
// The listener set is module-scope and process-wide, which is correct: the flags are process-wide
// too. `subscribeUpdateDot` is key-agnostic — a notification wakes every reader and each re-reads
// its own key. With exactly two keys and two readers that is cheaper than tracking subscriptions
// per key, and it cannot go stale when a key is added.
//
// ⚠ EVERY MUTATION OF A DOT FLAG MUST GO THROUGH markUpdateDot/clearUpdateDot. A direct
// localStorage.setItem on one of these keys would change the value without notifying, and the UI
// would not update until something else re-rendered. Verified at the time of writing: these two are
// the only writers in src/ (tests write through them too).
const updateDotListeners = new Set<() => void>()

const notifyUpdateDots = (): void => {
  for (const listener of updateDotListeners) listener()
}

// The `subscribe` half of useSyncExternalStore's contract. Stable across renders by construction
// (a module-scope function), so React never needlessly re-subscribes.
export const subscribeUpdateDot = (listener: () => void): (() => void) => {
  updateDotListeners.add(listener)
  return () => {
    updateDotListeners.delete(listener)
  }
}

export const markUpdateDot = (key: string): void => {
  try {
    localStorage.setItem(key, '1')
  } catch {
    /* best-effort */
  }
  // OUTSIDE the try: a blocked write still has to notify. Readers call readUpdateDot, which returns
  // false when storage throws, so the UI must be given the chance to re-read and agree with it
  // rather than keep showing a value nothing can now confirm.
  notifyUpdateDots()
}

export const clearUpdateDot = (key: string): void => {
  try {
    localStorage.removeItem(key)
  } catch {
    /* best-effort */
  }
  notifyUpdateDots()
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// WHAT THIS DEVICE LAST SAW IN THE CHANGELOG (2026-08-10, the owner's observation on v2.21.1).
//
// THE DEFECT THIS CLOSES. Both dots used to be lit by one line in main.tsx on `buildChanged` alone —
// "this device last booted a different build" — which knows nothing about whether the changelog
// gained anything. So an internal deploy pointed the player at an entry they had already read. It
// is not hypothetical: 2026-08-10 shipped v2.21.0 (two new lines) and then v2.21.1 (an internal
// hardening). Under the charter the day's entry already stated the day's net effect, so v2.21.1
// correctly added nothing — and everyone holding v2.21.0 got a breadcrumb leading nowhere.
//
// ★ THE TWO DOTS MEAN DIFFERENT THINGS, AND ONLY ONE OF THEM WAS LYING. The GEAR dot means "the app
// updated", which is true on every build change and STAYS that way (the owner re-opened that
// question himself and confirmed it): the Updating screen has already fired by then — it cannot be
// suppressed, because the same detection cannot tell a typo fix from a redesign — so removing the
// gear dot would leave the app announcing an update and then behaving as though nothing happened.
// The CHANGELOG dot means "there is something new to READ", and that is what needs gating.
//
// ⚠ THE NEWEST ENTRY ONLY, AND THAT IS DELIBERATE. Hashing the whole visible list would fire when
// the ELEVENTH day rolls off into CHANGELOG-ARCHIVE.md (rule 14) — the list would differ while
// nothing new had been added, a false positive. Comparing only the newest entry's DATE would miss
// the opposite case: a second deploy on the same Pacific day ADDING a line to the existing entry,
// which is exactly what v2.21.0 did. So the stamp is the newest entry's date AND its lines.
// ⚠⚠ AND IT IS SOUND ONLY BECAUSE SETTLED HISTORY IS NEVER EDITED — the charter rule above, which
// nothing enforces. A deploy that reworded or added a line to an OLDER entry while leaving the
// newest one byte-identical would be INVISIBLE here: no dot, and the news lost. The build guard
// cannot catch it either (scripts/changelogStamp.mjs inspects only the newest entry's date, and
// structurally cannot see the previous commit's array). So if you are ever tempted to edit a
// shipped entry, this is the consequence: readers who already have that build will never be told.
//
// ⚠ WHAT THE DOT ACTUALLY MEANS, stated because it is not quite "unread". It means "the newest
// entry's text differs from what this device last BOOTED" — the stamp is written at boot, not when
// the changelog is opened. Two knock-on cases, both ACCEPTED: a same-day REWORD that says the same
// thing re-fires, and a same-day DELETION with nothing added re-fires. Both err toward showing a
// dot, which is the same tie-break the migration rule takes below, and a walk of 47 real changelog
// transitions in this repo found the pure-delete-with-nothing-added case has happened zero times.
//
// Stored whole rather than hashed: a few hundred bytes of localStorage costs nothing, and it means
// there is no hash function to be subtly wrong and no collision to reason about. JSON.stringify
// of the array, so the separator question never arises: two entries cannot collide however their
// lines are punctuated, and the stored value stays plain ASCII and legible in devtools.
export const CHANGELOG_SEEN_KEY = 'cg-changelog-seen'

/** The newest entry as one comparable string. Pure — the whole point is that it is testable. */
export const changelogSignature = (entries: readonly ChangelogEntry[]): string => {
  const newest = entries[0]
  return newest ? JSON.stringify([newest.date, ...newest.items]) : ''
}

export const readChangelogSeen = (): string | null => {
  try {
    return localStorage.getItem(CHANGELOG_SEEN_KEY)
  } catch {
    return null
  }
}

export const writeChangelogSeen = (stamp: string): void => {
  try {
    localStorage.setItem(CHANGELOG_SEEN_KEY, stamp)
  } catch {
    /* best-effort — the same rule as the dots: blocked storage must never break boot */
  }
}

/**
 * Is there something in the changelog this device has not seen?
 *
 * ⚠⚠ A MISSING STAMP COUNTS AS CHANGED — THE EXACT OPPOSITE OF `buildChanged`, ON PURPOSE, AND THIS
 * IS THE MIGRATION CASE. `buildChanged` treats a missing stamp as "first visit, nothing to announce"
 * because it is the FIRST thing consulted. This is not: it is only ever reached once `buildChanged`
 * has already returned true, which means an installation that has run a DIFFERENT build before —
 * never a first visit. A missing stamp there means only "we have never recorded what this device
 * saw", which is true of every existing installation on the one boot after this ships.
 * ★ So the tie is broken toward SHOWING the dot, because the two errors are not equal: a spurious
 * dot costs a glance, while a suppressed one costs the player the news entirely. The first boot
 * after this change therefore behaves exactly as today does, and every boot after it is honest.
 *
 * ⚠⚠ THAT MAKES THIS FUNCTION'S NULL RULE CORRECT ONLY FOR A CALLER THAT HAS ALREADY ESTABLISHED
 * THE BUILD CHANGED. `buildChanged` encodes the OPPOSITE null rule in code (lib/buildStamp), so the
 * two comparators genuinely disagree about what a missing value means, and the disagreement is only
 * safe because of the order they run in. Any NEW caller must therefore gate on buildChanged first,
 * exactly as main.tsx does. (Taking that flag as a third parameter was considered, which would turn
 * this paragraph into a unit test; it was not taken because at the sole call site the argument would
 * always be the same variable, and the extra parameter buys nothing a reader of that one line does
 * not already see. Revisit the moment a second caller appears — that is when it starts paying.)
 */
export const changelogChanged = (stored: string | null, current: string): boolean =>
  stored !== current
// ════════════════════════════════════════════════════════════════════════════════════════════════
