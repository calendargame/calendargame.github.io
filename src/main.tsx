import './index.css' // Tailwind (v3, compiled in-build) + the app's custom CSS — replaces the old Play-CDN <script> + inline <style>.
import * as React from 'react'
import ErrorBoundary, { ModeErrorBoundary } from './ErrorBoundary'
// The original loaded the full ReactDOM UMD global, which exposes BOTH createRoot and
// createPortal. The modern modular build splits them: createRoot is in 'react-dom/client',
// createPortal is in 'react-dom'. Reconstruct a ReactDOM with both so the app's
// ReactDOM.createRoot (mount) and ReactDOM.createPortal (dropdowns/popovers) both work.
import { createRoot } from 'react-dom/client'
import { createPortal } from 'react-dom'
import {
  isLeap, isLeapJulian, wday,
  wdayJulian, isJulianDate, isGapDate, rangeHasLeapYear,
} from './lib/calendar.js'
import { DAY, fmtYear, fmt, fmtPartial, numericFormatOf } from './lib/format.js'
import Expander from './components/Expander.jsx'
import StatPanel from './components/StatPanel.jsx'
import { NewBestStar, SectionLabel } from './components/primitives.jsx'
import CustomSelect from './components/CustomSelect.jsx'
import GuidePage from './components/GuidePage.jsx'
import LookupCard from './components/LookupCard.jsx'
import { MethodExplanation, MethodBreakdownSection } from './components/MethodBreakdown.jsx'
import W5Logo from './components/W5Logo.jsx'
import { CODES_CLOSE_MS } from './lib/constants.js'
import { useSettings } from './store/settings.js'
import { useModePrefs } from './store/modePrefs.js'
import { useProgress } from './store/progress.js'
import type { AoxBest } from './store/progress.js'
import { calcAvg, calcLast, calcMed } from './engine/stats.js'
import { useGameEngine } from './engine/useGameEngine.js'
import { reportWebVitals } from './dev/webVitals.js'
import type { Question, WeekdayQuestion, DedPuzzle, GameState } from './engine/gameReducer.js'
import type { ButtonState } from './engine/answerButtons.js'
import type { FormatId, DatePart } from './lib/format.js'
import type { LookupEntry } from './components/LookupCard.jsx'
import type { CodeDate } from './components/MethodBreakdown.jsx'
const ReactDOM = { createRoot, createPortal }

// --- Shared types for the typed App + mode components (Stage C, TypeScript, final file). ---
type GenDate = (minY: number, maxY: number) => Question
type FmtDate = (y: number, m: number, d: number, fmt?: FormatId) => string
type FlashState = { type: 'good' | 'bad'; idx: number }
type GameEngine = ReturnType<typeof useGameEngine>
interface ModeProps {
  visible: boolean
  minY: number
  maxY: number
  useJulian: boolean
  saveStats: boolean
  dateFormat: FormatId
  randomFormat: boolean
  leapChance: string
  janFebChance: string
  julianChance: string
  onFreshChange?: (fresh: boolean) => void
}
interface DedOpts {
  useJulian: boolean
  leapChance: string
  janFebChance: string
  randomFormat: boolean
  dateFormat: FormatId
  abCrossOnly: boolean
  julCrossOnly: boolean
  monthOnly1582: boolean
}
// AoxBest / BlitzBest / SuddenBest moved to store/progress.ts (the persisted store owns them); imported above.

    const {useEffect,useRef,useState,useCallback} = React;
    // ─────────────────────────────────────────────────────────────────────────
    // Date snapshot fields. Every generated date object carries these stamps
    // so that back-browse and codes display always reflect the system that was
    // active when the date was generated, not the current setting:
    //   y, m, d   — year, month, day (1-indexed month)
    //   _fmt      — date format ID at generation (e.g. 'written-mdy', 'numeric-dmy').
    //               Random Format on → random roll per date; off → current dateFormat.
    //               Display layer always trusts _fmt over the live dateFormat setting.
    //   _jul      — useJulian boolean at generation. Used by codes panel + history
    //               so revisiting a Julian-era date via Back keeps Julian highlights/
    //               codes even if the user has since toggled Julian off.
    // Deduction puzzles additionally carry: _abx (abCrossOnly), _julx (julCrossOnly),
    // _m1582 (monthOnly1582) — informational snapshots of per-mode toggles at spawn.
    // ─────────────────────────────────────────────────────────────────────────
    // Reset-style button shared className. Used by Reset Stats (Classic/Deduction/Flash),
    // Round Reset (Blitz active), AoX Reset, Settings Reset.
    const RESET_BTN_CLASS="px-3 py-2 rounded-xl bg-rose-600/90 text-white text-sm font-medium";
    // Compact Reset Stats button variant (smaller py + col-span fit for stats panel).
    const RESET_STATS_BTN_CLASS="w-full px-3 py-1.5 rounded-xl btn-solid border border-transparent text-sm font-medium";
    // Presentational primitives (NewBestStar, SectionLabel, Kbd) + their class consts → src/components/primitives.jsx, imported at top.
    // buttonStateClass — picks the className for an answer-grid button based on its
    // persistent state (correct/wrong-latest/wrong-prev/override-wrong) and any active
    // flash animation. Returns just the state-class portion; the caller composes the
    // full className (base + state + lock/dim).
    //   ps        — persistBtns[idx] value or undefined
    //   isFlashing — whether a flash is active for this button index
    //   flashGood — when flashing, whether it's a good or bad flash
    //   idleClass — fallback for idle state (varies between AoX 'surface-button' and App's idleBtn)
    const buttonStateClass=(ps: ButtonState | undefined,isFlashing: boolean,flashGood: boolean,idleClass: string)=>{
      if(ps==='correct')return'btn-correct-persist border-transparent';
      if(ps==='wrong-latest')return'btn-wrong-persist border-transparent';
      if(ps==='wrong-prev')return'btn-wrong-dim border-transparent';
      if(ps==='override-wrong')return'btn-override-wrong border-transparent';
      if(isFlashing)return(flashGood?"flash-good":"flash-bad")+' border-transparent';
      return idleClass;
    };
    // AnswerButton wrapper was considered but not used: each grid has site-specific
    // baseBtn/extra-class shaping (col-span, py-2 text-sm, centerLastOpt) so calling
    // buttonStateClass directly in each render keeps the layout flexible while still
    // sharing the state-class derivation. If a site ever needs the full wrapper,
    // factor it back in here.
    // MONTH / DAY name tables → src/lib/format.js, imported at top.
    // MODE_LABELS drives the header mode CustomSelect (the customSelect dropdown
    // that replaced the native <select>). Order here = order shown in the dropdown.
    const MODE_LABELS=[{value:'classic',label:'Classic'},{value:'aox',label:'AoX'},{value:'deduction',label:'Deduction'},{value:'flash',label:'Flash'},{value:'blitz',label:'Blitz'},{value:'lookup',label:'Lookup'},{value:'guide',label:'How to Play'}];
    // Method-code maps + the per-date code summary (METHOD_*, JULIAN_AB_MAP, normalizeMod7,
    // canonicalizeMod, calcDayCode, calcCdCode, yearParts, computeMethodSummary) → src/lib/method.js,
    // imported at top. (computeMethodSummary is the only one used here; the rest are its internals.)
    // Deduction option-count constants. YEAR_OPTION_DEFAULT (5) is the universal max for
    // distinct-codes Year windows in normal Gregorian/Julian play (N=6+ collides). A Year
    // window straddling Oct 15, 1582 collapses to 2 options (the +5 weekday shift across that
    // boundary makes any longer window duplicate) — handled by windowYears length, not a const.
    // DAY_OPTION_COUNT (7) is the standard Day window; the Oct 1582 left-side {1-4} case uses
    // the literal-4 window [1,2,3,4] inline since that's the only valid layout there (codes
    // 1-4 repeat at days 15-18).
    const YEAR_OPTION_DEFAULT=5,DAY_OPTION_COUNT=7;
    // Month deduction boxes — 7 fixed boxes grouping months by shared doomsday code
    // Each box: {label:displayed text, months:[month numbers in that box]}
    const MONTH_BOXES_COMMON=[
      {label:"Jan/Oct",months:[1,10]},      // code 6
      {label:"Feb/Mar/Nov",months:[2,3,11]},// code 2
      {label:"Apr/Jul",months:[4,7]},       // code 5
      {label:"May",months:[5]},             // code 0
      {label:"Jun",months:[6]},             // code 3
      {label:"Aug",months:[8]},             // code 1
      {label:"Sep/Dec",months:[9,12]},      // code 4
    ];
    const MONTH_BOXES_LEAP=[
      {label:"Oct",months:[10]},            // code 6
      {label:"Mar/Nov",months:[3,11]},      // code 2
      {label:"Jan/Apr/Jul",months:[1,4,7]}, // code 5
      {label:"May",months:[5]},             // code 0
      {label:"Jun",months:[6]},             // code 3
      {label:"Feb/Aug",months:[2,8]},       // code 1
      {label:"Sep/Dec",months:[9,12]},      // code 4
    ];
    // 1582-specific Month sub-mode box layouts (only used when useJulian=ON and yc=1582).
    // 1582 has the Julian/Gregorian split: Jan-Sep + Oct1-4 use Julian (year code +1),
    // Oct15+ + Nov + Dec use Gregorian (year code -2). The effective month code = month code + year code.
    // Three day-ranges produce three layouts; only October's box position differs across them.
    const MONTH_BOXES_1582_PRE=[ // Days 1-4 of any month: Oct uses Julian
      {label:"Jan/Oct/Nov",months:[1,10,11]},// sum 0
      {label:"Feb/Mar",months:[2,3]},        // sum 3
      {label:"Apr/Jul",months:[4,7]},        // sum 6
      {label:"May",months:[5]},              // sum 1
      {label:"Jun",months:[6]},              // sum 4
      {label:"Aug/Dec",months:[8,12]},       // sum 2
      {label:"Sep",months:[9]},              // sum 5
    ];
    const MONTH_BOXES_1582_POST=[ // Days 15-31: Oct uses Gregorian (joins Jun)
      {label:"Jan/Nov",months:[1,11]},       // sum 0
      {label:"Feb/Mar",months:[2,3]},        // sum 3
      {label:"Apr/Jul",months:[4,7]},        // sum 6
      {label:"May",months:[5]},              // sum 1
      {label:"Jun/Oct",months:[6,10]},       // sum 4
      {label:"Aug/Dec",months:[8,12]},       // sum 2
      {label:"Sep",months:[9]},              // sum 5
    ];
    const MONTH_BOXES_1582_GAP=[ // Days 5-14: Oct excluded entirely (gap days don't exist in Oct 1582)
      {label:"Jan/Nov",months:[1,11]},       // sum 0
      {label:"Feb/Mar",months:[2,3]},        // sum 3
      {label:"Apr/Jul",months:[4,7]},        // sum 6
      {label:"May",months:[5]},              // sum 1
      {label:"Jun",months:[6]},              // sum 4
      {label:"Aug/Dec",months:[8,12]},       // sum 2
      {label:"Sep",months:[9]},              // sum 5
    ];
    // Day-of-week & calendar math (toAstro, isLeap, dim, jdn*, wday*, isJulian*, isGap*, rangeHasLeapYear) → src/lib/calendar.js, imported at top.
    // Date formatting (fmtYear, fmt, fmtPartial, numericFormatOf) → src/lib/format.js, imported at top.
    const rint=(a: number,b: number)=>Math.floor(Math.random()*(b-a+1))+a;
    function randomDate(lo: number,hi: number,julian=false,leapChance='random',janFebChance='random',julianChance='random'): WeekdayQuestion {
      // Decide leap-year preference based on leapChance setting
      const r=Math.random();
      let wantLeap=null;
      if(leapChance==='100')wantLeap=true;
      else if(leapChance==='75')wantLeap=r<0.75;
      else if(leapChance==='50')wantLeap=r<0.5;
      // janFebChance / julianChance — Option A semantics: the listed % is the exact
      // final probability that the output matches the bias. 'random' means no biasing
      // (natural distribution under the year range + leap settings). On non-'random' values,
      // we roll a separate Math.random() up front so the bias decision is independent of
      // leap. On hit, force toward the bias; on miss, force away. This guarantees the final
      // percentage equals the chosen value rather than (chance × 1 + (1-chance) × natural).
      const rjf=Math.random();
      let wantJanFeb=null;
      if(janFebChance==='100')wantJanFeb=true;
      else if(janFebChance==='75')wantJanFeb=rjf<0.75;
      else if(janFebChance==='50')wantJanFeb=rjf<0.5;
      else if(janFebChance==='25')wantJanFeb=rjf<0.25;
      // julianChance only applies when the Use Julian Calendar toggle is on; if julian=false,
      // every date is treated as Gregorian regardless of year, so biasing is meaningless.
      const rjul=Math.random();
      let wantJulian=null;
      if(julian){
        if(julianChance==='100')wantJulian=true;
        else if(julianChance==='75')wantJulian=rjul<0.75;
        else if(julianChance==='50')wantJulian=rjul<0.5;
        else if(julianChance==='25')wantJulian=rjul<0.25;
      }
      // Try preference-respecting attempts first; fall back to no preference if year range has no leap years
      for(let attempts=0;attempts<2000;attempts++){
        const y=rint(lo,hi);if(y===0)continue;
        // Per-date leap check: only apply Julian leap rule if the year actually falls in the Julian period.
        // Without this, useJulian=on caused isLeapJulian to be applied to post-1582 years, which disagrees with
        // dimFn / isJulianDate / the codes panel — manifesting as e.g. 1900 being treated as a leap year for
        // wantLeap/forceJanFeb purposes while the codes panel correctly reports Gregorian non-leap.
        const inJulianRange=julian&&y<1582;
        const isLeapY=inJulianRange?isLeapJulian(y):isLeap(y);
        if(wantLeap!==null&&wantLeap!==isLeapY)continue;
        let m;
        if(wantJanFeb!==null&&isLeapY){
          // On leap years, force toward (or away from) Jan/Feb based on the rolled bias.
          // Non-leap years are unaffected — Jan/Feb chance only applies on leap years.
          m=wantJanFeb?rint(1,2):rint(3,12);
        }else{
          m=rint(1,12);
        }
        const isJul=julian&&isJulianDate(y,m,1);
        const maxD=m===2?((isJul?isLeapJulian(y):isLeap(y))?29:28):([4,6,9,11].includes(m)?30:31);
        const d=rint(1,maxD);
        if(isGapDate(y,m,d))continue;
        // Julian-chance bias is checked against the final (y,m,d) since year 1582 contains
        // both Julian (Jan-Sep + Oct 1-4) and Gregorian (Oct 15+ + Nov + Dec) dates.
        if(wantJulian!==null){
          const isJ=isJulianDate(y,m,d);
          if(wantJulian!==isJ)continue;
        }
        return{y,m,d};
      }
      // Silent fallback: no leap-preference / janFeb / julian filter
      for(;;){
        const y=rint(lo,hi);if(y===0)continue;
        const m=rint(1,12);
        const isJul=julian&&isJulianDate(y,m,1);
        const maxD=m===2?((isJul?isLeapJulian(y):isLeap(y))?29:28):([4,6,9,11].includes(m)?30:31);
        const d=rint(1,maxD);
        if(isGapDate(y,m,d))continue;
        return{y,m,d};
      }
    }
    // FORMAT_IDS / rollFormat live at module scope so App's genDate and every mode
    // component can stamp a date's ._fmt at generation time.
    const FORMAT_IDS: FormatId[]=['written-mdy','written-dmy','numeric-mdy','numeric-dmy','numeric-ymd'];
    const rollFormat=()=>FORMAT_IDS[Math.floor(Math.random()*FORMAT_IDS.length)];
    const isTouch=typeof window!=="undefined"&&("ontouchstart" in window||navigator.maxTouchPoints>0||matchMedia("(pointer:coarse)").matches);
    const fmtBlitzT=(s: number)=>{const sec=Math.ceil(s);if(sec<60)return sec+"s";const m=Math.floor(sec/60),r=sec%60;return m+"m "+r+"s";};
    const fmtFlashT=(ms: number)=>(ms/1000).toFixed(1)+"s";
    // Time display follows WCA convention (regulation 9f1): individual single times
    // (Last) are truncated to hundredths — the third decimal is dropped, never rounded.
    // Averages, medians, and bests are rounded to nearest hundredth (toFixed(2)).
    // truncTime drops the third decimal; fmtTime rounds via toFixed(2).
    const truncTime=(t: number | null)=>(t==null||t>=60)?"—":`${(Math.floor(t*100)/100).toFixed(2)}s`;
    const fmtTime=(t: number | null)=>(t==null||t>=60)?"—":`${t.toFixed(2)}s`;
    // WCA-consistent accuracy formatter: when there's at least one wrong answer, floor (truncate) the
    // percentage so we never display "100.0%" for 9999/10000 (which rounds up under toFixed). Pure 100%
    // displays normally. Same philosophy as truncTime (regulation 9f1) — never inflate the user's result.
    const fmtAccuracyPct=(good: number,played: number)=>{
      if(!played)return"—";
      const pct=good/played*100;
      if(good<played&&pct>=99.95)return"99.9%";
      return`${pct.toFixed(1)}%`;
    };
    // calcAvg / calcLast / calcMed → src/engine/stats.js, imported at top (shared by the mode strips).
    const blockMinus=(e: React.KeyboardEvent)=>{if(e.key==="-"||e.key==="Subtract"||e.key==="Minus")e.preventDefault();};
    const blockMinusBI=(e: React.FormEvent<HTMLInputElement> & { data?: string | null })=>{if(e.data&&e.data.includes("-"))e.preventDefault();};

    // entryWithGreen → src/engine/answerButtons.js, imported at top (shared with the reducer + AoxMode).

    // Timing constants (keep in sync with CSS .expander transition)
    // CODES_CLOSE_MS → src/lib/constants.js, imported at top (shared with the codes panel).
    const FLASH_MS=550;       // green/red button flash duration (ms)
    // Button-pulse flash (the green/red pulse on an answered option) — transient UI, not engine
    // state. Every mode component owns one; this hook is the single copy. Latest-timeout pattern
    // so rapid answers each get the full FLASH_MS before clearing. `setFlash` is exposed for the
    // few sites that clear it directly (e.g. Deduction's sub-type switch).
    function useButtonFlash(){
      const [flash,setFlash]=useState<FlashState | null>(null);
      const flashClearRef=useRef<ReturnType<typeof setTimeout> | null>(null);
      const setFlashWithTimeout=(val: FlashState)=>{setFlash(val);if(flashClearRef.current)clearTimeout(flashClearRef.current);flashClearRef.current=setTimeout(()=>{setFlash(null);flashClearRef.current=null;},FLASH_MS);};
      return {flash,setFlash,setFlashWithTimeout};
    }
    // The engine-state half of a mode's freshness check (stats all zero, no history, no live-question
    // flags set) — identical across modes. Each mode ANDs its own fields (toggles/timers/bests) on top.
    function engineFresh(s: GameState){
      return s.stats.played===0&&s.stats.good===0&&s.stats.streak===0&&s.stats.best===0&&s.stats.times.length===0&&s.stack.length===0&&s.forwardStack.length===0&&s.backDepth===0&&s.locked===false&&s.revealed===false&&s.countedWrong===false&&s.canOverrideCorrect===false&&s.pendingWrongOverride===null&&s.overrideUsedThisQ===false&&s.calcOpen===false&&s.calcPenaltyActive===false;
    }
    // Shared "hideable stats" chrome for the three non-timed modes (Classic, Flash, Deduction): the
    // show/hide toggles, the two-tap "Enable and Reset Stats?" arm (+ its click-outside / Save-Stats-off
    // / mode-leave disarms), and the 6-box stats array + armedSpan for <StatPanel>. Re-enabling timing
    // follows App's original rule: OFF→just hide; ON with no desync→regen the live date; ON with a
    // desync (stats moved while hidden)→two-tap confirm→full reset. Both toggles (`timingOff` +
    // `scoringOff`) are owned by the component and persisted in the mode-prefs store, so they're
    // passed in with their setters (timingOff also feeds useGameEngine). Flash is the only
    // mode with a live timer to tear down, so it passes afterTimingEnabled() (on re-enable) and onHide()
    // (on mode-leave); Classic/Deduction omit them.
    function useStatsHideToggles({eng, saveStats, visible, timingOff, setTimingOff, scoringOff, setScoringOff, afterTimingEnabled, onHide}: { eng: GameEngine; saveStats: boolean; visible: boolean; timingOff: boolean; setTimingOff: (v: boolean) => void; scoringOff: boolean; setScoringOff: (v: boolean) => void; afterTimingEnabled?: () => void; onHide?: () => void }){
      // timingOff + scoringOff are owned by the mode component (persisted in the mode-prefs store) and
      // passed in, so the hook holds no toggle state of its own — it just orchestrates the desync arm
      // and builds the stats strip from them.
      const S=eng.state.stats;
      const [timingArmed,setTimingArmed]=useState(false);
      const timingArmedRef=useRef(false);
      const timingArmTimerRef=useRef<ReturnType<typeof setTimeout> | null>(null);
      const timingArmBtnRef=useRef<HTMLButtonElement | null>(null);
      const disarmTimingArm=()=>{if(timingArmTimerRef.current){clearTimeout(timingArmTimerRef.current);timingArmTimerRef.current=null;}timingArmedRef.current=false;setTimingArmed(false);};
      const toggleScoringOff=()=>{if(!saveStats)return;setScoringOff(!scoringOff);};   // scoringOff is the current (prop) value
      const toggleTimingOff=()=>{
        if(!saveStats)return;
        if(!timingOff){setTimingOff(true);return;}
        const desync=S.good!==S.times.length;
        if(!desync){eng.regenDate();if(afterTimingEnabled)afterTimingEnabled();setTimingOff(false);return;}
        if(timingArmedRef.current){if(timingArmTimerRef.current){clearTimeout(timingArmTimerRef.current);timingArmTimerRef.current=null;}timingArmedRef.current=false;setTimingArmed(false);eng.fullReset();if(afterTimingEnabled)afterTimingEnabled();setTimingOff(false);return;}
        timingArmedRef.current=true;setTimingArmed(true);
        if(timingArmTimerRef.current)clearTimeout(timingArmTimerRef.current);
        timingArmTimerRef.current=setTimeout(()=>{timingArmedRef.current=false;setTimingArmed(false);timingArmTimerRef.current=null;},3000);
      };
      useEffect(()=>{if(!timingArmed)return;const h=(e: MouseEvent)=>{if(timingArmBtnRef.current&&timingArmBtnRef.current.contains(e.target as Node | null))return;disarmTimingArm();};const t=setTimeout(()=>document.addEventListener('click',h),0);return()=>{clearTimeout(t);document.removeEventListener('click',h);};},[timingArmed]);
      // Fire on visibility transitions only: when hidden, disarm + run the mode's teardown (onHide,
      // the Flash flash-stopper). onHide/disarmTimingArm are re-created each render; listing them
      // would re-fire the teardown every render. Intentional [visible]-only effect.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      useEffect(()=>{if(!visible){if(timingArmedRef.current)disarmTimingArm();if(onHide)onHide();}},[visible]);
      useEffect(()=>{if(!saveStats&&timingArmedRef.current)disarmTimingArm();},[saveStats]);
      const sLast=calcLast(S.times),sAvg=calcAvg(S.times),sMed=calcMed(S.times);
      const sOff=scoringOff||!saveStats;
      const tOff=timingOff||!saveStats;
      const sFn=saveStats?toggleScoringOff:null;
      const tFn=saveStats?toggleTimingOff:null;
      const statsArr=[
        {label:"Score",value:`${S.good}/${S.played}`,off:sOff,fn:sFn},
        {label:"Accuracy",value:fmtAccuracyPct(S.good,S.played),off:sOff,fn:sFn},
        {label:"Streak",value:`${S.streak}/${S.best}`,off:sOff,fn:sFn},
        {label:"Last",value:truncTime(sLast),off:tOff,fn:tFn},
        {label:"Average",value:fmtTime(sAvg),off:tOff,fn:tFn},
        {label:"Median",value:fmtTime(sMed),off:tOff,fn:tFn},
      ];
      const armedSpan=(timingArmed&&saveStats)?{startIdx:3,endIdx:5,label:"Enable and Reset Stats?",onClick:toggleTimingOff}:null;
      // armedBtnRef is returned separately (not nested in armedSpan) so StatPanel's plain
      // armedSpan data stays ref-free — see the note in StatPanel.tsx.
      return {timingArmed,statsArr,armedSpan,armedBtnRef:timingArmBtnRef};
    }
    // Run fn() whenever any value in `deps` changes — skipping the initial mount. The generic
    // "react to a settings/toggle change" effect the modes use to regen an unanswered live date
    // (the engine's regenDate no-ops on a burned/browsed date). fn is read through a ref so the
    // latest closure runs without having to list it (or the engine) in the dependency array.
    function useChangeEffect(deps: React.DependencyList, fn: () => void){
      const fnRef=useRef(fn);
      useEffect(()=>{fnRef.current=fn;});   // keep the latest fn (post-commit), not during render (refs rule)
      const firstRef=useRef(true);
      useEffect(()=>{if(firstRef.current){firstRef.current=false;return;}fnRef.current();},deps);   // eslint-disable-line react-hooks/exhaustive-deps
    }

    // computeHasCredit, markBtns, mkBtnsWithCorrect → src/engine/answerButtons.js, imported at top.

    // Expander → src/components/Expander.jsx, imported at top.



    const DEPLOY_TS=new Date('2026-06-05T20:58:43Z');

    // ============================================================
    // makeDedPuzzle — the PURE Deduction puzzle generator (mode-untangle Step 4).
    //
    // Returns a fresh puzzle {type,y,m,d,w,options,boxes?,_fmt,_jul,…} for the given sub-mode +
    // year range, or null when a Year puzzle can't be built for the range (caller keeps the
    // previous puzzle — App's "retain rather than show a degenerate puzzle"). This is App's old
    // spawnDedWithRange body, lifted out so DeductionMode's shared-engine genDate can produce
    // puzzles; App's spawnDedWithRange now delegates here (one source of truth). The side effects
    // the old version had inline (setCalcPenalty, tStartRef) are the caller's concern now — the
    // engine owns the per-question reset + solve timer. aw/dimFn are the local calendar helpers
    // (mirrors App's activeWday/dimFn, keyed off the passed useJulian). The dead `pc` local of
    // the original is dropped (it was never read). Generation logic is otherwise verbatim.
    // ============================================================
    function makeDedPuzzle(type: DatePart, lo: number, hi: number, {useJulian,leapChance,janFebChance,randomFormat,dateFormat,abCrossOnly,julCrossOnly,monthOnly1582}: DedOpts): DedPuzzle | null {
      const aw=(y: number,m: number,d: number)=>(useJulian&&isJulianDate(y,m,d))?wdayJulian(y,m,d):wday(y,m,d);
      const dimFn=(y: number,m: number)=>{const leap=(useJulian&&isJulianDate(y,m,1))?isLeapJulian(y):isLeap(y);return m===2?(leap?29:28):([4,6,9,11].includes(m)?30:31);};
      // Decide leap preference once per question (not per attempt) so probabilities don't skew.
      const r=Math.random();
      let wantLeap=null;
      if(leapChance==='100')wantLeap=true;
      else if(leapChance==='75')wantLeap=r<0.75;
      else if(leapChance==='50')wantLeap=r<0.5;
      // Roll a separate random for Jan/Feb biasing (Option A semantics). Decide once per question.
      const rjf=Math.random();
      let wantJanFeb=null;
      if(janFebChance==='100')wantJanFeb=true;
      else if(janFebChance==='75')wantJanFeb=rjf<0.75;
      else if(janFebChance==='50')wantJanFeb=rjf<0.5;
      else if(janFebChance==='25')wantJanFeb=rjf<0.25;
      const isLeapForY=(yc: number)=>{const jul=useJulian&&isJulianDate(yc,1,1);return jul?isLeapJulian(yc):isLeap(yc);};
      const pickMonth=(isLeapY: boolean)=>{
        if(wantJanFeb===null||!isLeapY)return rint(1,12);
        return wantJanFeb?rint(1,2):rint(3,12);
      };
      const attachFmt=(o: DedPuzzle)=>{o._fmt=randomFormat?rollFormat():dateFormat;o._jul=useJulian;return o;};
      if(type==="year"){
        const windowCrossesJulianBoundary=(a: number,b: number,m: number,d: number)=>{
          if(!useJulian)return false;
          if(a>b)return false;
          const aIsJul=isJulianDate(a,m,d),bIsJul=isJulianDate(b,m,d);
          return aIsJul!==bIsJul;
        };
        const julianBoundaryPair=(m: number,d: number)=>{
          if(m===10&&d>=5&&d<=14)return null; // gap day
          if(m<10||(m===10&&d<=4))return[1582,1583];
          return[1581,1582];
        };
        const windowCrossesAb=(a: number,b: number)=>Math.floor(a/100)!==Math.floor(b/100);
        const validateDistinct=(years: number[],m: number,d: number)=>{
          const wdays=[];
          for(const y of years){
            if(m===2&&d===29&&!isLeapForY(y))continue; // dead option, skip
            if(d>dimFn(y,m))return false;
            if(isGapDate(y,m,d))return false;
            wdays.push(aw(y,m,d));
          }
          return new Set(wdays).size===wdays.length;
        };
        const inRange=(y: number)=>y!==0&&y>=Math.max(1,lo)&&y<=hi;
        const julCrossPossible=julCrossOnly&&useJulian&&inRange(1582)&&(inRange(1581)||inRange(1583));
        const abCrossPossible=abCrossOnly&&Math.floor(Math.max(1,lo)/100)!==Math.floor(hi/100);
        let enforce=null;
        if(abCrossPossible&&julCrossPossible)enforce=Math.random()<0.5?'ab':'jul';
        else if(abCrossPossible)enforce='ab';
        else if(julCrossPossible)enforce='jul';
        const trySpawn=()=>{
          for(let attempt=0;attempt<3000;attempt++){
            let yc=rint(Math.max(1,lo),hi);
            if(yc===0)continue;
            const isLeapY=isLeapForY(yc);
            if(wantLeap!==null&&wantLeap!==isLeapY)continue;
            const m=pickMonth(isLeapY);
            const D=dimFn(yc,m);
            if(D<=0)continue;
            const d=rint(1,D);
            if(isGapDate(yc,m,d))continue;
            let windowYears;
            if(enforce==='jul'){
              const pair=julianBoundaryPair(m,d);
              if(!pair||!inRange(pair[0])||!inRange(pair[1]))continue;
              if(m===2&&d===29){
                const leaps=pair.filter(y=>isLeapForY(y));
                if(leaps.length===0)continue;
                yc=leaps[rint(0,leaps.length-1)];
              }else{
                if(d>dimFn(pair[0],m)||d>dimFn(pair[1],m))continue;
                yc=pair[rint(0,1)];
              }
              windowYears=pair.slice();
            }else if(enforce==='ab'){
              const P=rint(0,YEAR_OPTION_DEFAULT-1);
              const start=yc-P,end=start+YEAR_OPTION_DEFAULT-1;
              if(!inRange(start)||!inRange(end))continue;
              if(start<=0&&end>=0)continue;
              if(!windowCrossesAb(start,end))continue;
              if(windowCrossesJulianBoundary(start,end,m,d))continue;
              windowYears=[];for(let yy=start;yy<=end;yy++)windowYears.push(yy);
              if(m===2&&d===29){
                const leaps=windowYears.filter(y=>isLeapForY(y));
                if(leaps.length===0)continue;
                yc=leaps[rint(0,leaps.length-1)];
              }
            }else{
              const P=rint(0,YEAR_OPTION_DEFAULT-1);
              const start=yc-P,end=start+YEAR_OPTION_DEFAULT-1;
              if(!inRange(start)||!inRange(end))continue;
              if(start<=0&&end>=0)continue;
              if(windowCrossesJulianBoundary(start,end,m,d)){
                const pair=julianBoundaryPair(m,d);
                if(!pair||!inRange(pair[0])||!inRange(pair[1]))continue;
                if(m===2&&d===29){
                  const leaps=pair.filter(y=>isLeapForY(y));
                  if(leaps.length===0)continue;
                  yc=leaps[rint(0,leaps.length-1)];
                }else{
                  if(d>dimFn(pair[0],m)||d>dimFn(pair[1],m))continue;
                  yc=pair[rint(0,1)];
                }
                windowYears=pair.slice();
              }else{
                windowYears=[];for(let yy=start;yy<=end;yy++)windowYears.push(yy);
                if(m===2&&d===29){
                  const leaps=windowYears.filter(y=>isLeapForY(y));
                  if(leaps.length===0)continue;
                  yc=leaps[rint(0,leaps.length-1)];
                }
              }
            }
            if(!validateDistinct(windowYears,m,d))continue;
            const w=aw(yc,m,d);
            return attachFmt({type:"year",y:yc,m,d,w,options:windowYears,_abx:abCrossOnly,_julx:julCrossOnly});
          }
          return null;
        };
        // No fallback: the Year sub-mode playability contract (yearSubPossible) keeps this from
        // being called for an unbuildable range in normal play. null → caller retains the prior
        // puzzle (App) or supplies an init fallback (DeductionMode's hidden, unreachable Year engine).
        return trySpawn();
      }
      if(type==="month"){
        const force1582=monthOnly1582&&useJulian&&1582>=lo&&1582<=hi;
        let yc=null;
        if(force1582){
          yc=1582;
        }else{
          for(let t=0;t<2000;t++){const c=rint(lo,hi);if(c===0)continue;const il=isLeapForY(c);if(wantLeap!==null&&wantLeap!==il)continue;yc=c;break;}
          if(yc==null){for(let t=0;t<600;t++){const c=rint(lo,hi);if(c!==0){yc=c;break;}}if(yc==null)yc=lo>0?lo:1;}
        }
        const isLeapY=isLeapForY(yc);
        const is1582Special=yc===1582&&useJulian;
        if(is1582Special){
          const dCat=(()=>{const rr=Math.random();
            if(rr<4/31)return'pre';      // ~13% → days 1-4
            if(rr<14/31)return'gap';     // ~32% → days 5-14 (October excluded from box layout)
            return'post';                // ~55% → days 15-31
          })();
          const boxes=dCat==='pre'?MONTH_BOXES_1582_PRE:dCat==='gap'?MONTH_BOXES_1582_GAP:MONTH_BOXES_1582_POST;
          let pickFromBoxes=boxes;
          if(wantJanFeb===true&&isLeapY){const filtered=boxes.filter(b=>b.months.includes(1)||b.months.includes(2));if(filtered.length>0)pickFromBoxes=filtered;}
          else if(wantJanFeb===false&&isLeapY){const filtered=boxes.filter(b=>!b.months.includes(1)&&!b.months.includes(2));if(filtered.length>0)pickFromBoxes=filtered;}
          const box=pickFromBoxes[rint(0,pickFromBoxes.length-1)];
          let m;
          if(wantJanFeb===true&&isLeapY){const allowed=box.months.filter(mm=>mm===1||mm===2);m=allowed.length>0?allowed[rint(0,allowed.length-1)]:box.months[rint(0,box.months.length-1)];}
          else if(wantJanFeb===false&&isLeapY){const allowed=box.months.filter(mm=>mm!==1&&mm!==2);m=allowed.length>0?allowed[rint(0,allowed.length-1)]:box.months[rint(0,box.months.length-1)];}
          else m=box.months[rint(0,box.months.length-1)];
          let d;
          if(m===10){
            if(dCat==='pre')d=rint(1,4);
            else d=rint(15,31); // dCat='post' (gap is impossible here per box layout)
          }else{
            const D=dimFn(yc,m);
            if(dCat==='pre')d=rint(1,Math.min(4,D));
            else if(dCat==='gap')d=rint(5,Math.min(14,D));
            else d=rint(15,D);
          }
          const w=aw(yc,m,d);
          return attachFmt({type:"month",y:yc,d,w,m,options:boxes.map(b=>b.label),boxes:boxes.map(b=>({...b,months:[...b.months]})),_m1582:monthOnly1582});
        }
        const boxes=isLeapY?MONTH_BOXES_LEAP:MONTH_BOXES_COMMON;
        let pickFromBoxes=boxes;
        if(wantJanFeb===true&&isLeapY){const filtered=boxes.filter(b=>b.months.includes(1)||b.months.includes(2));if(filtered.length>0)pickFromBoxes=filtered;}
        else if(wantJanFeb===false&&isLeapY){const filtered=boxes.filter(b=>!b.months.includes(1)&&!b.months.includes(2));if(filtered.length>0)pickFromBoxes=filtered;}
        const box=pickFromBoxes[rint(0,pickFromBoxes.length-1)];
        let m;
        if(wantJanFeb===true&&isLeapY){const allowed=box.months.filter(mm=>mm===1||mm===2);m=allowed.length>0?allowed[rint(0,allowed.length-1)]:box.months[rint(0,box.months.length-1)];}
        else if(wantJanFeb===false&&isLeapY){const allowed=box.months.filter(mm=>mm!==1&&mm!==2);m=allowed.length>0?allowed[rint(0,allowed.length-1)]:box.months[rint(0,box.months.length-1)];}
        else m=box.months[rint(0,box.months.length-1)];
        const D=dimFn(yc,m),d=rint(1,D),w=aw(yc,m,d);
        return attachFmt({type:"month",y:yc,d,w,m,options:boxes.map(b=>b.label),boxes:boxes.map(b=>({...b,months:[...b.months]})),_m1582:monthOnly1582});
      }
      if(type==="day"){
        let yc=null;
        for(let t=0;t<2000;t++){const c=rint(lo,hi);if(c===0)continue;const il=isLeapForY(c);if(wantLeap!==null&&wantLeap!==il)continue;yc=c;break;}
        if(yc==null){for(let t=0;t<600;t++){const c=rint(lo,hi);if(c!==0){yc=c;break;}}if(yc==null)yc=lo>0?lo:1;}
        const isLeapY=isLeapForY(yc);
        const m=pickMonth(isLeapY),D=dimFn(yc,m);
        const isOct1582Special=yc===1582&&m===10&&useJulian;
        if(isOct1582Special){
          const useLeft=Math.random()<4/21;
          if(useLeft){
            const d=rint(1,4);
            const w=aw(yc,m,d);
            return attachFmt({type:"day",y:yc,m,w,d,options:[1,2,3,4]});
          }else{
            const span=DAY_OPTION_COUNT;
            const P=rint(0,span-1);
            const dLo=15+P,dHi=25+P;
            const d=rint(dLo,dHi);
            const start=d-P;
            const w=aw(yc,m,d);
            const opts=[];for(let v=start;v<start+span;v++)opts.push(v);
            return attachFmt({type:"day",y:yc,m,w,d,options:opts});
          }
        }
        const span=Math.min(DAY_OPTION_COUNT,D);
        const P=rint(0,span-1);
        const dLo=P+1,dHi=D-(span-1)+P;
        const d=rint(dLo,dHi),w=aw(yc,m,d);
        const start=d-P,end=start+span-1;
        const opts=[];for(let v=start;v<=end;v++)opts.push(v);
        return attachFmt({type:"day",y:yc,m,w,d,options:opts});
      }
      return null;
    }

    // StatPanel → src/components/StatPanel.jsx, imported at top.

    // CustomSelect → src/components/CustomSelect.jsx, imported at top.

    // ============================================================
    // AoxMode — the "average of N" run mode, FOLDED onto the shared useGameEngine (mode-untangle
    // Step 5, redone). Like Blitz, the engine runs the per-question loop (answer / credit / stats /
    // history / Override / Show Codes) and the COMPONENT owns the run layer: the run lifecycle
    // (idle/running/done/failed), the Ao-N count, Best Average/Median (per config, with rollback),
    // One-By-One, and the fail-on-mistake rule. The run's stats ARE the engine stats — good =
    // credited solves, played = attempts, times = solve times, streak/best. The fold needs only
    // two general engine flags: `complete` (the Nth solve credits without advancing) and
    // `noAdvance` (a failing override of that solve stays put). See gameReducer.
    function AoxMode({minY,maxY,visible,fmtDate,useJulian=false,genDate=randomDate,leapChance='random',janFebChance='random',julianChance='random',randomFormat=false,dateFormat='written-mdy',saveStats=true,onFreshChange}: ModeProps & { fmtDate: FmtDate; genDate?: GenDate }){
      const aoxN=useModePrefs(s=>s.aoxN),setAoxN=useModePrefs(s=>s.setAoxN);   // persisted (mode-prefs store)
      const allowMistakes=useModePrefs(s=>s.aoxAllowMistakes),setAllowMistakes=useModePrefs(s=>s.setAoxAllowMistakes);   // persisted (mode-prefs store)
      const oneByOne=useModePrefs(s=>s.aoxOneByOne),setOneByOne=useModePrefs(s=>s.setAoxOneByOne);   // persisted (mode-prefs store)
      const [runPhase,setRunPhase]=useState("idle");   // idle | running | done | failed (the RUN; the engine just runs the per-question loop)
      const [shown,setShown]=useState(false);           // One-By-One: is the current date revealed? (always true for non-One-By-One while running)
      const n=Math.max(2,Math.min(1000,parseInt(aoxN)||10));
      // Best keying: bests are siloed per difficulty configuration. Dimensions: n, allowMistakes,
      // format (random→'random' bucket), leapChance, janFebChance, year range, useJulian.
      const bestKey=`${n}|${allowMistakes}|${randomFormat?'random':dateFormat}|${leapChance}|${janFebChance}|${minY}-${maxY}|${useJulian}`;
      // saveStats:true ALWAYS → the run tracks + completes regardless of the global Save Stats
      // setting (which only dims the display + gates recording a Best). timingOff:false → solve
      // times are recorded for the average.
      const eng=useGameEngine({genDate,minY,maxY,useJulian,saveStats:true,timingOff:false});
      const {state,correct}=eng;
      const S=state.stats;
      const doneCount=S.good;                 // credited solves this run
      const isRunning=runPhase==="running";
      const isLocked=runPhase==="done"||runPhase==="failed";
      const inBack=state.backDepth>0;

      // Per-config Best Average / Median (component-owned, like Blitz's Best Score). A run records
      // its Best on completion; an Override that undoes the completing solve rolls it back, gated
      // to the run that set it via the run id.
      // AoX all-time bests (avg/median, config-keyed) persist across reloads (Stage D1): from the
      // progress store. (bestNew markers + the rollback refs below stay local — per-session/ephemeral.)
      const bests=useProgress(s=>s.aoxBest),setBests=useProgress(s=>s.setAoxBest);
      const [bestNew,setBestNew]=useState<Record<string, { avg: boolean; med: boolean }>>({});
      const nextRunIdRef=useRef(1);
      const currentRunIdRef=useRef<number | null>(null);
      const prevBestSnapRef=useRef<{ key: string; best: AoxBest } | null>(null);     // {key,best} snapshotted when this run set a Best, for rollback
      const bestData=bests[bestKey]||{avg:null,avgMed:null,avgRoundId:null,med:null,medAvg:null,medRoundId:null};

      const {flash,setFlashWithTimeout}=useButtonFlash();   // green/red answer pulse

      // Frozen date for the codes panel during the close animation (same as the other modes).
      const latestAoxDateRef=useRef<Question | null>(null);
      const wasCodesOpenRef=useRef(false);
      const [aoxFrozenDate,setAoxFrozenDate]=useState<Question | null>(()=>({...state.date}));
      // Keep the latest date in a ref (post-commit) for the close-timeout below — written in an
      // effect, not during render (compiler refs rule); the timeout fires long after any commit.
      useEffect(()=>{latestAoxDateRef.current=state.date;});
      // Freeze the codes-panel date across the close animation. Depends on the date VALUE (y/m/d),
      // not the object identity — intentional, mirroring MethodBreakdown's freeze effect.
      useEffect(()=>{
        if(state.calcOpen){wasCodesOpenRef.current=true;setAoxFrozenDate(state.date);return;}
        if(wasCodesOpenRef.current){wasCodesOpenRef.current=false;const t=setTimeout(()=>setAoxFrozenDate(latestAoxDateRef.current),CODES_CLOSE_MS);return()=>clearTimeout(t);}
        else{setAoxFrozenDate(state.date);}
      },[state.calcOpen,state.date.y,state.date.m,state.date.d]);   // eslint-disable-line react-hooks/exhaustive-deps

      // Record this run's Best Average/Median (on completion). Compares against the closure
      // `bests[bestKey]` (the best before this run) and snapshots it for a later rollback.
      const applyBest=(times: number[])=>{
        const avg=calcAvg(times),med=calcMed(times),rid=currentRunIdRef.current;
        if(avg==null||med==null)return;
        const cur=bests[bestKey]||{avg:null,avgMed:null,avgRoundId:null,med:null,medAvg:null,medRoundId:null};
        prevBestSnapRef.current={key:bestKey,best:{...cur}};
        const avgImp=cur.avg==null||avg<cur.avg,medImp=cur.med==null||med<cur.med;
        setBests(p=>({...p,[bestKey]:{
          avg:avgImp?avg:cur.avg,avgMed:avgImp?med:cur.avgMed,avgRoundId:avgImp?rid:cur.avgRoundId,
          med:medImp?med:cur.med,medAvg:medImp?avg:cur.medAvg,medRoundId:medImp?rid:cur.medRoundId,
        }}));
        if(avgImp||medImp)setBestNew(p=>{const e=p[bestKey]||{avg:false,med:false};return{...p,[bestKey]:{avg:e.avg||avgImp,med:e.med||medImp}};});
      };
      // Restore the Best to its pre-run value when an Override undoes the run that set it.
      const rollbackBest=()=>{
        const snap=prevBestSnapRef.current;
        if(!snap||snap.key!==bestKey)return;
        setBests(p=>({...p,[bestKey]:{...snap.best}}));
        setBestNew(p=>{const nx={...p};delete nx[bestKey];return nx;});
        prevBestSnapRef.current=null;
      };

      // The run completes when the credited count reaches N: flip to done + record a Best (if Save
      // Stats on). The completing answer used eng.answer(...,{complete}) so the engine stayed on the
      // solve; this just transitions the phase. Re-entry is guarded by runPhase.
      useEffect(()=>{
        if(runPhase!=="running"||doneCount<n)return;
        setRunPhase("done");
        if(saveStats)applyBest(S.times);
      },[doneCount,runPhase,n,saveStats]);/* eslint-disable-line react-hooks/exhaustive-deps */

      // Reset the run if the panel is hidden mid-run.
      useEffect(()=>{if(!visible&&runPhase==="running"){eng.resetStats();setRunPhase("idle");setShown(false);}/* eslint-disable-line react-hooks/exhaustive-deps */},[visible]);

      // Auto-reset/regen on a settings change. Running → reset the run; idle → regen the hidden
      // date on a content change (Julian-only keeps it); done/failed → leave the ended run alone.
      const prevAoxPopRef=useRef({randomFormat,dateFormat,useJulian,minY,maxY,leapChance,janFebChance,julianChance});
      useEffect(()=>{
        const prev=prevAoxPopRef.current;
        const contentChanged=prev.dateFormat!==dateFormat||prev.randomFormat!==randomFormat||prev.leapChance!==leapChance||prev.janFebChance!==janFebChance||prev.julianChance!==julianChance||prev.minY!==minY||prev.maxY!==maxY;
        const julianChanged=prev.useJulian!==useJulian;
        prevAoxPopRef.current={randomFormat,dateFormat,useJulian,minY,maxY,leapChance,janFebChance,julianChance};
        if(!contentChanged&&!julianChanged)return;
        if(runPhase==="running"){eng.resetStats();setRunPhase("idle");setShown(false);return;}
        if(runPhase!=="idle")return;
        if(contentChanged)eng.regenDate();
      },[randomFormat,dateFormat,useJulian,minY,maxY,leapChance,janFebChance,julianChance,runPhase,eng]);

      // Freshness for App's isFullyReset (the random date is excluded).
      const aoxIsFreshLocal=aoxN==="10"&&allowMistakes===false&&oneByOne===false&&runPhase==="idle"&&shown===false&&S.played===0&&S.good===0&&S.streak===0&&S.best===0&&S.times.length===0&&state.stack.length===0&&state.forwardStack.length===0&&state.backDepth===0&&flash===null&&Object.keys(state.persistBtns).length===0&&state.calcOpen===false&&state.canOverrideCorrect===false&&Object.keys(bests).length===0&&Object.keys(bestNew).length===0&&state.pendingWrongOverride===null&&state.overrideUsedThisQ===false&&state.countedWrong===false;
      useEffect(()=>{onFreshChange?.(aoxIsFreshLocal);},[aoxIsFreshLocal,onFreshChange]);

      // Derived UI state.
      const dateVisible=isLocked||(isRunning&&(!oneByOne||shown))||inBack;
      const revealLocked=!isRunning||state.calcOpen||(oneByOne&&!shown)||inBack;
      const backDisabled=state.stack.length===0||runPhase==="idle"||runPhase==="running";
      const fwdDisabled=state.forwardStack.length===0||runPhase==="idle"||runPhase==="running";
      const last=state.stack[state.stack.length-1];
      // Override availability mirrors the shared engine's (Save Stats off locks it).
      const overrideAvail=saveStats&&!state.overrideUsedThisQ&&(state.countedWrong||state.canOverrideCorrect||state.pendingWrongOverride!=null||eng.retroOverrideEligible);
      const codesDisabled=runPhase==="idle"||(oneByOne&&!shown&&!inBack&&!isLocked);
      const optionsDisabled=isLocked||state.calcOpen||(oneByOne&&!shown&&!inBack)||runPhase==="idle"||inBack;
      const baseBtn="w-full rounded-2xl border px-4 py-3 text-base shadow-xs select-none";
      const scoreDisplay=runPhase==="idle"?"0/0":`${doneCount}/${S.played}`;
      const accuracyDisplay=fmtAccuracyPct(doneCount,S.played);
      const date=state.date;

      // Handlers.
      const begin=()=>{eng.resetStats();currentRunIdRef.current=nextRunIdRef.current++;prevBestSnapRef.current=null;setRunPhase("running");setShown(true);};
      const continueRun=()=>{setShown(true);eng.restartTimer();};   // One-By-One: reveal the already-loaded next date + start its solve timer
      const startOrContinue=()=>{if(runPhase==="idle")begin();else continueRun();};
      const submitDoW=(i: number)=>{
        setFlashWithTimeout({type:i===correct?"good":"bad",idx:i});
        const willComplete=i===correct&&!state.countedWrong&&doneCount===n-1;   // the Nth credited solve completes the run
        const willAdvance=i===correct&&!willComplete;                            // a non-completing correct (first-try or late) advances
        eng.answer(i,{complete:willComplete});
        if(i!==correct&&!allowMistakes){eng.lockReveal();setRunPhase("failed");} // wrong + no mistakes → reveal the answer + fail the run
        else if(willAdvance&&oneByOne)setShown(false);                           // One-By-One: hide the freshly-loaded next date until Continue
      };
      const onReveal=()=>{eng.reveal();if(!allowMistakes)setRunPhase("failed");};
      const onShowCodes=()=>{const open=!state.calcOpen;eng.showCodes(open);if(open&&!allowMistakes&&isRunning)setRunPhase("failed");};
      const onOverride=()=>{
        const reverseCompleting=state.canOverrideCorrect&&!state.countedWrong&&!inBack;                 // Path 2: reverse the live completing solve
        const reverseToWrong=reverseCompleting&&state.prevStatsSnapshot&&!state.prevStatsSnapshot.wasWrong;
        const retroToWrong=eng.retroOverrideEligible&&last?.capsule?.snapshot&&!last.capsule.snapshot.wasWrong; // Path 5: retro-flip a correct entry to wrong
        const crediting=state.countedWrong||state.pendingWrongOverride!=null;                           // Path 3/4: credit a wrong
        const toWrong=reverseToWrong||retroToWrong;
        const failNow=toWrong&&!allowMistakes;
        if(state.countedWrong)setFlashWithTimeout({type:"good",idx:correct});   // crediting the current wrong → green flash
        eng.override({noAdvance:!!(reverseCompleting&&failNow)});
        if(reverseCompleting)rollbackBest();                                     // the completing solve may have set this run's Best
        if(failNow)setRunPhase("failed");                                        // a to-wrong override with no mistakes fails the run (bug #2 / unified rule)
        else if(crediting&&runPhase==="failed")setRunPhase("running");           // crediting the wrong that failed the run resumes it
        else if(reverseCompleting&&allowMistakes)setRunPhase("running");         // Allow Mistakes on: reversing the completing solve resumes the run
      };
      const reset=()=>{eng.resetStats();setRunPhase("idle");setShown(false);setBestNew({});prevBestSnapRef.current=null;currentRunIdRef.current=null;};

      const primaryBtn=runPhase==="idle"
        ?(<button type="button" data-key="N" className="col-span-1 px-3 py-2 rounded-xl btn-solid text-sm font-medium" onClick={startOrContinue}>Begin</button>)
        :isLocked?(<button type="button" data-key="N" className={`col-span-1 ${RESET_BTN_CLASS}`} onClick={reset}>Reset</button>)
        :(!shown&&oneByOne)?(<button type="button" data-key="N" className="col-span-1 px-3 py-2 rounded-xl btn-solid text-sm font-medium" onClick={startOrContinue}>Continue</button>)
        :(<button type="button" data-key="N" className={`col-span-1 ${RESET_BTN_CLASS}`} onClick={reset}>Reset</button>);

      return(
        <div style={{display:visible?"block":"none"}}>
          {/* Save Stats off: all stat boxes show "—" with strikethrough labels (matches App). */}
          <div className={saveStats?"":"opacity-50"}><StatPanel stats={[
            {label:"Score",value:scoreDisplay,off:!saveStats,fn:null},
            {label:"Accuracy",value:accuracyDisplay,off:!saveStats,fn:null},
            {label:"Streak",value:`${S.streak}/${S.best}`,off:!saveStats,fn:null},
            {label:"Last",value:truncTime(calcLast(S.times)),off:!saveStats,fn:null},
            {label:"Average",value:fmtTime(calcAvg(S.times)),off:!saveStats,fn:null},
            {label:"Median",value:fmtTime(calcMed(S.times)),off:!saveStats,fn:null},
          ]}/></div>
          <div className="mt-3 text-xs text-purple-300/60">
            <div className="flex flex-wrap items-start gap-4">
              <div className="min-w-[125px]">
                <div>Best Average: {fmtTime(bestData.avg)}{bestNew[bestKey]?.avg&&<NewBestStar/>}</div>
                <div className="text-[11px] opacity-70">Median: {fmtTime(bestData.avgMed)}</div>
              </div>
              <div className="min-w-[125px]">
                <div>Best Median: {fmtTime(bestData.med)}{bestNew[bestKey]?.med&&<NewBestStar/>}</div>
                <div className="text-[11px] opacity-70">Average: {fmtTime(bestData.medAvg)}</div>
              </div>
              {bestData.avgRoundId!=null&&bestData.medRoundId!=null&&<span className="shrink-0 ml-auto">{bestData.avgRoundId===bestData.medRoundId?"Same Round":"Different Rounds"}</span>}
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 flex-nowrap">
            <div className="flex items-center shrink-0"><span className={`text-sm leading-none text-purple-200/80${runPhase!=="idle"?" opacity-60":""}`}>Ao</span><input type="text" inputMode="numeric" readOnly={runPhase!=="idle"} value={aoxN} onChange={e=>{if(runPhase==="idle")setAoxN(e.target.value);}} onBlur={()=>setAoxN(String(Math.max(2,Math.min(1000,parseInt(aoxN)||10))))} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();setAoxN(String(Math.max(2,Math.min(1000,parseInt(aoxN)||10))));e.currentTarget.blur();}else if(e.key==="Escape"){setAoxN(String(n));e.currentTarget.blur();}}} className={`panel rounded-xl px-2 py-1 w-14 text-center tabular-nums text-sm focus:outline-hidden shrink-0${runPhase!=="idle"?" opacity-60 pointer-events-none":""}`}/></div>
            <button type="button" onClick={()=>{if(runPhase==="idle")setAllowMistakes(v=>!v);}} className={`flex-1 px-2 py-1 rounded-xl text-xs font-medium border ${allowMistakes?"btn-solid border-transparent":"surface-toggle text-purple-100/80"}${runPhase!=="idle"?" opacity-60 pointer-events-none":""}`}>Allow Mistakes</button>
            <button type="button" onClick={()=>{if(runPhase==="idle")setOneByOne(v=>!v);}} className={`flex-1 px-2 py-1 rounded-xl text-xs font-medium border ${oneByOne?"btn-solid border-transparent":"surface-toggle text-purple-100/80"}${runPhase!=="idle"?" opacity-60 pointer-events-none":""}`}>One-By-One</button>
          </div>
          <div className="mt-4 rounded-2xl panel p-4">
            <div className="text-center relative">
              {(inBack||isLocked)&&<span className="absolute right-0 top-0 text-[11px] tabular-nums text-purple-300/60">Q{state.stack.length+1}</span>}
              <div className="text-3xl font-bold">{dateVisible?fmtDate(date.y,date.m,date.d,date._fmt):"—"}</div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3" data-answer-grid="true">
              {DAY.map((nm,i)=>{const lastCol=i===DAY.length-1?"col-span-2":"";const ps=state.persistBtns[i];const isFlashing=!!(flash&&flash.idx===i);const bCls=buttonStateClass(ps,isFlashing,flash?.type==="good",'surface-button');const perLocked=!!ps;const shouldDim=optionsDisabled&&!ps&&!isFlashing;return(<button key={nm} type="button" onClick={()=>{if(perLocked)return;submitDoW(i);}} className={`${baseBtn} ${bCls} ${(perLocked||optionsDisabled)?"pointer-events-none":""} ${shouldDim?"opacity-60":""} ${lastCol}`}>{nm}</button>);})}
            </div>
          </div>
          <div className="mt-4 rounded-2xl panel p-3 space-y-3">
            <div className="grid grid-cols-4 gap-2">
              {primaryBtn}
              <div className="col-span-1 flex gap-1">
                <button type="button" data-key="ArrowLeft" className={`flex-1 px-1 py-2 rounded-xl border surface-button text-sm font-medium flex items-center justify-center ${backDisabled?"opacity-60 pointer-events-none":""}`} onClick={eng.back}><span style={{position:'relative',top:'-1.5px'}}>&lt;</span></button>
                <button type="button" data-key="ArrowRight" className={`flex-1 px-1 py-2 rounded-xl border surface-button text-sm font-medium flex items-center justify-center ${fwdDisabled?"opacity-60 pointer-events-none":""}`} onClick={eng.forward}><span style={{position:'relative',top:'-1.5px'}}>&gt;</span></button>
              </div>
              <button type="button" data-key="R" className={`col-span-1 px-3 py-2 rounded-xl border surface-button text-sm font-medium text-center ${revealLocked?"opacity-60 pointer-events-none":""}`} onClick={onReveal}>Reveal</button>
              <button type="button" data-key="O" className={`col-span-1 px-3 py-2 rounded-xl border surface-button text-sm font-medium text-center ${!overrideAvail?"opacity-60 pointer-events-none":""}`} onClick={onOverride}>Override</button>
            </div>
            <button type="button" data-key="C" className={`w-full px-4 py-2 rounded-xl btn-solid text-sm font-medium ${codesDisabled&&!inBack?"opacity-60 pointer-events-none":""}`} onClick={onShowCodes}>{state.calcOpen?"Hide Codes":"Show Codes"}</button>
            <Expander open={state.calcOpen}><div className="mt-3 rounded-2xl thin px-4 pt-[3px] pb-1.5"><MethodExplanation date={aoxFrozenDate} useJulian={inBack?(aoxFrozenDate?._jul??useJulian):useJulian} displayedFormat={aoxFrozenDate?._fmt||dateFormat}/></div></Expander>
          </div>
        </div>
      );
    }

    // ============================================================
    // ClassicMode — the Classic game mode, on the shared engine (mode-untangle Step 1c).
    //
    // Self-contained + always-mounted (display:none when inactive), exactly like AoxMode:
    // it owns ALL of Classic's state via useGameEngine (the pure reducer) plus its own
    // display toggles (timing/scoring hide, the timing-desync two-tap) and the transient
    // button flash. App no longer renders Classic inline — it just mounts <ClassicMode/>
    // and passes the settings down (like it does for AoxMode). This is the first mode
    // carved out of App's fused rendering; Flash/Blitz/Deduction follow onto the same engine.
    // ============================================================
    function ClassicMode({visible,genDate,minY,maxY,useJulian,saveStats,dateFormat,randomFormat,leapChance,janFebChance,julianChance,fmtDate,onFreshChange}: ModeProps & { genDate: GenDate; fmtDate: FmtDate }){
      const timingOff=useModePrefs(s=>s.classicTimingOff),setTimingOff=useModePrefs(s=>s.setClassicTimingOff);   // persisted; timing hidden by default (feeds the engine)
      const scoringOff=useModePrefs(s=>s.classicScoringOff),setScoringOff=useModePrefs(s=>s.setClassicScoringOff);   // persisted; scoring shown by default
      // Lifetime stats persist across reloads (Stage D1): hydrate from saved progress on mount,
      // then mirror every stats change back to the store (which caps the solve-times window).
      const eng=useGameEngine({genDate,minY,maxY,useJulian,saveStats,timingOff,getInitialStats:()=>useProgress.getState().stats.classic});
      const {state,correct,overrideAvail}=eng;
      const setModeStats=useProgress(s=>s.setModeStats);
      useEffect(()=>{setModeStats('classic',state.stats);},[state.stats,setModeStats]);
      const {flash,setFlashWithTimeout}=useButtonFlash();   // green/red answer pulse
      // Hideable stats chrome (show/hide toggles + two-tap "Enable and Reset Stats?" arm + the 6-box
      // stats strip), shared with Flash/Deduction via useStatsHideToggles.
      const {timingArmed,statsArr,armedSpan,armedBtnRef}=useStatsHideToggles({eng,saveStats,visible,timingOff,setTimingOff,scoringOff,setScoringOff});
      const optionsDisabled=state.locked||state.calcOpen||state.calcPenaltyActive;
      const revealDisabled=(state.locked&&state.revealed)||state.calcOpen||state.calcPenaltyActive;
      const baseBtn="w-full rounded-2xl border px-4 py-3 text-base shadow-xs select-none";
      const idleBtn="surface-button";

      const onAnswer=(i: number)=>{setFlashWithTimeout({type:i===correct?"good":"bad",idx:i});eng.answer(i);};
      // Override Path 3 (override-after-wrong) flashes green on the correct button, matching App.
      const onOverride=()=>{if(state.countedWrong)setFlashWithTimeout({type:"good",idx:correct});eng.override();};

      // regenDecisionFor (App's popover effect, Classic slice): a format / leap / Jan-Feb /
      // Julian-chance / year-range change regens an UNANSWERED live date; a useJulian toggle
      // keeps it (live useJulian flows through to the answer + codes). REGEN_DATE no-ops on a
      // burned or browsed date, so we just fire it on the relevant changes.
      useChangeEffect([randomFormat,dateFormat,leapChance,janFebChance,julianChance,minY,maxY],()=>eng.regenDate());
      // Freshness — engine state at launch default + Classic's own toggle/flash fields. Reported up
      // via onFreshChange so App's isFullyReset (Full Reset dim/lock) accounts for Classic.
      const classicIsFresh=engineFresh(state)&&timingOff===true&&scoringOff===false&&timingArmed===false&&flash===null;
      useEffect(()=>{onFreshChange?.(classicIsFresh);},[classicIsFresh,onFreshChange]);
      const date=state.date;
      return(
        <div style={{display:visible?"block":"none"}}>
          <div className={saveStats?"":"opacity-50"}><StatPanel stats={statsArr} armedSpan={armedSpan} armedBtnRef={armedBtnRef}/></div>
          <div className="mt-3"><button type="button" data-key="S" className={RESET_STATS_BTN_CLASS} onClick={eng.resetStats}>Reset Stats</button></div>
          <div className="mt-5">
            <div className="mt-4 rounded-2xl panel p-4">
              <div className="text-center relative">
                {state.backDepth>0&&<span className="absolute right-0 top-0 text-[11px] tabular-nums text-purple-300/60">Q{state.stack.length+1}</span>}
                <div className="text-3xl font-bold">{fmtDate(date.y,date.m,date.d,date._fmt)}</div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3" data-answer-grid="true">
                {DAY.map((n,i)=>{const last=i===DAY.length-1?"col-span-2":"";const ps=state.persistBtns[i];const isFlashing=!!(flash&&flash.idx===i);const bCls=buttonStateClass(ps,isFlashing,flash?.type==="good",idleBtn);const perLocked=!!ps;const shouldDim=optionsDisabled&&!ps&&!isFlashing;return(<button key={n} type="button" onClick={()=>{if(perLocked)return;onAnswer(i);if(isTouch)(document.activeElement as HTMLElement | null)?.blur();}} className={`${baseBtn} ${bCls} ${(perLocked||optionsDisabled)?"pointer-events-none":""} ${shouldDim?"opacity-60":""} ${last}`}>{n}</button>);})}
              </div>
            </div>
            <div className="mt-4 rounded-2xl panel p-3 space-y-3">
              <div className="grid grid-cols-4 gap-2">
                <button type="button" data-key="N" className="col-span-1 px-3 py-2 rounded-xl border surface-button text-sm font-medium" onClick={()=>eng.doNew()}>New</button>
                <div className="col-span-1 flex gap-1">
                  <button type="button" data-key="ArrowLeft" className={`flex-1 px-1 py-2 rounded-xl border surface-button text-sm font-medium flex items-center justify-center ${state.stack.length===0?"opacity-60 pointer-events-none":""}`} onClick={eng.back}><span style={{position:'relative',top:'-1.5px'}}>&lt;</span></button>
                  <button type="button" data-key="ArrowRight" className={`flex-1 px-1 py-2 rounded-xl border surface-button text-sm font-medium flex items-center justify-center ${state.forwardStack.length===0?"opacity-60 pointer-events-none":""}`} onClick={eng.forward}><span style={{position:'relative',top:'-1.5px'}}>&gt;</span></button>
                </div>
                <button type="button" data-key="R" className={`col-span-1 px-3 py-2 rounded-xl border surface-button text-sm font-medium text-center ${revealDisabled?"opacity-60 pointer-events-none":""}`} onClick={eng.reveal}>Reveal</button>
                <button type="button" data-key="O" className={`col-span-1 px-3 py-2 rounded-xl border surface-button text-sm font-medium text-center ${!overrideAvail?"opacity-60 pointer-events-none":""}`} onClick={onOverride}>Override</button>
              </div>
              <MethodBreakdownSection date={date} open={state.calcOpen} onOpenChange={open=>eng.showCodes(open)} className="" contentClassName="mt-3 rounded-2xl thin px-4 pt-[3px] pb-1.5" useJulian={state.backDepth>0?(date?._jul??useJulian):useJulian} displayedFormat={date?._fmt||dateFormat}/>
            </div>
          </div>
        </div>
      );
    }

    // ============================================================
    // FlashMode — the Flash game mode on the shared engine (mode-untangle Step 2).
    //
    // Self-contained + always-mounted like ClassicMode/AoxMode. Reuses useGameEngine for ALL
    // engine behavior (answer/override/stats/history); adds only Flash's brief-reveal TIMER:
    // Begin advances to a fresh date + reveals it for flashMs, then it hides ("…") and you
    // answer from memory; answering, Reveal, or Override ends the flash. The timer (setTimeout
    // + rAF + the bar) is component-owned side-effect — the pure reducer never sees it.
    // (Chrome — stats strip, toggles, freshness, settings-regen — currently mirrors
    // ClassicMode; that duplication gets factored into a shared shell in Step 6, once all
    // modes' variations are known.)
    // ============================================================
    function FlashMode({visible,genDate,minY,maxY,useJulian,saveStats,dateFormat,randomFormat,leapChance,janFebChance,julianChance,fmtDate,onFreshChange}: ModeProps & { genDate: GenDate; fmtDate: FmtDate }){
      const [active,setActive]=useState(false);
      const [flashPhase,setFlashPhase]=useState("dash");      // dash (idle) | show (revealing) | hide ("…")
      const [showTimerDate,setShowTimerDate]=useState(false); // keep the date visible after Reveal
      const flashMs=useModePrefs(s=>s.flashMs),setFlashMs=useModePrefs(s=>s.setFlashMs);   // persisted (mode-prefs store)
      const [flashRemainMs,setFlashRemainMs]=useState(500);
      const flashTimerRef=useRef<ReturnType<typeof setTimeout> | null>(null);
      const flashDeadlineRef=useRef<number | null>(null);
      const flashBarRef=useRef<HTMLSpanElement | null>(null);
      const timingOff=useModePrefs(s=>s.flashTimingOff),setTimingOff=useModePrefs(s=>s.setFlashTimingOff);   // persisted; timing shown by default (feeds the engine)
      const scoringOff=useModePrefs(s=>s.flashScoringOff),setScoringOff=useModePrefs(s=>s.setFlashScoringOff);   // persisted; scoring shown by default
      // Lifetime stats persist across reloads (Stage D1): hydrate on mount, mirror changes to the store.
      const eng=useGameEngine({genDate,minY,maxY,useJulian,saveStats,timingOff,getInitialStats:()=>useProgress.getState().stats.flash});
      const {state,correct,overrideAvail}=eng;
      const setModeStats=useProgress(s=>s.setModeStats);
      useEffect(()=>{setModeStats('flash',state.stats);},[state.stats,setModeStats]);
      const {flash,setFlashWithTimeout}=useButtonFlash();   // green/red answer pulse

      const resetFlashBar=()=>{if(flashBarRef.current){flashBarRef.current.style.transition="none";flashBarRef.current.style.transform="scaleX(1)";}};
      const startFlashBar=(ms: number)=>{requestAnimationFrame(()=>{if(!flashBarRef.current)return;const s=flashBarRef.current;s.style.transition="none";s.style.transform="scaleX(1)";s.getBoundingClientRect();s.style.transition=`transform ${ms}ms linear`;s.style.transform="scaleX(0)";});};
      const endFlashPhase=useCallback(()=>{setFlashPhase("hide");flashDeadlineRef.current=null;setFlashRemainMs(0);flashTimerRef.current=null;},[]);
      const stopFlash=()=>{clearTimeout(flashTimerRef.current ?? undefined);flashTimerRef.current=null;setFlashPhase("dash");flashDeadlineRef.current=null;setFlashRemainMs(flashMs);resetFlashBar();};
      // freezeFlash — Show-Codes-during-the-flash teardown. Unlike stopFlash (which RESETS the
      // bar to 100% + number to full for the idle state), this FREEZES the countdown in place:
      // it cancels the auto-hide timer, stops the rAF number countdown (setActive(false)), and
      // pins the bar at its current rendered scale so the bar and number freeze TOGETHER. The
      // date stays shown. (The original applyCalcPenalty froze the number but missed the bar's
      // CSS transition — bug #4. This completes the freeze.)
      const freezeFlash=()=>{
        clearTimeout(flashTimerRef.current ?? undefined);flashTimerRef.current=null;flashDeadlineRef.current=null;
        if(flashBarRef.current){const t=getComputedStyle(flashBarRef.current).transform;flashBarRef.current.style.transition="none";flashBarRef.current.style.transform=t;}
        setActive(false);setShowTimerDate(true);setFlashPhase("dash");
      };

      // rAF countdown of the reveal-time label while showing (cosmetic; matches App's loop).
      useEffect(()=>{
        if(!(active&&flashPhase==="show"))return;
        let raf = 0;
        const loop=()=>{const now=performance.now();if(flashDeadlineRef.current)setFlashRemainMs(Math.max(0,flashDeadlineRef.current-now));raf=requestAnimationFrame(loop);};
        raf=requestAnimationFrame(loop);
        return ()=>cancelAnimationFrame(raf);
      },[active,flashPhase]);

      const begin=()=>{
        eng.doNew();                       // advance to a fresh date to reveal
        setActive(true);setShowTimerDate(false);setFlashPhase("show");
        clearTimeout(flashTimerRef.current ?? undefined);
        const now=performance.now();
        flashDeadlineRef.current=now+flashMs;setFlashRemainMs(flashMs);
        flashTimerRef.current=setTimeout(endFlashPhase,Math.max(50,flashMs));
        startFlashBar(flashMs);
      };
      const onAnswer=(i: number)=>{
        if(!active)return;
        setFlashWithTimeout({type:i===correct?"good":"bad",idx:i});
        eng.answer(i);
        if(i===correct){setActive(false);stopFlash();}   // a correct answer ends the flash
      };
      // Reveal during a live flash FREEZES the countdown (bar + number) in place, exactly like
      // Show Codes — the date stays shown and the answer is revealed. Outside a live flash
      // (browsing history / idle) it keeps the plain reset-to-idle teardown.
      const onReveal=()=>{eng.reveal();if(active)freezeFlash();else{setActive(false);setShowTimerDate(true);stopFlash();}};
      // Opening Show Codes mid-flash freezes the countdown (bar + number) and keeps the date
      // shown, then applies the codes penalty — bug #4. Closing it (or opening on a non-live
      // entry) is the normal toggle.
      const onShowCodes=(open: boolean)=>{if(open&&active)freezeFlash();eng.showCodes(open);};
      const onOverride=()=>{const wasActive=active;if(state.countedWrong)setFlashWithTimeout({type:"good",idx:correct});eng.override();if(wasActive){setActive(false);stopFlash();}};
      const resetRound=()=>{eng.resetRound();setActive(false);setShowTimerDate(false);stopFlash();};   // primary "Reset" while live (= App arm)

      // Hideable stats chrome shared with Classic/Deduction. Flash supplies its flash-timer teardown:
      // afterTimingEnabled (re-enabling timing while a flash is live stops it + hides its date) and
      // onHide (leaving the mode stops a live flash). Classic/Deduction pass neither (no timer).
      const {timingArmed,statsArr,armedSpan,armedBtnRef}=useStatsHideToggles({
        eng,saveStats,visible,timingOff,setTimingOff,scoringOff,setScoringOff,
        afterTimingEnabled:()=>{if(active){setActive(false);stopFlash();}setShowTimerDate(false);},
        onHide:()=>{if(active){setActive(false);stopFlash();}},
      });

      useChangeEffect([randomFormat,dateFormat,leapChance,janFebChance,julianChance,minY,maxY],()=>eng.regenDate());

      // Freshness for App's isFullyReset (Flash owns its state now): engine fresh + Flash's own fields.
      const flashIsFresh=engineFresh(state)&&timingOff===false&&scoringOff===false&&timingArmed===false&&flash===null&&active===false&&flashPhase==="dash"&&showTimerDate===false&&flashMs===500&&flashRemainMs===500;
      useEffect(()=>{onFreshChange?.(flashIsFresh);},[flashIsFresh,onFreshChange]);

      const shouldShowTimerDate=active||showTimerDate;
      const flashHiding=active&&flashPhase==="hide";
      const optionsDisabled=!active||state.locked||state.calcOpen||state.calcPenaltyActive;
      // Reveal is available whenever a date is on screen — including DURING the flash (matching
      // Show Codes, which keys off shouldShowTimerDate). Was wrongly locked in the "show" phase
      // via `!showTimerDate&&!flashHiding`; `!shouldShowTimerDate` enables it — bug #5.
      const revealDisabled=(state.locked&&state.revealed)||state.calcOpen||state.calcPenaltyActive||!shouldShowTimerDate;
      const baseBtn="w-full rounded-2xl border px-4 py-3 text-base shadow-xs select-none";
      const idleBtn="surface-button";
      const onResetStats=()=>{eng.resetStats();if(active){setActive(false);stopFlash();}setShowTimerDate(false);};
      const date=state.date;
      const dateText=shouldShowTimerDate?(flashHiding?"…":fmtDate(date.y,date.m,date.d,date._fmt)):"—";
      return(
        <div style={{display:visible?"block":"none"}}>
          <div className={saveStats?"":"opacity-50"}><StatPanel stats={statsArr} armedSpan={armedSpan} armedBtnRef={armedBtnRef}/></div>
          <div className="mt-3"><button type="button" data-key="S" className={RESET_STATS_BTN_CLASS} onClick={onResetStats}>Reset Stats</button></div>
          <div className="mt-3"><div className="flex items-center gap-2"><input type="range" min="100" max="3000" step="100" value={flashMs} onChange={e=>{const v=+e.target.value;setFlashMs(v);if(!active){setFlashRemainMs(v);resetFlashBar();}}} disabled={active} style={{"--rng-fill":Math.round((flashMs-100)/2900*100)+"%"} as React.CSSProperties} className="flex-1 disabled:opacity-40"/><span className="tabular-nums text-xs w-10 shrink-0 text-right">{fmtFlashT(flashMs)}</span></div></div>
          <div className="mt-5">
            <div className="mb-3"><div className="text-center text-xs tabular-nums text-purple-200/80 mb-1">{fmtFlashT(flashRemainMs)}</div><div className="bar"><span ref={flashBarRef} style={{width:"100%"}}></span></div></div>
            <div className="mt-4 rounded-2xl panel p-4">
              <div className="text-center relative">
                {state.backDepth>0&&<span className="absolute right-0 top-0 text-[11px] tabular-nums text-purple-300/60">Q{state.stack.length+1}</span>}
                <div className="text-3xl font-bold">{dateText}</div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3" data-answer-grid="true">
                {DAY.map((n,i)=>{const last=i===DAY.length-1?"col-span-2":"";const ps=state.persistBtns[i];const isFlashing=!!(flash&&flash.idx===i);const bCls=buttonStateClass(ps,isFlashing,flash?.type==="good",idleBtn);const perLocked=!!ps;const shouldDim=optionsDisabled&&!ps&&!isFlashing;return(<button key={n} type="button" onClick={()=>{if(perLocked)return;onAnswer(i);if(isTouch)(document.activeElement as HTMLElement | null)?.blur();}} className={`${baseBtn} ${bCls} ${(perLocked||optionsDisabled)?"pointer-events-none":""} ${shouldDim?"opacity-60":""} ${last}`}>{n}</button>);})}
              </div>
            </div>
            <div className="mt-4 rounded-2xl panel p-3 space-y-3">
              <div className="grid grid-cols-4 gap-2">
                {active?(<button type="button" data-key="N" className={`col-span-1 ${RESET_BTN_CLASS}`} onClick={resetRound}>Reset</button>):(<button type="button" data-key="N" className="col-span-1 px-3 py-2 rounded-xl btn-solid text-sm font-medium" onClick={begin}>Begin</button>)}
                <div className="col-span-1 flex gap-1">
                  <button type="button" data-key="ArrowLeft" className={`flex-1 px-1 py-2 rounded-xl border surface-button text-sm font-medium flex items-center justify-center ${(active||state.stack.length===0)?"opacity-60 pointer-events-none":""}`} onClick={eng.back}><span style={{position:'relative',top:'-1.5px'}}>&lt;</span></button>
                  <button type="button" data-key="ArrowRight" className={`flex-1 px-1 py-2 rounded-xl border surface-button text-sm font-medium flex items-center justify-center ${(active||state.forwardStack.length===0)?"opacity-60 pointer-events-none":""}`} onClick={eng.forward}><span style={{position:'relative',top:'-1.5px'}}>&gt;</span></button>
                </div>
                <button type="button" data-key="R" className={`col-span-1 px-3 py-2 rounded-xl border surface-button text-sm font-medium text-center ${revealDisabled?"opacity-60 pointer-events-none":""}`} onClick={onReveal}>Reveal</button>
                <button type="button" data-key="O" className={`col-span-1 px-3 py-2 rounded-xl border surface-button text-sm font-medium text-center ${!overrideAvail?"opacity-60 pointer-events-none":""}`} onClick={onOverride}>Override</button>
              </div>
              <MethodBreakdownSection date={shouldShowTimerDate?date:null} open={state.calcOpen} onOpenChange={onShowCodes} className="" contentClassName="mt-3 rounded-2xl thin px-4 pt-[3px] pb-1.5" useJulian={state.backDepth>0?(date?._jul??useJulian):useJulian} displayedFormat={date?._fmt||dateFormat}/>
            </div>
          </div>
        </div>
      );
    }

    // ============================================================
    // BlitzMode — the Blitz game mode on the shared engine (mode-untangle Step 3).
    //
    // Self-contained + always-mounted. KEY INSIGHT: App resets stats on every blitz Begin,
    // so the engine `S` already IS the round score — Blitz needs NO reducer changes. BlitzMode
    // = the engine + a countdown (Per Round `blitzSec` / Per Question `qSec`) + Best Score/
    // Streak tracking. Begin = engine.resetStats() (fresh round) + start timer; answering uses
    // the engine; a round ends on the clock, a per-round wrong with Allow-Mistakes-off, or a
    // per-Q wrong. Best is reconciled in an effect when a round ends (set to max, tagged with
    // the round id) and ROLLED BACK there too when an Override drops the round that set it.
    // ============================================================
    function BlitzMode({visible,genDate,minY,maxY,useJulian,saveStats,dateFormat,randomFormat,leapChance,janFebChance,julianChance,fmtDate,onFreshChange}: ModeProps & { genDate: GenDate; fmtDate: FmtDate }){
      const perQ=useModePrefs(s=>s.blitzPerQ),setPerQ=useModePrefs(s=>s.setBlitzPerQ);   // persisted (mode-prefs store)
      const allowMistakes=useModePrefs(s=>s.blitzAllowMistakes),setAllowMistakes=useModePrefs(s=>s.setBlitzAllowMistakes);   // persisted (mode-prefs store)
      const [active,setActive]=useState(false);
      const [timerDone,setTimerDone]=useState(false);
      const [showTimerDate,setShowTimerDate]=useState(false);
      const blitzSec=useModePrefs(s=>s.blitzSec),setBlitzSec=useModePrefs(s=>s.setBlitzSec);   // persisted (mode-prefs store)
      const qSec=useModePrefs(s=>s.blitzQSec),setQSec=useModePrefs(s=>s.setBlitzQSec);   // persisted (mode-prefs store)
      const [,setBlitzRemain]=useState(60);
      const [,setQRemain]=useState(5);
      const blitzStartRef=useRef<number | null>(null),blitzPausedAtRef=useRef<number | null>(null),blitzPausedAccRef=useRef(0),blitzRemainRef=useRef(60);
      const blitzBarRef=useRef<HTMLSpanElement | null>(null),blitzTimeRef=useRef<HTMLSpanElement | null>(null);
      const qDeadlineRef=useRef<number | null>(null),qPausedAtRef=useRef<number | null>(null),qPausedAccRef=useRef(0);
      const suddenBarRef=useRef<HTMLSpanElement | null>(null),suddenTimeRef=useRef<HTMLSpanElement | null>(null);
      // Blitz/Sudden all-time bests persist across reloads (Stage D1): from the progress store.
      // (The "new best ★" markers below stay local — they're per-session UI, not persisted.)
      const blitzBest=useProgress(s=>s.blitzBest),setBlitzBest=useProgress(s=>s.setBlitzBest);
      const suddenBest=useProgress(s=>s.suddenBest),setSuddenBest=useProgress(s=>s.setSuddenBest);
      const [blitzBestNew,setBlitzBestNew]=useState<Record<string, { score: boolean; streak: boolean }>>({}),[suddenBestNew,setSuddenBestNew]=useState<Record<string, boolean>>({});
      const currentRoundIdRef=useRef<number | null>(null),nextRoundIdRef=useRef(1);
      const eng=useGameEngine({genDate,minY,maxY,useJulian,saveStats,timingOff:false}); // Blitz: timing always tracked
      const {state,correct,overrideAvail}=eng;
      const S=state.stats;
      const {flash,setFlashWithTimeout}=useButtonFlash();   // green/red answer pulse

      // Per-config Best silos (mirrors App's getBlitzBk / getSuddenBk keys exactly).
      const blitzBk=`${allowMistakes?'m':'n'}${blitzSec}|${randomFormat?'random':dateFormat}|${leapChance}|${janFebChance}|${julianChance}|${minY}-${maxY}|${useJulian}`;
      const suddenBk=`${qSec}|${randomFormat?'random':dateFormat}|${leapChance}|${janFebChance}|${julianChance}|${minY}-${maxY}|${useJulian}`;

      const resetTimerBars=()=>{if(blitzBarRef.current)blitzBarRef.current.style.transform="scaleX(1)";if(suddenBarRef.current)suddenBarRef.current.style.transform="scaleX(1)";};
      const stopRound=()=>{blitzStartRef.current=null;blitzPausedAtRef.current=null;blitzPausedAccRef.current=0;qDeadlineRef.current=null;qPausedAtRef.current=null;qPausedAccRef.current=0;};
      const endRound=()=>{setActive(false);setShowTimerDate(true);setTimerDone(true);stopRound();};

      // Countdown loop (Per Round drains blitzRemain; Per Question drains qRemain). On 0 the
      // round ends — per-round timeout shows the answer with no stat (lockReveal); per-Q
      // timeout counts a miss (timeoutMiss).
      useEffect(()=>{
        if(!active)return;
        let raf = 0;
        const loop=()=>{
          const now=performance.now();
          if(!perQ&&blitzStartRef.current!=null){
            const t=(now-blitzStartRef.current-blitzPausedAccRef.current)/1000;
            const r=Math.max(0,blitzSec-t);blitzRemainRef.current=r;
            const sx=Math.max(0,Math.min(1,r/blitzSec));
            if(blitzBarRef.current)blitzBarRef.current.style.transform="scaleX("+sx+")";
            if(blitzTimeRef.current)blitzTimeRef.current.textContent=fmtBlitzT(r);
            setBlitzRemain(r);
            if(r<=.001){eng.lockReveal();endRound();return;}
          }
          if(perQ&&qDeadlineRef.current!=null){
            const r=Math.max(0,(qDeadlineRef.current+qPausedAccRef.current-now)/1000);
            const sx=(qSec>0?Math.max(0,Math.min(1,r/qSec)):1);
            if(suddenBarRef.current)suddenBarRef.current.style.transform="scaleX("+sx+")";
            if(suddenTimeRef.current)suddenTimeRef.current.textContent=Math.ceil(r)+"s";
            setQRemain(r);
            if(r<=.001){eng.timeoutMiss();endRound();return;}
          }
          raf=requestAnimationFrame(loop);
        };
        raf=requestAnimationFrame(loop);
        return ()=>cancelAnimationFrame(raf);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- endRound is behavior-stable (closes over only stable setters + ref writes); excluded so its identity change doesn't restart the countdown
      },[active,perQ,blitzSec,qSec,eng]);

      const begin=()=>{
        eng.resetStats();                       // fresh round (S→0, history clear, new date)
        currentRoundIdRef.current=nextRoundIdRef.current++;
        setActive(true);setTimerDone(false);setShowTimerDate(false);
        const now=performance.now();
        if(!perQ){blitzStartRef.current=now;blitzPausedAccRef.current=0;blitzPausedAtRef.current=null;setBlitzRemain(blitzSec);blitzRemainRef.current=blitzSec;}
        else{qDeadlineRef.current=now+qSec*1000;qPausedAccRef.current=0;qPausedAtRef.current=null;setQRemain(qSec);}
        resetTimerBars();
      };
      const onAnswer=(i: number)=>{
        if(!active)return;
        setFlashWithTimeout({type:i===correct?"good":"bad",idx:i});
        eng.answer(i);
        if(i===correct){
          // eslint-disable-next-line react-hooks/purity -- performance.now() runs in the answer event handler (not render); the linter mis-flags handler-only impurity (begin() makes the same call un-flagged)
          if(perQ){const now=performance.now();qDeadlineRef.current=now+qSec*1000;qPausedAccRef.current=0;qPausedAtRef.current=null;setQRemain(qSec);}
          // per-round: round continues; engine already advanced to the next date
        }else{
          // Wrong: per-Q is sudden death; per-round ends only when Allow Mistakes is off.
          if(perQ||!allowMistakes){eng.lockReveal();endRound();}
        }
      };
      // Override-to-wrong is a mistake: flipping a CORRECT answer to wrong (a live first-try
      // reversal, or retro-flipping the most-recent correct history entry) ends the round when
      // Allow Mistakes is off (or Per Question) — exactly like a real wrong answer (bug #1).
      // Wrong→credit overrides (countedWrong / pendingWrongOverride) are corrections and never
      // end the round. Detect the to-wrong direction from the same fields the reducer reads.
      const onOverride=()=>{
        let flipToWrong=false;
        if(state.canOverrideCorrect&&state.prevStatsSnapshot)flipToWrong=!state.prevStatsSnapshot.wasWrong;
        else if(eng.retroOverrideEligible){const last=state.stack[state.stack.length-1];flipToWrong=!!(last?.capsule?.snapshot&&!last.capsule.snapshot.wasWrong);}
        if(state.countedWrong)setFlashWithTimeout({type:"good",idx:correct});
        eng.override(); // best reconciled by the timerDone effect
        if(active&&flipToWrong&&(perQ||!allowMistakes))endRound();
      };
      const onReveal=()=>{eng.reveal();endRound();};
      // Opening Show Codes during an active round ends the round (so Best Score is recorded and
      // the countdown stops), exactly like Reveal — bug #3. The original applyCalcPenalty ended
      // the round for an active timer; the Blitz migration dropped it (bare eng.showCodes).
      const onShowCodes=(open: boolean)=>{eng.showCodes(open);if(open&&active)endRound();};
      const resetRound=()=>{eng.resetStats();setActive(false);setTimerDone(false);setShowTimerDate(false);stopRound();resetTimerBars();}; // App's arm (resets stats for blitz)

      // Reconcile Best when a round is over: set to max(S) tagged with the round id, and roll
      // back when an Override has dropped the score of the round that set the Best. Runs on
      // S changes while timerDone (covers both round-end and post-round override).
      useEffect(()=>{
        if(!timerDone)return;
        const rid=currentRoundIdRef.current;
        if(!perQ){
          setBlitzBest(prev=>{
            const cur=prev[blitzBk]??{score:0,streak:0,scoreRoundId:null,streakRoundId:null};
            let next={...cur};
            if(S.good>cur.score)next={...next,score:S.good,scoreRoundId:rid};
            else if(cur.scoreRoundId===rid&&S.good<cur.score)next={...next,score:S.good};
            if(S.best>cur.streak)next={...next,streak:S.best,streakRoundId:rid};
            else if(cur.streakRoundId===rid&&S.best<cur.streak)next={...next,streak:S.best};
            if(next.score===cur.score&&next.streak===cur.streak&&next.scoreRoundId===cur.scoreRoundId&&next.streakRoundId===cur.streakRoundId)return prev;
            const scoreUp=next.score>cur.score,streakUp=next.streak>cur.streak;
            if(scoreUp||streakUp)setBlitzBestNew(p=>{const e=p[blitzBk]||{score:false,streak:false};return{...p,[blitzBk]:{score:e.score||scoreUp,streak:e.streak||streakUp}};});
            return{...prev,[blitzBk]:next};
          });
        }else{
          setSuddenBest(prev=>{
            const cur=prev[suddenBk]??{score:0,roundId:null};
            let next={...cur};
            if(S.good>cur.score)next={score:S.good,roundId:rid};
            else if(cur.roundId===rid&&S.good<cur.score)next={...next,score:S.good};
            if(next.score===cur.score&&next.roundId===cur.roundId)return prev;
            if(next.score>cur.score)setSuddenBestNew(p=>({...p,[suddenBk]:true}));
            return{...prev,[suddenBk]:next};
          });
        }
      },[timerDone,S.good,S.best,perQ,blitzBk,suddenBk,setBlitzBest,setSuddenBest]);

      const togglePerQ=()=>{if(active||timerDone)return;setPerQ(v=>{const n=!v;if(n&&allowMistakes)setAllowMistakes(false);return n;});};
      const toggleAllowMistakes=()=>{if(active||timerDone)return;setAllowMistakes(v=>!v);};

      const blitzIsFresh=state.stats.played===0&&state.stats.good===0&&state.stats.streak===0&&state.stats.best===0&&state.stats.times.length===0&&state.stack.length===0&&state.forwardStack.length===0&&state.backDepth===0&&state.locked===false&&state.revealed===false&&state.countedWrong===false&&state.canOverrideCorrect===false&&state.pendingWrongOverride===null&&state.overrideUsedThisQ===false&&state.calcOpen===false&&active===false&&timerDone===false&&showTimerDate===false&&perQ===false&&allowMistakes===true&&blitzSec===60&&qSec===5&&Object.keys(blitzBest).length===0&&Object.keys(suddenBest).length===0&&flash===null;
      useEffect(()=>{onFreshChange?.(blitzIsFresh);},[blitzIsFresh,onFreshChange]);

      const shouldShowTimerDate=active||showTimerDate;
      const optionsDisabled=!active||state.locked||state.calcOpen||state.calcPenaltyActive;
      const timerBlocksReveal=!shouldShowTimerDate;
      const revealDisabled=(state.locked&&state.revealed)||state.calcOpen||state.calcPenaltyActive||timerBlocksReveal||timerDone;
      const timerBusy=active;
      const baseBtn="w-full rounded-2xl border px-4 py-3 text-base shadow-xs select-none";
      const idleBtn="surface-button";
      const showStreak=!perQ;
      const sOff=!saveStats;
      const statsArr=[
        {label:"Score",value:`${S.good}/${S.played}`,off:sOff,fn:null},
        {label:"Accuracy",value:fmtAccuracyPct(S.good,S.played),off:sOff,fn:null},
        ...(showStreak?[{label:"Streak",value:`${S.streak}/${S.best}`,off:sOff,fn:null}]:[]),
        {label:"Last",value:truncTime(calcLast(S.times)),off:sOff,fn:null},
        {label:"Average",value:fmtTime(calcAvg(S.times)),off:sOff,fn:null},
        {label:"Median",value:fmtTime(calcMed(S.times)),off:sOff,fn:null},
      ];
      const date=state.date;
      const dateText=shouldShowTimerDate?fmtDate(date.y,date.m,date.d,date._fmt):"—";
      const bScore=blitzBest[blitzBk],sScore=suddenBest[suddenBk];
      return(
        <div style={{display:visible?"block":"none"}}>
          <div className={saveStats?"":"opacity-50"}><StatPanel stats={statsArr}/></div>
          {!perQ&&(()=>{const newF=blitzBestNew[blitzBk]||{score:false,streak:false};const showTag=bScore&&bScore.scoreRoundId!=null&&bScore.streakRoundId!=null;return(<div className="mt-3 text-xs text-purple-300/60"><div className="flex flex-wrap items-start gap-4"><div className="min-w-[125px]">Best Score: {bScore?.score??'—'}{newF.score&&<NewBestStar/>}</div><div className="min-w-[125px]">Best Streak: {bScore?.streak??'—'}{newF.streak&&<NewBestStar/>}</div>{showTag&&<span className="shrink-0 ml-auto">{bScore.scoreRoundId===bScore.streakRoundId?"Same Round":"Different Rounds"}</span>}</div></div>);})()}
          {perQ&&(<div className="mt-3 text-xs text-purple-300/60"><div className="flex flex-wrap items-start gap-4"><div className="min-w-[125px]">Best Score: {sScore?.score??'—'}{suddenBestNew[suddenBk]&&<NewBestStar/>}</div></div></div>)}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={toggleAllowMistakes} className={`flex-1 px-2 py-1 rounded-xl text-xs font-medium border ${allowMistakes?"btn-solid border-transparent":"surface-toggle text-purple-100/80"}${(active||timerDone)?" opacity-60 pointer-events-none":""}`}>Allow Mistakes</button>
            <button type="button" onClick={togglePerQ} className={`flex-1 px-2 py-1 rounded-xl text-xs font-medium border btn-solid border-transparent${(active||timerDone)?" opacity-60 pointer-events-none":""}`}>{perQ?"Per Question":"Per Round"}</button>
          </div>
          <div className="mt-3">{!perQ?(<div className="flex items-center gap-2"><input type="range" min="10" max="180" step="5" value={blitzSec} onChange={e=>{const v=+e.target.value;setBlitzSec(v);if(!active){setBlitzRemain(v);blitzRemainRef.current=v;if(blitzTimeRef.current)blitzTimeRef.current.textContent=fmtBlitzT(v);if(blitzBarRef.current)blitzBarRef.current.style.transform="scaleX(1)";}}} disabled={active||timerDone} style={{"--rng-fill":Math.round((blitzSec-10)/170*100)+"%"} as React.CSSProperties} className="flex-1 disabled:opacity-40"/><span className="tabular-nums text-xs w-14 shrink-0 text-right">{fmtBlitzT(blitzSec)}</span></div>):(<div className="flex items-center gap-2"><input type="range" min="1" max="20" step="1" value={qSec} onChange={e=>{const v=+e.target.value;setQSec(v);if(!active){setQRemain(v);if(suddenTimeRef.current)suddenTimeRef.current.textContent=v+"s";if(suddenBarRef.current)suddenBarRef.current.style.transform="scaleX(1)";}}} disabled={active||timerDone} style={{"--rng-fill":Math.round((qSec-1)/19*100)+"%"} as React.CSSProperties} className="flex-1 disabled:opacity-40"/><span className="tabular-nums text-xs w-8 shrink-0 text-right">{qSec}s</span></div>)}</div>
          <div className="mt-5">
            {!perQ&&(<div className="mb-3"><div className="text-center text-xs tabular-nums text-purple-200/80 mb-1"><span ref={blitzTimeRef}>{fmtBlitzT(blitzSec)}</span></div><div className="bar"><span ref={blitzBarRef} style={{width:"100%"}}></span></div></div>)}
            {perQ&&(<div className="mb-3"><div className="text-center text-xs tabular-nums text-purple-200/80 mb-1"><span ref={suddenTimeRef}>{qSec}s</span></div><div className="bar"><span ref={suddenBarRef} style={{width:"100%"}}></span></div></div>)}
            <div className="mt-4 rounded-2xl panel p-4">
              <div className="text-center relative">
                {state.backDepth>0&&<span className="absolute right-0 top-0 text-[11px] tabular-nums text-purple-300/60">Q{state.stack.length+1}</span>}
                <div className="text-3xl font-bold">{dateText}</div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3" data-answer-grid="true">
                {DAY.map((n,i)=>{const last=i===DAY.length-1?"col-span-2":"";const ps=state.persistBtns[i];const isFlashing=!!(flash&&flash.idx===i);const bCls=buttonStateClass(ps,isFlashing,flash?.type==="good",idleBtn);const perLocked=!!ps;const shouldDim=optionsDisabled&&!ps&&!isFlashing;return(<button key={n} type="button" onClick={()=>{if(perLocked)return;onAnswer(i);if(isTouch)(document.activeElement as HTMLElement | null)?.blur();}} className={`${baseBtn} ${bCls} ${(perLocked||optionsDisabled)?"pointer-events-none":""} ${shouldDim?"opacity-60":""} ${last}`}>{n}</button>);})}
              </div>
            </div>
            <div className="mt-4 rounded-2xl panel p-3 space-y-3">
              <div className="grid grid-cols-4 gap-2">
                {(active||timerDone)?(<button type="button" data-key="N" className={`col-span-1 ${RESET_BTN_CLASS}`} onClick={resetRound}>Reset</button>):(<button type="button" data-key="N" className="col-span-1 px-3 py-2 rounded-xl btn-solid text-sm font-medium" onClick={begin}>Begin</button>)}
                <div className="col-span-1 flex gap-1">
                  <button type="button" data-key="ArrowLeft" className={`flex-1 px-1 py-2 rounded-xl border surface-button text-sm font-medium flex items-center justify-center ${(timerBusy||state.stack.length===0)?"opacity-60 pointer-events-none":""}`} onClick={eng.back}><span style={{position:'relative',top:'-1.5px'}}>&lt;</span></button>
                  <button type="button" data-key="ArrowRight" className={`flex-1 px-1 py-2 rounded-xl border surface-button text-sm font-medium flex items-center justify-center ${(timerBusy||state.forwardStack.length===0)?"opacity-60 pointer-events-none":""}`} onClick={eng.forward}><span style={{position:'relative',top:'-1.5px'}}>&gt;</span></button>
                </div>
                <button type="button" data-key="R" className={`col-span-1 px-3 py-2 rounded-xl border surface-button text-sm font-medium text-center ${revealDisabled?"opacity-60 pointer-events-none":""}`} onClick={onReveal}>Reveal</button>
                <button type="button" data-key="O" className={`col-span-1 px-3 py-2 rounded-xl border surface-button text-sm font-medium text-center ${!overrideAvail?"opacity-60 pointer-events-none":""}`} onClick={onOverride}>Override</button>
              </div>
              <MethodBreakdownSection date={shouldShowTimerDate?date:null} open={state.calcOpen} onOpenChange={onShowCodes} className="" contentClassName="mt-3 rounded-2xl thin px-4 pt-[3px] pb-1.5" useJulian={state.backDepth>0?(date?._jul??useJulian):useJulian} displayedFormat={date?._fmt||dateFormat}/>
            </div>
          </div>
        </div>
      );
    }

    // ============================================================
    // DeductionMode — the Deduction game mode on the shared engine (mode-untangle Step 4).
    //
    // Self-contained + always-mounted like ClassicMode/FlashMode/BlitzMode. Deduction has THREE
    // independent sub-modes (Day/Month/Year), each with its OWN stats + history silo — modeled as
    // THREE useGameEngine instances; `dedType` selects which is shown while the other two persist
    // (exactly the per-silo behavior App had via statsByMode['deduction-*'] + dedStack[type]).
    // The "correct" answer is a puzzle OPTION INDEX, not a weekday — the shared reducer handles
    // that uniformly via correctIndexOf (puzzle entries carry `type`). Puzzles come from the pure
    // makeDedPuzzle (module scope), passed as each engine's genDate. Chrome (stats strip /
    // scoring+timing toggles / freshness / settings-regen) mirrors ClassicMode and gets folded
    // into a shared shell in Step 6, once all modes' variations are known.
    // ============================================================
    function DeductionMode({visible,minY,maxY,useJulian,saveStats,dateFormat,randomFormat,leapChance,janFebChance,julianChance,onFreshChange}: ModeProps){
      const dedType=useModePrefs(s=>s.dedType),setDedType=useModePrefs(s=>s.setDedType);   // persisted (mode-prefs store)
      const [abCrossOnly,setAbCrossOnly]=useState(false);
      const [julCrossOnly,setJulCrossOnly]=useState(false);
      const [monthOnly1582,setMonthOnly1582]=useState(false);
      const timingOff=useModePrefs(s=>s.dedTimingOff),setTimingOff=useModePrefs(s=>s.setDedTimingOff);   // persisted; timing hidden by default (feeds all three engines)
      const scoringOff=useModePrefs(s=>s.dedScoringOff),setScoringOff=useModePrefs(s=>s.setDedScoringOff);   // persisted; scoring shown by default

      // Per-sub-mode puzzle generators — close over the latest settings + toggles each render.
      const opts={useJulian,leapChance,janFebChance,randomFormat,dateFormat,abCrossOnly,julCrossOnly,monthOnly1582};
      // Year init can fail when the range can't build a distinct-window puzzle (yearSubPossible
      // false). Supply a minimal valid fallback so the (hidden, unreachable) Year engine stays
      // well-formed — it's never displayed in that state (the Year button is disabled).
      const yearFallback=(lo: number): DedPuzzle=>{const y=Math.max(1,lo);const w=(useJulian&&isJulianDate(y,1,1))?wdayJulian(y,1,1):wday(y,1,1);return{type:"year",y,m:1,d:1,w,options:[y],_fmt:randomFormat?rollFormat():dateFormat,_jul:useJulian,_abx:abCrossOnly,_julx:julCrossOnly};};
      const genDay=(lo: number,hi: number): DedPuzzle=>makeDedPuzzle("day",lo,hi,opts)!;
      const genMonth=(lo: number,hi: number): DedPuzzle=>makeDedPuzzle("month",lo,hi,opts)!;
      const genYear=(lo: number,hi: number): DedPuzzle=>makeDedPuzzle("year",lo,hi,opts)||yearFallback(lo);

      // Lifetime stats persist per sub-mode (Stage D1): each silo hydrates from its own saved slice
      // on mount and mirrors changes back to the store.
      const dayEng=useGameEngine({genDate:genDay,minY,maxY,useJulian,saveStats,timingOff,getInitialStats:()=>useProgress.getState().stats.dedDay});
      const monthEng=useGameEngine({genDate:genMonth,minY,maxY,useJulian,saveStats,timingOff,getInitialStats:()=>useProgress.getState().stats.dedMonth});
      const yearEng=useGameEngine({genDate:genYear,minY,maxY,useJulian,saveStats,timingOff,getInitialStats:()=>useProgress.getState().stats.dedYear});
      const eng=dedType==="month"?monthEng:dedType==="year"?yearEng:dayEng;
      const {state,correct,overrideAvail}=eng;
      const setModeStats=useProgress(s=>s.setModeStats);
      useEffect(()=>{setModeStats('dedDay',dayEng.state.stats);},[dayEng.state.stats,setModeStats]);
      useEffect(()=>{setModeStats('dedMonth',monthEng.state.stats);},[monthEng.state.stats,setModeStats]);
      useEffect(()=>{setModeStats('dedYear',yearEng.state.stats);},[yearEng.state.stats,setModeStats]);
      // One flash for the active grid (only one sub-mode visible at a time). setFlash is cleared
      // directly on sub-type switch (changeDedType), so it's destructured alongside the pulse setter.
      const {flash,setFlash,setFlashWithTimeout}=useButtonFlash();   // green/red answer pulse
      // Hideable stats chrome shared with Classic/Flash — operates on the ACTIVE sub-mode's engine.
      const {timingArmed,statsArr,armedSpan,armedBtnRef}=useStatsHideToggles({eng,saveStats,visible,timingOff,setTimingOff,scoringOff,setScoringOff});

      const fmtDatePartial=(y: number,m: number,d: number,storedFmt: FormatId | undefined,missing: DatePart)=>fmtPartial(y,m,d,storedFmt||dateFormat,missing);
      const centerLastOpt=(index: number,total: number)=>{if(total<=0)return"";if(index===total-1&&total%3===1)return"col-span-3";return"";};
      // Can the range support a Year puzzle? (mirrors App's yearSubPossible exactly.)
      const yearSubPossible=(()=>{const lo=Math.max(1,minY),hi=maxY;if(hi-lo+1>=5)return true;if(!useJulian)return false;const has1581=lo<=1581&&hi>=1581,has1582=lo<=1582&&hi>=1582,has1583=lo<=1583&&hi>=1583;return(has1582&&has1583)||(has1581&&has1582);})();

      const optionsDisabled=state.locked||state.calcOpen||state.calcPenaltyActive;
      const revealDisabled=(state.locked&&state.revealed)||state.calcOpen||state.calcPenaltyActive;
      const baseBtn="w-full rounded-2xl border px-4 py-3 text-base shadow-xs select-none";
      const idleBtn="surface-button";

      const changeDedType=(t: string)=>{if(t===dedType)return;setFlash(null);setDedType(t);};   // each silo persists; just swap which shows
      const onAnswer=(i: number)=>{setFlashWithTimeout({type:i===correct?"good":"bad",idx:i});eng.answer(i);};
      // Override-after-wrong flashes green on the correct option, matching App's dedFlash branch.
      const onOverride=()=>{if(state.countedWrong)setFlashWithTimeout({type:"good",idx:correct});eng.override();};

      // Auto-switch out of Year when a range/Julian change makes it unbuildable (mirrors App).
      useEffect(()=>{if(dedType==="year"&&!yearSubPossible)setDedType("day");},[dedType,yearSubPossible,setDedType]);   // setDedType is a stable store setter
      // Auto-clear toggles when their prerequisites break (mirrors App's popover effect).
      useEffect(()=>{if(!useJulian){if(julCrossOnly)setJulCrossOnly(false);if(monthOnly1582)setMonthOnly1582(false);}},[useJulian,julCrossOnly,monthOnly1582]);
      useEffect(()=>{
        if(julCrossOnly&&(1581<minY||1583>maxY))setJulCrossOnly(false);
        if(monthOnly1582&&(1582<minY||1582>maxY))setMonthOnly1582(false);
        if(abCrossOnly&&Math.floor(Math.max(1,minY)/100)===Math.floor(maxY/100))setAbCrossOnly(false);
      },[minY,maxY,abCrossOnly,julCrossOnly,monthOnly1582]);

      // Settings-change regen: regen ALL three engines' live puzzle (each no-ops on a burned or
      // browsed date), matching App's "regen the current + cleanse FRESH non-current" on a
      // format / random-format / leap / Jan-Feb / Julian-chance / range / calendar change.
      useChangeEffect([randomFormat,dateFormat,leapChance,janFebChance,julianChance,minY,maxY,useJulian],()=>{dayEng.regenDate();monthEng.regenDate();yearEng.regenDate();});
      // Toggle-change regen: a relevant Deduction toggle regens the ACTIVE engine's puzzle (the
      // toggles only render in their own sub-mode, so the active engine is always the right one).
      useChangeEffect([abCrossOnly,julCrossOnly,monthOnly1582],()=>eng.regenDate());

      // Freshness — all three silos' engine state fresh + Deduction's toggles/UI at launch default
      // (dates are random, so excluded). Reported up so App's isFullyReset accounts for Deduction.
      const deductionIsFresh=engineFresh(dayEng.state)&&engineFresh(monthEng.state)&&engineFresh(yearEng.state)&&dedType==="day"&&abCrossOnly===false&&julCrossOnly===false&&monthOnly1582===false&&timingOff===true&&scoringOff===false&&timingArmed===false&&flash===null;
      useEffect(()=>{onFreshChange?.(deductionIsFresh);},[deductionIsFresh,onFreshChange]);
      const date=state.date as DedPuzzle;
      // Codes-panel target mirrors App's deduction calcTarget: just the date fields (so
      // displayedFormat falls to the current dateFormat) + the puzzle's _jul snapshot.
      const calcTarget: { y: number; m: number; d: number; _jul?: boolean; _fmt?: FormatId } | null=date?{y:date.y,m:date.m,d:date.d,_jul:date._jul}:null;
      // cellDates for the Month 1582 codes panel (answer box groups months from both calendars).
      let cellDates=null;
      if(date&&date.type==="month"&&date.y===1582&&date.boxes){
        const box=correct>=0?date.boxes[correct]:null;
        if(box&&Array.isArray(box.months)&&box.months.length>=2)cellDates=box.months.map(m=>({y:date.y,m,d:date.d}));
      }
      // Toggle enable conditions (mirror App's render gating).
      const abPossible=Math.floor(Math.max(1,minY)/100)!==Math.floor(maxY/100);
      const has1581=1581>=minY&&1581<=maxY,has1582=1582>=minY&&1582<=maxY,has1583=1583>=minY&&1583<=maxY;
      const julPossible=useJulian&&has1582&&(has1581||has1583);
      const m1582Possible=useJulian&&1582>=minY&&1582<=maxY;

      return(
        <div style={{display:visible?"block":"none"}}>
          <div className={saveStats?"":"opacity-50"}><StatPanel stats={statsArr} armedSpan={armedSpan} armedBtnRef={armedBtnRef}/></div>
          <div className="mt-3"><button type="button" data-key="S" className={RESET_STATS_BTN_CLASS} onClick={eng.resetStats}>Reset Stats</button></div>
          <div className="mt-5">
            <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
              <div className="flex justify-start">
                {dedType==="year"&&(()=>{const disabled=!abPossible;const active=abCrossOnly&&!disabled;return(<button type="button" onClick={()=>{if(disabled)return;setAbCrossOnly(v=>!v);}} className={`px-2 py-1 rounded-xl text-xs font-medium border min-w-20 ${active?"btn-solid border-transparent":"surface-toggle text-purple-100/80"}${disabled?" opacity-60 pointer-events-none":""}`}><i>ab</i> Cross</button>);})()}
              </div>
              <div className="flex gap-2 items-center">
                {["day","month","year"].map(t=>{const disabled=t==="year"&&!yearSubPossible;return(<button key={t} type="button" onClick={()=>{if(disabled)return;changeDedType(t);}} className={`px-2 py-1.5 rounded-xl text-sm font-medium border min-w-16 ${dedType===t?"btn-solid border-transparent text-white":"surface-toggle text-purple-100/80"}${disabled?" opacity-60 pointer-events-none":""}`}>{t[0].toUpperCase()+t.slice(1)}</button>);})}
              </div>
              <div className="flex justify-end">
                {dedType==="year"&&(()=>{const disabled=!julPossible;const active=julCrossOnly&&!disabled;return(<button type="button" onClick={()=>{if(disabled)return;setJulCrossOnly(v=>!v);}} className={`px-2 py-1 rounded-xl text-xs font-medium border min-w-20 ${active?"btn-solid border-transparent":"surface-toggle text-purple-100/80"}${disabled?" opacity-60 pointer-events-none":""}`}>Jul Cross</button>);})()}
                {dedType==="month"&&(()=>{const disabled=!m1582Possible;const active=monthOnly1582&&!disabled;return(<button type="button" onClick={()=>{if(disabled)return;setMonthOnly1582(v=>!v);}} className={`px-2 py-1 rounded-xl text-xs font-medium border min-w-20 ${active?"btn-solid border-transparent":"surface-toggle text-purple-100/80"}${disabled?" opacity-60 pointer-events-none":""}`}>1582 Only</button>);})()}
              </div>
            </div>
            <div className="mt-4 rounded-2xl panel p-4">
              <div className="text-center relative">
                {state.backDepth>0&&<span className="absolute right-0 top-0 text-[11px] tabular-nums text-purple-300/60">Q{state.stack.length+1}</span>}
                <div className="text-3xl font-bold">{date?fmtDatePartial(date.y,date.m,date.d,date._fmt,date.type):"—"}</div>
                {date&&<div className="mt-1 text-lg text-purple-100">Weekday: <span className="font-semibold">{DAY[date.w]}</span></div>}
              </div>
              <div className="mt-4">
                {date&&date.type==="year"&&(()=>{const N=date.options.length;const gridCls=N===2?"grid-cols-2":N===5?"grid-cols-6":"grid-cols-3";const colSpanFor=(idx: number)=>N===5?(idx<3?"col-span-2":"col-span-3"):"";return(<div className={`grid gap-2 ${gridCls}`} data-answer-grid="true">{date.options.map((y,idx)=>{const ps=state.persistBtns[idx];const isFlashing=!!(flash&&flash.idx===idx);const bCls=buttonStateClass(ps,isFlashing,flash?.type==="good",idleBtn);const perLocked=!!ps;const shouldDim=optionsDisabled&&!ps&&!isFlashing;return(<button key={idx} type="button" onClick={()=>{if(perLocked)return;onAnswer(idx);if(isTouch)(document.activeElement as HTMLElement | null)?.blur();}} className={`${baseBtn} py-2 text-sm ${bCls} ${(perLocked||optionsDisabled)?"pointer-events-none":""} ${shouldDim?"opacity-60":""} ${colSpanFor(idx)}`}>{fmtYear(y)}</button>);})}</div>);})()}
                {date&&date.type==="month"&&(<div className="grid grid-cols-2 gap-3" data-answer-grid="true">{date.options.map((mv,idx)=>{const last=idx===date.options.length-1?"col-span-2":"";const ps=state.persistBtns[idx];const isFlashing=!!(flash&&flash.idx===idx);const bCls=buttonStateClass(ps,isFlashing,flash?.type==="good",idleBtn);const perLocked=!!ps;const shouldDim=optionsDisabled&&!ps&&!isFlashing;return(<button key={idx} type="button" onClick={()=>{if(perLocked)return;onAnswer(idx);if(isTouch)(document.activeElement as HTMLElement | null)?.blur();}} className={`${baseBtn} ${bCls} ${(perLocked||optionsDisabled)?"pointer-events-none":""} ${shouldDim?"opacity-60":""} ${last}`}>{mv}</button>);})}</div>)}
                {date&&date.type==="day"&&(<div className="grid grid-cols-3 gap-2" data-answer-grid="true">{date.options.map((dv,idx)=>{const ps=state.persistBtns[idx];const isFlashing=!!(flash&&flash.idx===idx);const bCls=buttonStateClass(ps,isFlashing,flash?.type==="good",idleBtn);const perLocked=!!ps;const shouldDim=optionsDisabled&&!ps&&!isFlashing;return(<button key={idx} type="button" onClick={()=>{if(perLocked)return;onAnswer(idx);if(isTouch)(document.activeElement as HTMLElement | null)?.blur();}} className={`${baseBtn} py-2 text-sm ${bCls} ${(perLocked||optionsDisabled)?"pointer-events-none":""} ${shouldDim?"opacity-60":""} ${centerLastOpt(idx,date.options.length)}`}>{dv}</button>);})}</div>)}
              </div>
            </div>
            <div className="mt-4 rounded-2xl panel p-3 space-y-3">
              <div className="grid grid-cols-4 gap-2">
                <button type="button" data-key="N" className="col-span-1 px-3 py-2 rounded-xl border surface-button text-sm font-medium" onClick={()=>eng.doNew()}>New</button>
                <div className="col-span-1 flex gap-1">
                  <button type="button" data-key="ArrowLeft" className={`flex-1 px-1 py-2 rounded-xl border surface-button text-sm font-medium flex items-center justify-center ${state.stack.length===0?"opacity-60 pointer-events-none":""}`} onClick={eng.back}><span style={{position:'relative',top:'-1.5px'}}>&lt;</span></button>
                  <button type="button" data-key="ArrowRight" className={`flex-1 px-1 py-2 rounded-xl border surface-button text-sm font-medium flex items-center justify-center ${state.forwardStack.length===0?"opacity-60 pointer-events-none":""}`} onClick={eng.forward}><span style={{position:'relative',top:'-1.5px'}}>&gt;</span></button>
                </div>
                <button type="button" data-key="R" className={`col-span-1 px-3 py-2 rounded-xl border surface-button text-sm font-medium text-center ${revealDisabled?"opacity-60 pointer-events-none":""}`} onClick={eng.reveal}>Reveal</button>
                <button type="button" data-key="O" className={`col-span-1 px-3 py-2 rounded-xl border surface-button text-sm font-medium text-center ${!overrideAvail?"opacity-60 pointer-events-none":""}`} onClick={onOverride}>Override</button>
              </div>
              <MethodBreakdownSection date={calcTarget} open={state.calcOpen} onOpenChange={open=>eng.showCodes(open)} className="" contentClassName="mt-3 rounded-2xl thin px-4 pt-[3px] pb-1.5" useJulian={calcTarget?._jul??useJulian} displayedFormat={calcTarget?._fmt||dateFormat} cellDates={cellDates}/>
            </div>
          </div>
        </div>
      );
    }

    // ============================================================
    // App — the top-level component for the remaining fused modes
    //
    // Manages mode switching, per-mode preserved state (dateByMode, calcOpenByMode,
    // preservedByModeRef, stacksByModeRef, timerDoneSnapRef), stats tracking, and the
    // still-fused rendering (Lookup/How to Play). Classic, Flash, Blitz, Deduction + AoX are
    // their own self-contained components (ClassicMode/FlashMode/BlitzMode/DeductionMode on the
    // shared engine, AoxMode).
    // ============================================================
    function App(){
      const [mode,setMode]=useState("classic");   // the app always opens to Classic (the current tab is not persisted)
      // Tracks the most recent non-guide mode so the H key bind can toggle out of
      // guide back to where the user was. Updated whenever mode changes (excluding
      // changes INTO guide). Initial value 'classic' covers the never-left-classic case.
      // Distinct from the unrelated prevModeRef declared further down which tracks
      // mode changes for codes-freeze logic.
      const prevNonGuideModeRef=useRef('classic');
      useEffect(()=>{if(mode!=='guide')prevNonGuideModeRef.current=mode;},[mode]);
      const modeSelectRef=useRef<HTMLDivElement | null>(null);
      const [systemIsDark,setSystemIsDark]=useState(()=>typeof window!=="undefined"?window.matchMedia("(prefers-color-scheme: dark)").matches:true);
      // ⚙ Settings store (Stage C, Step 5a). The 13 settings values + their setters
      // + resetSettings now live in the Zustand store (src/store/settings.js), bound
      // here to the SAME local names App used before so every read site, setter call
      // (incl. functional updaters), and the settingsAtDefaults/isFullyReset booleans
      // keep working unchanged. minInputVal/maxInputVal stay as local useState below.
      // Each setter is selected individually so component re-renders only when the
      // specific value it reads changes (Zustand selector subscriptions).
      const useSystem=useSettings(s=>s.useSystem),setUseSystem=useSettings(s=>s.setUseSystem);
      const darkTheme=useSettings(s=>s.darkTheme),setDarkTheme=useSettings(s=>s.setDarkTheme);
      const lightTheme=useSettings(s=>s.lightTheme),setLightTheme=useSettings(s=>s.setLightTheme);
      const manualTheme=useSettings(s=>s.manualTheme),setManualTheme=useSettings(s=>s.setManualTheme);
      const minY=useSettings(s=>s.minY),setMinY=useSettings(s=>s.setMinY);
      const maxY=useSettings(s=>s.maxY),setMaxY=useSettings(s=>s.setMaxY);
      const useJulian=useSettings(s=>s.useJulian),setUseJulian=useSettings(s=>s.setUseJulian);
      const saveStats=useSettings(s=>s.saveStats),setSaveStats=useSettings(s=>s.setSaveStats);
      const dateFormat=useSettings(s=>s.dateFormat),setDateFormat=useSettings(s=>s.setDateFormat);
      const randomFormat=useSettings(s=>s.randomFormat),setRandomFormat=useSettings(s=>s.setRandomFormat);
      const leapChance=useSettings(s=>s.leapChance),setLeapChance=useSettings(s=>s.setLeapChance);
      const janFebChance=useSettings(s=>s.janFebChance),setJanFebChance=useSettings(s=>s.setJanFebChance);
      const julianChance=useSettings(s=>s.julianChance),setJulianChance=useSettings(s=>s.setJulianChance);
      const resetSettingsStore=useSettings(s=>s.resetSettings);

      const activeTheme=useSystem?(systemIsDark?darkTheme:lightTheme):manualTheme;
      useEffect(()=>{const mq=window.matchMedia("(prefers-color-scheme: dark)");const h=(e: MediaQueryListEvent)=>setSystemIsDark(e.matches);mq.addEventListener("change",h);return()=>mq.removeEventListener("change",h);},[]);
      useEffect(()=>{
        document.documentElement.setAttribute("data-theme",activeTheme);
        const tc=getComputedStyle(document.documentElement).getPropertyValue("--tc").trim();
        const meta=document.querySelector("meta[name='theme-color']");
        if(meta&&tc)(meta as HTMLMetaElement).content=tc;
      },[activeTheme]);
      // Save Stats toggle. Flips the global ⚙ setting; each always-mounted mode component
      // reads the new saveStats prop itself (display dimming + Best-recording gate). Save Stats
      // is not a date-generation setting, so it never regenerates a date.
      const toggleSaveStats=()=>setSaveStats(v=>!v);
      // minY/maxY now from the settings store (bound at top of App). minInputVal/maxInputVal stay local (transient text mirrors).
      const [minInputVal,setMinInputVal]=useState("1");
      const [maxInputVal,setMaxInputVal]=useState("10000");
      const minInputRef=useRef<HTMLInputElement | null>(null),maxInputRef=useRef<HTMLInputElement | null>(null);
      // Lookup history persists across reloads (Stage D1): sourced from the progress store
      // instead of local useState. The store setter accepts a direct value OR a functional
      // updater, so the push/move/clear handlers below stay unchanged.
      const lookupHistory=useProgress(s=>s.lookupHistory);
      const setLookupHistory=useProgress(s=>s.setLookupHistory);
      const resetProgress=useProgress(s=>s.resetProgress);   // Full Reset wipes saved progress too (Stage D1)
      const resetModePrefs=useModePrefs(s=>s.resetModePrefs);   // Full Reset restores the per-mode setup too
      const [lookupInput,setLookupInput]=useState("");
      const [lookupOutput,setLookupOutput]=useState("");
      const [lookupCalcDate,setLookupCalcDate]=useState<CodeDate | null>(null);
      const [lookupSelectedHistoryId,setLookupSelectedHistoryId]=useState<string | null>(null);
      const [lookupCalcOpen,setLookupCalcOpen]=useState(false);
      // #6 — removed prevLookupCalcKeyRef and its effect; lookup Show Codes now only closes
      // when runLookup() fires a new result or the user manually closes it.
      // Bar height tracking. The htp-sticky-bar is position:fixed (chrome-style fixed
      // element above everything), so it has no natural effect on the flow of the
      // appScrollRef container below it. We measure the bar's offsetHeight here and
      // write it to a CSS custom property (--bar-h) on the document root; the scroll
      // container reads it via padding-top:var(--bar-h) so its content starts below
      // the bar instead of being covered by it. ResizeObserver fires on initial mount
      // and any time the bar's height changes (e.g., mode switch flips pb-2.5 in
      // guide mode vs none in game modes, or content reflows). Writing to a CSS
      // variable instead of JS-applying padding directly keeps the styling
      // declarative and avoids React state churn for a value that's not part of
      // application logic.
      const htpStickyBarRef=useRef<HTMLDivElement | null>(null);
      useEffect(()=>{
        const el=htpStickyBarRef.current;if(!el)return;
        const updateBarH=()=>{document.documentElement.style.setProperty('--bar-h',`${el.offsetHeight}px`);};
        updateBarH();
        const ro=new ResizeObserver(updateBarH);
        ro.observe(el);
        return()=>ro.disconnect();
      },[]);
      // App-wide scroll-state tracking on the confined scroll container (appScrollRef).
      // Container scrolls when content overflows the viewport-below-bar (always in HtP,
      // and in any mode where content can't fit at the current viewport size).
      //   appScrolledFromTop → bar's elev-shadow-down + container's fade-scroll-top
      //   appAtBottom         → container's fade-scroll-bottom
      // Defaults: appAtBottom true / appScrolledFromTop false (no indicators on first
      // paint before scroll state is evaluated). The listener runs on every mode change
      // so it picks up the container ref and re-evaluates against new content. Inner
      // scrollables (popover, lookup) track their own scroll state independently.
      const appScrollRef=useRef<HTMLDivElement | null>(null);
      const [appAtBottom,setAppAtBottom]=useState(true);
      const [appScrolledFromTop,setAppScrolledFromTop]=useState(false);
      useEffect(()=>{
        const el=appScrollRef.current;if(!el)return;
        const evaluate=()=>{
          const scrollTop=el.scrollTop;
          const scrollHeight=el.scrollHeight;
          const clientHeight=el.clientHeight;
          const noOverflow=scrollHeight<=clientHeight+1;
          setAppAtBottom(noOverflow||scrollTop+clientHeight>=scrollHeight-4);
          setAppScrolledFromTop(!noOverflow&&scrollTop>0);
        };
        evaluate();
        el.addEventListener('scroll',evaluate,{passive:true});
        const ro=new ResizeObserver(evaluate);
        ro.observe(el);
        return()=>{el.removeEventListener('scroll',evaluate);ro.disconnect();};
      },[mode]);
      // Mode-change effect: reset the scroll container to top on every mode switch.
      // Without this, switching from HtP (where the user scrolled) into a game mode
      // would leave the container at its previous scrollTop, hiding the top of the
      // mode's content. Runs after evaluate() above to ensure a clean visual transition.
      useEffect(()=>{const el=appScrollRef.current;if(el)el.scrollTop=0;},[mode]);
      // BFCache scroll reset (defense-in-depth alongside position:fixed #root).
      // Multiple events + deferred resets cover edge cases where pageshow alone isn't reliable
      // on iOS Safari. visibilitychange catches tab-foreground transitions; rAF + setTimeout
      // catch late scroll restorations that happen after the initial event fires. Resets
      // both the window/body scroll (defense-in-depth — body has overflow:hidden so it
      // can't scroll, but BFCache might try anyway) AND the inner container (the actual
      // scroll surface that the user interacts with).
      useEffect(()=>{const reset=()=>{window.scrollTo(0,0);if(document.documentElement.scrollTop!==0)document.documentElement.scrollTop=0;if(document.body.scrollTop!==0)document.body.scrollTop=0;if(appScrollRef.current)appScrollRef.current.scrollTop=0;};const onPageShow=()=>{reset();requestAnimationFrame(reset);setTimeout(reset,0);};const onVisChange=()=>{if(document.visibilityState==='visible'){reset();requestAnimationFrame(reset);}};reset();window.addEventListener('pageshow',onPageShow);document.addEventListener('visibilitychange',onVisChange);return()=>{window.removeEventListener('pageshow',onPageShow);document.removeEventListener('visibilitychange',onVisChange);};},[]);
      // Keyboard input — desktop convenience, mobile-no-op.
      // Three categories of keys are handled, all subject to the same gates: not in
      // an input/textarea/contentEditable, no modifiers held (Cmd+L stays browser),
      // not a key repeat or IME composition.
      //
      // 1. Number keys 0–9 trigger the visible answer-grid button at that 0-based
      //    index, left-to-right and top-to-bottom. Indexing matches the book's day
      //    codes (Sun=0 ... Sat=6) for day grids; positional for Deduction Month/Year.
      // 2. Letters (case-insensitive) and ArrowLeft/Right walk the DOM for a button
      //    with matching data-key attribute and click the first one that's both
      //    visible (offsetParent != null) and not locked (no pointer-events-none class).
      //    Game-loop binds: N (New/Begin/Reset), R (Reveal), O (Override), C (Show/Hide
      //    Codes), S (Reset Stats), ← Back, → Forward.
      // 3. Special direct-action keys, no DOM button needed:
      //    - Mode switching: K Classic, F Flash, B Blitz, A AoX, D Deduction, L Lookup
      //    - H toggles to/from guide (returns to prevNonGuideModeRef when leaving guide)
      //    - G toggles the settings popover
      //
      // All keyboard activations bypass CSS pointer-events via .click(), so the
      // pointer-events-none className check is mandatory to mirror real-click locks.
      // settingsOpen is declared here — above the keyboard effect that toggles it (G key) — so it's
      // not read before its declaration (the compiler flags accessing a binding before it's declared).
      const [settingsOpen,setSettingsOpen]=useState(false);
      useEffect(()=>{const onKey=(e: KeyboardEvent)=>{
        if(e.repeat||e.isComposing)return;
        // Tab: toggle the mode selector dropdown. Plain Tab only — Ctrl+Tab, Ctrl+Shift+Tab,
        // Shift+Tab, Alt+Tab all pass through to the browser. Works universally, including
        // when an input is focused (Esc/Enter already blur inputs, so the standard "leave
        // this input" role of Tab is unneeded). focus() before click() so the dropdown's
        // arrow-nav handler (handleTriggerKeyDown on the trigger) sees subsequent keys.
        if(e.key==='Tab'){
          if(e.ctrlKey||e.metaKey||e.altKey||e.shiftKey)return;
          if(modeSelectRef.current){
            const trigger=modeSelectRef.current.querySelector('button');
            if(trigger){e.preventDefault();trigger.focus();trigger.click();}
          }
          return;
        }
        if(e.ctrlKey||e.metaKey||e.altKey||e.shiftKey)return;
        const k=e.key;
        const ae=document.activeElement as HTMLElement | null;
        if(ae){const tag=ae.tagName;if(tag==='INPUT'||tag==='TEXTAREA'||ae.isContentEditable)return;}
        // Category 1: 0–9 → answer grid
        if(k>='0'&&k<='9'){
          const grids=document.querySelectorAll<HTMLElement>('[data-answer-grid="true"]');
          let visible: HTMLElement | null=null;
          for(const g of grids){if(g.offsetParent!==null){visible=g;break;}}
          if(!visible)return;
          const idx=parseInt(k,10);
          const btn=visible.children[idx] as HTMLElement | undefined;
          if(!btn||btn.tagName!=='BUTTON')return;
          if(btn.className.includes('pointer-events-none'))return;
          e.preventDefault();
          btn.click();
          return;
        }
        // Determine target key string for letters and arrows
        let dataKey=null;
        if(k==='ArrowLeft')dataKey='ArrowLeft';
        else if(k==='ArrowRight')dataKey='ArrowRight';
        else if(k.length===1){const upper=k.toUpperCase();if(upper>='A'&&upper<='Z')dataKey=upper;}
        if(!dataKey)return;
        // Category 3a: mode switching — direct setMode (no DOM button per mode)
        const MODE_KEYS: Record<string, string>={K:'classic',F:'flash',B:'blitz',A:'aox',D:'deduction',L:'lookup'};
        if(MODE_KEYS[dataKey]){e.preventDefault();setMode(MODE_KEYS[dataKey]);setSettingsOpen(false);return;}
        // Category 3b: H — toggle to/from guide, preserving previous non-guide mode
        if(dataKey==='H'){e.preventDefault();setMode(m=>m==='guide'?(prevNonGuideModeRef.current||'classic'):'guide');setSettingsOpen(false);return;}
        // Category 3c: G — toggle settings popover
        if(dataKey==='G'){e.preventDefault();setSettingsOpen(v=>!v);return;}
        // Category 2: data-key DOM walk for game-loop letters and arrows
        const tagged=document.querySelectorAll<HTMLElement>(`[data-key="${dataKey}"]`);
        for(const btn of tagged){
          if(btn.tagName!=='BUTTON')continue;
          if(btn.offsetParent===null)continue;
          if(btn.className.includes('pointer-events-none'))continue;
          e.preventDefault();
          btn.click();
          return;
        }
      };window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[]);
      function applyMinValue(val: number){if(val!==minY)setMinY(val);}
      function applyMaxValue(val: number){if(val!==maxY)setMaxY(val);}
      const commitMin=()=>{const p=parseInt(minInputVal);if(isNaN(p)){setMinInputVal(String(minY));return;}const v=Math.max(1,Math.min(maxY,p));applyMinValue(v);setMinInputVal(String(v));};
      const commitMax=()=>{const p=parseInt(maxInputVal);if(isNaN(p)){setMaxInputVal(String(maxY));return;}const v=Math.max(minY,Math.min(10000,p));applyMaxValue(v);setMaxInputVal(String(v));};
      useEffect(()=>{if(document.activeElement===minInputRef.current)return;setMinInputVal(String(minY));},[minY]);
      useEffect(()=>{if(document.activeElement===maxInputRef.current)return;setMaxInputVal(String(maxY));},[maxY]);
      const pushLookupHistory=(entry: LookupEntry)=>setLookupHistory(prev=>[entry,...prev].slice(0,20));
      const moveHistoryEntryToTop=(id: string)=>setLookupHistory(prev=>{const idx=prev.findIndex(e=>e.id===id);if(idx<=0)return prev;const entry=prev[idx];return[entry,...prev.slice(0,idx),...prev.slice(idx+1)];});
      const clearLookupHistory=()=>setLookupHistory([]);
      // Date format / randomFormat / leapChance / janFebChance / julianChance now from the
      // settings store (bound at top of App). Semantics unchanged:
      //   dateFormat: 'written-mdy'|'written-dmy'|'numeric-mdy'|'numeric-dmy'|'numeric-ymd'.
      //   randomFormat overrides the selected format for game-mode dates only (Lookup + DEPLOY_TS ignore it).
      //   leap/janFeb/julianChance: Option-A date-generation biases (apply to all game modes; Lookup unaffected).
      //   julianChance's 5-button row is locked when useJulian is off OR the year range is all-Gregorian
      //   (minY>=1583) or all-Julian (maxY<=1581); year 1582 is mixed so any range including it is unlocked.
      // FORMAT_IDS and rollFormat are defined at module scope (see top of file)
      // so the dateByMode useState initializer can also use them.
      // fmtDate: every date stamps _fmt (always present), so display always uses
      // the date's stored format. Falls through to dateFormat only if a malformed
      // legacy date without _fmt slips through (defensive).
      const fmtDate=(y: number,m: number,d: number,storedFmt?: FormatId)=>fmt(y,m,d,storedFmt||dateFormat);
      // Generate a new game-mode date with the current settings baked in.
      // Stamps _fmt and _jul at generation. _fmt is always present — random roll
      // when randomFormat is on, current dateFormat when off. The display layer always
      // trusts _fmt.
      // On a Cat A unanswered untouched live date, format setting changes
      // can trigger a fresh genDate call via regenDecisionFor (Random off→on always; Random
      // on→off and dropdown changes regen only on _fmt mismatch with the now-active format).
      // Wrong guesses defer format regen — the new format only applies on the next genDate.
      // _jul is the calendar system in effect when the date was generated; used by stack
      // entries (and deduction) so revisiting a past question shows codes consistent with
      // the system that was active when it was created. Live questions ignore _jul and use
      // current useJulian, so toggling Julian on a live (un-guessed) date updates the answer.
      const genDate=(lo: number,hi: number)=>{
        const dt=randomDate(lo,hi,useJulian,leapChance,janFebChance,julianChance);
        dt._fmt=randomFormat?rollFormat():dateFormat;
        dt._jul=useJulian;
        return dt;
      };
      const settingsRef=useRef<HTMLDivElement | null>(null);
      const settingsPopoverRef=useRef<HTMLDivElement | null>(null);
      // Full Reset state: armed=true means the user tapped once and the next tap fires.
      // Auto-disarms after a short timer, when settings closes, or when the user taps any
      // other interactive control inside the popover. Implemented as a per-tap state machine
      // rather than a dialog so the destructive nature is communicated by the in-place label
      // and color change without a modal interruption.
      const [fullResetArmed,setFullResetArmed]=useState(false);
      const fullResetBtnRef=useRef<HTMLButtonElement | null>(null);
      const fullResetTimerRef=useRef<ReturnType<typeof setTimeout> | null>(null);
      // aoxIsFresh — reported up from AoxMode via the onFreshChange prop. AoxMode's ~24
      // internal state fields are otherwise opaque to the App, so we mirror their combined
      // freshness state here to use in isFullyReset (the Full Reset dim/lock check below).
      // Initialized to true (matches fresh-mount reality); AoxMode's useEffect calls
      // onFreshChange on every freshness flip so this stays in sync.
      const [aoxIsFresh,setAoxIsFresh]=useState(true);
      // classicIsFresh — reported up from ClassicMode (its state is self-owned now), same as
      // aoxIsFresh. Used by isFullyReset so the Full Reset button reflects Classic's activity.
      const [classicIsFresh,setClassicIsFresh]=useState(true);
      const [flashIsFresh,setFlashIsFresh]=useState(true); // ditto from FlashMode
      const [blitzIsFresh,setBlitzIsFresh]=useState(true); // ditto from BlitzMode
      const [deductionIsFresh,setDeductionIsFresh]=useState(true); // ditto from DeductionMode (all 3 silos)
      // AoxMode is always-mounted-with-display-none (rather than conditionally rendered) so its
      // internal state persists across mode switches — that's intentional UX (a paused AoX
      // run survives a detour into Classic). But it means none of AoxMode's ~25 useStates and
      // refs auto-reset when fullReset switches mode away from 'aox'. Solution: bump this key
      // in fullReset to force a one-shot AoxMode remount, which runs all its useState/useRef
      // initializers fresh. Normal mode switching doesn't change this key, so the cross-mode
      // persistence behavior is preserved everywhere except the explicit Full Reset path.
      const [aoxResetKey,setAoxResetKey]=useState(0);
      // Same remount trigger for ClassicMode (also always-mounted, owns its own engine state):
      // Full Reset bumps this so Classic returns to its launch state.
      const [classicResetKey,setClassicResetKey]=useState(0);
      const [flashResetKey,setFlashResetKey]=useState(0); // ditto for FlashMode
      const [blitzResetKey,setBlitzResetKey]=useState(0); // ditto for BlitzMode
      const [deductionResetKey,setDeductionResetKey]=useState(0); // ditto for DeductionMode
      // Scroll-state tracking for the settings popover inner scroll wrapper.
      // Popover inner scroll state. Three flags drive the visual edge indicators:
      //   popoverScrolledFromTop → top fade (no shadow at top — no fixed UI there)
      //   popoverAtBottom        → bottom fade + sticky footer shadow (both signal "more below")
      // Defaults: scrolledFromTop false, atBottom true (no indicators on first open before
      // the listener evaluates). The two fade flags combine into fade-scroll-both when both apply.
      const popoverInnerScrollRef=useRef<HTMLDivElement | null>(null);
      const [popoverAtBottom,setPopoverAtBottom]=useState(true);
      const [popoverScrolledFromTop,setPopoverScrolledFromTop]=useState(false);
      useEffect(()=>{
        if(!settingsOpen){setPopoverAtBottom(true);setPopoverScrolledFromTop(false);return;}
        const el=popoverInnerScrollRef.current;if(!el)return;
        const evaluate=()=>{
          const noOverflow=el.scrollHeight<=el.clientHeight+1;
          setPopoverAtBottom(noOverflow||el.scrollTop+el.clientHeight>=el.scrollHeight-4);
          setPopoverScrolledFromTop(!noOverflow&&el.scrollTop>0);
        };
        evaluate();
        el.addEventListener('scroll',evaluate,{passive:true});
        const ro=new ResizeObserver(evaluate);
        ro.observe(el);
        return()=>{el.removeEventListener('scroll',evaluate);ro.disconnect();};
      },[settingsOpen]);
      // Settings popover click-outside handler. Closes settings when the user taps
      // anywhere outside three regions: the gear button itself (settingsRef), the
      // popover content (settingsPopoverRef), and the mode CustomSelect wrapper
      // (modeSelectRef). The mode CustomSelect exclusion is what lets the user open
      // and pick from the mode dropdown without the settings popover auto-closing
      // on the same tap — taps inside the mode trigger or its open dropdown panel
      // are inside modeSelectRef's subtree and therefore "inside" for this check.
      useEffect(()=>{if(!settingsOpen)return;const h=(e: MouseEvent | TouchEvent)=>{const target=e.target as Element | null;const inBtn=settingsRef.current&&settingsRef.current.contains(target);const inPop=settingsPopoverRef.current&&settingsPopoverRef.current.contains(target);const inSel=modeSelectRef.current&&modeSelectRef.current.contains(target);
        // Mousedown on the browser scrollbar registers e.target as <html> on Windows. Ignore that
        // case so dragging the scrollbar doesn't close the popover.
        const onScrollbar=target===document.documentElement||target===document.body;
        if(onScrollbar)return;
        // Open CustomSelect dropdown panels (the mode select + the theme selects) portal out to
        // #root with role="listbox", so a tap on an option lands OUTSIDE the popover in the DOM.
        // Treat that as "inside" so picking a theme/mode doesn't slam the settings popover shut
        // before the selection registers.
        const inListbox=!!(target&&target.closest&&target.closest('[role="listbox"]'));
        if(!inBtn&&!inPop&&!inSel&&!inListbox){
          // Year-range inputs (and any future input in the popover) commit on blur. When closing
          // settings via click-outside on a non-focusable element, the input keeps focus until
          // the popover unmounts — and React's synthetic onBlur doesn't reliably fire on unmount,
          // so the typed value gets dropped. Programmatically blur first so onBlur runs
          // synchronously (commit), then close. (Mobile happens to work without this because
          // tapping a non-focusable target on touch normally fires blur before touchstart.)
          const ae=document.activeElement as HTMLElement | null;
          if(ae&&ae.tagName==='INPUT'&&settingsPopoverRef.current&&settingsPopoverRef.current.contains(ae))ae.blur();
          setSettingsOpen(false);
        }};document.addEventListener('mousedown',h);document.addEventListener('touchstart',h);return()=>{document.removeEventListener('mousedown',h);document.removeEventListener('touchstart',h);};},[settingsOpen]);
      // Escape closes the settings popover. Doesn't fire when an input has focus that already
      // handles Escape (year-range inputs revert their value on Escape) — those handlers call
      // stopPropagation isn't used, so this listener still receives the event after the input's
      // handler runs. To avoid double-handling, we check the active element type.
      useEffect(()=>{if(!settingsOpen)return;const h=(e: KeyboardEvent)=>{if(e.key!=="Escape")return;const ae=document.activeElement;if(ae&&ae.tagName==="INPUT")return;e.preventDefault();setSettingsOpen(false);};document.addEventListener('keydown',h);return()=>document.removeEventListener('keydown',h);},[settingsOpen]);
      // Theme option arrays — keys match the CustomSelect API (value/label) so
      // they can be passed directly without per-render mapping.
      const DARK_THEMES=[{value:'dusk',label:'Dusk'},{value:'midnight',label:'Midnight'},{value:'nebula',label:'Nebula'}];
      const LIGHT_THEMES=[{value:'light',label:'Light'},{value:'parchment',label:'Parchment'}];
      const ALL_THEMES_LABELED=[{value:'dusk',label:'Dusk (dark)'},{value:'midnight',label:'Midnight (dark)'},{value:'nebula',label:'Nebula (dark)'},{value:'light',label:'Light (light)'},{value:'parchment',label:'Parchment (light)'}];
      // Resets every setting in the ⚙ popover to its initial useState default.
      // Does NOT touch mode-specific config outside the popover (AoX N, timer durations,
      // Deduction sub-types/toggles) or stats/history (Reset Stats handles that).
      // Triggers the unified popover-settings effect, which will regenerate the current
      // date as appropriate (Random Format / Date Format / Leap Chance are always-regen).
      const resetSettings=()=>{
        // Reset the 13 store-held settings in one shot (single source of truth in
        // src/store/settings.js), then the 2 transient text mirrors that live locally.
        resetSettingsStore();
        setMinInputVal("1");setMaxInputVal("10000");
      };
      // Full Reset — back to the launch state. The five always-mounted mode components own ALL
      // gameplay state (stats, history, run/round progress, config toggles, timers), so bumping
      // their *ResetKey props below remounts them and resets every per-mode value to its hook
      // default in the same render. App therefore only resets what IT owns: the current mode,
      // the ⚙ settings (delegated to resetSettings → the Zustand store + the 2 input mirrors),
      // the Lookup state, and the scroll position. Deliberately NOT a location.reload() — this
      // stays the single source of truth for "back to launch" as offline/profile state is added.
      const fullReset=()=>{
        prevNonGuideModeRef.current="classic";
        setMode("classic");
        setSettingsOpen(false);
        setAppAtBottom(true);
        setAppScrolledFromTop(false);
        // Settings popover → defaults (13 store values incl. theme + the 2 transient input mirrors).
        resetSettings();
        // Saved gameplay progress → wiped (Stage D1): clears lifetime stats + all-time bests + Lookup
        // history in the persisted store, making Full Reset permanent. Runs BEFORE the remount-key bumps
        // below, so the continuous modes re-hydrate from the now-empty store (blank stats).
        resetProgress();
        // Per-mode setup (Flash speed, Blitz/AoX config, Deduction sub-type, last mode) → launch
        // defaults. Runs BEFORE the remount-key bumps so the modes re-read the now-default prefs.
        resetModePrefs();
        // Lookup input/output are transient local state (the history itself was cleared by resetProgress).
        setLookupInput("");setLookupOutput("");
        setLookupCalcDate(null);setLookupSelectedHistoryId(null);setLookupCalcOpen(false);
        // Remount all five mode components → their internal state resets to launch defaults.
        setAoxResetKey(k=>k+1);
        setClassicResetKey(k=>k+1);
        setFlashResetKey(k=>k+1);
        setBlitzResetKey(k=>k+1);
        setDeductionResetKey(k=>k+1);
        // Scroll window + app container to top (synchronous, avoids a visual flash before the
        // mode-change effect would do it; window.scrollTo is defense-in-depth, body can't scroll).
        if(typeof window!=="undefined")window.scrollTo(0,0);
        if(appScrollRef.current)appScrollRef.current.scrollTop=0;
      };
      // Two-tap-to-confirm wrapper. Tap 1 arms (label flips to "Confirm?", button gets a ring).
      // Tap 2 within the arm window fires the reset and disarms. Auto-disarm via timer (3s),
      // settings-close watcher, and any-other-popover-mousedown listener.
      const armFullReset=()=>{
        // Defense in depth — the pointer-events-none className keeps taps from reaching here,
        // but if some keyboard/programmatic path bypasses CSS, this short-circuit ensures
        // we never arm/fire when the action would be a no-op.
        if(isFullyReset)return;
        if(fullResetArmed){
          if(fullResetTimerRef.current){clearTimeout(fullResetTimerRef.current);fullResetTimerRef.current=null;}
          setFullResetArmed(false);
          fullReset();
          return;
        }
        setFullResetArmed(true);
        if(fullResetTimerRef.current)clearTimeout(fullResetTimerRef.current);
        fullResetTimerRef.current=setTimeout(()=>{setFullResetArmed(false);fullResetTimerRef.current=null;},3000);
      };
      const disarmFullReset=()=>{
        if(fullResetTimerRef.current){clearTimeout(fullResetTimerRef.current);fullResetTimerRef.current=null;}
        setFullResetArmed(false);
      };
      // Disarm whenever settings closes by any path (gear tap, click-outside, Esc, full-reset firing).
      useEffect(()=>{if(!settingsOpen)disarmFullReset();},[settingsOpen]);
      // NOTE: the "disarm when state flips to fully-reset" safety-net effect was moved to just
      // after the isFullyReset declaration below — its dependency array reads isFullyReset, which
      // is declared later, so keeping it here would read isFullyReset before initialization (a TDZ
      // crash once the block-scoping shim was removed). Effects run after render regardless of source
      // order, so relocating it is behavior-identical.
      // Site-wide disarm listener (capture phase) — disarms when the user mousedowns/touches
      // any element outside the Full Reset button itself. Capture phase fires before the
      // target's own onClick, so the user's intent (e.g., toggling Random Format, switching
      // modes, tapping a date answer) still proceeds normally; we just consume the pending
      // arm. Scope is the entire document (not just the settings popover) so taps anywhere
      // outside the button reliably disarm.
      useEffect(()=>{
        if(!fullResetArmed)return;
        const h=(e: MouseEvent | TouchEvent)=>{
          if(fullResetBtnRef.current&&fullResetBtnRef.current.contains(e.target as Node | null))return;
          disarmFullReset();
        };
        document.addEventListener('mousedown',h,true);
        document.addEventListener('touchstart',h,true);
        return()=>{document.removeEventListener('mousedown',h,true);document.removeEventListener('touchstart',h,true);};
      },[fullResetArmed]);
      // Cleanup the Full Reset arm timer on unmount.
      useEffect(()=>()=>{
        if(fullResetTimerRef.current)clearTimeout(fullResetTimerRef.current);
      },[]);
      // True when every popover-controlled value matches its initial useState default.
      // Drives Reset Settings dim-and-lock — same pattern as Reveal/Override/etc.
      // Includes year range *input text* values so a dirty (uncommitted) input keeps
      // the button active to clear it back to "1" / "10000".
      const settingsAtDefaults=randomFormat===true&&dateFormat==='written-mdy'&&useJulian===true&&minY===1&&maxY===10000&&minInputVal==="1"&&maxInputVal==="10000"&&leapChance==='random'&&janFebChance==='random'&&julianChance==='random'&&saveStats===true&&useSystem===true&&darkTheme==='dusk'&&lightTheme==='light'&&manualTheme==='dusk';
      // Every per-mode piece of state now lives in the always-mounted mode components, which
      // each report a comprehensive freshness flag (config + stats + history + UI toggles) up
      // via onFreshChange. So isFullyReset = the launch mode (classic) + settings-at-defaults +
      // the Lookup state (which lives here in App) + all five freshness flags. No dead App-side
      // game-state checks remain.
      const isFullyReset=mode==='classic'&&settingsAtDefaults&&lookupHistory.length===0&&lookupInput===""&&lookupOutput===""&&lookupCalcDate===null&&lookupSelectedHistoryId===null&&lookupCalcOpen===false&&aoxIsFresh&&classicIsFresh&&flashIsFresh&&blitzIsFresh&&deductionIsFresh;
      // Safety net (moved here from above so its dep array reads isFullyReset AFTER it's declared):
      // if state somehow flips to fully-reset while the Full Reset button is armed (shouldn't be
      // reachable in practice — fullReset disarms before firing — but defensive), disarm.
      useEffect(()=>{if(isFullyReset&&fullResetArmed)disarmFullReset();},[isFullyReset,fullResetArmed]);
      // Settings popover. Stays IN the bar (absolute, anchored to the bar's relative
      // inner div via top-full) — only its CustomSelect dropdown PANELS portal out to
      // #root, to escape this overflow scroll context for the frosted-glass blur. Do NOT
      // re-portal the whole popover: that was tried (on a wrong "the fixed bar breaks the
      // frost" theory) and reverted — the scroll container, not the bar, was the cause.
      const settingsJsx=settingsOpen&&(<div ref={settingsPopoverRef} className="absolute left-4 right-4 top-full mt-2 z-50 rounded-2xl card py-4 space-y-4 shadow-xl flex flex-col max-h-[calc(100dvh-80px)]">
        <div ref={popoverInnerScrollRef} className={`overflow-y-auto overscroll-contain flex-1 min-h-0 space-y-4 px-4${popoverScrolledFromTop&&!popoverAtBottom?" fade-scroll-both":popoverScrolledFromTop?" fade-scroll-top":!popoverAtBottom?" fade-scroll-bottom":""}`}>
        <div className="space-y-2">
          <SectionLabel>Date Format</SectionLabel>
          <div className="flex items-center justify-between"><span className="text-xs text-purple-200/80">Random Format</span><button type="button" onClick={()=>setRandomFormat(v=>!v)} className={`px-3 py-1 rounded-xl text-xs font-medium border ${randomFormat?"btn-solid border-transparent":"surface-toggle text-purple-100/80"}`}>{randomFormat?"On":"Off"}</button></div>
          <div className={`flex gap-2 ${randomFormat?"opacity-60 pointer-events-none":""}`}>
            <div className="flex-1 space-y-1.5">
              <SectionLabel className="text-center">Written</SectionLabel>
              <div className="flex border surface-toggle rounded-xl overflow-hidden">
                <button type="button" onClick={()=>setDateFormat('written-mdy')} className={`flex-1 px-2 py-1 text-xs font-medium border-r border-(--sbtn-bd) ${dateFormat==='written-mdy'?"btn-solid text-white":"text-purple-100/80"}`}>MDY</button>
                <button type="button" onClick={()=>setDateFormat('written-dmy')} className={`flex-1 px-2 py-1 text-xs font-medium ${dateFormat==='written-dmy'?"btn-solid text-white":"text-purple-100/80"}`}>DMY</button>
              </div>
            </div>
            <div className="flex-1 space-y-1.5">
              <SectionLabel className="text-center">Numeric</SectionLabel>
              <div className="flex border surface-toggle rounded-xl overflow-hidden">
                <button type="button" onClick={()=>setDateFormat('numeric-mdy')} className={`flex-1 px-2 py-1 text-xs font-medium border-r border-(--sbtn-bd) ${dateFormat==='numeric-mdy'?"btn-solid text-white":"text-purple-100/80"}`}>MDY</button>
                <button type="button" onClick={()=>setDateFormat('numeric-dmy')} className={`flex-1 px-2 py-1 text-xs font-medium border-r border-(--sbtn-bd) ${dateFormat==='numeric-dmy'?"btn-solid text-white":"text-purple-100/80"}`}>DMY</button>
                <button type="button" onClick={()=>setDateFormat('numeric-ymd')} className={`flex-1 px-2 py-1 text-xs font-medium ${dateFormat==='numeric-ymd'?"btn-solid text-white":"text-purple-100/80"}`}>YMD</button>
              </div>
            </div>
          </div>
        </div>
        <div className="space-y-2 pt-3 border-t border-purple-500/20">
          <SectionLabel>Calendar System</SectionLabel>
          <div className="flex items-center justify-between"><span className="text-xs text-purple-200/80">Julian Calendar (pre-Oct 15, 1582)</span><button type="button" onClick={()=>setUseJulian(v=>!v)} className={`px-3 py-1 rounded-xl text-xs font-medium border ${useJulian?"btn-solid border-transparent":"surface-toggle text-purple-100/80"}`}>{useJulian?"On":"Off"}</button></div>
          {/* Julian Chance row: locked when useJulian is off (no Julian dates possible) OR when
              the year range is entirely Gregorian (minY>=1583) or entirely Julian (maxY<=1581).
              Year 1582 itself contains BOTH Julian (Jan-Sep + Oct 1-4) and Gregorian (Oct 15+ + Nov + Dec)
              dates, so a range that includes year 1582 always counts as mixed and the row stays
              unlocked. When locked, the selected value stays visually selected so it's restored
              when the lock condition clears (matches Leap Year Chance locking behavior). */}
          <div className="flex gap-1.5">
            {(() => { const julianMixed=useJulian&&minY<=1582&&maxY>=1582; return ['random','25','50','75','100'].map(v=>(<button key={v} type="button" onClick={()=>{if(!julianMixed)return;setJulianChance(v);}} aria-disabled={!julianMixed} className={`flex-1 px-1.5 py-1.5 rounded-xl text-xs font-medium border ${julianChance===v?"btn-solid border-transparent":"surface-toggle text-purple-100/80"}${!julianMixed?" opacity-60 pointer-events-none":""}`}>{v==='random'?'Random':v+'%'}</button>)); })()}
          </div>
        </div>
        <div className="space-y-2 pt-3 border-t border-purple-500/20">
          <SectionLabel>Year Range</SectionLabel>
          <div className="flex items-center gap-2">
            <input ref={minInputRef} type="text" inputMode="numeric" pattern="[0-9]*" value={minInputVal} onChange={e=>{if(e.target.value===''||/^\d*$/.test(e.target.value))setMinInputVal(e.target.value);}} onBlur={commitMin} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();commitMin();e.currentTarget.blur();}if(e.key==="Escape"){setMinInputVal(String(minY));e.currentTarget.blur();}blockMinus(e);}} onBeforeInput={blockMinusBI} className="w-16 panel rounded-xl px-2 py-1.5 text-xs text-center focus:outline-hidden focus-ring tabular-nums"/>
            <span className="text-purple-300/60 text-sm shrink-0">→</span>
            <input ref={maxInputRef} type="text" inputMode="numeric" pattern="[0-9]*" value={maxInputVal} onChange={e=>{if(e.target.value===''||/^\d*$/.test(e.target.value))setMaxInputVal(e.target.value);}} onBlur={commitMax} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();commitMax();e.currentTarget.blur();}if(e.key==="Escape"){setMaxInputVal(String(maxY));e.currentTarget.blur();}blockMinus(e);}} onBeforeInput={blockMinusBI} className="w-16 panel rounded-xl px-2 py-1.5 text-xs text-center focus:outline-hidden focus-ring tabular-nums"/>
          </div>
        </div>
        <div className="space-y-2 pt-3 border-t border-purple-500/20">
          <SectionLabel>Leap Year</SectionLabel>
          {/* Umbrella "Leap Year" SectionLabel covers both chance rows below. Each row
              keeps its own descriptive sub-label (muted text-purple-200/80, NOT the
              uppercase tracking-widest SectionLabel style) so the hierarchy reads
              top-down: section heading → sub-label → buttons. The two rows live in
              one divider-bounded section because they're tightly related — both
              control leap-year date generation behavior. */}
          <div className="text-xs text-purple-200/80">Leap Year Chance</div>
          <div className="flex gap-1.5">
            {/* When the active year range contains no leap years (per active calendar), lock the four
                buttons. The currently-selected value stays visually selected so it's restored when the
                range changes back to one with a leap year. Jan/Feb Chance stays unlocked — that row
                doesn't imply leap-year reachability (a setting kept while unreachable just doesn't fire). */}
            {(() => { const leapReachable=rangeHasLeapYear(minY,maxY,useJulian); return ['random','50','75','100'].map(v=>(<button key={v} type="button" onClick={()=>{if(!leapReachable)return;setLeapChance(v);}} aria-disabled={!leapReachable} className={`flex-1 px-1.5 py-1.5 rounded-xl text-xs font-medium border ${leapChance===v?"btn-solid border-transparent":"surface-toggle text-purple-100/80"}${!leapReachable?" opacity-60 pointer-events-none":""}`}>{v==='random'?'Random':v+'%'}</button>)); })()}
          </div>
          <div className="text-xs text-purple-200/80">Jan/Feb Chance on Leap Years</div>
          {/* Jan/Feb Chance: 5-button chance row. Option A semantics — the listed % is the
              exact final probability that a leap-year date lands on Jan/Feb. Random means
              no biasing (natural ~17% on uniform months). The row stays unlocked even when
              leap years aren't reachable in the current range — the setting is preserved
              and applies once a leap year becomes reachable again. px-1.5 (slightly tighter
              than the default px-2) so 5 buttons with "Random" label fit cleanly on iPhone
              SE width at text-xs without wrapping. Leap Year Chance above uses the same
              padding for visual consistency. */}
          <div className="flex gap-1.5">
            {['random','25','50','75','100'].map(v=>(<button key={v} type="button" onClick={()=>setJanFebChance(v)} className={`flex-1 px-1.5 py-1.5 rounded-xl text-xs font-medium border ${janFebChance===v?"btn-solid border-transparent":"surface-toggle text-purple-100/80"}`}>{v==='random'?'Random':v+'%'}</button>))}
          </div>
        </div>
        <div className="space-y-2 pt-3 border-t border-purple-500/20">
          <SectionLabel>Stats</SectionLabel>
          <div className="flex items-center justify-between"><span className="text-xs text-purple-200/80">Save Stats</span><button type="button" onClick={toggleSaveStats} className={`px-3 py-1 rounded-xl text-xs font-medium border ${saveStats?"btn-solid border-transparent":"surface-toggle text-purple-100/80"}`}>{saveStats?"On":"Off"}</button></div>
        </div>
        <div className="space-y-2 pt-3 border-t border-purple-500/20">
          <SectionLabel>Theme</SectionLabel>
          <div className="flex items-center justify-between"><span className="text-xs text-purple-200/80">Use System Settings</span><button type="button" onClick={()=>setUseSystem(v=>!v)} className={`px-3 py-1 rounded-xl text-xs font-medium border ${useSystem?"btn-solid border-transparent":"surface-toggle text-purple-100/80"}`}>{useSystem?"On":"Off"}</button></div>
          {useSystem?(<><div className="flex items-center gap-3"><span className="text-xs text-purple-200/80 w-10 shrink-0">Dark:</span><CustomSelect value={darkTheme} onChange={setDarkTheme} options={DARK_THEMES} openUp ariaLabel="Dark theme" wrapperClassName="flex-1" className="panel rounded-xl px-2 py-1 text-sm w-full focus:outline-hidden focus-ring text-left"/></div><div className="flex items-center gap-3"><span className="text-xs text-purple-200/80 w-10 shrink-0">Light:</span><CustomSelect value={lightTheme} onChange={setLightTheme} options={LIGHT_THEMES} openUp ariaLabel="Light theme" wrapperClassName="flex-1" className="panel rounded-xl px-2 py-1 text-sm w-full focus:outline-hidden focus-ring text-left"/></div></>):(<div className="flex items-center gap-3"><span className="text-xs text-purple-200/80 w-10 shrink-0">Theme:</span><CustomSelect value={manualTheme} onChange={setManualTheme} options={ALL_THEMES_LABELED} openUp ariaLabel="Theme" wrapperClassName="flex-1" className="panel rounded-xl px-2 py-1 text-sm w-full focus:outline-hidden focus-ring text-left"/></div>)}
        </div>
        </div>
        <div className={`popover-sticky-footer pt-4 px-4 border-t border-purple-500/20${!popoverAtBottom?" elev-shadow-up":""}`}>
          <div className="flex gap-2">
            <button type="button" onClick={resetSettings} className={`flex-1 ${RESET_BTN_CLASS} ${settingsAtDefaults?"opacity-60 pointer-events-none":""}`}>Reset Settings</button>
            <button ref={fullResetBtnRef} type="button" onClick={armFullReset} className={`flex-1 ${RESET_BTN_CLASS}${fullResetArmed?" ring-2 ring-rose-200":""}${isFullyReset?" opacity-60 pointer-events-none":""}`}>{fullResetArmed?"Confirm?":"Full Reset"}</button>
          </div>
        </div>
        <div className="pt-3 px-4 border-t border-purple-500/20 text-[11px] text-purple-300/60 space-y-0.5">
          <div>Contact: <a href="mailto:dayoftheweekcalculation@gmail.com" className="underline break-all select-text">dayoftheweekcalculation@gmail.com</a></div>
          <div>Last Updated: {(()=>{const d=DEPLOY_TS;const yy=d.getFullYear();const mo=d.getMonth()+1;const da=d.getDate();const numFmt=numericFormatOf(dateFormat);const datePart=fmt(yy,mo,da,numFmt);const timePart=d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false});return`${datePart} ${timePart}`;})()}</div>
        </div>
      </div>);
      return(
        <>
        {/* Bar (position:fixed): the bar is a CHROME-STYLE fixed element above
            everything — explicitly positioned at the viewport top so iOS PWA recognizes
            it as chrome UI and live-samples its bg-(--bg1) (theme-aware) for the
            status bar color. Sibling appScrollRef container is position:absolute
            below, with padding-top:var(--bar-h) so its content starts below the bar.
            ResizeObserver elsewhere in App writes the bar's offsetHeight to --bar-h.
            Full width (no max-w) so theme bg + elevation shadow span edge-to-edge on
            screens wider than 480px; inner max-w-[480px] wrapper holds the title row.
            elev-shadow-down appears when the scroll container is past top.
            HtP-only bar pb-2.5: absorbs half (10px) of the 20px gap that normally sits
            between the title row and the first GuidePage panel. The <GuidePage/> wrapper
            also drops mt-5 → mt-2.5 to compensate, so the total gap stays 20px — but the
            visual "lock line" is centered between title row and first panel rather than
            sitting right at the title row's bottom edge.
            ⚠ The SPACE in `pt-5 ${` is REQUIRED — Tailwind v4's source scanner silently drops a
            utility glued directly to `${` when it appears nowhere else; without it the bar lost
            its pt-5 (20px) top padding and the whole site sat ~20px too high. Don't remove the
            space. (Calendar Game layout bug-fix, 2026-06-01.) */}
        <div ref={htpStickyBarRef} style={{position:'fixed',top:0,left:0,right:0,zIndex:30}} className={`htp-sticky-bar bg-(--bg1) w-full pt-5 ${mode==="guide"?" pb-2.5":""}${appScrolledFromTop?" elev-shadow-down":""}`}>
          <div className="mx-auto px-4 w-full max-w-[480px] relative">
            <div className="flex items-center justify-between gap-2">
              {/* header left: title */}
              <div className="flex items-center gap-2 shrink-0">
                <W5Logo className="shrink-0" />
                <h1 className="text-xl font-semibold leading-none shrink-0">Calendar Game</h1>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* gear settings button */}
                <div className="relative" ref={settingsRef}>
                  <button type="button" onClick={()=>setSettingsOpen(v=>!v)} className={`px-2.5 py-2 rounded-xl text-sm border ${settingsOpen?"btn-solid border-transparent":"panel text-purple-100/80"}`} aria-label="Settings">⚙</button>
                </div>
                {/* mode selector */}
                {/* Mode CustomSelect. Replaced the original native <select> as part of the
                    site-wide CustomSelect rollout that fixed iOS Safari's native picker
                    auto-close bug — see the CustomSelect component for full context.
                    wrapperRef={modeSelectRef} so the existing settings click-outside handler
                    keeps treating taps inside the mode dropdown the same way it treated taps
                    on the original <select>. showChevron renders the same ▲▼ indicator. */}
                <CustomSelect wrapperRef={modeSelectRef} value={mode} onChange={(v)=>{setMode(v);setSettingsOpen(false);}} options={MODE_LABELS} ariaLabel="Mode" showChevron className="panel rounded-xl px-2.5 py-2 pr-9 text-sm focus:outline-hidden focus-ring text-left"/>
              </div>
            </div>
            {settingsJsx}
          </div>
        </div>
        {/* Scroll container: position:absolute inset:0 with padding-top:var(--bar-h)
            so content starts immediately below the bar. overscroll-contain keeps
            rubber-band bounce LOCAL to this container (bar is unaffected). */}
        <div ref={appScrollRef} style={{paddingTop:'var(--bar-h)'}} className={`absolute inset-0 overflow-y-auto overscroll-contain${appScrolledFromTop&&!appAtBottom?" fade-scroll-both":appScrolledFromTop?" fade-scroll-top":!appAtBottom?" fade-scroll-bottom":""}`}>
        <div className="mx-auto px-4 pb-5 w-full max-w-[480px]">
          {/* key={aoxResetKey} forces remount on Full Reset since AoxMode is always-mounted
              (display:none toggle on visible prop, not conditional rendering) and its internal
              state would otherwise persist across resets. See aoxResetKey declaration upstream
              for full rationale. */}
          {/* Per-mode error boundaries (ModeErrorBoundary): a crash in one mode is isolated —
              the bar + switcher + other modes keep working. The mode's reset key lives on the
              BOUNDARY now (not the inner component) so Full Reset remounts boundary+component
              together (clearing any caught error AND resetting the component's state). The
              always-mounted modes pass `active` so a hidden mode's crash paints nothing. */}
          <ModeErrorBoundary key={"aox-"+aoxResetKey} mode="AoX" active={mode==="aox"}>
            <AoxMode minY={minY} maxY={maxY} visible={mode==="aox"} fmtDate={fmtDate} useJulian={useJulian} genDate={genDate} leapChance={leapChance} janFebChance={janFebChance} julianChance={julianChance} randomFormat={randomFormat} dateFormat={dateFormat} saveStats={saveStats} onFreshChange={setAoxIsFresh}/>
          </ModeErrorBoundary>
          <ModeErrorBoundary key={"classic-"+classicResetKey} mode="Classic" active={mode==="classic"}>
            <ClassicMode visible={mode==="classic"} genDate={genDate} minY={minY} maxY={maxY} useJulian={useJulian} saveStats={saveStats} dateFormat={dateFormat} randomFormat={randomFormat} leapChance={leapChance} janFebChance={janFebChance} julianChance={julianChance} fmtDate={fmtDate} onFreshChange={setClassicIsFresh}/>
          </ModeErrorBoundary>
          <ModeErrorBoundary key={"flash-"+flashResetKey} mode="Flash" active={mode==="flash"}>
            <FlashMode visible={mode==="flash"} genDate={genDate} minY={minY} maxY={maxY} useJulian={useJulian} saveStats={saveStats} dateFormat={dateFormat} randomFormat={randomFormat} leapChance={leapChance} janFebChance={janFebChance} julianChance={julianChance} fmtDate={fmtDate} onFreshChange={setFlashIsFresh}/>
          </ModeErrorBoundary>
          <ModeErrorBoundary key={"blitz-"+blitzResetKey} mode="Blitz" active={mode==="blitz"}>
            <BlitzMode visible={mode==="blitz"} genDate={genDate} minY={minY} maxY={maxY} useJulian={useJulian} saveStats={saveStats} dateFormat={dateFormat} randomFormat={randomFormat} leapChance={leapChance} janFebChance={janFebChance} julianChance={julianChance} fmtDate={fmtDate} onFreshChange={setBlitzIsFresh}/>
          </ModeErrorBoundary>
          <ModeErrorBoundary key={"deduction-"+deductionResetKey} mode="Deduction" active={mode==="deduction"}>
            <DeductionMode visible={mode==="deduction"} minY={minY} maxY={maxY} useJulian={useJulian} saveStats={saveStats} dateFormat={dateFormat} randomFormat={randomFormat} leapChance={leapChance} janFebChance={janFebChance} julianChance={julianChance} onFreshChange={setDeductionIsFresh}/>
          </ModeErrorBoundary>
          {mode==="lookup"&&(<ModeErrorBoundary mode="Lookup" active={true}><div className="mt-5"><LookupCard history={lookupHistory} onAddHistory={pushLookupHistory} onMoveHistory={moveHistoryEntryToTop} onClearHistory={clearLookupHistory} inputValue={lookupInput} onInputChange={setLookupInput} outputValue={lookupOutput} onOutputChange={setLookupOutput} calcDate={lookupCalcDate} onCalcDateChange={setLookupCalcDate} selectedHistoryId={lookupSelectedHistoryId} onSelectedHistoryIdChange={setLookupSelectedHistoryId} calcOpen={lookupCalcOpen} onCalcOpenChange={setLookupCalcOpen} fmtDate={fmtDate} dateFormat={dateFormat} useJulian={useJulian}/></div></ModeErrorBoundary>)}
          {mode==="guide"&&(<ModeErrorBoundary mode="How to Play" active={true}><div className="mt-2.5"><GuidePage/></div></ModeErrorBoundary>)}
        </div>
        </div>
        </>
      );
    }

    // GuidePage / GuideSection (How-to-Play) → src/components/GuidePage.jsx, imported at top.

    // Show Codes panel ordering follows the date's display format (left-to-right reading
    // order), with Leap appearing once both year and month are visible. mdy/dmy formats:
    // month/day/ab/cd/leap. ymd format: ab/cd/month/leap/day. Uses the date's _fmt
    // snapshot when randomFormat is on (passed as displayedFormat), else the user's
    // selected format.
    //
    // When `cellDates` is provided (Deduction Month sub-mode 1582 only — answer cell
    // groups months from both calendars), each code value is collected across all
    // interpretations and joined with slashes, deduped via Set (insertion-order
    // preserved). Calendar text follows the same dedup rule: "Julian/Gregorian Calendar"
    // not "Julian/Julian/Gregorian". Cell ordering naturally produces Julian-first since
    // Julian months come first in the cell labels (e.g., Aug/Dec, Jan/Nov).
    // MethodExplanation / MethodBreakdownSection (Show Codes panel) → src/components/MethodBreakdown.jsx, imported at top.

    // LookupCard → src/components/LookupCard.jsx, imported at top.

    // Browser entry: mount into #root (provided by index.html). The mount is guarded on
    // #root's presence so that importing this module from a characterization test does NOT
    // auto-mount a second copy — tests `import { App }`, create a #root (for CustomSelect's
    // portal), and mount via Testing Library into their own container. At test-import time
    // #root doesn't exist yet (tests create it in beforeEach), so this is skipped; in the
    // real build #root is in the HTML before this module runs. (The eventual thin entry /
    // app-module split falls out naturally during the Step-6 cleanup; this is the minimal
    // touch needed to make App testable for the safety net.)
    const rootEl = typeof document !== "undefined" ? document.getElementById("root") : null;
    if (rootEl) ReactDOM.createRoot(rootEl).render(<ErrorBoundary><App/></ErrorBoundary>);

    // Dev-only Core Web Vitals logging (Stage E0). The static import.meta.env.DEV guard
    // makes this dead code in a production build, so the call, reportWebVitals, and the
    // web-vitals library are all tree-shaken out of the shipped bundle.
    if (rootEl && import.meta.env.DEV) reportWebVitals();

    // Exported for the Step-6 characterization tests (the mode-untangle safety net).
    export { App };
