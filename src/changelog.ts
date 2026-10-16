// changelog.ts — the plain-words changelog (round 6): what each deploy changed, written for
// players, never developers. Hand-maintained: every deploy adds its lines here, a standing part
// of the deploy ritual.
//
// THE CHARTER (round 8; the two ordering rules amended in round 11) — this array is exactly
// what ships and exactly what the popup draws:
//   • Newest first. Entry dates are the deploy's Pacific calendar date in ISO form (YYYY-MM-DD);
//     the popup renders them through the user's Date Format setting, so never encode a format here.
//     ★ THE NEWEST ENTRY'S DATE IS NOW ENFORCED BY THE BUILD (round 16). The deploy stamp is
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
//     last. Already the de-facto pattern (the 7/26 entry ends on one), written down in round
//     11. The entry is read top-down by someone who has just been handed the update, so the line
//     likeliest to be why they opened it leads; a fix nobody was waiting for closes.
//   • A SECOND DEPLOY ON THE SAME DAY RESTATES THAT DAY'S NET EFFECT VERSUS PRODUCTION — it does
//     not prepend a second log. (The charter said "prepend, newest lines first" until round
//     11; the practice on 2026-07-28 was already better and is what got codified.) A player only
//     ever sees the difference from the version they last had, so an intermediate state nobody
//     ran is not a change: MERGE a correction into the line it corrects, and DELETE outright a
//     line describing something the later deploy reverted. Worked example, 2026-07-28: round
//     10's hairline fix was merged into round 9's How-to-Play line, and round 9's "Date Format
//     now stacks" line was deleted because round 10 reverted it and no player ever saw it.
//     Lines already SHIPPED on an earlier day are settled history — never reordered or reworded
//     to suit a later rule.
//     ONE EXCEPTION, MADE ONCE (the owner's instruction, 2026-10-07): the Oxford-comma sweep added
//     the comma before the final "and" / "or" of every list of three or more, in every entry here
//     and in the archive. PUNCTUATION ONLY — not a word moved — and done in a release whose newest
//     entry was a new one, so the changelog dot (keyed on the newest entry's text, below) saw
//     nothing but real news. tests/oxfordCommaGuard now holds every new line to the same comma, so
//     the sweep never needs repeating; it is not a licence to reword settled lines.
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
// after an update. ⚠ THEY NO LONGER FIRE TOGETHER (2026-08-10): the build-change detection (in
// main.tsx) marks the GEAR dot on every build change, but marks the CHANGELOG dot only
// when the newest entry here has actually changed since this device last looked — see
// CHANGELOG_SEEN_KEY at the bottom of this file for why, and for the migration case. Opening ⚙
// Settings clears the gear button's dot; the first tap on the Changelog link clears the link's own.
// Plain localStorage, not a store — the flags describe the code that ran, not user data — and
// try/catch throughout: blocked storage (privacy modes) must never break boot, it just means no
// dots.
//
// ★ THIS FILE WRITES localStorage ITSELF, AND SAYS SO EVERY TIME. Every other write in the app goes
// through store/storageHealth — the storage door — and that is how the count of how full the device
// is (store/storageUsage) stays exact. This file cannot call the door: it may import nothing
// (vite.config.js loads it at build time). So the dependency runs the other way. The door hands
// this file one listener (reportWritesTo), and each writer below names the key it has just written
// or removed; the door reads what that key now holds and counts it. Where the door was never
// loaded — the build-time import — there is nobody to tell, and nothing is said.
// ⚠ A NEW WRITER HERE MUST DO THE SAME, on the line after its write. tests/storageDoor pins it.

export type ChangelogEntry = {
  date: string // the day's Pacific date, ISO YYYY-MM-DD (unique — same-day deploys merge)
  items: string[] // short plain-words lines, one visible change each
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-10-16',
    items: [
      "In Blitz, the time slider and the countdown are now one. Press Begin and the slider becomes the round's countdown in the same place, with the time left where the slider's value was; Reset brings the slider back. The Blitz page is a little shorter for it.",
      "In Blitz, a small line under each best now gives that round's other number: its streak under Best Score, and its score under Best Streak — so even a narrow phone can tell whether one round set both. A best from before this update shows a dash there until you beat it.",
      'In the ⚙ menu, Save Defaults, Reset Settings, Full Reset, View Saved Defaults, and Clear Saved Defaults are now the first thing under Per-preset, and scroll with the settings, so the list has much more room. The part that stays put at the bottom is now three short lines: your Contact email, then Storage used with the Changelog, then Last Updated with Check for updates. On a wide phone the Changelog no longer drops onto a line of its own.',
      'Manage Presets has a new Duplicate button beside New Preset. Pick a preset from its list to get a copy with all of its settings, saved defaults, per-mode setup, and Amnesic setting, but none of its stats, bests, or times. The copy is named after the original with "(2)" on the end, sits right under it, and you stay on the preset you were on.',
      "Once it is open, the ⚙ menu's Open in list now works like the top bar's lists. Slide your finger onto the option you want and lift to choose it. Lift off the list to choose nothing.",
      'A button now works however long you hold it before lifting your finger, and when you slide off it and back on before lifting. On an iPhone, a press held for a couple of seconds, or moved about, used to do nothing. The same goes for the dimmed area around a popup: a long press there now closes the popup.',
      'On an iPhone, a quick double tap and hold no longer brings up the magnifier on a screen that does not scroll, on its buttons, labels, and numbers alike. Boxes you type in keep it.',
      'The figures at the top of a MoX or Blitz breakdown are in a new order: Solves, Fastest, Slowest, and Spread down the left, and Accuracy, Mean, and Median down the right.',
      'On the narrowest phones, where even "P1" would be cut, the ready-made preset names ("Preset 1", "Preset 2", and so on) are now shown as just their numbers: "1", "2", and so on, all of them together.',
      'A preset name that your device draws as nothing at all, such as some pasted symbols, now counts as a blank name: it goes back to "Preset 2" and the like, as a name of spaces does, instead of leaving an empty button. A symbol your device has no picture for, which it shows as a box, still counts as a name.',
      "How to Play's text, the keyboard keys it shows, and the ⚙ menu's headings now grow and shrink with the rest of the app's text on smaller and bigger screens, so they never read larger than what is around them. On a typical phone they look just as before.",
      'The Show Codes box now has as much room above its codes as below them, like the stats boxes. That room grows with the text on a bigger screen.',
      "Fixed: in the ⚙ menu, scrolled all the way down, the Amnesic picker's bottom edge is no longer cut off.",
      'Fixed: on a very narrow screen, the Mode button no longer covers the end of the Preset button, and the ⚙ no longer runs off the edge. The Preset button keeps room for its arrows and a number, and the Mode button gives way instead, its name cut short where it does not fit.',
      "Fixed: in Manage Presets, pressing your device's Back while typing a preset name no longer throws the name away. It keeps it, as tapping away does, and closes the popup. Escape still throws a name away.",
      'Fixed: on an iPhone, a flick that started on a button in the ⚙ menu could press that button as your finger lifted, such as opening the Open in list. A flick now only scrolls, wherever it starts.',
    ],
  },
  {
    date: '2026-10-12',
    items: [
      'Preset names can now be any length, and nothing you type is turned away. Where a name is too long for its spot it ends in “…”, and Manage Presets tells you at the exact letter where that starts.',
      'On a narrow screen, a preset still called “Preset 1” is shown as “P1” so that it fits, and it goes back to its full name wherever there is room. Only what is shown changes.',
      'The preset list at the top of the screen is the same width as its button again, and every drop-down list draws its rows the same way. On a very narrow screen the list is a little wider than its button, so that no row is left blank.',
      'Fades at the edge of a scrolling area are now half as deep. Every shadow in the app now comes from one small set, in each theme’s own colour, and the answer buttons no longer have one.',
      'When Amnesic is on Full the stats strip and the Best line in MoX and Blitz now share a single dashed outline. There used to be two. The Best line is set in a little from the edge to make room.',
      '“Storage used” now shows one decimal place. It reads “<0.1%” when something is stored but too little to show a digit, which a screen reader says as “under 0.1%”. Its breakdown has a new “Preset names” line.',
      'In MoX and Blitz, the tag beside your bests no longer drops onto a line of its own. Where the screen is too narrow for it, it is left out.',
      'In How to Play, the fade under the top bar now goes away while an open section’s title is pinned there, and it comes and goes smoothly as sections open, close, and swap. A title sitting above the top bar now glides into place.',
      'With the ⚙ menu open, Shift+Tab now reaches the ⚙ button, the mode list, and the preset list, so both lists can be opened from the keyboard.',
      'Lists of three or more things now carry a comma before the final “and” or “or”, throughout the app, How to Play, and this changelog.',
      'A preset name with nothing in it that can be seen now counts as blank, and goes back to the preset’s default name.',
      'If a device has no room to save a new preset name, the name is left as it was and a note under it says so.',
      'A few small notes in ⚙ Settings now scale with the rest of the text on small screens and on large ones. So do the small lines under your MoX bests.',
      'Fixed: the keyboard ring on the stats strip now follows its round corners.',
      'Fixed: in How to Play on a slow device, the page could drift out of step with a long section closing above the one you opened.',
      'Fixed: on a computer, a drop-down list long enough to scroll no longer loses room for its names to the scrollbar.',
      'Fixed: a drop-down list left open while the screen turned could keep its old width.',
      'Fixed: after the screen turned, the shadow at the edge of a scrolling area could fade in over the wrong distance.',
      'Fixed: an emoji at the end of a long preset name could be cut in half.',
    ],
  },
  {
    date: '2026-10-06',
    items: [
      'Amnesic, in ⚙ Settings → Stats, now has three choices: Off, Stats Only, and Full. Full is what Amnesic always was. On Stats Only your Blitz and MoX bests are your real saved ones and a new best is kept for good, while everything in the stats strip is for the session only and Lookup history saves as normal.',
      'The A that marked an amnesic preset is gone, so a preset’s name has its full room back. Instead, a dashed outline goes round whatever won’t be kept: the stats strip on Stats Only and Full, and the Best line too on Full.',
      '⚙ Settings now always shows a “Storage used” line near the bottom. Tap it to see what is taking the space and what you can clear. If you ever reach 80% it turns amber, the ⚙ button shows an amber dot, and the breakdown opens once by itself at a moment when you aren’t mid-question.',
      'The modes are now listed Classic, Deduction, Flash, MoX, Blitz — in the mode menu, in Default Mode, in Save Defaults, and throughout How to Play. The letter keys are unchanged.',
      'The ⚙ menu and every popup now have a fully solid background, so nothing behind them shows through. The drop-down lists keep their frosted look.',
      'In How to Play, a section you open now settles in the same spot its title pins at, flush under the top bar, and the shadow sits under whichever edge the text is sliding beneath.',
      'In ⚙ Settings → Manage Presets, the ✕ is now drawn dead centre, and a row you drag no longer carries a pill around the whole row — only its ✕ button and name box lift. The other rows now make way at the halfway point in both directions.',
      'The preset list at the top of the screen now widens to show every name in full.',
      'An answered date now remembers which calendar it was judged in, so browsing back to it always shows an answer and codes that agree, even if you changed Julian Calendar in between. A February 29 that the regular calendar doesn’t have is replaced with a new date when you switch Julian off before answering it.',
      'While the ⚙ menu, a drop-down list, or a popup is open, no key reaches the page behind it any more. The mode letters, H, and G still work.',
      'Keyboard: Tab and Shift+Tab now stay inside the ⚙ menu and walk all of its controls; the preset list, the mode list, and Open in all open with Enter or Space; and a ring now shows where the keyboard is, anywhere in the app. The ring never appears for a tap or a click, and the game’s shortcut keys don’t trigger it.',
      'Which preset you are on, and its Amnesic setting, now belong to the window you are in, so two windows no longer change each other and a reload always comes back to the same place.',
      'In MoX, the tag in the breakdown now reads Same Run or Different Runs.',
      'The Reset Stats and storage popups now say exactly what they clear for the Amnesic setting you are on.',
      'How to Play has been checked line by line against the app again.',
      'Fixed: in Flash, the countdown could stay frozen after Reset Stats.',
      'Fixed: one Back press could do nothing after a reload with the ⚙ menu or a popup open.',
      'Fixed: dragging a preset down by a single pixel could swap it with the one below.',
      'Fixed: a finished round you came back to could write over a better best set in another window.',
    ],
  },
  {
    date: '2026-10-02',
    items: [
      'The iPhone status bar now dims along with the rest of the screen when a popup opens in the app installed on your home screen, and brightens again when it closes. It follows a split second behind the page — that part is the phone’s doing.',
      'On a Windows computer, text on the page is drawn the way it was before the last update again, matching the text in the ⚙ menu and popups.',
    ],
  },
  {
    date: '2026-10-01',
    items: [
      'Rotate Dots, in ⚙ Settings → Display, now has three choices: Standard, 45° CCW, and 90° CCW. At 45° the dots are a little smaller so the turned pattern fits; Standard and 90° are exactly as they were. Your choice carries over to your saved defaults and to every preset.',
      'Every solve time is now kept, so Mean and Median cover all of your times instead of only the newest 1,000. Times an earlier version had already dropped can’t be brought back.',
      'Lookup history is now unlimited instead of stopping at the newest 100, and the list stays smooth however long it grows.',
      'Only really closing the app starts things fresh now. A reload keeps your Back and Forward history in Classic, Flash, and Deduction, your place in How to Play, and whatever is on screen in Lookup. A Blitz round or MoX run still in progress is the exception: a reload ends it.',
      'Switching presets no longer clears anything either. Each preset keeps its own Back and Forward history for when you return, and How to Play and Lookup stay exactly as you left them. The same goes for turning Amnesic on or off.',
      'When you come back to a date you hadn’t answered — after a reload, a preset switch, or a guest — you get a new date if a time could still be recorded for it, so a time can never be set on a date you’d already seen. With timing stats hidden or Save Stats off, the same date is waiting for you.',
      'A guest playing in Amnesic can no longer change your bests. Your finished Blitz round or MoX run is put aside while they play and comes back when Amnesic goes off — unless a setting it was played under was changed, in which case it isn’t brought back and its bests stay as they were.',
      'Whether a Blitz round or MoX run counts is now decided once, by Save Stats at the moment it first ends. A practice round can never be recorded afterwards, and a recorded one stays recorded.',
      'In Blitz, the ★ next to a best now means what it means in MoX: the round on screen set it. It stays while that round is on screen, including after a preset switch or a reload, and goes if an Override takes the best away.',
      'In MoX with One-by-One on, the next date now always waits for Continue, and the clock starts when you press it.',
      '⚙ Settings → Open in is now a dropdown, the same as the preset picker at the top, so it stays one row however many presets you have. It also now applies only when the app is freshly opened — a reload keeps you on the preset you were on.',
      'In ⚙ Settings → Manage Presets, each row is now ✕ on the left, then the name, with a plain ≡ grip on the right. A row you drag can no longer slide off the list or show a white band, and holding it near the top or bottom scrolls a long list for you.',
      'In How to Play, the title of the section you’re reading now stays pinned under the top bar as you scroll through it.',
      'Lookup lost its two dividing lines, and Show Codes now sits directly under the answer.',
      'Popups now stack properly. Esc, Back, or a tap outside closes only the one on top — including a dropdown list inside ⚙ Settings, which used to take the whole menu with it — and the page behind is dimmed once however many are open.',
      'If your device runs out of storage, the app now tells you with a “Your progress isn’t being saved” popup and carries on. Your newest answers are kept until you close or reload the app, are saved by themselves as soon as there is room, and Check for updates waits until then.',
      'Another attempt at dimming the iPhone status bar along with the rest of the screen when a popup opens in the app installed on your home screen.',
      'How to Play has been checked line by line against the app again, and the Amnesic, Saved Progress, Lookup, and keyboard sections were corrected.',
      'Fixed: Last could show a time a hundredth of a second faster than the one you actually got.',
      'Fixed: in Deduction, turning timing stats back on gave a new puzzle only in the sub-mode on screen. All three now get one.',
      'Fixed: changing a date setting during a live flash in Flash swapped the date underneath it.',
      'Fixed: a best of 0, or an empty MoX best, could be left behind after an Override took a first score back, keeping Full Reset lit.',
      'Fixed: the run breakdown in Blitz and MoX could reopen by itself when you left the mode and came back.',
      'Fixed: in Lookup, a date the app refused left the previous date’s codes open under the error, and the arrow keys could change Lookup behind an open popup.',
      'Fixed: pressing a popup’s button with a mouse, sliding off to cancel, and letting go on the dimmed area closed the popup.',
    ],
  },
  {
    date: '2026-09-23',
    items: [
      'Override is now a switch you can flip as often as you like, in every mode. After you override a date the button reads Undo — press it and that date goes back to exactly how you answered it, red highlights and all, with your score, streak, and times following. Every date you’ve played remembers this for as long as it’s in your history, so you can browse back to one and flip it again.',
      'A finished Blitz round or MoX run you come back to after switching presets brings every date’s Override or Undo with it.',
      'In Blitz and MoX a tap of Override or Undo can now end a round or run as well as rescue one. A Blitz round that a tap ended keeps its date on screen and its clock running until you put it right, and with Allow Mistakes on in MoX, taking the credit off a run’s final solve hands the run back with a Next button. How to Play has the full rules.',
      'A failed MoX run now opens its breakdown too — tap the stats strip, just like a finished run — and a failed run always shows its times.',
      'Each row of the run breakdown now shows that date’s day of the week as one letter (the key is in How to Play), and fastest, slowest, missed, shown, and overridden now sit before the time, so the times line up in one column.',
      'In ⚙ Settings the Global and Per-preset headings are now centered, with a heavier line across the menu splitting it into its two halves.',
      'Popups no longer carry a Cancel button. The one button left on a popup is the one that goes ahead — Delete, Reset Stats, Full Reset, Save — and to back out you tap outside the box, press Esc, or use Back, exactly the way the Changelog and the saved-defaults popup already closed.',
      'In ⚙ Settings → Manage Presets, backing out of a delete question now takes you back to the list of presets with the popup still open, instead of closing the whole thing. Back out again from there and it closes.',
      'Deleting a preset you’ve never used — nothing played, nothing changed, nothing saved — no longer asks first. A preset with anything in it, including a round or run still going, still asks.',
      'Each mode’s Reset Stats popup now also says that no other preset is touched, and Reset Settings and Full Reset now say exactly what they restore.',
      'How to Play has been checked line by line against the app, and the Stats, Override, Blitz, and MoX sections in particular now say exactly what each number and button does.',
      'Another attempt at dimming the iPhone status bar along with the rest of the screen when a popup opens in the app installed on your home screen. An earlier note said this already worked; in the installed app it didn’t.',
      'If this update arrives while a finished Blitz round or MoX run is waiting on screen, dates you’d already overridden in it come back without your original wrong highlights — the older version never kept them. Your score and times are unaffected.',
      'Fixed: turning Amnesic on by itself could not be saved as a default. Now it can, and it lights up Reset Settings and Full Reset like any other change.',
      'Fixed: a star could stay lit next to a Blitz best that an Override had taken back.',
      'Fixed: a finished Blitz round you came back to after switching presets could resume with a full minute on the clock instead of the time it actually had left.',
      'Fixed: the Last time could show an older date’s time after an Override.',
      'Fixed: the breakdown’s Fastest and Slowest could read a hundredth of a second different from the same solve in the list below.',
    ],
  },
  {
    date: '2026-09-10',
    items: [
      'Each preset can now choose which page it opens on — any mode, Lookup, or How to Play — in ⚙ Settings → Default Mode. And a new Open in setting, at the top of the Settings menu, chooses which preset the app opens into when you launch it: the one you used last, or one you pin.',
      'Within a single visit each preset also remembers the page you were last on, so leaving a preset and coming back returns you to it. Fully closing the app sends each preset back to its Default Mode.',
      'Every reset now asks first, with a popup that says exactly what it will clear and whether it affects only this preset or the whole app — Full Reset, Reset Settings, each mode’s Reset Stats, and Clear Saved Defaults. The old “tap again to confirm” buttons are gone.',
      'A finished Blitz round or MoX run now stays on its results page when you switch presets and come back. Only pressing Reset, or fully closing the app, clears it — the way it worked before presets.',
      'The Changelog, the saved-defaults popup, and the run breakdown no longer carry a Close button: tap outside the box, press Esc, or use Back. The confirmation popups keep their Cancel and Save.',
      'The Dot Layout switch, in Settings → Display, is now called Rotate Dots CCW, so its name says what it does.',
      'The run breakdown is now titled for the mode it belongs to — Mean Breakdown in MoX, and Round Breakdown or Run Breakdown in Blitz.',
      'The mode picker at the top of the screen is now exactly as wide as the menu it opens, and the preset picker beside it fills the space that leaves.',
      'View Saved Defaults and Clear Saved Defaults, at the foot of the Settings menu, are now buttons matching the three above them rather than underlined links.',
      'The status bar along the very top of the screen now dims to match the page behind a popup, instead of staying bright.',
      'Amnesic now returns to whatever your saved defaults say each time you reopen the app, instead of staying where it was left.',
    ],
  },
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
      'The app can now hold several separate set-ups at once, called presets. Each one keeps its own settings, stats, bests, saved defaults, and lookup history, so a preset you practise in and a preset you experiment in never touch each other. Switch between them with the new picker at the top of the screen — press and slide down to it, the same way the mode picker works. Make, rename, reorder, and delete presets under ⚙ Settings → Manage Presets.',
      'The top of the screen is rearranged to make room for that picker: logo on the far left, then the preset picker, then the mode picker, with the gear on the far right. The "Calendar Game" wordmark has gone to pay for the space.',
      'Any preset can be made Amnesic, under ⚙ Settings → Stats. While that is on, the preset records nothing — no stats, no bests, no lookup history — and everything from the session goes when the app closes. It is there for handing your phone to someone else, or for playing without it counting. Presets with it on are marked with an A in the picker.',
      'When a Blitz or MoX run finishes, tapping its row of stats now opens the whole run question by question, with your fastest and slowest marked and the mean, fastest, and slowest shown together.',
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
  // ★ THE ARRAY IS AT TEN, so every new day retires the oldest into CHANGELOG-ARCHIVE.md (the
  // ten-entry rule in the charter above). The most recent: adding 2026-10-15 retired 2026-08-10.
]

// Who is told which key this file has just written or removed (the header says why).
let wrote: ((key: string) => void) | null = null
export const reportWritesTo = (listener: (key: string) => void): void => {
  wrote = listener
}

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
    wrote?.(key)
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
    wrote?.(key)
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
    wrote?.(CHANGELOG_SEEN_KEY)
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
