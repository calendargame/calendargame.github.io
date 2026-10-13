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

### 2026-08-09

- Stats you have hidden by tapping them now leave an empty box instead of a crossed-out one. A dash now means one thing only — nothing recorded yet — and when Save Stats is off the whole strip dims together, so you can still see at a glance which stats you hid yourself. Nothing is crossed out anywhere any more.
- How to Play has a new Accessibility section: what the app does for screen readers, keyboards, and reduced-motion settings — and, said plainly, where it still falls short.
- With Reduce Motion turned on, a few animations that used to play anyway now hold still as well: the dots on the Updating screen, and the colour fades on buttons.
- Typing in a Year Range box now counts as a change straight away, for everything the Settings menu does about it: the violet bar under the ⚙ button, Save Defaults, Reset Settings, and Full Reset all react to the typing instead of waiting for you to leave the box. Dates still come from the stored range until the year counts.
- The three buttons at the foot of the Settings menu now tell a screen reader when they are unavailable, instead of only looking grey — and on a computer the pointer shows the not-allowed cursor over them.
- Fixed: in Lookup, tapping a row in the History list now shows you which row you tapped. The row is tinted and gets a coloured edge down its left side. Tapping always did put that date back in the box above, but nothing on screen changed to say which one you had picked. On a computer, resting the pointer on a row now lights it up too, on every colour theme.
- Fixed: pressing Esc in a Year Range box now throws away what you typed and puts the stored year back. It used to do the opposite and keep the year you were trying to discard.
- Fixed: pressing Esc in a Year Range box no longer closes the whole Settings menu with it. It just leaves the box, and pressing Esc again closes the menu.
- Fixed: pressing Esc in the AoX run-length box now throws the typing away too, on the AoX screen and inside the Save Defaults box alike.
- Fixed: pressing Esc in the Lookup date box now throws away what you typed and puts back what was there before. That was the last box in the app without it, so Esc means the same thing everywhere now: throw this away and leave the box. Enter still means keep it and leave.
- Fixed: the three buttons at the foot of the Settings menu now do nothing at all while they are dimmed. Save Defaults could previously be opened with a keyboard when there was nothing to save.

### 2026-08-08

- How to Play now scrolls inside its own panel, the same way every other page in the app already did. Two things change with it: tapping the status bar no longer jumps the guide to the top, and dragging on the top bar itself no longer scrolls it.
- Lookup now keeps your 100 most recent dates instead of 20, and once there are two or more the History heading shows how many are saved. Older ones still drop off the bottom on their own.
- Settings now reads properly with a screen reader: the four On/Off switches and the two Year Range boxes each say which setting they belong to. Before this they had no name of their own, so they all announced alike.
- Fixed: on a very short window — or zoomed a long way in — the Save/View defaults box could push its own title and buttons off screen where you could not reach them. It now fits the screen and scrolls inside itself.

### 2026-08-07

- In Settings, Leap Year Chance and Jan/Feb Chance on Leap Years now come before the Julian Calendar settings, so the ones most people change sit nearer the top. How to Play covers them in the same new order.
- The mode menu no longer closes itself when the page scrolls — including a scroll that was already gliding when you opened it. Choosing a mode, tapping the page, pressing Esc, or going Back all still close it.
- After an update, the brief "Updating" screen now always plays out fully, and the launch straight afterwards goes in without the usual opening pause.
- Fixed: a press on the settings gear or the mode menu button that the browser interrupts no longer opens the menu and shuts it again straight away.

### 2026-08-02

- Dates on or before October 4, 1582 can be read in two calendars, and Lookup now shows both — "Julian: Saturday" above "Gregorian: Wednesday" — instead of one chosen for you. The answer sits on three fixed lines: the date, then its reading or readings.
- February 29 of a year like 1500 is a real Julian date and no Gregorian date at all. Lookup now accepts it and answers "Gregorian: Does Not Exist", and Show Codes works through the calendar the date actually has.
- History rows say the same thing in short, so each stays on one line: "J: Sat · G: Wed" for an early date, and just the weekday on its own for every other one. Tap a row to see it spelled out in full above.
- The Julian Calendar setting no longer changes any Lookup answer. It only picks which calendar Show Codes teaches.
- Check for updates now really checks. The link reads "Checking…" while it looks, then answers "Up to date" or "No connection" in the same spot, and installs something only when there genuinely is a new version — so a press with nothing to get no longer throws away the copy that lets the app work offline.
- Opening the mode menu just after flicking the page no longer closes it again straight away: a scroll that was already gliding is left to finish, while a scroll you start with the menu open still closes it.
- Going back to the app from another page no longer sends How to Play to the top. A fresh launch, a reload, and a Full Reset still start there.
- Fixed: the fades and shadows at the edges of a scrolling area now keep up when content grows or shrinks under them — opening Show Codes in Lookup, or a How to Play section — instead of holding the old answer until you next scroll.

### 2026-07-28

- Input, Julian Chance, Leap Year Chance, and Jan/Feb Chance are now drawn as one connected strip of buttons in the settings menu, matching Date Format and the themes.
- A greyed-out setting now greys out all in one piece, instead of fading button by button.
- Opening a How to Play section no longer leaves a sliver of the section above it peeking out under the bar — except right at the bottom of the guide, where there is no page left to scroll.
- The shadow under the top bar now follows your scrolling instead of switching on and off, so it settles the instant the page does — including when you tap the status bar to jump to the top.
- How to Play keeps your place while the app is open: leave for a mode, play, and come back and the same section is still open at the same point on the page. Closing the app and launching it again, reloading it, or a Full Reset starts it fresh at the top; switching to another app and back keeps your place as before.
- In Deduction, the answer buttons are spaced the same in all three sub-modes — the day and year grids were a little tighter than the month one, so they no longer shift as you switch.
- In AoX, the run length box now stands exactly as tall as the Allow Mistakes and One-by-One buttons beside it.
- With a keyboard: click one option of a setting and the arrow keys then move along that setting, choosing each option as you land on it — without stepping the date behind the menu.
- The changelog popup is back to just the list and Close; the small grey note under it is gone, since How to Play already explains how far back the list goes.

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
