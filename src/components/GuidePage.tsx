import { useState, useCallback, type ReactNode } from 'react'
import Expander from './Expander.jsx'
import { Kbd } from './primitives.jsx'

// GuidePage / GuideSection — the How-to-Play tab: an accordion of documentation
// sections (each a GuideSection wrapping an Expander) covering every observable
// behavior on the site. GuideSection is the reusable open/close row; GuidePage
// lays them out with Divider separators. Pure content + local open/close state.
//
// Extracted from main.jsx in Stage C, Step 4e (verbatim prose). GuideSection is
// exported named; GuidePage is the default export.
export function GuideSection({
  id,
  title,
  children,
  openId,
  onToggle,
}: {
  id: string
  title: ReactNode
  children?: ReactNode
  openId: string | null
  onToggle: (id: string) => void
}) {
  const isOpen = openId === id
  return (
    <div className="rounded-2xl panel overflow-hidden">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="w-full text-left px-4 py-3 flex items-center justify-between"
      >
        <span className="text-sm font-semibold text-purple-50">{title}</span>
        <span
          className={`text-[7px] text-white/90 leading-none transition-transform ease-in-out ${isOpen ? 'rotate-180' : ''}`}
          // Match the Expander's duration EXACTLY (.expander uses the same calc) so the triangle and
          // the panel finish together — and honor the reduce-motion --motion-scale, so both snap
          // instantly under "Reduce Motion" instead of the panel snapping while the triangle spins.
          style={{ transitionDuration: 'calc(0.28s * var(--motion-scale))' }}
        >
          ▼
        </span>
      </button>
      <Expander open={isOpen}>
        <div className="px-4 pb-4 pt-1 text-[13px] text-purple-100/90 leading-relaxed space-y-2">
          {children}
        </div>
      </Expander>
    </div>
  )
}
// Section divider with a centered label, placed between GuideSection groups. Defined at
// module scope (not inside GuidePage) so it's a stable component type across renders —
// React's compiler flags components created during render. It closes over nothing but
// its `label` prop, so hoisting is behavior-identical.
function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-1 pt-1">
      <div className="flex-1 h-px bg-purple-500/20"></div>
      <span className="text-[10px] uppercase tracking-widest text-purple-300/60">{label}</span>
      <div className="flex-1 h-px bg-purple-500/20"></div>
    </div>
  )
}
export default function GuidePage() {
  const [open, setOpen] = useState<string | null>(null)
  const toggle = useCallback((id: string) => setOpen((o) => (o === id ? null : id)), [])
  return (
    <div className="space-y-2">
      <GuideSection id="overview" title="What Is Calendar Game?" openId={open} onToggle={toggle}>
        <p>
          Calendar Game is a training tool for mental calculation of the day of the week. You're
          given a date and must identify which weekday it falls on — as quickly and accurately as
          possible. Dates use the proleptic Gregorian calendar by default. The Julian calendar is
          supported as an opt-in setting for dates on or before October 4, 1582 (the day before the
          Gregorian reform took effect).
        </p>
        <p className="mt-2">
          It runs entirely in your browser and saves your progress on this device. You can add it to
          your home screen and use it like an app — on iPhone via Safari's Share button → Add to
          Home Screen, on Android via Chrome's Install app / Add to Home screen — and once it has
          loaded it works fully offline, with no connection needed to practice.
        </p>
        <p className="mt-2">
          It pairs with the book{' '}
          <i>Day-of-the-Week Calculation: A Highly Optimized Mental Method</i>.
        </p>
        <p className="mt-2">
          If you have any questions, ideas, or recommendations, or have noticed any bugs or mistakes
          — whether about the site or the book — please feel free to reach out:{' '}
          <a href="mailto:dayoftheweekcalculation@gmail.com" className="underline break-all">
            dayoftheweekcalculation@gmail.com
          </a>
          .
        </p>
      </GuideSection>
      <Divider label="Interface" />
      <GuideSection id="buttons" title="Buttons" openId={open} onToggle={toggle}>
        <p>
          <b>New</b> — load a fresh date. In timer modes, only available after pressing Begin.
        </p>
        <p>
          <b>Begin</b> — timer modes only (Blitz, Flash, AoX). Starts a round or run. After pressing
          Begin, the timer starts and the date is shown (Flash hides it after the configured
          duration; AoX hides it between solves only when One-By-One is on).
        </p>
        <p>
          <b>Reset</b> — timer modes only. In Blitz, ends the current round and unlocks settings;
          saved bests for the round are preserved. In AoX, ends the current run; saved bests are
          preserved. Press Reset and then Begin to start a fresh round/run.
        </p>
        <p>
          <b>Reset Stats</b> — casual modes only (Classic, Flash, Deduction). Clears your stats and
          question history for the current mode (Deduction only resets the current sub-type's
          stats). Generates a new date when timing stats are visible, or when you've burned the
          current date (answered wrong, revealed, or shown codes); otherwise the current date is
          kept. In Flash, mid-question Reset Stats always generates a new date and returns to the
          dash state. Does not affect timer-mode bests.
        </p>
        <p>
          <b>Back (&lt;)</b> — return to the previous date. The answer is shown and the card is
          locked. No stat penalty. You can go back through your entire history in Classic, Flash,
          and Deduction; in Blitz and AoX, you can browse the current round or run. Every entry in
          your history shows the correct answer in green; if you got it wrong, your wrong guess(es)
          appear as dimmed red alongside the green. While browsing back, a small <b>Q#</b> label
          appears at the top-right of the date card showing your position in history (e.g. Q3 means
          you're on the third question viewed).
        </p>
        <p>
          <b>Forward (&gt;)</b> — move forward through dates you've browsed past with Back. The
          forward history clears whenever you answer a new question, press New/Begin/Reset, or take
          any action that advances the date. Overriding while browsing back does not clear the
          forward history. Each entry remembers its date format and calendar system, so a
          back-then-forward round trip never alters how a date was originally shown.
        </p>
        <p>
          <b>Reveal</b> — show the correct answer without guessing. Counts as a wrong attempt. No
          penalty on unanswered dates while browsing back.
        </p>
        <p>
          <b>Override</b> — fix a mistake. You can override any date in your history by browsing to
          it with Back/Forward. After a wrong answer: gives you credit with time recorded and
          adjusts your score. After a correct answer: undoes the credit and adjusts your score.
        </p>
        <p>
          You can also override the most recent past date directly from a fresh, untouched live question
          (in any mode) — Override is enabled when the live date hasn't been answered yet, and
          tapping it flips your previous date's right/wrong status. A previously correct date that's
          been retroactively flipped to wrong shows up with a green-and-red diagonal split:
          green-upper-left (originally correct) and red-lower-right (now counted wrong). You can
          only override each date once. Overriding a wrong answer (regardless of how) clears any
          wrong highlights; only the correct answer is shown.
        </p>
        <p>
          In Blitz, you can override past dates
          after the round ends to adjust your score and saved bests; and with Allow Mistakes off (or
          in Per Question), overriding a correct answer to wrong during a round ends the round, just
          like a wrong answer. In AoX without Allow Mistakes, overriding a correct answer ends the
          run. Override is locked when Save Stats is off.
        </p>
        <p>
          <b>Show Codes</b> — reveals the calculation codes for the current date. Counts as wrong if
          you haven't already answered incorrectly. No penalty on unanswered dates while browsing
          back. In Blitz, opening Show Codes during a round ends the round and records your bests;
          in Flash it freezes the countdown so the date stays on screen while you study the codes.
          In AoX without Allow Mistakes, opening Show Codes ends the run.
        </p>
      </GuideSection>
      <GuideSection id="stats" title="Stats" openId={open} onToggle={toggle}>
        <p>
          <b>Score</b> — correct first-try answers out of total attempts. In Blitz, only the current
          round is shown. In AoX, shows correct answers out of total attempts; the run ends once
          correct answers reach the set number.
        </p>
        <p>
          <b>Accuracy</b> — percentage of questions answered correctly on the first try. Shows —
          until your first attempt.
        </p>
        <p>
          <b>Streak</b> — your current consecutive correct streak / your best in this session.
        </p>
        <p>
          <b>Last / Avg / Med</b> — timing stats, calculated using correct answers only. Last is
          your most recent correct time; Avg is the average across all correct answers; Med is the
          median, which is less skewed by outliers. Any time of 60 seconds or more — whether an
          individual solve, a computed average or median, or any Best — displays as "—". Times are
          still tracked internally and contribute to averages, medians, and best-tracking; only the
          display is capped. Your saved solve times keep a rolling window of the most recent 1000
          (older times roll off so saved progress stays small on your device), so after a lot of
          practice Avg and Med reflect your recent 1000 rather than all-time; within a single visit,
          every solve still counts.
        </p>
        <p>
          Time formatting follows the WCA speedcubing convention: individual single times (Last) are{' '}
          <i>truncated</i> to hundredths — the third decimal is dropped, never rounded. Averages,
          medians, and bests are <i>rounded</i> to the nearest hundredth. Truncating singles
          prevents fortunate rounding boundaries on individual attempts; rounding aggregates avoids
          systematic downward bias.
        </p>
        <p>
          One question = one attempt. Getting a question wrong then right still counts as one
          attempt, marked correct.
        </p>
        <p>When you set a new best, a small ★ appears next to the value to flag it.</p>
        <p className="text-purple-300/70 text-[12px]">
          In modes designed for casual practice (Classic, Deduction, Flash), you can tap any stat to
          hide it. Tapping Score, Accuracy, or Streak hides all three; tapping any timing stat hides
          all three. Score, Accuracy, and Streak continue tracking in the background while hidden —
          re-enabling them brings the same numbers back.
        </p>
        <p className="text-purple-300/70 text-[12px]">
          Timing stats behave differently: timing
          pauses entirely while hidden — no times are recorded. When you turn timing back on, the
          current date is regenerated if it's still unanswered; if you've already answered wrong,
          revealed the answer, or shown codes, the date stays until you advance yourself. If any
          questions were answered while timing was hidden, a desync would arise on re-enable, so the
          three timing stat boxes merge into a single "Enable and Reset Stats?" confirmation — tap
          it again within 3 seconds to confirm (turn on and full reset), or tap anywhere else to
          cancel.
        </p>
        <p className="text-purple-300/70 text-[12px]">
          When Save Stats is off, all stat boxes site-wide (across every mode, including
          AoX) show '—' with strikethrough labels, dim, and become non-interactive — toggling timing
          or scoring is disabled until Save Stats is turned back on, which prevents accidentally
          creating stat desyncs. Turning Save Stats on while timing is also on regenerates an
          unanswered date for a clean fresh start.
        </p>
        <p className="text-purple-300/70 text-[12px]">
          When timing stats are off, leaving and returning
          to a mode preserves the current question exactly as you left it — same date, same answers,
          codes panel in the same state. In all other modes, stats are always visible.
        </p>
      </GuideSection>
      <GuideSection id="keyboard" title="Keyboard Input" openId={open} onToggle={toggle}>
        <p>
          On any device with a hardware keyboard (typically desktop), you can press keys to operate
          the site without tapping. The on-screen layout is identical to mobile — keyboard input is
          the only desktop-specific addition.
        </p>
        <div className="mt-3 space-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-purple-300/60 mb-1.5">
              Answer Grid
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <Kbd>0</Kbd>
                <span>Sunday</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>1</Kbd>
                <span>Monday</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>2</Kbd>
                <span>Tuesday</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>3</Kbd>
                <span>Wednesday</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>4</Kbd>
                <span>Thursday</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>5</Kbd>
                <span>Friday</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>6</Kbd>
                <span>Saturday</span>
              </div>
            </div>
            <p className="mt-2 text-xs italic">
              In Deduction Month and Year, the same keys map positionally to the boxes or year
              options on screen.
            </p>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-purple-300/60 mb-1.5">
              Game Actions
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <Kbd>N</Kbd>
                <span>New / Begin / Reset</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>R</Kbd>
                <span>Reveal</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>O</Kbd>
                <span>Override</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>C</Kbd>
                <span>Show / Hide Codes</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>S</Kbd>
                <span>Reset Stats</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>←</Kbd>
                <span>Back</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>→</Kbd>
                <span>Forward</span>
              </div>
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-purple-300/60 mb-1.5">
              Overlays
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <Kbd>H</Kbd>
                <span>How to Play (toggle)</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>G</Kbd>
                <span>Settings ⚙ (toggle)</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>Tab</Kbd>
                <span>Mode selector (toggle)</span>
              </div>
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-purple-300/60 mb-1.5">
              Mode Switching
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <Kbd>K</Kbd>
                <span>Classic</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>F</Kbd>
                <span>Flash</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>B</Kbd>
                <span>Blitz</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>A</Kbd>
                <span>AoX</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>D</Kbd>
                <span>Deduction</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>L</Kbd>
                <span>Lookup</span>
              </div>
            </div>
          </div>
        </div>
        <p className="mt-3">
          Letter keys are case-insensitive. Letter and number keys are ignored when you're typing in
          an input field or when a modifier key (Ctrl/Cmd/Alt/Shift) is held. <Kbd>Tab</Kbd> is the
          exception: it toggles the mode selector even from inputs (use Esc or Enter to leave an
          input first if you'd rather), and Tab combined with any modifier (Ctrl+Tab,
          Ctrl+Shift+Tab, etc.) passes through to the browser. Locked or already-pressed buttons are
          skipped, just like a click would be. Reset Stats (S) only applies to the casual modes
          (Classic, Deduction, Flash); pressing it in Blitz, AoX, or Lookup is a no-op since those
          modes don't have a separate Reset Stats button (their round/run Reset clears
          in-round/in-run stats; persistent bests update only when set).
        </p>
      </GuideSection>
      <Divider label="Settings" />
      <GuideSection id="dateformat" title="Date Format" openId={open} onToggle={toggle}>
        <p>
          Set via the ⚙ settings menu. Choose one of five real-world formats: <b>Written MDY</b>{' '}
          (April 27, 1828), <b>Written DMY</b> (27 April 1828), <b>Numeric MDY</b> (4/27/1828),{' '}
          <b>Numeric DMY</b> (27.4.1828), or <b>Numeric YMD</b> (1828-4-27). Numeric formats use a
          fixed separator convention: MDY uses '/', DMY uses '.', YMD uses '-'. Years always show in
          full, never abbreviated.
        </p>
        <p>
          Only DMY, MDY, and YMD orderings are offered because those are the only orderings actually
          used in real life — orderings like YDM aren't standard anywhere.
        </p>
        <p>
          <b>Random Format</b>, when on, rolls one of the five formats per date in game modes only —
          your selected format is preserved underneath (the panels just lock visually). Lookup and
          the Last Updated timestamp ignore Random and always use the selected format. The Last
          Updated timestamp uses the numeric version of whichever format you've selected.
        </p>
        <p>
          In Classic, Deduction, Flash, and AoX (idle), any format setting change — Random Format
          toggle or Date Format dropdown — regenerates an unanswered date so you don't return to a
          previously-seen date in a now-mismatched format. This applies across all modes: if you
          change a format setting in one mode, any unanswered dates in the other modes are also
          regenerated. If you've already made a wrong guess, revealed the answer, or shown codes on
          the displayed date, the change is deferred — the burned state is preserved and the new
          format applies on the next generated date. In active Blitz rounds and AoX runs, any format
          change ends the round.
        </p>
        <p>
          In game modes' Show Codes, codes appear in the order the date is read (left to right),
          with Leap shown once you've seen both the year and month.
        </p>
      </GuideSection>
      <GuideSection id="julian" title="Julian Calendar" openId={open} onToggle={toggle}>
        <p>
          Toggle via the ⚙ settings menu under Calendar System. On by default. When on, dates on or
          before October 4, 1582 are treated as Julian calendar dates, which have different leap
          year rules — every year divisible by 4 is a leap year, with no century exception. This
          affects weekday calculation and the codes shown in Show Codes. October 5–14, 1582 are
          always excluded since those dates never existed; the Gregorian calendar skipped them to
          correct accumulated calendar drift.
        </p>
        <p>
          Toggling Julian doesn't necessarily regenerate the current date. For dates after October
          4, 1582, Julian has no effect. For Julian-eligible dates (October 4, 1582 or earlier), the
          date stays if you haven't made a wrong guess yet — the answer and codes simply update. If
          you've already wrong-guessed, the date regenerates and is added to your history with both
          your red guess and a green for the day that was correct under the calendar system in
          effect when the date was first generated. Each date snapshots its calendar system at
          generation, so revisiting an earlier question via Back shows the highlights and codes that
          were correct under the system in effect when that date was generated. In active Blitz
          rounds and AoX runs, any Julian toggle ends the round.
        </p>
        <p>
          <b>Julian Chance</b> (also under Calendar System) sets how often a generated date lands in
          the Julian calendar period (pre-Oct 15, 1582) — Random uses the natural rate (which
          depends on your year range, ~16% on the default 1–10000 range); 25%, 50%, 75%, and 100%
          force higher rates. The listed percentage is the exact final rate of Julian dates, not a
          force probability. The five buttons are locked and faded in three cases: when the Julian
          Calendar toggle above is off (no Julian dates can be generated regardless), when your year
          range is entirely post-Gregorian (minimum year is 1583 or later, so no Julian dates exist
          in range), or when your year range is entirely pre-Gregorian (maximum year is 1581 or
          earlier, so every date is already Julian and the setting has nothing to do). Year 1582
          itself contains both Julian (Jan-Sep + Oct 1-4) and Gregorian (Oct 15+ + Nov + Dec) dates,
          so any range that includes 1582 counts as mixed and the row stays unlocked. The
          previously-selected value stays visually selected while locked so it's restored when the
          lock condition clears. Changing the chance value always regenerates an unanswered date;
          burned dates defer like every other setting.
        </p>
      </GuideSection>
      <GuideSection id="range" title="Year Range" openId={open} onToggle={toggle}>
        <p>
          Set via the ⚙ settings menu. Controls which years dates are drawn from. Defaults to
          1–10000 AD. Changing the range always regenerates the current date — but if you've already
          made a wrong guess on the current date, the change is deferred so the wrong-state is
          preserved; the new range applies to the next date. While browsing back, settings-driven
          regen always preserves your history: the date you were viewing and any forward entries are
          pushed back to history before the live slot is regenerated. In active Blitz rounds and AoX
          runs, any range change ends the round.
        </p>
        <p>
          <b>Year sub-mode auto-disable:</b> Deduction's Year sub-mode requires either a year range
          of at least 5 years (so a 5-year window can be built) or, with Julian on, a range that
          contains October 15, 1582 (so a 2-year Jul Cross window can be built). When neither
          condition holds, the Year sub-type button greys out, and if you were already in Year mode
          when the range changed, you're auto-switched to Day mode. Day and Month sub-modes work for
          any valid range.
        </p>
      </GuideSection>
      <GuideSection id="leap" title="Leap Year Settings" openId={open} onToggle={toggle}>
        <p>
          Two settings in the ⚙ menu control how often leap years appear and what months they're
          paired with. <b>Leap Year Chance</b> sets how often a generated date lands on a leap year
          — Random uses the natural rate (~24%); 50%, 75%, and 100% force higher rates.{' '}
          <b>Jan/Feb Chance on Leap Years</b> sets how often a leap-year date lands on January or
          February — Random uses the natural rate (~17%, since 2 of 12 months are Jan/Feb); 25%,
          50%, 75%, and 100% force higher rates. The listed percentage is the exact final rate of
          Jan/Feb on leap-year dates, not just a "force probability" — under 50%, exactly half of
          leap-year dates are Jan/Feb. These settings apply to all game modes' date generation;
          Lookup is unaffected. If your year range happens to contain no leap years (under the
          active calendar), the four Leap Year Chance buttons are locked and faded; the
          previously-selected value stays visually selected so it's restored when you change the
          range back to one with a leap year reachable. Jan/Feb Chance stays unlocked since the
          setting still applies on whatever leap years exist in the range. Changing any value in{' '}
          <b>Leap Year Chance</b> or <b>Jan/Feb Chance on Leap Years</b> always regenerates the
          displayed date so the new setting takes effect immediately. If you've already made a wrong
          guess, revealed the answer, or shown codes on the current date, either change is deferred
          so the burned state is preserved; the new setting applies to the next date. In active
          Blitz rounds and AoX runs, any chance setting change ends the round.
        </p>
      </GuideSection>
      <GuideSection id="savestats" title="Save Stats" openId={open} onToggle={toggle}>
        <p>
          Toggle via the ⚙ settings menu under Stats. On by default. When off, your answers don't
          update stats or saved bests. The stats panel dims to indicate the off state. Override is
          locked when Save Stats is off, across all modes. The toggle works differently per mode:
        </p>
        <p className="mt-2">
          <b>Classic, Deduction, Flash</b> — per-question. The toggle's value is locked in at the
          moment of your first stat-affecting action (your first wrong guess on the question, or
          your correct answer if you got it right on the first try). Toggling afterward doesn't
          change that question's outcome, but does apply to the next question. If you've already
          made a wrong guess on the current question, toggling Save Stats does not regenerate the
          date — the toggle's frozen value sticks for the question. When off, the question doesn't
          update stats and isn't pushed to history (Back can't browse to it).
        </p>
        <p className="mt-2">
          <b>Blitz</b> — round-level. In-round score, accuracy, streak, and Back/Forward navigation
          through round questions all work normally regardless of the toggle. Whatever the toggle is
          set to when the round ends determines whether the round's Best Score and Best Streak
          update.
        </p>
        <p className="mt-2">
          <b>AoX</b> — run-level. In-run score, streak, times, and Back/Forward navigation all work
          normally regardless of the toggle. Whatever the toggle is set to when the run ends
          determines whether Best Average, Best Median, and Best Streak update.
        </p>
      </GuideSection>
      <GuideSection id="theme" title="Theme" openId={open} onToggle={toggle}>
        <p>
          Five themes: Dusk (default dark navy), Midnight (true black with purple), Nebula (deep
          purple), Light (clean white), and Parchment (warm cream). Accessible from the ⚙ settings
          menu in any tab. Enable Use System Settings to match your device's light/dark mode
          automatically, with separate theme choices for each. Disable to pick one manually.
        </p>
      </GuideSection>
      <Divider label="Data" />
      <GuideSection id="saved-progress" title="Saved Progress" openId={open} onToggle={toggle}>
        <p>
          The app saves the following on this device and restores them when you return — after
          closing the app, refreshing, or revisiting later: your <b>⚙ Settings</b> (date format,
          calendar system, year range, the leap / Jan-Feb / Julian chances, Save Stats, and theme);
          your <b>per-mode setup</b> (Flash speed; Blitz / Sudden timer lengths, Allow Mistakes, and
          Per-Round vs Per-Question; AoX count, Allow Mistakes, and One-By-One; the Deduction
          sub-type; and each mode's show / hide stat toggles); your <b>stats</b> in the casual modes
          (Classic, Flash, Deduction); your <b>all-time bests</b> (Blitz score &amp; streak, Sudden
          score, AoX average &amp; median); and your <b>Lookup history</b>. Saved Average and Median
          use a rolling window of your most recent 1000 solves.
        </p>
        <p>
          <b>Not saved</b> — these reset each visit: any in-progress timed round or run and the
          current question (a half-finished run is discarded by design); and the current tab — the
          app always opens to Classic. <b>Full Reset</b> (below) clears everything that is saved.
        </p>
      </GuideSection>
      <GuideSection
        id="reset-settings"
        title="Reset Settings &amp; Full Reset"
        openId={open}
        onToggle={toggle}
      >
        <p>
          <b>Reset Settings</b> — at the bottom-left of the ⚙ menu, restores everything in the menu
          to its defaults: Random Format on, Written MDY, Julian on, Julian Chance Random, year
          range 1–10000, Leap Year Chance Random, Jan/Feb Chance Random, Save Stats on, and theme
          back to Use System Settings with Dusk (dark) and Light (light). It does not touch
          mode-specific config outside the menu (AoX N, timer durations, Deduction sub-types and
          toggles) or your stats and history. No confirmation prompt — tap to apply. When every
          setting in the menu is already at its default, this button dims and locks since tapping it
          would have no effect.
        </p>
        <p>
          <b>Full Reset</b> — at the bottom-right of the ⚙ menu, restores the entire site to its
          initial launch state. Wipes all stats, all-time bests (Blitz, Sudden, AoX), Lookup
          history, and in-progress rounds and runs. Your stats, all-time bests, and Lookup history
          are saved on this device and restored on your next visit, so Full Reset clears that saved
          copy permanently. Resets every setting and toggle across all modes — both the ⚙ menu and
          the per-mode toggles (AoX N, timer durations, Deduction sub-types and toggles, Allow
          Mistakes, Save Stats, Stop Codes, etc.). Closes any open overlay (How to Play, ⚙ menu,
          codes, method breakdown) and switches to Classic. Requires two taps to confirm: tap once
          and the button changes to "Confirm?"; tap again to fire. Auto-cancels after a few seconds,
          when you close ⚙, or if you tap any other control. When every setting, toggle, stat, best,
          history entry, and live state across the entire site is already at its launch value, this
          button dims and locks since tapping it would have no effect.
        </p>
      </GuideSection>
      <Divider label="Modes" />
      <GuideSection id="classic" title="Classic" openId={open} onToggle={toggle}>
        <p>
          The main practice mode with no time pressure. Answer at your own pace. Override works
          after both wrong and correct answers. Reset Stats clears your stats and question history;
          when timing stats are hidden and you haven't burned the current date, the date is kept.
        </p>
      </GuideSection>
      <GuideSection id="aox" title="AoX" openId={open} onToggle={toggle}>
        <p>
          Average your times over a set number of correct solves (2–1000). The score shows correct
          answers out of total attempts; the run ends when correct answers reach your target. Press
          Begin to start a run.
        </p>
        <p>
          <b>Allow Mistakes</b> — wrong answers don't end the run but don't count toward your score.
        </p>
        <p>
          <b>One-By-One</b> — hides the date between solves. Press Continue to reveal each new date.
        </p>
        <p>
          <b>Last / Avg / Med</b> — tap any of these to show or hide all three time stats.
        </p>
        <p>
          <b>Back/Forward</b> — browse previous dates from the current run without affecting it.
          Press Continue to resume; the date you were viewing and any forward entries are pushed
          back to your run history before a fresh date is generated, so nothing is lost. After a run
          completes, Back and Forward let you browse all dates from that run; press Reset to start
          fresh.
        </p>
        <p>
          <b>Override</b> — after wrong: gives credit with time recorded, preserves streak. After
          correct: undoes the credit, resets streak, and either ends the run (Allow Mistakes off) or
          advances to a new date (Allow Mistakes on). You can also override past dates while
          browsing back with Back/Forward. If overriding on the last question with Allow Mistakes
          on, a new date is generated to complete the average. One override per question. Override
          is locked when Save Stats is off.
        </p>
        <p>
          Stats in AoX are always visible and always track. Best average and best median are tracked
          independently — they can come from different runs. Beneath each best, the companion metric
          from the run that set it is also shown (e.g. the median from the run that set your best
          average). A <i>Same Round</i> or <i>Different Rounds</i> tag tells you whether your best
          average and best median came from the same exceptional run, or from two different strong
          ones. If you override a correct answer that set a new best, the best is also restored. The
          score display freezes when a run ends and only resets after pressing Reset.
        </p>
        <p>
          Bests are tracked per exact configuration: AoX size (n), Allow Mistakes, Date Format (or
          Random Format on its own bucket), Leap Year Chance, Jan/Feb Chance on Leap Years, Julian
          Chance, year range, and Calendar System (Julian on/off). Changing any of these creates a
          separate bucket — your previous bests remain stored and reappear when you switch back to
          that exact config.
        </p>
        <p>
          The small <b>Q#</b> label at the top-right of the date card appears not only while
          back-browsing but also at run end (done/failed) so you can identify which question of the
          run you're viewing in the summary.
        </p>
      </GuideSection>
      <GuideSection id="deduction" title="Deduction" openId={open} onToggle={toggle}>
        <p>
          Identify the missing piece of a date given the rest plus the weekday. Choose Day, Month,
          or Year mode. The displayed date follows your selected Date Format (or random format
          snapshot, if Random Format is on), with a fixed-width underscore placeholder where the
          missing piece would normally appear.
        </p>
        <p className="mt-2">
          <b>Day</b> — seven consecutive days are shown, each with a unique day code. The correct
          day can appear in any position. <i>October 1582 with Julian on:</i> days 5–14 don't exist
          (the Gregorian transition skipped them), so the valid days are 1–4 and 15–31. When the
          window can't fit seven days on one side of the gap, it shrinks to four — codes 1, 2, 3, 4
          repeat at days 15, 16, 17, 18, so a five-day window crossing the gap would have a
          duplicate code.
        </p>
        <p className="mt-2">
          <b>Month</b> — seven fixed boxes group months that share the same month code, so tapping
          any month within a box gives the same weekday for that date. Tap the box containing the
          correct month. The boxes are always in the same position. In leap years, January shifts
          into the Apr/Jul box (becoming Jan/Apr/Jul) and February shifts into the Aug box (becoming
          Feb/Aug); the other boxes are unchanged. <i>Year 1582 with Julian on:</i> a special layout
          applies because the Julian/Gregorian transition splits the year — January through
          September and October 1–4 use Julian (year code +1), while October 15+ and
          November/December use Gregorian (year code −2). October's box position depends on the day:
          for days 1–4 it joins Jan and Nov ("Jan/Oct/Nov"); for days 15–31 it joins Jun
          ("Jun/Oct"); for days 5–14 it's excluded since those dates don't exist. The other six
          boxes are arranged differently from the standard layout — practice carefully.
        </p>
        <p className="mt-2">
          <b>Year</b> — five consecutive year options. Each option has a unique year code, so only
          the correct year matches the displayed weekday. The correct year can appear in any
          position. <i>With Julian on:</i> when the five-year window would cross October 15, 1582
          (the Julian/Gregorian boundary), it shrinks to two years — the calendar's 10-day jump
          produces a +5 weekday shift across that boundary that breaks distinctness for any longer
          window. <i>February 29:</i> only allowed when the window contains at least one leap year
          (Gregorian or Julian as appropriate). Non-leap years still appear as options but trivially
          can't be the answer, since Feb 29 doesn't exist in those years.
        </p>
        <p className="mt-2">
          <b>Per-mode toggles</b> — Year mode adds <i>ab</i> Cross (left of Day/Month/Year) and Jul
          Cross (right of Day/Month/Year). Month mode adds 1582 Only (right of Day/Month/Year).
          These are mode-specific, not in the ⚙ Settings menu, since they only apply to one
          Deduction sub-mode.
        </p>
        <p className="mt-2">
          <b>
            <i>ab</i> Cross
          </b>{' '}
          (Year mode) — when on, the five-year window must cross a year ending in 00 (any 100-year
          boundary, both leap and non-leap centuries). Practice the <i>ab</i> code change
          mid-window. Disabled when your year range doesn't span any 100-year boundary.
        </p>
        <p className="mt-2">
          <b>Jul Cross</b> (Year mode) — when on, the two-year window must cross October 15, 1582
          (the Julian/Gregorian transition). N=2 always. Disabled when the Julian setting is off, or
          when your year range doesn't contain 1582 plus at least one of its neighbors (1581 or
          1583).
        </p>
        <p className="mt-2">
          <b>Both Year toggles on</b> — each puzzle randomly picks (50/50) which constraint to
          enforce. The two can't both be true for the same window.
        </p>
        <p className="mt-2">
          <b>1582 Only</b> (Month mode) — when on, every puzzle uses year 1582, forcing the special
          split layout described above. Disabled when the Julian setting is off or your year range
          excludes 1582. When the answer's cell groups months from both calendars, Show Codes uses
          slash notation (e.g., 1/-3, Julian/Gregorian) for any value that differs across the cell's
          months; values that are the same across all months collapse to a single value.
        </p>
        <p className="mt-2">
          Switch subtypes anytime — progress in each is preserved, including question history. Stats
          are tracked separately for each subtype, and Back/Forward only walks the current subtype's
          entries. Reset Stats clears the current subtype's stats and history only; the other
          subtypes' stats and history are untouched. When timing stats are hidden and you haven't
          burned the current question, the question is kept.
        </p>
      </GuideSection>
      <GuideSection id="flash" title="Flash" openId={open} onToggle={toggle}>
        <p>
          The date is briefly revealed (0.1s–3.0s, default 0.5s, adjustable via the slider) then
          hidden. Answer from memory. Reset Stats clears your stats and question history.
          Mid-question, Reset Stats always generates a new date and returns to the dash state.
        </p>
        <p>
          While the date is showing you can also press Reveal or Show Codes — both freeze the
          countdown (the timer bar and the number stop together) and keep the date on screen. Reveal
          shows the answer and counts a miss; Show Codes does the same and also opens the
          calculation breakdown.
        </p>
      </GuideSection>
      <GuideSection id="blitz" title="Blitz" openId={open} onToggle={toggle}>
        <p>
          Answer as many dates as possible before time runs out. Score shows correct answers for the
          current round only.
        </p>
        <p>
          <b>Allow Mistakes</b> — when on, wrong answers count against accuracy but don't end the
          round. When off, a wrong answer ends the round immediately.
        </p>
        <p>
          <b>Per Round / Per Question</b> — tap to switch. Per Round uses a single countdown for the
          whole round (10s–3m, default 60s). Per Question gives each question its own countdown
          (1s–20s, default 5s); running out of time ends the round. Per Question always enforces no
          mistakes: tapping Per Question auto-disables Allow Mistakes, and tapping Allow Mistakes on
          while in Per Question auto-switches back to Per Round.
        </p>
        <p>
          When the round ends, the correct answer for the current date is highlighted and your bests
          are recorded. A round also ends if you give up on the current date with Reveal or Show
          Codes, or — with Allow Mistakes off (or in Per Question) — if you override a correct
          answer to wrong. You can then browse your round's history with Back/Forward and override
          past dates to adjust your score and saved bests. Overriding a wrong answer that ended the
          round resumes it.
        </p>
        <p>
          Streak is hidden in Per Question since any wrong answer ends the round, making streak
          equal to score.
        </p>
        <p>
          Best scores are tracked per exact configuration: timer duration, Allow Mistakes, Per
          Round/Per Question, Date Format (or Random Format as its own bucket), Leap Year Chance,
          Jan/Feb Chance on Leap Years, Julian Chance, year range, and Calendar System (Julian
          on/off). Changing any of these creates a separate bucket — your previous bests remain
          stored and reappear when you switch back. Best score and best streak are tracked
          independently in Per Round; a <i>Same Round</i> or <i>Different Rounds</i> tag tells you
          whether your best score and best streak came from the same exceptional round, or from two
          different strong ones. If you leave Blitz after a round ends without pressing Reset, the
          round state (bests, history, final date) is preserved when you return. Press Reset to
          clear your current round, unlock the settings, and start fresh. Changing settings while
          idle resets the current round.
        </p>
      </GuideSection>
      <GuideSection id="lookup" title="Lookup" openId={open} onToggle={toggle}>
        <p>
          Enter any AD date to instantly see its weekday. Lookup input is always numeric and follows
          your selected Date Format (m/d/y, d.m.y, or y-m-d). Lookup ignores Random Format and
          always uses the selected format directly. Changing the Date Format clears the input box.
          Supports years 1–10000. Show Codes is available for all results and stays open as you
          browse your history. The history panel shows up to 10 entries before scrolling and
          re-renders live when you change the Date Format. October 5–14, 1582 never existed and will
          appear in history as "Does Not Exist" with Show Codes unavailable.
        </p>
      </GuideSection>
    </div>
  )
}
