# Changelog archive

Retired entries from the in-app changelog (`src/changelog.ts`) — the plain-words "What's new"
list players read behind **⚙ Settings → Changelog**.

`src/changelog.ts` holds **at most ten day-entries, ever**. The popup renders that array as-is,
so anything left in the code file both ships to every visitor and gets drawn. When a new day
would make it eleven, the **oldest** entry moves out of the code file and into this one —
unchanged, keeping its ISO date and its lines verbatim, newest day first below.

This file is documentation only. **No source file imports it**, it lives outside `public/`, and
the build never touches Markdown, so not one byte of retired history reaches the bundle. The rule
lives with the data, in the charter comment at the top of `src/changelog.ts`.

## Retired entries

### 2026-07-26

- The Lookup page no longer scrolls as a whole — only the history list moves, and it now uses whatever room your screen has instead of stopping at a fixed height.
- The answer line in Lookup always keeps its space, so nothing on the page shifts as answers come and go. Before your first lookup, or after Clear, it simply invites you to enter a date.
- Lookup works out every answer and every history row afresh, so changing your Date Format or the Julian Calendar setting updates the answer line and the whole list together.
- The five themes are now buttons in two labelled rows, Dark and Light, instead of hiding inside drop-down menus — and both rows always show, so the settings menu no longer changes height.
- Turning Use System Settings off now keeps whichever theme is already on screen.
- The app keeps your place when you switch away and come back, instead of jumping to the top — in How to Play and in the game screens alike. And a How to Play section you open now comes to rest just clear of the bar at the top, with its title fully readable.
- Tapping a value to type it — a timer, or the AoX Run Length — no longer nudges the row around it, and a longer number is no longer cut off as you type.
- In Deduction, the month answer buttons are now the same size as the year and day ones.
- The small light-blue dot now sits just after the word Changelog instead of on top of it, and the changelog itself keeps the ten most recent days that had an update.
- Fixed: in AoX, the codes panel no longer swaps what it shows while it is sliding shut.
- The Show Codes button now stands exactly as tall as the buttons beside it.
- The settings controls and the Show Codes button now describe themselves properly to screen readers.

### 2026-07-21

- The small links at the bottom of the settings menu now share consistent spacing.
- Side-swiping no longer flips the installed app through pages on iPhone.
- Typing a timer value no longer nudges the slider.
- Every input box now wears the same border as the buttons.
- Guide panels open and close with a smooth, matched motion that keeps your place on the page.
- Fixed: the Lookup page no longer scrolls as a whole — long history lists scroll inside their own box again.
- This changelog and the Lookup history list now scroll the same way as the settings menu: content fades softly at the edges, and the scrollbar stays clear of the text.

### 2026-07-19

- Added this changelog: after an update, a small light-blue dot appears on the gear button, and then on the Changelog link inside, until you have taken a look.
- The brief updating screen now also appears when a new version arrived quietly between visits, so an update never slips by unannounced.
- Typing a timer value no longer stretches its box while you edit.
- Guide panels open and close at one smooth, even pace, whatever their length.
- View saved defaults is always available, shows the launch values until you save your own, and now lets you edit and save right from the popup; clearing saved defaults asks for confirmation first.
- Reset Settings now restores everything your saved defaults cover, including the four mode-screen values.
- Blitz and AoX can hide their time stats; timing quietly carries on, so nothing is lost when you show them again.

### 2026-07-17

- Blitz Per Question gains an Allow Mistakes option, with its own best score and best streak.
- Timer readouts keep one steady width, so sliders no longer shift as values change.
- Dropdown menus in the guide close when the page scrolls.
- Every reset snaps the screen back instantly and cleanly.
- Deduction stays centered and its layout holds steady while you answer.
- A View saved defaults link shows exactly what you saved.
- The app stays portrait: Android installs lock to it, and turning an iPhone sideways brings up a rotate-back screen that pauses any countdown.
- Text in the guide can now be selected and copied.
- Plus a round of smaller fixes and polish throughout.
