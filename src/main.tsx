import './index.css' // Tailwind (v3, compiled in-build) + the app's custom CSS — replaces the old Play-CDN <script> + inline <style>.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  useSyncExternalStore,
} from 'react'
import type { SetStateAction } from 'react'
import ErrorBoundary, { ModeErrorBoundary } from './ErrorBoundary'
import { initObservability, captureError } from './observability/sentry'
// createRoot only. This used to reconstruct a ReactDOM object carrying createPortal too, because
// the modern modular build splits them ('react-dom/client' vs 'react-dom') and this file portalled
// the settings modals; those went to components/SettingsPanel, which imports createPortal
// itself, so the shim had nothing left to reconstruct.
import { createRoot } from 'react-dom/client'
import { fmt } from './lib/format.js'
import { dotOrientationFor } from './lib/dotLayout.js'
import { randomDate } from './lib/dateGen.js'
import { makeDedPuzzle } from './lib/dedPuzzle.js'
import { UpdateDot } from './components/UpdateDot.jsx'
import CustomSelect from './components/CustomSelect.jsx'
import GuidePage from './components/GuidePage.jsx'
import LookupCard from './components/LookupCard.jsx'
import W5Logo from './components/W5Logo.jsx'
import PresetSwitcher from './components/PresetSwitcher.jsx'
import { useBackButton } from './components/useBackButton.js'
import { useYearRangeMirrors } from './components/useYearRangeMirrors.js'
import { SettingsPanel } from './components/SettingsPanel.jsx'
import { SCROLLER_CORE_CLASS, scrollFadeClass, scrollEdgeGaps, isAtBottom, isScrolledFromTop, edgeShade, readShadeRampPx, writeShade, observeScrollExtent, BOTTOM_EDGE_BAND_PX } from './components/scrollRegion.js'
import { installPointerGestures } from './lib/pointerGestures.js'
import { installSelectAllOnEntry } from './lib/textEntry.js'
import { readBuildStamp, writeBuildStamp, buildChanged } from './lib/buildStamp.js'
import { useUpdateCheck } from './components/useUpdateCheck.js'
import { DEPLOY_TS } from './deployStamp.js'
import { GEAR_DOT_KEY, CHANGELOG_DOT_KEY, readUpdateDot, markUpdateDot, clearUpdateDot, subscribeUpdateDot, CHANGELOG, changelogSignature, changelogChanged, readChangelogSeen, writeChangelogSeen } from './changelog.js'
import { usePresets } from './store/presets.js'
import { activeDataId, selectAmnesic, discardParkedStats } from './store/amnesic.js'
import { setPresetAmnesic } from './store/presetControl.js'
import { useSettings } from './store/settings.js'
import { useModePrefs } from './store/modePrefs.js'
import { useUserDefaults, effectiveSettingsDefaults, effectivePrefDefaults, effectiveAmnesicDefault, prefsMatchDefaults } from './store/userDefaults.js'
import { useProgress } from './store/progress.js'
import { useLookupHistory, useLookupSession, addLookupEntry, moveEntryToTop, mergeForDisplay } from './store/lookupHistory.js'
import type { LookupEntry } from './store/lookupHistory.js'
import { reportWebVitals } from './dev/webVitals.js'
import type { FormatId } from './lib/format.js'
import type { CodeDate } from './components/MethodBreakdown.jsx'
import RotateOverlay from './components/RotateOverlay.jsx'
import BootOverlay from './components/BootOverlay.jsx'
import { rollFormat, isTouch } from './lib/modeFormat.js'
import ClassicMode from './modes/ClassicMode.jsx'
import FlashMode from './modes/FlashMode.jsx'
import DeductionMode from './modes/DeductionMode.jsx'
import AoxMode from './modes/AoxMode.jsx'
import BlitzMode from './modes/BlitzMode.jsx'

    // ★ HOW TO READ THE "WHERE DID X GO?" INDEX BELOW (audited in full, round 14). Every entry names
    // a symbol this file once declared and says where it lives NOW. An entry says "imported at top"
    // ONLY when the import block at the head of this file really names that symbol today — several
    // entries claimed it after the symbol's last reader here had left, which is the exact lie an
    // index is supposed to prevent. When main.tsx no longer touches a module at all the entry says
    // so and lists the real consumers instead, so the pointer still earns its place. Re-audit against
    // the import block, never against these lines, whenever you move something out.
    //
    // Shared mode types (GenDate/FmtDate/FlashState/GameEngine/ModeProps/DedOpts) -> src/modes/modeTypes.ts.
    // NOT imported here: App names none of them. It passes props to the five mode screens and their
    // types are inferred from those components, so the contract is enforced without this file
    // importing it. Consumed by src/modes/* and the engine.
    // AoxBest / BlitzBest / SuddenBest moved to store/progress.ts (the persisted store owns them).
    // NOT imported here either — of that module App takes useProgress ALONE now. The three best
    // types are read by AoxMode, BlitzMode, components/BlitzBestRow and src/engine/{aoxBest,blitzBest}.
    // LookupEntry / addLookupEntry / moveEntryToTop / mergeForDisplay, and the two stores that split
    // Lookup's history into a permanent shared list and a session-only amnesic overflow, moved OUT of
    // store/progress entirely (Q1, round 20) to store/lookupHistory.ts — see that file's header for
    // why Lookup's history stopped being preset data. App takes useLookupHistory, useLookupSession,
    // addLookupEntry, moveEntryToTop and mergeForDisplay from it; nothing else reaches that module.

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
    // Shared control className tokens + buttonStateClass -> src/components/controlClasses.ts. App
    // no longer imports it: its last four tokens (RESET_BTN_CLASS, FOOTER_RESET_BTN_CLASS, the
    // footer link-row class — since split into FOOTER_META_ROW_CLASS + FOOTER_DEFAULTS_ROW_CLASS —
    // and NUM_INPUT_CLASS) left with the ⚙ card. Consumed now by
    // components/SettingsPanel + DefaultsCard + WeekdayAnswer and all five mode screens.
    // DOT_CELLS — the logo's 7-position layout for the Dots input, in both orientations →
    // src/lib/dotLayout.ts. NOT imported here: App renders no answer input. Its readers are
    // components/WeekdayAnswer (the Dots grid itself) and components/GuidePage's DotDiagram, which
    // derives its diagram from the same data. What App DOES hold is the rotateDots SETTING (the
    // boolean; the geometry's own two-valued DotOrientation lives only in lib/dotLayout), and
    // `dotOrientationFor` — the ONE place that boolean is turned back into DotOrientation — IS
    // imported here, because the top bar's mark needs a SECOND, stricter derivation the four weekday
    // modes don't: the mark only turns while inputStyle is 'dots' (Q3, round 20 — see the W5Logo
    // call site for why). DOT_MARK_ROTATION itself stays unimported; W5Logo applies it.
    // WeekdayAnswer -> src/components/WeekdayAnswer.tsx. NOT imported here: all five mode screens
    // render their own, and App renders none.
    // MONTH / DAY name tables → src/lib/format.js. NOT imported here — see the format entry below for
    // what App does take from that module. Read by components/LookupCard (MONTH + DAY),
    // components/WeekdayAnswer, components/GuidePage, lib/method and modes/DeductionMode (DAY);
    // lib/format itself uses MONTH internally in fmt/fmtPartial.
    // MODE_LABELS drives the header mode CustomSelect (the customSelect dropdown
    // that replaced the native <select>). Order here = order shown in the dropdown.
    const MODE_LABELS=[{value:'classic',label:'Classic'},{value:'aox',label:'MoX'},{value:'deduction',label:'Deduction'},{value:'flash',label:'Flash'},{value:'blitz',label:'Blitz'},{value:'lookup',label:'Lookup'},{value:'guide',label:'How to Play'}];
    // ⚙ Settings PICKER option arrays (WRITTEN_FORMATS / NUMERIC_FORMATS / INPUT_STYLES /
    // DARK_THEMES / LIGHT_THEMES / CHANCE_OPTIONS / LEAP_CHANCE_OPTIONS) -> src/components/
    // settingsOptions.ts, imported by the panel itself. MODE_LABELS above stayed here because it
    // drives the BAR's mode CustomSelect, which is not part of the panel.
    // Method-code maps + the per-date code summary (METHOD_*, JULIAN_AB_MAP, normalizeMod7,
    // canonicalizeMod, calcDayCode, calcCdCode, yearParts, computeMethodSummary) → src/lib/method.js.
    // NOT imported here any more: computeMethodSummary was App's only reader and it left with the
    // codes panels. Its sole consumer now is components/MethodBreakdown; the rest are its internals.
    // Deduction option constants, yearGridLayout + the MONTH_BOXES tables -> src/lib/dedPuzzle.ts.
    // Of that module App imports makeDedPuzzle ALONE (see the entry further down); the option
    // constants and yearGridLayout are read by modes/DeductionMode, and MONTH_BOXES only inside
    // dedPuzzle itself.
    // Day-of-week & calendar math (toAstro, isLeap, dim, jdn*, wday*, isJulian*, isGap*,
    // rangeHasLeapYear) → src/lib/calendar.js. NOT imported here any more: rangeHasLeapYear was
    // App's last reader and it went with the Leap-Year picker into components/SettingsPanel.
    // Reached now only by the modes, LookupCard, the engine and the progress store.
    // Date formatting (fmtYear, fmt, fmtPartial, numericFormatOf) → src/lib/format.js. Of these App
    // imports `fmt` ALONE; numericFormatOf left with the Last-Updated stamp and the changelog dates
    // for components/SettingsPanel, and fmtYear/fmtPartial are read by the modes, not here.
    // rint + randomDate (the weekday-question generator) -> src/lib/dateGen.ts. Of these App imports
    // `randomDate` ALONE; rint is dateGen's own internal, shared only with lib/dedPuzzle.
    // Shared format/time helpers -> src/lib/modeFormat.ts. Of that module App imports rollFormat +
    // isTouch ALONE; its time/accuracy formatters and input guards belong to the mode screens.

    // entryWithGreen → src/engine/answerButtons.js. NOT imported here: App renders no answer buttons.
    // Its only consumer is src/engine/gameReducer.

    // FLASH_MS + the shared mode-screen hooks -> src/modes/modeHooks.ts, consumed there by the five
    // screens; nothing here reaches into src/modes for them. The one that is NOT mode-specific,
    // useSettingsCloseEffect, lives in src/components/useSettingsCloseEffect.ts — App reaches it
    // only INDIRECTLY now, through components/useUpdateCheck (the Q7 update-check reset moved in
    // there with the rest of that interaction), so it is no longer imported here.

    // computeHasCredit, markBtns, mkBtnsWithCorrect → src/engine/answerButtons.js. NOT imported here
    // either — same reason as entryWithGreen above. Their only reader is src/engine/gameReducer.

    // Expander → src/components/Expander.jsx. Not used here, and since round 14 not reached from here
    // at all: the last indirect route was through MethodBreakdownSection, and this file no longer
    // renders a codes panel of any kind (see the MethodBreakdownSection entry near the bottom).



    // DEPLOY_TS (the deploy stamp the "Last Updated" line renders and the build-change detection
    // below compares against) -> src/deployStamp.ts, imported at top. It moved there because it is
    // read from BOTH sides of the settings-panel boundary, and main.tsx cannot be imported by the
    // panel without a cycle. ★ THERE IS NO PER-DEPLOY BUMP ANY MORE (round 16, Q1): vite.config.js
    // injects the build clock as __BUILD_TS__, and the build FAILS if the newest changelog entry is
    // not dated that stamp's Pacific day. Nothing here has to be edited before a push.

    // Post-update splash skip: a one-time sessionStorage flag stamped by BOTH update paths
    // immediately before their reload — the AUTO path's gated reload (controllerchange or the
    // 4s-safety handoff, via makeUpdateReloadGate below) and the MANUAL Check-for-updates path
    // (forceReloadLatest below) — and CONSUMED (read + removed) by the next boot's hold
    // computation: the user just watched the Updating screen ≥1s, so the follow-on LOADING splash
    // skips its artificial 500ms hold and shows only as long as the real boot takes. It still
    // waits for css-ready + mount, so even the manual path's genuinely network-cold boot (caches
    // wiped) can never reveal an unstyled frame — post-update, the splash always shows only real
    // boot time. The consumed value is also shared (skipHoldConsumedRef in App) with the Q2
    // build-change flash effect: a boot that just came through the real Updating flow lands on a
    // changed build stamp by definition, and it must RESTAMP silently — the screen already showed,
    // and a second one back-to-back is exactly what the flash must never add. try/catch
    // throughout: sessionStorage can throw (privacy modes) and a broken flag must never break
    // boot.
    const SKIP_BOOT_HOLD_KEY='cg-skip-boot-hold';
    const markSkipBootHold=()=>{try{sessionStorage.setItem(SKIP_BOOT_HOLD_KEY,'1');}catch{/* best-effort */}};
    const consumeSkipBootHold=()=>{try{const set=sessionStorage.getItem(SKIP_BOOT_HOLD_KEY)!==null;sessionStorage.removeItem(SKIP_BOOT_HOLD_KEY);return set;}catch{return false;}};

    // Force the very latest deployed version, bypassing the service-worker cache — the big hammer
    // BEHIND Settings → "Check for updates", and since Q7 (round 11) no longer what that button
    // does. The button checks first and applies through the service worker; this runs only when a
    // check FOUND something the gentle path cannot deliver (no registration at all, or no handoff
    // within UPDATE_HANDOFF_MS). It stays reachable because it is the only cure for the round-7
    // class — an asset whose bytes changed while its precache revision did not, which Workbox will
    // never re-download (scripts/precacheIntegrity.mjs now makes that unshippable at build time).
    // (The NORMAL update path is two-step prompt-mode:
    // a newly-deployed SW installs + WAITS in the background, and App's auto-update boot effect
    // applies it on the next cold open behind the Updating screen.) It covers what that path
    // can't — a stuck/ancient SW or cached icon you can't shake on a phone with no hard-refresh:
    // it unregisters the service worker(s) and deletes the Cache-API caches (the precached app shell
    // + assets), then reloads — so the next load fetches everything fresh from the server. NEVER use
    // it on the automatic path: with the caches wiped, an offline launch has nothing to serve (the
    // auto path's safety fallback is a plain reload instead). It does NOT touch localStorage, so
    // saved stats, settings, bests, and Lookup history are all preserved (only the app code/asset
    // cache is cleared). Like the auto path's gated reload, it stamps cg-skip-boot-hold just before
    // navigating (markSkipBootHold above): the user already sat through the ≥1s Updating hold, so
    // the post-reload splash shows only the real (network-cold) boot time — no artificial 500ms
    // hold stacked on top.
    const forceReloadLatest=async()=>{
      try{
        if('serviceWorker' in navigator){
          const regs=await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r=>r.unregister()));
        }
        if('caches' in window){
          const keys=await caches.keys();
          await Promise.all(keys.map(k=>caches.delete(k)));
        }
      }catch{/* best-effort — reload regardless */}
      markSkipBootHold();
      window.location.reload();
    };

    // index.html's inline boot scripts stamp these: __bootShownAt = the requestAnimationFrame
    // timestamp of the #boot splash's first rendering opportunity (≈ its first paint); __cssReady =
    // set (with a window 'app-css-ready' event) by the preload-swapped stylesheet link's
    // onload/onerror — see vite.config.js bootCssPreload.
    declare global{interface Window{__bootShownAt?:number;__cssReady?:boolean}}

    // The page's LOADING splash is #boot in index.html — a body-level sibling of #root (so React's
    // first commit can't wipe it), inline-styled so it paints before any external resource. App owns
    // its removal, from exactly two places: the boot-hold effect (normal launch — after ≥0.5s visible
    // AND the real stylesheet has applied) and the auto-update path (the Updating overlay replaces
    // it). Optional-chained: tests don't create #boot, and a repeat call is a no-op.
    const dismissBootSplash=()=>{document.getElementById('boot')?.remove();};

    // The boot effects' shared "has the real stylesheet applied?" check: true once the preload-swapped
    // CSS link (vite.config.js bootCssPreload) has stamped __cssReady, or when no preload link exists
    // at all (dev/tests — the CSS arrives through the JS module graph before mount). Both boot paths —
    // the normal splash dismissal AND the auto-update Updating handoff — gate on it, so neither can
    // ever reveal an unstyled frame.
    const appCssApplied=()=>window.__cssReady===true||!document.querySelector('link[rel="preload"][as="style"]');

    // ★★ DO NOT HOIST THE `import('./sw.js')` IN App'S SERVICE-WORKER EFFECT TO MODULE SCOPE.
    // It is tempting, and it looks like a pure win: babel-plugin-react-compiler cannot lower a
    // dynamic import ("(BuildHIR::lowerExpression) Handle Import expressions") and one unlowerable
    // expression makes it abandon the ENTIRE enclosing component, so while that call sits inside
    // App's body the compiler emits exactly one event for the whole of main.tsx — that error,
    // against App — and App is never memoised at all. Hoisting the expression out does make App
    // compile (measured: CompileSuccess, 271 memo slots, 68 memo blocks).
    //
    // ⚠ IT ALSO BREAKS THE APP TODAY, and the suite proves it: with App compiled, exactly 3 cases go
    // red. Their ACTUAL failures, read off the run rather than summarised:
    //     tests/saveDefaults.dom:115  expected 2000 to be 800   (useModePrefs.getState().flashMs)
    //     tests/saveDefaults.dom:133  expected 2000 to be 800   (the same, one case later)
    //     tests/settingsPanel.defaults.dom:840  expected true to be false  (offers().gear)
    // Two of the three are NOT gear assertions at all — Reset Settings simply did not restore the
    // saved defaults, and the gear line beneath is never reached.
    //
    // ★ THE ROOT CAUSE, ESTABLISHED BY CONTROL RATHER THAN BY READING (round 16 review). Delete the
    // `if(!settingsModified)return;` guard out of `pressResetSettings` (the round-14 dimmed-button
    // guard, ~line 1392) and, with the hoist still applied, all 52 cases in those two files pass.
    // So the compiled defect is that MEMOISED HANDLER closing over a STALE `settingsModified` and
    // bailing out: the tap does nothing at all, which is why one symptom is an unrestored pref and
    // the other is a gear that never clears. The RENDERED value is right in the same commit — the
    // case at settingsPanel.defaults:838 asserts the gear is lit and PASSES on the line before —
    // so this is the handler's closure disagreeing with what was drawn, not a wrong `settingsModified`.
    //
    // ⚠ TWO THINGS THAT LOOK LIKE THE CAUSE AND ARE NOT. Both were TRIED, on top of the hoist, and
    // both left the same 3 cases red — do not spend the afternoon on either again:
    //   • `prefsAtDefaults` (~line 402) going stale because its zustand selector closes over
    //     defPrefs. Replacing it with a raw `useModePrefs()` subscription plus the comparison
    //     computed outside the selector changes nothing. (That probe is sound: without the hoist it
    //     is 52/52 green, so compilation is the only differentiator.) An earlier draft of THIS
    //     comment named it as the blocker; it was wrong, and this paragraph is its correction.
    //   • `defPrefs` being stale inside resetSettings. Reading the effective defaults fresh from
    //     useUserDefaults.getState() inside the reset changes nothing either.
    // The guard is DORMANT while App is uncompiled, so nothing ships broken — the harm would be in
    // fixing the wrong thing. Whatever fix is chosen has to make the guard read a live value without
    // putting a write in render; that is the work, and it has to land BEFORE the hoist.
    //
    // (Also worth knowing before anyone retries this: the compiler DOES run under the Vitest
    // transform. Look for `$[` / `c(271)`, not `_c(` — the SSR transform rewrites the runtime import
    // to `__vite_ssr_import_N__.c`, which is why this was previously believed invisible to tests.
    // And the compile events are readable without a build: run babel over this file with
    // babel-plugin-react-compiler and a `logger`, which is how the 271/68 above were measured.)

    // The two update-signal dots' getSnapshot functions (Q6), for the useSyncExternalStore reads in
    // App. Module scope, so each is ONE stable function identity for the life of the page: React
    // compares the snapshot it gets against the last one with Object.is, and both return a plain
    // boolean, so a re-read that finds no change re-renders nothing. Inlining these as arrows in the
    // component would allocate a new getSnapshot every render for no benefit.
    const readGearDot=()=>readUpdateDot(GEAR_DOT_KEY);
    const readChangelogDot=()=>readUpdateDot(CHANGELOG_DOT_KEY);

    // Q3 auto-update loop breaker: the count of consecutive auto-update attempts, persisted in
    // sessionStorage (it survives same-tab reloads — exactly the shape of the failure loop — but not a
    // fresh open). Counted up when the boot check engages the Updating flow, cleared on success
    // (controllerchange) and on any boot that finds no waiting worker; after 2 failed attempts the
    // boot check STOPS re-entering the flow (see the auto-update effect), so a persistently-failing
    // SKIP_WAITING / broken waiting worker can never trap the user in an Updating→reload loop — the
    // app always renders (on the old version) and the manual Check-for-updates hammer stays reachable.
    // try/catch throughout: sessionStorage can throw (privacy modes) and a broken counter must never
    // break boot.
    const UPDATE_ATTEMPTS_KEY='cg-update-attempts';
    const readUpdateAttempts=()=>{try{return parseInt(sessionStorage.getItem(UPDATE_ATTEMPTS_KEY)||'0',10)||0;}catch{return 0;}};
    const writeUpdateAttempts=(n: number)=>{try{sessionStorage.setItem(UPDATE_ATTEMPTS_KEY,String(n));}catch{/* best-effort */}};
    const clearUpdateAttempts=()=>{try{sessionStorage.removeItem(UPDATE_ATTEMPTS_KEY);}catch{/* best-effort */}};

    // Q3 min-hold: the guaranteed minimum time the "Updating…" screen stays visible, shared by BOTH
    // update paths so they feel identical — the AUTO path gates its reload on it (makeUpdateReloadGate
    // below) and the manual Check-for-updates button waits it out before forceReloadLatest. Without a
    // hold, activating an already-waiting worker completes in tens of ms and the reload outraces
    // React's paint of the overlay — the owner never saw the screen (1s picked 2026-07-13).
    const MIN_UPDATING_MS=1000;

    // Q7: how long the manual applier waits for the service-worker handoff (controllerchange) before
    // giving up and reaching for forceReloadLatest. A FAILURE bound, not a display duration — the
    // Updating screen is up the whole time either way. Generous, because a slow phone finishing an
    // install at 6s is a real success and cutting it off would wipe the offline copy for nothing;
    // the auto path's own 4s net is shorter because there it only ever activates an ALREADY
    // downloaded worker, while this one may still be fetching the new build.
    const UPDATE_HANDOFF_MS=8000;

    // makeUpdateReloadGate (pure, exported for tests) — the AUTO update path's reload gate: reload()
    // fires only when BOTH the SW handoff (controllerchange, or the 4s safety timeout — either calls
    // onHandoff) AND the armed MIN_UPDATING_MS visible hold have completed, and at most ONCE. The
    // hold is a plain setTimeout, never rAF — background-tab rAF throttling could park the callback
    // and hang the reload forever. cancel() clears the hold timer AND marks the gate dead (wired to
    // the update effect's cleanup) so a torn-down gate can never fire a stray reload — not even via
    // a late onHandoff after the hold already elapsed.
    const makeUpdateReloadGate=({minHoldMs,reload}:{minHoldMs:number;reload:()=>void})=>{
      let handoff=false,held=false,reloaded=false;
      let holdId: number|undefined;
      const tryReload=()=>{if(handoff&&held&&!reloaded){reloaded=true;reload();}};
      return{
        armHold:()=>{holdId=window.setTimeout(()=>{held=true;tryReload();},minHoldMs);},
        onHandoff:()=>{handoff=true;tryReload();},
        cancel:()=>{reloaded=true;if(holdId!==undefined)window.clearTimeout(holdId);},
      };
    };

    // Pure (exported for tests): how much longer #boot must stay up. The splash needs ≥500ms of
    // VISIBLE time or a fast cached load flashes it for a frame, which reads as a glitch — and
    // visible time starts at the __bootShownAt stamp, NOT at navigation start (the old bug:
    // `500 - performance.now()` clamps to 0 whenever React mounts >500ms after navigation — i.e. on
    // every real network / SW cold boot — so the splash flashed exactly where it mattered). A
    // missing stamp (inline script failed/stripped) holds the full 500ms from now: the safe direction.
    // skipHold (the consumed cg-skip-boot-hold flag — the boot right after an update, auto OR the
    // manual Check-for-updates reload; both paths stamp it) drops the
    // artificial hold entirely: remaining=0, the splash stays only for the real boot work.
    const bootHoldRemaining=(shownAt:number|undefined,now:number,skipHold=false)=>skipHold?0:shownAt===undefined?500:Math.max(500-(now-shownAt),0);

    // BootOverlay -> src/components/BootOverlay.tsx, imported at top (and re-exported at the bottom of
    // this file, which is how tests/bootFlowDriver.dom reaches it). BOOT_TRACE_ANIMATED — the flag that
    // parks the animated trace, Backlog B2 — is a module-private const INSIDE that same file: not
    // imported here, not exported, not re-exported. Flip it there.

    // RotateOverlay -> src/components/RotateOverlay.tsx, imported at top.

    // makeDedPuzzle -> src/lib/dedPuzzle.ts, imported at top.

    // StatPanel → src/components/StatPanel.jsx. NOT imported here: App shows no stats of its own.
    // Rendered by all five mode screens.

    // CustomSelect → src/components/CustomSelect.jsx, imported at top.

    // AoxMode -> src/modes/AoxMode.tsx, imported at top.

    // ClassicMode -> src/modes/ClassicMode.tsx, imported at top.

    // FlashMode -> src/modes/FlashMode.tsx, imported at top.

    // BlitzBestRow -> src/components/BlitzBestRow.tsx. NOT imported here: modes/BlitzMode is its only
    // consumer.

    // BlitzMode -> src/modes/BlitzMode.tsx, imported at top.

    // DeductionMode -> src/modes/DeductionMode.tsx, imported at top.

    // ============================================================
    // DefaultsCard -> src/components/DefaultsCard.tsx. No longer used here at all: its two
    // callers (the Save Defaults popup and the defaults manager) went to
    // components/SettingsPanel, and the contract prose that used to sit here went into that
    // card's own header, where it is next to the code it describes.
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
      // The preset switcher's wrapper, and it exists for exactly one reason: the ⚙ click-outside
      // handler below has to treat a press on that trigger as "inside", the same way it treats the
      // mode selector's. components/PresetSwitcher makes the prop REQUIRED so this cannot be
      // forgotten at a call site; the two refs are separate because the two controls are separate
      // regions — a single "any select in the bar" ref would have to be an array or a class lookup,
      // and neither is clearer than naming the two things that exist.
      const presetSelectRef=useRef<HTMLDivElement | null>(null);
      const [systemIsDark,setSystemIsDark]=useState(()=>typeof window!=="undefined"?window.matchMedia("(prefers-color-scheme: dark)").matches:true);
      // ⚙ Settings store (Stage C, Step 5a). ★ THE COUNT, AND WHICH SET IT COUNTS — three different
      // numbers live in this area and conflating them is how the old comments went wrong:
      //   15 = the settings the ⚙ store HOLDS AND PERSISTS (store/settings SETTINGS_DEFAULTS, and
      //        therefore PERSISTED_KEYS). App binds all 15 as values below: it needs every one for
      //        settingsAtDefaults, and several again for date generation, the mode props and the
      //        title-bar mark.
      //    3 = the store FUNCTIONS App binds — setMinY, setMaxY (they feed the year-range mirrors
      //        below) and applySettings (Reset Settings / Full Reset write all 15 in one shot). The
      //        other twelve per-value setters are NOT bound here: the only writer of a settings
      //        value is the panel, and components/SettingsPanel selects its own.
      //   19 = a different set entirely, and NOT what any of this judges — the Save Defaults
      //        SNAPSHOT (those 15 + the 4 capturable mode prefs). It is counted at resetSettings
      //        below, alongside how many of the 19 the gear actually compares.
      // The Year Range boxes' two TEXT MIRRORS are in none of those counts: they stay App state, in
      // components/useYearRangeMirrors (called below) — they are not settings, they are what the
      // user is currently typing, and they deliberately disagree with the store until it commits.
      // Each value is selected individually so a component re-renders only when the
      // specific value it reads changes (Zustand selector subscriptions).
      const useSystem=useSettings(s=>s.useSystem);
      const darkTheme=useSettings(s=>s.darkTheme);
      const lightTheme=useSettings(s=>s.lightTheme);
      const manualTheme=useSettings(s=>s.manualTheme);
      const minY=useSettings(s=>s.minY),setMinY=useSettings(s=>s.setMinY);
      const maxY=useSettings(s=>s.maxY),setMaxY=useSettings(s=>s.setMaxY);
      const useJulian=useSettings(s=>s.useJulian);
      const saveStats=useSettings(s=>s.saveStats);
      const dateFormat=useSettings(s=>s.dateFormat);
      const randomFormat=useSettings(s=>s.randomFormat);
      const inputStyle=useSettings(s=>s.inputStyle);
      const rotateDots=useSettings(s=>s.rotateDots);
      // The raw derivation — passed to the four weekday mode screens (and, through them, to
      // WeekdayAnswer), which only ever consult it while inputStyle is already 'dots' (they render
      // no other branch that reads it), so no additional gate belongs here. The top bar's mark needs
      // a STRICTER one — see its own call site below — and computes that separately rather than
      // reusing this name for two different meanings.
      const dotOrientation=dotOrientationFor(rotateDots);
      const leapChance=useSettings(s=>s.leapChance);
      const janFebChance=useSettings(s=>s.janFebChance);
      const julianChance=useSettings(s=>s.julianChance);
      const applySettingsStore=useSettings(s=>s.applySettings);
      // Personal defaults (Q7 Save Defaults): `saved` is the user's snapshot (null = none). The
      // EFFECTIVE defaults derived from it feed Reset Settings, Full Reset, settingsAtDefaults,
      // and the gear's "modified" indicator; the mode components read their own slices for their
      // freshness checks. Survives Full Reset by design (see store/userDefaults).
      const savedDefaults=useUserDefaults(s=>s.saved);
      const defSettings=useMemo(()=>effectiveSettingsDefaults(savedDefaults),[savedDefaults]);
      const defPrefs=useMemo(()=>effectivePrefDefaults(savedDefaults),[savedDefaults]);
      // prefsAtDefaults: do the four capturable mode-screen prefs match their effective defaults?
      // A BOOLEAN zustand selector, so App re-renders only when the answer FLIPS — a slider drag
      // in Flash/Blitz never re-renders App per tick.
      const prefsAtDefaults=useModePrefs(s=>prefsMatchDefaults(s,defPrefs));
      const applyModePrefs=useModePrefs(s=>s.applyPrefs);

      const activeTheme=useSystem?(systemIsDark?darkTheme:lightTheme):manualTheme;
      useEffect(()=>{const mq=window.matchMedia("(prefers-color-scheme: dark)");const h=(e: MediaQueryListEvent)=>setSystemIsDark(e.matches);mq.addEventListener("change",h);return()=>mq.removeEventListener("change",h);},[]);
      useEffect(()=>{
        document.documentElement.setAttribute("data-theme",activeTheme);
        const tc=getComputedStyle(document.documentElement).getPropertyValue("--tc").trim();
        const meta=document.querySelector("meta[name='theme-color']");
        if(meta&&tc)(meta as HTMLMetaElement).content=tc;
        // Keep <html>'s background in step too: index.html's boot script stamped the saved theme's
        // color on it so no pre-stylesheet frame ever paints white — without a re-stamp a runtime
        // theme switch would leave the document canvas (what iOS shows on overscroll) at the stale
        // boot color. tc is '' before the stylesheet applies (tests/dev first pass) → keep the stamp.
        if(tc)document.documentElement.style.background=tc;
      },[activeTheme]);
      // Q11 portrait lock, the non-Android half: the manifest's orientation:'portrait'
      // (vite.config.js webManifest) hard-locks installs only on Android, so on every platform
      // that ignores it (iOS foremost) App covers a sideways screen with RotateOverlay. Gate =
      // ALL of: a touch device (isTouch — desktop windows are never blocked), CSS landscape, and
      // a SHORT viewport (max-height 500px: only phone-in-landscape heights match — iPad
      // landscape is ≥768px tall, so tablets stay free; ~500 also clears the tallest phone
      // landscape, 440px-class, with margin). One combined media query so a single change
      // listener tracks rotation in both directions; the same boolean pauses the countdown
      // modes via clockPaused (an accidental mid-round rotation must not burn the clock behind
      // the overlay). Deliberately NOT the startup-image path — those stay portrait-only; the
      // overlay takes over after first paint.
      const [landscapeBlocked,setLandscapeBlocked]=useState(false);
      useEffect(()=>{
        if(!isTouch)return;
        const mq=window.matchMedia("(orientation: landscape) and (max-height: 500px)");
        const h=()=>setLandscapeBlocked(mq.matches);
        h();   // launched already-sideways → blocked from the first commit
        mq.addEventListener("change",h);
        return()=>mq.removeEventListener("change",h);
      },[]);
      // minY/maxY now from the settings store (bound at top of App). The two transient TEXT MIRRORS
      // that back the Year Range boxes -> components/useYearRangeMirrors, called further down
      // (beside where their commits used to sit, so the two sync effects keep their exact position
      // in App's effect order). They stay App state, not panel state, so a half-typed year survives
      // closing and reopening the panel — see that module's header. The two element refs stay
      // App-side useRefs, exactly like settingsPopoverRef: the panel attaches them, the hook's two
      // focus guards read them, and nothing else touches them.
      const minInputRef=useRef<HTMLInputElement | null>(null),maxInputRef=useRef<HTMLInputElement | null>(null);
      // Lookup history persists across reloads (Stage D1), and since Q1 (round 20) is SHARED across
      // every preset instead of living inside the progress store: sourced from store/lookupHistory's
      // two stores instead of local useState. lookupHistory is the PERMANENT shared list;
      // sessionLookupEntries is this browsing session's overflow for lookups made while the ACTIVE
      // preset was amnesic at the moment they were added (never written to the permanent list — see
      // pushLookupHistory below) — displayLookupHistory (declared further down, once fmtDate/dateFormat
      // are in scope) is the two merged for LookupCard to render. Both setters accept a direct value
      // OR a functional updater, so the push/move/clear handlers below read exactly like they did
      // when there was one list.
      const lookupHistory=useLookupHistory(s=>s.history);
      const setLookupHistory=useLookupHistory(s=>s.setHistory);
      const sessionLookupEntries=useLookupSession(s=>s.sessionEntries);
      const setSessionLookupEntries=useLookupSession(s=>s.setSessionEntries);
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
      // appScrollRef container below it. We measure the bar's border-box height here and
      // write it to a CSS custom property (--bar-h) on the document root; the scroll
      // container reads it via padding-top:var(--bar-h) so its content starts below
      // the bar instead of being covered by it. ResizeObserver fires on initial mount
      // and any time the bar's height changes (e.g., mode switch flips pb-2.5 in
      // guide mode vs none in game modes, or content reflows). Writing to a CSS
      // variable instead of JS-applying padding directly keeps the styling
      // declarative and avoids React state churn for a value that's not part of
      // application logic. syncBarHeight is the ONE writer of the variable, shared with the
      // scroll-ownership effect below: on a mode change the bar's height and the guide's scroll
      // range change in the SAME commit, and a ResizeObserver callback lands only after every
      // layout effect has run — so a scroll restore that trusted the observer would clamp against
      // a scroller 10px too short. Calling it directly reads the post-commit truth (the rect read
      // forces layout), which is why it's a callback rather than a closure inside the effect.
      // ⚠ THE THREE EFFECTS BELOW ARE ONE ORDERED CHAIN, and the order is the declaration order:
      // React runs layout effects top-down, so this one measures the bar, the scroll-ownership
      // effect positions against a document sized by that measurement, and the edge-indicator
      // effect evaluates against the position that left. All three are LAYOUT effects for the same
      // reason — a passive one anywhere in the chain runs after the whole chain and after paint,
      // which is one wrong frame. That is why this is useLayoutEffect and not useEffect: as a
      // passive effect it landed AFTER the edge evaluation, which then measured the first frame of
      // every cold start against index.css's placeholder --bar-h:57px.
      // ⚠ SUB-PIXEL PRECISION (round 10) — the measure is getBoundingClientRect().height, NOT
      // offsetHeight. offsetHeight is specified to return a ROUNDED INTEGER: on the owner's device
      // the bar is really 71.765625px tall and offsetHeight reported 72, so --bar-h — and with it
      // everything positioned from --bar-h — sat 0.234px too low. That was the whole of the
      // hairline he reported in How to Play (a faint line of the PREVIOUS panel's bottom border
      // touching the bar with no gap, gone after scrolling a hair further). SEVEN readers share
      // this one token and every one of them sharpens at once:
      //   1. --seat-top (index.css) — the accordion's reading line, --bar-h + one panel gap.
      //   2. scroll-padding-top on that same rule — the native scrollport seat (Tab to a header).
      //   3. .doc-fade-top's top offset — where the guide's top feather starts.
      //   4. the app scroller's paddingTop below — where its content starts. Padding on a scroll
      //      box lives INSIDE the box, so this reader feeds that scroller's own scrollHeight and
      //      therefore its scroll range. (Until round 13 the guide released the clamps and this
      //      same padding fed the DOCUMENT's height instead; one scroller now, one meaning.)
      //   5. the settings popover's max-height calc.
      //   6. CustomSelect's open dropdown, which WATCHES this property: its trigger is in the bar,
      //      so a change here means the trigger moved and the fixed panel must re-measure.
      //   7. GuidePage's seat ladder, last rung (--seat-top → scroll-padding-top → --bar-h).
      // Reader 3 is the structural one, and the reason this fix is a guarantee rather than a hope
      // about how a given renderer rounds: with an exact --bar-h the feather begins EXACTLY where
      // the bar ends, so it covers anything that could still bleed through. At 0.234px low there
      // was a band painted by neither the bar nor the fade.
      // ⚠ getBoundingClientRect() is TRANSFORM-AWARE — it reports the VISUAL box. The bar carries
      // no transform today and must not gain one: a scale on the bar would silently corrupt all
      // seven readers at once (animate a child instead).
      // ⚠ Do NOT "modernise" this into ResizeObserver's borderBoxSize (fractional too): this
      // callback is ALSO invoked directly from the mode-change layout effect below, where there is
      // no observer entry to read, so a rect read is needed regardless — and two sources for one
      // number is exactly the drift the ONE-writer note above exists to prevent.
      // HTMLElement, not HTMLDivElement: the bar is a <header> since the wordmark came out (the
      // banner landmark now carries the naming job the visible <h1> used to — see the bar's markup).
      // Nothing else about this changes: getBoundingClientRect and writeShade are both HTMLElement.
      const htpStickyBarRef=useRef<HTMLElement | null>(null);
      const syncBarHeight=useCallback(()=>{const el=htpStickyBarRef.current;if(el)document.documentElement.style.setProperty('--bar-h',`${el.getBoundingClientRect().height}px`);},[]);
      useLayoutEffect(()=>{
        const el=htpStickyBarRef.current;if(!el)return;
        syncBarHeight();
        // Mounted once ([] via the stable callback), so it catches every LATER height change —
        // a font/safe-area shift, a reflow. A mode change is not one of those: it lands in the
        // same commit as the scroll work below, which is why that effect re-syncs directly.
        const ro=new ResizeObserver(syncBarHeight);
        ro.observe(el);
        return()=>ro.disconnect();
      },[syncBarHeight]);
      // ★ ONE SCROLLER, EVERY SCREEN (round 13) — and this is the REVERSAL of rounds 7-12, so the
      // whole trade is written out here rather than inferred from what is missing.
      //
      // WHAT WAS TRADED AWAY, AND WHY IT WAS. iOS's tap-the-status-bar-to-scroll-to-top targets the
      // ROOT scroller exclusively: an inner overflow-y div can never receive it, WebKit sets
      // scrollsToTop = NO on every overflow scroller it creates, and no JS event exists to
      // intercept the tap — so it cannot be detected, polyfilled or faked. Round 7 bought that one
      // affordance for How to Play by stamping <html data-doc-scroll> in guide mode and releasing
      // the app's three scroll clamps, so the DOCUMENT scrolled the guide while every other screen
      // kept the locked fit-to-screen box.
      //
      // WHAT IT COST, which is what reversed it. The mode selector lives in the fixed bar, and on
      // the owner's iPhone it would not open on the first tap while the page was still coasting
      // from a flung scroll — two separate designs were shipped at that, both PASSING in Chromium
      // and both FAILING on the device. He then established the fix himself, unprompted, by
      // testing the app's OTHER scrollers: "if I do a big scroll in the inner scrollable region
      // then lift my finger then press the mode selector while the inner part is still scrolling,
      // the selector opens first try while the inner region finishes scrolling." An inner scroller
      // coasting under a fixed bar does not fight a tap on that bar; a coasting DOCUMENT does.
      // So the guide moves onto #appScroll on the same terms as every other screen.
      //
      // ⚠ THE PRICE, ACCEPTED KNOWINGLY BY THE OWNER — do not try to soften it, and do NOT build a
      // replacement. Tap-the-status-bar-to-scroll-to-top is gone on How to Play, permanently and
      // for the structural reason above. He was offered a substitute affordance and declined it.
      // Safari's URL bar also stops collapsing on that page, because the document no longer
      // scrolls; also accepted, also not fixable from here. If either comes up again, the answer is
      // "yes, that is the deal we made", not a patch.
      //
      // What the reversal SIMPLIFIES is most of the rest of this section: one scroller means one
      // listener, one evaluate(), one scroll-position language, one set of edge arithmetic, and no
      // <html> attribute to keep in step with a React state. It also makes the app's hard
      // no-pull-to-refresh guarantee structural rather than conditional — see index.css.
      const appScrollRef=useRef<HTMLDivElement | null>(null);
      // The guide's two fixed soft edges (index.css .doc-fade-*), refs so the edge effect below can
      // write their --shade. Mounted for the whole of guide mode now that their strength is
      // continuous — a strip at --shade 0 paints nothing, so there is no on/off left to render.
      const docFadeTopRef=useRef<HTMLDivElement | null>(null);
      const docFadeBottomRef=useRef<HTMLDivElement | null>(null);
      // The container's two mask fades, as state CLASSES (fade-scroll-*, index.css) — so unlike the
      // continuous --shade the boundaries read, these genuinely need booleans. They are pinned OFF
      // for the whole of guide mode by the one evaluate() below, which is what keeps the guide's
      // soft edges the progressive doc-fade strips and not a feather that snaps on and off. Two
      // consequences, both wanted: the strips stay the only progressive fade in the app, and
      // scrolling How to Play sets no React state at all (React bails on a write of the value
      // already held), which is the point on the app's one long reading page.
      const [appAtBottom,setAppAtBottom]=useState(true);
      const [appScrolledFromTop,setAppScrolledFromTop]=useState(false);
      // The guide's reading position, in the scroll container's own scrollTop units — the app's
      // ONLY per-mode scroll memory (the game modes always open at their own top; only the guide is
      // a reading page). A ref because nothing renders from it, and deliberately NOT persisted
      // anywhere: a refresh or a cold start opens Classic with a fresh ref and a fresh GuidePage,
      // which is the whole of "a new launch starts at the top with every panel closed".
      const guideScrollYRef=useRef(0);
      // saveReadingPosRef — how switchMode below takes that reading, and the answer to "what
      // replaces the attribute test?". It holds a closure, installed by the scroll-ownership effect
      // for exactly as long as the guide is the screen on show, that copies the live scroller's
      // scrollTop into guideScrollYRef; it is null the rest of the time.
      // ⚠ IT IS NOT A MODE MIRROR, and that is the whole point. The old gate could ask <html> a
      // question that WAS the mechanism — "is the document the scroller right now" — so it could
      // not disagree with reality. With one shared scroller that question is gone, and the honest
      // replacement is not `mode==='guide'` (switchMode is declared with [] deps because it needs
      // nothing from render — two refs and a stable setter — so a `mode` read inside it would be
      // frozen at the FIRST render's value forever; the stable identity is a bonus that spares the
      // keydown effect a re-subscribe per render, not the reason) nor a boolean ref
      // shadowing the mode (a second copy of a fact, i.e. a thing that can drift). A closure that
      // only EXISTS while the guide is up cannot drift: its lifetime is React's own effect cleanup,
      // it is published by the one effect that already owns the guide's position, and it closes
      // over the very element it reads, so it stays right even if the scroller's node changes.
      const saveReadingPosRef=useRef<(()=>void) | null>(null);
      // switchMode — the ONE door every mode change goes through. It exists to take the guide's
      // scroll reading at the only moment the number can be trusted: synchronously inside the
      // event that switches the mode, BEFORE React re-renders and hides the guide. Read it one
      // commit later — from an effect cleanup, the obvious place — and the guide is already
      // display:none, an element with no layout and therefore a scrollTop of 0, so the reader
      // silently loses their place; jsdom lays nothing out, so no test could ever catch that by
      // accident (tests/docScroll.dom forces the point). Hence a door rather than a guard. That
      // hazard did NOT go away with the document scroller — it sharpened: a re-clamped document
      // collapsed to a screenful and clamped its offset to ~0, while a hidden div is at a flat 0.
      // [] deps because it needs nothing from render: a ref call and a stable setter. The stable
      // identity that falls out of that is what keeps the keydown effect from re-subscribing on
      // every render — a nicety, not a requirement (that effect only swaps one window listener).
      const switchMode=useCallback((next: SetStateAction<string>)=>{
        saveReadingPosRef.current?.();
        setMode(next);
      },[]);
      // Scroll ownership on a mode change — ONE effect, no second opinion. Every scroll position
      // the app sets when you switch screens is set here, on the one container every screen
      // scrolls, and the whole policy is two rules:
      //   • guide → RESTORE the reader's place (switchMode saved it on the way out). The write is
      //     clamped by the engine against the scroller's height, which is why the bar measure has
      //     to land first.
      //   • every other mode → TOP. Without it, leaving a scrolled screen would show the next mode
      //     from the middle.
      // syncBarHeight comes FIRST and applies to BOTH branches, because the bar's guide-only pb-2.5
      // makes a mode change a bar-height change in EITHER direction: entering, --bar-h feeds the
      // container's padding-top, which is INSIDE the scroll box and so part of its scrollHeight,
      // i.e. what the restored offset gets clamped against; leaving, a --bar-h left 10px too tall
      // pads the game screen it hands over to, and the edge-indicator effect below would read that
      // inflated scrollHeight and paint a bottom fade on a mode with nothing to scroll. The bar's
      // own ResizeObserver cannot cover either case — it fires after every layout effect has run,
      // i.e. a frame late.
      // FOCUS, guide only: the container is tabIndex −1 (see the JSX) and is focused on entry so
      // Space / PageDown / Home / End scroll the page immediately. A document scroller gave that
      // away free — the document is the default keyboard scroll target — and an overflow div does
      // not: without this, a desktop reader's first Space does nothing until they click into the
      // page. preventScroll because focus() is specified to scroll the target into view, and this
      // element's "into view" is the top of the very range the line above just restored.
      // It is the LAST focus write of the switch, deliberately: CustomSelect returns focus to its
      // trigger when an option is chosen, and it does so inside the click handler, i.e. before this
      // commit — so arriving at the guide from the mode menu still lands on the scroller. Nothing is
      // lost by taking it: Tab opens that menu from anywhere (a window-level shortcut), so the
      // trigger never needed to hold focus to stay reachable.
      // …AND IT IS GIVEN BACK ON THE WAY OUT, which is the half the focus write cannot be shipped
      // without. Focus is taken FOR the guide — it is what makes Space/PageDown scroll a reading
      // page — and every other screen is a form of controls where a scroll target holding focus is
      // simply wrong. Leaving it held also made the behaviour depend on which door the reader used:
      // through the mode menu CustomSelect's own focus restore takes it away as a side effect, but
      // H, the mode letters and Android Back do not, so one route left every game screen quietly
      // keyboard-scrollable and the other did not. blur() only when the container is the one holding
      // it, so a switch that has already parked focus somewhere real (the menu trigger) is untouched.
      // A LAYOUT effect so all of it happens before the browser paints the new mode. Nothing else
      // in the app moves this scroller on a mode change, which is what makes the restore safe —
      // there is no later effect left to overwrite it.
      useLayoutEffect(()=>{
        syncBarHeight();
        const el=appScrollRef.current;if(!el)return;
        if(mode!=="guide"){el.scrollTop=0;if(document.activeElement===el)el.blur();return;}
        el.scrollTop=guideScrollYRef.current;
        el.focus({preventScroll:true});
        saveReadingPosRef.current=()=>{guideScrollYRef.current=el.scrollTop;};
        return()=>{saveReadingPosRef.current=null;};
      },[mode,syncBarHeight]);
      // App-wide scroll-state tracking. ONE scroller, one listener, one evaluate() — since round 13
      // there is no second sourcing path to keep honest. It was two: the clamped container via its
      // own scroll event, and the guide's DOCUMENT via window scroll/resize reading
      // document.scrollingElement against window.innerHeight, each answering the same question a
      // different way (this file used to carry an apology for exactly that). Both are now the
      // container.
      // The listener is paired with observeScrollExtent (components/scrollRegion) on the same
      // element, because a scroll event answers only "where is the scroller" and the edge question
      // also asks "how much content is there" — see round 11 Q4 below.
      // What it drives, in two languages (round 10 item B):
      //   • CONTINUOUS — the bar's boundary shadow, and in guide mode the two doc-fade strips, all
      //     via the 0…1 --shade written straight onto those elements. Strength is a function of
      //     position, so a stopped scroller is already at its final value, which is what killed the
      //     shadow that used to linger after the page had stopped dead.
      //   • BOOLEAN — the container's own fade-scroll-* masks, which are state classes and so still
      //     need appScrolledFromTop / appAtBottom.
      // ★ THE ONE PLACE THE GUIDE IS STILL DIFFERENT, and it is deliberate: in guide mode the two
      // booleans are pinned to their no-mask values inside evaluate() rather than computed. The
      // guide's edges are the PROGRESSIVE strips; letting the boolean masks paint the same two
      // edges as well would put a feather that snaps on at 4px of overflow on top of one that
      // ramps — reverting round 10 on the single page it was built for, while every shipped test
      // name kept passing. Pinning them here rather than branching the className is what makes that
      // one fact do both jobs: the masks stay off, AND entering the guide RESETS whatever the game
      // screen left in those booleans (React then bails on every identical write, so a scrolling
      // guide re-renders nothing).
      // The arithmetic is NOT written out here: scrollEdgeGaps and its two predicates
      // (components/scrollRegion) are the one owner of "how far is this scroller from its edges",
      // shared with useScrollEdgeState, so the shadow and the mask can never answer differently.
      // What stays bespoke is only that this screen has THREE shade surfaces (bar + two strips) and
      // a mode-dependent boolean, which the shared hook's two-surface shape does not cover; the
      // inner regions (popover, changelog, lookup, the defaults card) go through it.
      // Defaults: appAtBottom true / appScrolledFromTop false (no indicators on first
      // paint before scroll state is evaluated). The listener runs on every mode change
      // so it re-evaluates against new content and picks up the strips as they mount.
      // A LAYOUT effect, and the LAST of the three declared above, so React runs it third: the
      // first evaluate() of a mode therefore measures a bar already re-synced and a position
      // already applied, and the indicators are right on the FIRST painted frame. As a passive
      // effect it would evaluate after the paint, so returning to a scrolled guide flashed one
      // frame with no bar shadow and no top fade.
      useLayoutEffect(()=>{
        const rampPx=readShadeRampPx();
        // One writer for every boundary this screen owns; a ref that isn't mounted is skipped.
        const paint=(scrollTop:number,scrollHeight:number,clientHeight:number)=>{
          const gaps=scrollEdgeGaps(scrollTop,scrollHeight,clientHeight);
          const top=edgeShade(gaps.top,0,rampPx);
          writeShade(htpStickyBarRef.current,top);
          writeShade(docFadeTopRef.current,top);
          writeShade(docFadeBottomRef.current,edgeShade(gaps.bottom,BOTTOM_EDGE_BAND_PX,rampPx));
          return gaps;
        };
        // Same rule as scrollRegion's no-scroller path: a boundary surface with no scroller to
        // track must REST at 0, never at @property's initial 1. Unreachable today (the container
        // renders unconditionally) and kept anyway, because the twin of this hole in Lookup was a
        // live full-strength-shadow bug on every cold start of a fresh install — a shape that is
        // only ever noticed once, and cheaper to make impossible than to re-notice.
        const el=appScrollRef.current;if(!el){paint(0,0,0);return;}
        // ROUND 11 Q4 — the container is handed to observeScrollExtent rather than watched with a
        // plain ResizeObserver, because it is the thing the CONTENT hangs off. `absolute inset-0`
        // pins its own box to the viewport BY CONSTRUCTION, so an observer on the box alone was
        // watching the one number no content change can move, and every mask froze the moment
        // content changed without a scroll (open Show Codes while resting at the top and the bottom
        // fade kept the answer from before it opened). The helper reaches the one child, the
        // mode-content wrapper, whose height IS this scroller's scrollHeight.
        // ⚠ It is what covers the guide's accordion, which is the same freeze wearing the other
        // face: a toggle changes the content height and produces NO scroll event at all (a tap that
        // seats an already-seated panel scrolls nowhere, and the panel keeps growing for the rest
        // of its animation after the glide's last scroll event).
        // The observer fires once per animation FRAME while content is transitioning — that is the
        // point (the indicators track a panel opening instead of snapping after it) and it costs
        // nothing on the frames that move no boundary: writeShade skips an unchanged number and
        // React bails on a setState to the value already held, so those frames re-render nothing.
        // tests/scrollExtent.dom pins the whole contract, fixtures included.
        const guide=mode==="guide";
        const evaluate=()=>{
          const gaps=paint(el.scrollTop,el.scrollHeight,el.clientHeight);
          // Pinned, not computed, in guide mode — see the ★ note above.
          setAppAtBottom(guide||isAtBottom(gaps));
          setAppScrolledFromTop(!guide&&isScrolledFromTop(gaps));
        };
        evaluate();
        el.addEventListener('scroll',evaluate,{passive:true});
        const stopExtent=observeScrollExtent(el,evaluate);
        return()=>{el.removeEventListener('scroll',evaluate);stopExtent();};
      },[mode]);
      // Root-scroll invariant on MOUNT and on BFCache restore — nothing else. The division of
      // labour, stated explicitly because this effect used to overreach (Q6, round 8):
      //   • the scroll-ownership layout effect above owns the position on a mode switch (restore
      //     for the guide, top for everything else), and fullReset owns it on a reset (it zeroes
      //     the scroller inline, and clears the guide's saved position with it).
      //   • THIS effect owns the load-time invariant, and since round 13 that is TWO writes, not
      //     one write plus belt-and-braces. The app mounts in Classic (the current tab is never
      //     persisted, so a cold start or refresh ALWAYS lands there) and html/body/#root are
      //     clamped in every mode now, so a non-zero ROOT scrollTop would permanently offset the
      //     fixed layout — the original concern, unchanged.
      //     ⚠ `appScrollRef.current.scrollTop=0` IS NOW LOAD-BEARING — do not trim it as the
      //     defence-in-depth it used to be. History scroll restoration on a reload replays the
      //     offsets the last session left, and the surface a reader could actually have scrolled is
      //     no longer the document (which can no longer move at all): it is this container. A
      //     reload from a scrolled How to Play hands its offset straight back, into a fresh
      //     instance that is showing CLASSIC from the top — i.e. a game screen scrolled to a
      //     position that belongs to a page it is not showing. Zeroing it here is the whole of
      //     "a fresh load starts at the top".
      //     rAF + setTimeout because iOS Safari applies that restoration AFTER the event fires.
      //     window/documentElement/body are still reset alongside (body has overflow:hidden so it
      //     cannot scroll, but a restore might try anyway).
      //   • A BFCACHE RESTORE (event.persisted) IS SKIPPED ENTIRELY (Q3, round 11) — the opposite
      //     case, and the reason the gate exists. `pageshow` fires for both a genuine load and a
      //     back-forward-cache restore, and a restore is not a navigation: the JS heap is kept
      //     alive, so the app comes back in the SAME mode with the SAME DOM it left. Whatever
      //     scroll offset the browser hands back is therefore the one that belongs to this layout
      //     — the reader's place in the guide, the player's place on a long game screen — and
      //     zeroing it is pure loss. That is exactly the mistake round 8
      //     removed from visibilitychange (come back, lose your place in How to Play), surviving
      //     in a second event; round 9 then built the guide's position preservation on top of it.
      //     The invariant above is untouched by the gate: a restore cannot smuggle in a stale
      //     offset, because the mode that produced it is the mode being restored.
      //   • BACKGROUNDING NOW MOVES NOTHING — a deliberate behaviour CHANGE (Q6, round 8), not a
      //     tidy-up. There was a visibilitychange→reset listener here calling this same reset(),
      //     which zeroes the inner scroller too: switching apps and coming back jumped you to the
      //     top of whatever you were reading. That was invisible for a long time only because the
      //     clamped modes rarely overflow, and round-7's guide doc-scroll made it unmissable ("come
      //     back, lose your place in How to Play"). Removed rather than special-cased to the guide:
      //     foregrounding an app is not a navigation, the browser runs no scroll restoration for
      //     it, so there was never a root-scroll invariant for this listener to defend — in EVERY
      //     mode. The guide's in-flight scroll writer is cancelled when the app is backgrounded
      //     by GuidePage itself, which is where that concern belongs.
      useEffect(()=>{const reset=()=>{window.scrollTo(0,0);if(document.documentElement.scrollTop!==0)document.documentElement.scrollTop=0;if(document.body.scrollTop!==0)document.body.scrollTop=0;if(appScrollRef.current)appScrollRef.current.scrollTop=0;};const onPageShow=(e: PageTransitionEvent)=>{if(e.persisted)return;reset();requestAnimationFrame(reset);setTimeout(reset,0);};reset();window.addEventListener('pageshow',onPageShow);return()=>{window.removeEventListener('pageshow',onPageShow);};},[]);
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
      // Q3: the "Updating…" overlay (BootOverlay updating) — three triggers: the Settings "Check for
      // updates" button raises it once a check has FOUND something (Q7's applier below — never on a
      // press that turns out to have nothing to get), the auto-update-on-open effect below shows it
      // for at least MIN_UPDATING_MS while a WAITING new version activates (both cleared by their
      // reload), and the Q2 build-change flash effect shows it for exactly that hold — no reload —
      // when a boot detects an update that already landed silently (cleared by its own hold-end).
      const [updating,setUpdating]=useState(false);
      // Q3 Loading screen: remove index.html's #boot splash once BOTH are true —
      //   • it has been VISIBLE ≥0.5s (bootHoldRemaining, anchored to the __bootShownAt rAF stamp — not
      //     navigation start), so a fast cached load doesn't flash it for a single frame (which read
      //     like a glitch); on a slow load it has already served its time → the hold clamps to 0; and
      //     the boot right after an update — auto OR the manual Check-for-updates reload, BOTH stamp
      //     the one-time cg-skip-boot-hold flag, consumed here — skips the hold entirely (the user
      //     just watched the Updating screen ≥1s, so the splash shows only as long as the real boot
      //     takes);
      //   • the real stylesheet has APPLIED — the build swaps the render-blocking CSS <link> into a
      //     preload (vite.config.js bootCssPreload) so the splash can be the page's first paint, and
      //     the swap stamps window.__cssReady + fires 'app-css-ready'. Removing #boot before then would
      //     reveal an unstyled app: the module script is NOT CSSOM-blocked (it precedes the link), so on
      //     a SW-cached load React commits before the CSS lands. In dev/tests no preload link exists
      //     (CSS arrives through the JS module graph before mount) → the querySelector check is ready.
      // When an update-overlay path below has claimed the handoff (updateEngagedRef — the auto-update
      // flow or the Q2 build-change flash), finish leaves #boot alone — the Updating overlay replaces
      // it (the updating effect), never a frame with neither.
      const updateEngagedRef=useRef(false);
      // The raw consumed cg-skip-boot-hold value, written by the boot-hold effect below (which owns
      // the flag's one-per-boot consumption) and read by the Q2 build-change flash effect after it —
      // same-kind effects run in declaration order, so the write is always ahead of the read.
      const skipHoldConsumedRef=useRef(false);
      // Set by the auto-update flow's engage(): a gated reload is coming (success or the safety net),
      // so the Updating overlay must stay up until that navigation — the Q2 flash's hold-end checks
      // this before revealing the app (the rare same-boot overlap: a freshly-downloaded new build
      // AND an even newer version already waiting).
      const updateReloadPendingRef=useRef(false);
      // ══ Q7 (round 11): "Check for updates" ACTUALLY CHECKS ═══════════════════════════════════
      // It used to show the Updating screen and run forceReloadLatest unconditionally — claiming an
      // update on every press and destroying the offline copy even on the presses where nothing had
      // changed. Now it asks first. The feature is three parts and App owns exactly one of them:
      //   • THE DETECTOR (why it is a build-identity file and not a fetch with cache:'reload', not
      //     DEPLOY_TS, not registration.update()) — documented at length in lib/updateCheck.ts.
      //   • THE INTERACTION (the button's state machine, its 3s result window and the
      //     abort-on-close) — components/useUpdateCheck.ts, called by App below. ★ It must keep
      //     being called by APP: its abort-on-close is a useSettingsCloseEffect, which never fires
      //     for a caller that unmounts when the panel closes — the rule is stated in full at the top
      //     of that file, and the suite cannot enforce it.
      //   • THE APPLIER — applyUpdate, right here, because it is App's machinery end to end:
      //     setUpdating (the Updating overlay), updateReloadPendingRef (shared with the Q2
      //     build-change flash below), makeUpdateReloadGate, markSkipBootHold and forceReloadLatest.
      //     It is TERMINAL: every route out of it navigates.
      //
      // The applier reuses the auto-update path wholesale: SKIP_WAITING to the waiting worker, one
      // reload through makeUpdateReloadGate so the MIN_UPDATING_MS visible hold is honoured and the
      // reload fires at most once, and markSkipBootHold so the boot it causes doesn't stack a second
      // artificial splash hold. That KEEPS THE OFFLINE COPY, which the old unconditional
      // forceReloadLatest destroyed every time.
      // forceReloadLatest is still reachable, and deliberately — but be exact about WHEN, because
      // the round-7 class is not it. It fires from inside this applier and nowhere else, on the two
      // ways the gentle path can fail to deliver what the check promised: no registration to hand
      // off to at all, or no controllerchange within UPDATE_HANDOFF_MS. Having promised an update,
      // the button must produce one.
      // The round-7 class — an asset whose bytes changed while its precache revision did not, which
      // Workbox will never re-download — is now handled a step earlier and better: Q10b's
      // scripts/precacheIntegrity.mjs FAILS THE BUILD unless every revision in dist/sw.js is the
      // md5 of the file actually shipped, so such a build cannot exist to be installed. A client
      // still carrying one from round 7 is cured by the next deploy through this same gentle path
      // (its cached revision is the stale one, the new manifest carries the true md5, so Workbox
      // does re-download). What no client-side button can cure is an edge serving wrong bytes for a
      // correct revision: the check's own fetch would be served the same stale bytes and say "up to
      // date". That is a server-side problem and belongs to the deploy, not to this button.
      const applyUpdate=useCallback((reg: ServiceWorkerRegistration|null)=>{
        updateReloadPendingRef.current=true; // the overlay is owned through to a navigation now
        setUpdating(true);
        // No service worker at all (unsupported, blocked, or a registration that failed — the state
        // Q10a now reports): there is nothing to hand off to, so the hammer IS the update path.
        if(!reg){window.setTimeout(forceReloadLatest,MIN_UPDATING_MS);return;}
        // `settled` = this applier is FINISHED — it has either navigated (the gate's reload) or given
        // up (the handoff deadline below, which hands over to forceReloadLatest). Nothing it started
        // still matters after that, and one thing actively harms: reg.update() may still be in flight
        // when forceReloadLatest unregisters the worker, and the browser then rejects it with
        // InvalidStateError — an error the app MANUFACTURED by abandoning the operation, reported as
        // if the update had failed on its own. So the deadline marks the applier settled first, and
        // everything the applier still owns (the report below, the SKIP_WAITING handoff, the
        // controllerchange listener) is torn down or suppressed against that one flag.
        let settled=false;
        const gate=makeUpdateReloadGate({minHoldMs:MIN_UPDATING_MS,reload:()=>{settled=true;markSkipBootHold();window.location.reload();}});
        gate.armHold();
        const onControllerChange=()=>gate.onHandoff();
        navigator.serviceWorker.addEventListener('controllerchange',onControllerChange,{once:true});
        const handOff=(w: ServiceWorker|null|undefined)=>{if(w&&!settled)w.postMessage({type:'SKIP_WAITING'});};
        // A worker already parked in `waiting` is the update — messaging it directly is the whole
        // job. Only when there is none do we go to the network, and update() is used here as the
        // APPLIER it is: it fetches + installs, and the new worker arrives as `waiting` (or as
        // `installing` we then wait out). A resolved update() that produces neither is the failed
        // install reproduced in the Q7 research; the safety net below covers it.
        if(reg.waiting)handOff(reg.waiting);
        else reg.update().then(()=>{
          if(reg.waiting){handOff(reg.waiting);return;}
          const installing=reg.installing;
          if(installing)installing.addEventListener('statechange',()=>{if(installing.state==='installed')handOff(reg.waiting??installing);});
        }).catch(err=>{if(!settled)captureError(err,{where:'update-apply'});});
        window.setTimeout(()=>{if(settled)return;settled=true;navigator.serviceWorker.removeEventListener('controllerchange',onControllerChange);gate.cancel();forceReloadLatest();},UPDATE_HANDOFF_MS);
      },[]);
      // The button's state machine + its abort-on-close (components/useUpdateCheck). The two values
      // it returns are the Check-for-updates control's whole surface: `updateCheck` IS the label and
      // the disabled/underlined state, and `onCheckUpdates` is the press. Called HERE and nowhere
      // else — see the caller rule in that file.
      const {updateCheck,onCheckUpdates}=useUpdateCheck(settingsOpen,applyUpdate);
      useEffect(()=>{
        let disposed=false;
        let cssFallbackId: number | undefined;
        const finish=()=>{if(!disposed&&!updateEngagedRef.current)dismissBootSplash();};
        // Consume the skip flag unconditionally (it must never linger) and share the raw value with
        // the Q2 build-change flash effect below via skipHoldConsumedRef (its silent-restamp
        // suppression), but only HONOR it for the hold when no update attempt is pending: on the
        // safety-retry boot (worker still waiting, attempts>0) the 500ms hold is what covers the
        // async getRegistration→updateEngagedRef claim — skipping it there could reveal the app for
        // a few frames before the Updating overlay paints.
        const skippedHold=consumeSkipBootHold();
        skipHoldConsumedRef.current=skippedHold;
        const id=window.setTimeout(()=>{
          if(disposed)return;
          if(appCssApplied())finish();
          else{
            window.addEventListener('app-css-ready',finish,{once:true});
            // Escape hatch (the css twin of the SW path's safety timeout): if the preload link fires
            // neither onload nor onerror — rel=preload unsupported, or an extension stripped the inline
            // handlers — nothing would EVER signal readiness and the splash would sit up forever. After
            // 4s, do exactly what the link's own onload does: swap it to a live stylesheet, stamp
            // __cssReady, fire 'app-css-ready' (which runs finish above and also unblocks the
            // auto-update path's css gate).
            cssFallbackId=window.setTimeout(()=>{
              if(disposed||appCssApplied())return;
              const link=document.querySelector('link[rel="preload"][as="style"]') as HTMLLinkElement | null;
              if(link)link.rel='stylesheet';
              window.__cssReady=true;
              window.dispatchEvent(new Event('app-css-ready'));
            },4000);
          }
        },bootHoldRemaining(window.__bootShownAt,performance.now(),skippedHold&&readUpdateAttempts()===0));
        return ()=>{disposed=true;window.clearTimeout(id);if(cssFallbackId!==undefined)window.clearTimeout(cssFallbackId);window.removeEventListener('app-css-ready',finish);};
      },[]);
      // Q3 auto-update-on-open: in PRODUCTION only, register the SW (src/sw.ts, DYNAMICALLY imported so
      // the registration never runs in dev/tests and its chunk never loads there; registering also kicks off src/sw.ts's
      // background registration.update() prefetch) and — IN PARALLEL, since this check needs only the
      // browser's registration, never that module — look for a new version that installed on a previous
      // visit and is WAITING. If one is: claim the #boot handoff, wait for the css-ready gate the normal
      // boot path enforces (the Updating overlay is styled by the real stylesheet — entering sooner would
      // paint it unstyled), show the Updating screen (the updating effect below removes #boot AFTER the
      // overlay commits), message the waiting worker DIRECTLY ({type:'SKIP_WAITING'} — a handler the
      // generateSW worker ships natively, so unlike any handle src/sw.ts could hand back this cannot race
      // the register module's own registration and no-op), and reload exactly ONCE through the reload
      // gate (makeUpdateReloadGate): only after BOTH the SW handoff (controllerchange — which can also
      // fire for unrelated SW handoffs, hence the gate's one-shot guard — or the 4s safety net) AND the
      // MIN_UPDATING_MS visible hold, so the Updating screen always registers (activating an
      // already-waiting worker takes tens of ms, and an ungated reload outraces the overlay's paint —
      // the owner never saw the screen). The gate's reload also stamps cg-skip-boot-hold, so the boot
      // it triggers skips the splash's artificial 500ms hold — the full flow: logo → Updating ≥1s →
      // reload → the splash shows only as long as the real boot takes → the app. Cold-open only — NO
      // resume/focus re-check (owner's call). All SW behaviour is on-device. This flow only covers an
      // update still WAITING at boot; the other half — one whose activation completed BETWEEN
      // sessions, so nothing is waiting here — is the Q2 build-change flash effect below. The whole flow is wrapped
      // in the sessionStorage attempt counter (the loop breaker — see readUpdateAttempts): after 2
      // straight failed attempts the flow is SKIPPED, the counter cleared, and the app renders on the
      // old version instead of looping Updating→reload forever.
      // Q10a (round 11) — BOTH ways the registration can fail now REPORT instead of vanishing. The
      // dynamic import's rejection (the ./sw.js chunk itself failing to load) is captured below, and
      // the registration call's own failure is captured inside src/sw.ts via onRegisterError. Either
      // one leaves the app running with NO service worker — no offline copy, no update path, and
      // (before this) nothing anywhere saying so: an agent hit exactly that state in July 2026 and it
      // was invisible. These are the two halves because they fail independently — the chunk can load
      // and register() still be rejected (an unsupported scope, a blocked SW, a 404 on sw.js).
      useEffect(()=>{
        if(!import.meta.env.PROD||typeof navigator==='undefined'||!('serviceWorker' in navigator))return;
        let cancelled=false;
        let engageOnCss: (()=>void) | null=null;
        let gate: ReturnType<typeof makeUpdateReloadGate> | null=null;
        // Held so the cleanup can DETACH it: {once:true} only removes a listener that actually fired,
        // and the whole point of the 4s safety net is that controllerchange may never arrive at all.
        // Without both halves this effect leaks a live listener onto navigator.serviceWorker — a
        // global that outlives the component — holding its gate and closure alive for the page's life.
        let onControllerChange: (()=>void) | null=null;
        import('./sw.js').catch(err=>captureError(err,{where:'sw-module-import'})); // Q10a: never swallowed — a chunk that won't load means NO service worker at all (see the note above)
        navigator.serviceWorker.getRegistration().then(reg=>{
          if(cancelled)return;
          const waiting=reg?.waiting;
          if(!waiting){clearUpdateAttempts();return;} // nothing waiting — a healthy boot resets the loop breaker
          const attempts=readUpdateAttempts();
          if(attempts>=2){
            // Loop breaker tripped: two consecutive attempts already failed (SKIP_WAITING is broken /
            // the waiting worker can't take control). Do NOT re-enter the Updating flow — clear the
            // counter and boot normally on the OLD version (sw.ts's background update() may still
            // repair the waiting worker for a later launch, and Check for updates stays reachable).
            clearUpdateAttempts();
            return;
          }
          updateEngagedRef.current=true; // claim the #boot handoff NOW, before the css gate — the normal boot effect must not remove the splash while the overlay is still pending
          const engage=()=>{
            if(cancelled)return;
            writeUpdateAttempts(attempts+1);
            updateReloadPendingRef.current=true; // the overlay is now owned through to this flow's reload — the Q2 flash's hold-end must not drop it
            setUpdating(true); // #boot comes down only after this commits (the updating effect below)
            // The reload gate (armed now, released by whichever handoff arrives): both the success
            // reload and the safety reload go through it, so both honor the min-hold, fire at most
            // once, and stamp the next boot's splash skip just before navigating away.
            gate=makeUpdateReloadGate({minHoldMs:MIN_UPDATING_MS,reload:()=>{markSkipBootHold();window.location.reload();}});
            gate.armHold();
            onControllerChange=()=>{clearUpdateAttempts();gate?.onHandoff();};
            navigator.serviceWorker.addEventListener('controllerchange',onControllerChange,{once:true}); // success — reset the loop breaker, then the gated one-shot reload. {once:true} costs nothing: the gate is already one-shot, so only the FIRST controllerchange has ever done anything
            waiting.postMessage({type:'SKIP_WAITING'});
            // Safety net: if activation never fires controllerchange (skipWaiting failed), don't leave the
            // Updating screen stuck — a PLAIN reload after a few seconds (the old worker serves the old app
            // again; the update retries next launch). NEVER forceReloadLatest here: it wipes every cache,
            // and offline that bricks the app — the manual Check-for-updates button keeps that big hammer.
            // The attempt counter deliberately SURVIVES this reload (sessionStorage) — that's what limits
            // the retry to two rounds via the >=2 check above. (At 4s the min-hold is long done, so this
            // handoff reloads immediately through the gate.)
            window.setTimeout(()=>{if(!cancelled)gate?.onHandoff();},4000);
          };
          if(appCssApplied())engage();
          else{engageOnCss=engage;window.addEventListener('app-css-ready',engage,{once:true});}
        }).catch(()=>{});
        return ()=>{cancelled=true;gate?.cancel();if(engageOnCss)window.removeEventListener('app-css-ready',engageOnCss);if(onControllerChange)navigator.serviceWorker.removeEventListener('controllerchange',onControllerChange);};
      },[]);
      // Q2 (round 6): the cold-open build-change "Updating" flash — the visible signal for updates
      // that land SILENTLY, with nothing waiting for the auto flow above to bridge. The primary case:
      // closing the app releases the old worker's last client, the browser completes the waiting
      // worker's activation in the background, and the next open is already the new version (an
      // evicted Safari tab's fresh download reads the same). Detection is the plain-localStorage
      // build stamp (lib/buildStamp): every boot compares the stored stamp against this build's
      // DEPLOY_TS and then RESTAMPS — the one detection per boot, and where everything else that
      // reacts to a build change (the Q6 update-signal dots) hooks in. On a mismatch the SAME
      // Updating screen holds for MIN_UPDATING_MS — no reload; hold-end reveals the app — under the
      // auto flow's exact discipline: claim the #boot handoff synchronously (the boot-hold effect
      // must leave the splash to the overlay), engage only once the real stylesheet has applied
      // (appCssApplied / app-css-ready — an unstyled Updating frame must never paint), and let the
      // updating effect below take #boot down only after the overlay commits. Two boots restamp
      // SILENTLY, with no screen: the first-ever visit (no stamp — nothing to announce) and the boot
      // right after the REAL Updating flow (skipHoldConsumedRef — that flow already showed the
      // screen ≥1s and its reload lands on a changed stamp by definition; without this suppression
      // every real update would be chased by a second screen back-to-back, the exact thing the owner
      // ruled out). If the auto flow engages during the hold (an even newer version already
      // waiting), hold-end defers to its reload (updateReloadPendingRef) instead of revealing the
      // app for a moment before the navigation.
      // The two update-signal dots (Q6) ARE the PERSISTED flags (src/changelog), read live rather
      // than mirrored: the detection below marks the GEAR flag on every build change and the CHANGELOG
      // flag only when the newest entry actually changed (2026-08-10), opening Settings
      // retires the gear's (toggleSettings, immediately below), and the first tap on the footer's
      // Changelog link retires the link's — the two-stage breadcrumb to the changelog popup.
      // Declared HERE, above the effect that sets them.
      // ★ READ STRAIGHT FROM THE PERSISTED FLAGS — no React state, deliberately. These were two
      // useStates seeded from the flags and re-synced by setGearDot/setChangelogDot calls inside
      // effects, which is react-hooks/set-state-in-effect and a cascading render: commit → effect →
      // setState → commit again. The flags in src/changelog were always the source of truth and the
      // state was always just a copy, so the copy is gone. markUpdateDot/clearUpdateDot notify, and
      // these two re-render — the same UI, one commit earlier, with no setState anywhere.
      // The snapshot getters are module-scope constants (readGearDot / readChangelogDot, declared
      // beside appCssApplied at the top of this file) so their identity is stable across renders.
      const gearDot=useSyncExternalStore(subscribeUpdateDot,readGearDot);
      const changelogDot=useSyncExternalStore(subscribeUpdateDot,readChangelogDot);
      // THE ONE WAY TO OPEN SETTINGS, and the only place the gear's update dot (Q6) is retired.
      // ★ WHY THIS IS A CALLBACK AND NOT AN EFFECT. The retirement used to be
      // `useEffect(()=>{if(settingsOpen&&gearDot){clearUpdateDot(…);setGearDot(false);}},[settingsOpen,gearDot])`,
      // which is a setState run synchronously inside an effect body — react-hooks/set-state-in-effect,
      // and a real cascading render (open the panel → commit → effect → setState → commit again).
      // The fix cannot go the other way and put the localStorage write in render: render must stay
      // pure. So the retirement moves to the EVENT that causes it. Opening is the trigger; an effect
      // watching the resulting state was only ever an indirect way of observing that event.
      //
      // ★ WHY A SHARED CALLBACK. setSettingsOpen has 11 call sites, but 8 pass a literal `false`
      // (mode keys, H, outside-click, Esc, drag-dismiss, fullReset, the Back button, the mode
      // selector) and cannot open. The 3 that CAN open are all toggles — the gear's onPointerDown,
      // the gear's onClick, and the G shortcut — and a toggle does not know which way it is going.
      // Computing `opening` here once, in one place all three share, is what makes "retire only when
      // opening" expressible at all.
      //
      // ★ WHY IT SETS A VALUE INSTEAD OF `v=>!v`. Because `opening` has to be computed ONCE and
      // then used twice — to decide the retirement and to set the state — and that is the whole
      // reason. It is behaviour-neutral: the gear carries BOTH onPointerDown and onClick (pointer
      // presses toggle on press; the click is kept for keyboard and tests, and lib/pointerGestures
      // suppresses the real one) and exactly one of them fires per interaction today.
      // ⚠ AND IT IS NOT A DOUBLE-FIRE SAFETY NET — an earlier draft of this comment claimed it was,
      // and that claim was FALSE. A browser delivers pointerdown and click as separate tasks, so
      // React commits between them and the click reads the handler rebuilt against the ALREADY-OPEN
      // state: `opening` recomputes to false and the panel shuts, exactly as `v=>!v` would. The two
      // forms differ only when both land inside ONE React batch, which is not how the browser
      // sequences them. If double-fire safety is ever actually wanted it needs a form that reads the
      // LIVE value at call time; this is not that, and must not be trusted as if it were.
      //
      // ⚠ ONE BRANCH OF THE OLD EFFECT IS INTENTIONALLY NOT CARRIED OVER: its `gearDot` dep ALSO
      // retired a dot that lit WHILE the panel was already open. That branch was dead under the OLD
      // model — gearDot was React state that only this file's mount effect could move, and that
      // effect runs while settingsOpen is still its initial false.
      // ★ IT IS NOT DEAD ANY MORE, AND THE READ ABOVE IS WHAT CHANGED THAT. gearDot is now
      // useSyncExternalStore over readGearDot, which re-reads localStorage on every render — and
      // localStorage is shared across TABS. A second tab of the app detecting the same build change
      // writes the flag; this tab picks it up on its next render for any reason, with no
      // notification needed. So a dot CAN now light with the panel open, and with the retirement
      // living only in toggleSettings it then stays lit until the panel is closed and reopened.
      // ACCEPTED AS A COSMETIC GAP, deliberately: closing it means an effect watching
      // [settingsOpen,gearDot] that writes storage, i.e. reinstating the cascading render this round
      // removed, to shorten by one panel-cycle a stale breadcrumb in a two-tab session. The live
      // read WIDENS this gap rather than closing it — do not repeat the old "markUpdateDot has two
      // callers, both mount-only" argument, which reasons about THIS tab and no longer settles it.
      const toggleSettings=useCallback(()=>{
        const opening=!settingsOpen;
        if(opening&&gearDot)clearUpdateDot(GEAR_DOT_KEY); // notifies → the dot re-reads false
        setSettingsOpen(opening);
      },[settingsOpen,gearDot]);
      useEffect(()=>{
        const current=DEPLOY_TS.toISOString();
        const changed=buildChanged(readBuildStamp(),current);
        writeBuildStamp(current); // restamp on EVERY boot — the stamp always names the build that last ran
        // ══ THE TWO DOTS NO LONGER FIRE TOGETHER (2026-08-10, the owner's observation) ═══════════
        // They mean different things, and only one of them is true on every build change:
        //   • THE GEAR DOT = "the app updated". True whenever the build changed, so it is marked
        //     unconditionally here — including on a build the real Updating flow just bridged (the
        //     skip-hold boot below suppresses only the SCREEN). ★ It STAYS that way deliberately:
        //     the Updating screen has already fired by this point and cannot be suppressed, since
        //     this same detection cannot tell a typo fix from a redesign. Dropping the gear dot
        //     would leave the app announcing an update and then acting as though nothing happened.
        //   • THE CHANGELOG DOT = "there is something new to READ", which is NOT implied by a build
        //     change. It used to be marked on the same line, and the comment that stood here claimed
        //     "the changelog still has news either way" — which was false, and v2.21.1 proved it:
        //     an internal deploy on a day whose entry already stated the day's net effect adds no
        //     line at all (rule 13's fallback sentence is a fallback, never an addition), so every
        //     player holding v2.21.0 got a breadcrumb leading to something they had already read.
        // The comparison itself, the migration case and why the newest entry ALONE is the right
        // thing to compare all live in changelog.ts beside CHANGELOG_SEEN_KEY.
        //
        // Restamped on EVERY boot, exactly like the build stamp above, so the stored value always
        // names what this device last saw. Computed BEFORE the write, or it would always match.
        const seenNow=changelogSignature(CHANGELOG);
        const unread=changelogChanged(readChangelogSeen(),seenNow);
        writeChangelogSeen(seenNow);
        // Marking the PERSISTED flags is all that is needed: both dots read them through
        // useSyncExternalStore (see their declarations above), so markUpdateDot notifies and
        // re-renders them. There is no React state left to mirror into — which is exactly why this
        // effect no longer trips react-hooks/set-state-in-effect.
        if(changed){markUpdateDot(GEAR_DOT_KEY);if(unread)markUpdateDot(CHANGELOG_DOT_KEY);}
        if(!changed||skipHoldConsumedRef.current)return;
        updateEngagedRef.current=true; // claim the #boot handoff NOW — the splash hands off to the overlay, never to the app
        let cancelled=false;
        let holdId: number | undefined;
        let engageOnCss: (()=>void) | null=null;
        const engage=()=>{
          if(cancelled)return;
          setUpdating(true); // #boot comes down only after this commits (the updating effect below)
          holdId=window.setTimeout(()=>{if(!updateReloadPendingRef.current)setUpdating(false);},MIN_UPDATING_MS);
        };
        if(appCssApplied())engage();
        else{engageOnCss=engage;window.addEventListener('app-css-ready',engage,{once:true});}
        return()=>{cancelled=true;if(holdId!==undefined)window.clearTimeout(holdId);if(engageOnCss)window.removeEventListener('app-css-ready',engageOnCss);};
      },[]);
      // The update paths' #boot handoff (paired with updateEngagedRef above — the auto-update flow
      // and the Q2 build-change flash): remove the splash only AFTER the Updating overlay has
      // COMMITTED — effects run post-commit, so by now the overlay is in the DOM and there is never
      // a frame with neither splash nor overlay. A no-op for the manual Check-for-updates trigger
      // (#boot is long gone by then; dismissBootSplash is idempotent).
      useEffect(()=>{if(updating)dismissBootSplash();},[updating]);
      useEffect(()=>{const onKey=(e: KeyboardEvent)=>{
        if(e.repeat||e.isComposing)return;
        // ★★ WHAT AN OPEN MODAL BLOCKS, AND WHAT IT DELIBERATELY DOES NOT — the whole rule, in one
        // place, because it is exactly one line different for each half and the difference is the
        // point. A modal is up ⇒ the page underneath is INERT (components/modalContract), so the two
        // categories that REACH INTO that page bail: Category 1's answer grid and Category 2's
        // [data-key] DOM walk both find a live button under the scrim and CLICK it. That is not
        // theoretical — it shipped: Blitz with Allow Mistakes off, answer wrong, tap the stat strip
        // to open the round breakdown, press O, and the walk clicked Override behind the scrim,
        // resumed the finished round and reverted its provisional Best. The run breakdown is what
        // made it reachable, being the first modal to sit over a LIVE GAME SCREEN rather than over
        // the settings panel; the bail used to live in the Tab branch alone.
        // ⚠ CATEGORY 3 STAYS LIVE, and that is a DECISION with two tests standing on it, not an
        // oversight. The mode letters, H and G do not operate the page underneath — they REPLACE
        // what is on screen, and every modal goes with it: the four ⚙ popups are children of the
        // panel these shortcuts close (tests/settingsPanel.defaults — "G, and a mode letter, close
        // the modal and the panel together and discard the pending snapshot"), and the run
        // breakdown's own availability is gated on its mode screen being VISIBLE for exactly this
        // reason (modes/AoxMode, tests/runBreakdown "leaving the mode takes the popup with it").
        // Gating them would take a documented escape hatch away and leave a card that can only be
        // dismissed by the controls under the finger.
        // The scrim's trap already stopPropagation()s presses inside the modal's own tree; this
        // covers presses that start outside it. Asked lazily — one DOM query, and only for a press
        // that has already turned out to belong to one of the two gated categories.
        const modalUp=()=>!!document.querySelector('[data-settings-modal]');
        // Tab: toggle the mode selector dropdown. Plain Tab only — Ctrl+Tab, Ctrl+Shift+Tab,
        // Shift+Tab, Alt+Tab all pass through to the browser. Works universally, including
        // when an input is focused (Esc/Enter already blur inputs, so the standard "leave
        // this input" role of Tab is unneeded). focus() before click() so the dropdown's
        // arrow-nav handler (handleTriggerKeyDown on the trigger) sees subsequent keys.
        if(e.key==='Tab'){
          if(e.ctrlKey||e.metaKey||e.altKey||e.shiftKey)return;
          // An open modal owns Tab while it is up (its scrim's focus trap) — opening the mode
          // dropdown behind an aria-modal dialog would break the modal contract.
          if(modalUp())return;
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
        // Category 1: 0–9 → answer grid — GATED, it clicks a button on the page underneath
        if(k>='0'&&k<='9'){
          if(modalUp())return;
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
        // Category 3a: mode switching — direct switchMode (no DOM button per mode)
        const MODE_KEYS: Record<string, string>={K:'classic',F:'flash',B:'blitz',A:'aox',D:'deduction',L:'lookup'};
        if(MODE_KEYS[dataKey]){e.preventDefault();switchMode(MODE_KEYS[dataKey]);setSettingsOpen(false);return;}
        // Category 3b: H — toggle to/from guide, preserving previous non-guide mode
        if(dataKey==='H'){e.preventDefault();switchMode(m=>m==='guide'?(prevNonGuideModeRef.current||'classic'):'guide');setSettingsOpen(false);return;}
        // Category 3c: G — toggle settings popover
        if(dataKey==='G'){e.preventDefault();toggleSettings();return;}
        // Category 2: data-key DOM walk for game-loop letters and arrows — GATED for the same
        // reason as Category 1, and it is the one that shipped the bug (Override, through a scrim).
        if(modalUp())return;
        const tagged=document.querySelectorAll<HTMLElement>(`[data-key="${dataKey}"]`);
        for(const btn of tagged){
          if(btn.tagName!=='BUTTON')continue;
          if(btn.offsetParent===null)continue;
          if(btn.className.includes('pointer-events-none'))continue;
          e.preventDefault();
          btn.click();
          return;
        }
      };window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[switchMode,toggleSettings]);
      // Q4: install the global press-drag-release input controller (slide-off-to-cancel on every button
      // + answer-grid drag-to-select). One set of document pointer listeners; cleanup on unmount.
      useEffect(()=>installPointerGestures(),[]);
      // Round 18: the other app-wide input rule, installed the same way — entering any box you can
      // type into highlights everything already in it, so typing replaces the value rather than
      // appending to it. One set of document listeners for every one of them; lib/textEntry argues why
      // it is delegated rather than six onFocus props, and why the tap path needs three events.
      useEffect(()=>installSelectAllOnEntry(),[]);
      // The Year Range boxes' text state, their refs, their two commits and their two focus-guarded
      // store→text sync effects — one unit, in components/useYearRangeMirrors. Called HERE rather
      // than up beside the store bindings so those two effects keep the exact ordinal position in
      // App's effect order that they had when they were written out on these lines.
      const yearRange=useYearRangeMirrors(minY,maxY,setMinY,setMaxY,minInputRef,maxInputRef);
      // Newest to the front, capped — the rule and its number live in store/lookupHistory (addLookupEntry).
      // ⚠ WHICH LIST an entry joins is decided HERE, once, at the moment it is added — the identical
      // shape as fullReset's own `selectAmnesic(usePresets.getState())` check below. While the ACTIVE
      // preset is amnesic the entry goes into the SESSION overflow instead of the permanent list, so
      // it can never reach permanent storage; it still shows on screen for the rest of this browsing
      // session via displayLookupHistory (below), and it can never be promoted into the permanent list
      // later — turning Amnesic off does not reach back and adopt it, the same "no merge on toggle-
      // off" rule store/amnesic states for stats. See store/lookupHistory's header for the full
      // argument for why this is a separate mechanism from Amnesic's own per-preset session stats.
      const pushLookupHistory=(entry: LookupEntry)=>{
        if(selectAmnesic(usePresets.getState()))setSessionLookupEntries(prev=>addLookupEntry(prev,entry));
        else setLookupHistory(prev=>addLookupEntry(prev,entry));
      };
      // Re-asking a question you already have moves it to the front of WHICHEVER list it lives in —
      // the session overflow if it was added while amnesic, the permanent list otherwise. It can
      // never jump lists: a session entry re-asked while still amnesic stays a session entry.
      const moveHistoryEntryToTop=(id: string)=>{
        if(sessionLookupEntries.some(e=>e.id===id))setSessionLookupEntries(prev=>moveEntryToTop(prev,id));
        else setLookupHistory(prev=>moveEntryToTop(prev,id));
      };
      // Clear History is a direct, manual, whole-list request from whoever is looking at the screen
      // right now — it wipes everything CURRENTLY ON SCREEN, both buckets. Full Reset reaches for
      // this SAME function (see fullReset below) rather than duplicating the two-bucket clear.
      const clearLookupHistory=()=>{setLookupHistory([]);setSessionLookupEntries([]);};
      // What LookupCard actually renders — the permanent list with this session's amnesic overflow
      // merged in front of it (store/lookupHistory's mergeForDisplay; see pushLookupHistory above for
      // why a session entry never reaches `lookupHistory` itself).
      const displayLookupHistory=mergeForDisplay(lookupHistory,sessionLookupEntries);
      // Date format / randomFormat / leapChance / janFebChance / julianChance now from the
      // settings store (bound at top of App). Semantics unchanged:
      //   dateFormat: 'written-mdy'|'written-dmy'|'numeric-mdy'|'numeric-dmy'|'numeric-ymd'.
      //   randomFormat overrides the selected format for game-mode dates only (Lookup + DEPLOY_TS ignore it).
      //   leap/janFeb/julianChance: Option-A date-generation biases (apply to all game modes; Lookup unaffected).
      //   julianChance's picker is locked when useJulian is off OR the year range is all-Gregorian
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
      // The Full Reset two-tap machine and all five settings modals (their open flags, cards,
      // pending snapshots, openers, commits, capture-phase Escape handlers, focus-on-open effects
      // and Android-Back registrations) moved WHOLE into components/SettingsPanel. Their lifetime
      // is the panel's open state, and the panel now unmounts on close — so unmounting IS the
      // discard, and the five "close the popup when settings closes" effects that used to live
      // here are gone with them rather than reimplemented. App keeps only what the GEAR needs.
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
      // ditto for GuidePage, whose one piece of state is the open panel (Q6, round 9 — it joined
      // the always-mounted screens so that panel, and the reading position, survive a detour into
      // a game mode; Full Reset is the one thing that must still close it).
      const [guideResetKey,setGuideResetKey]=useState(0);
      // ★★ THROW AWAY EVERYTHING THE SIX ALWAYS-MOUNTED SCREENS ARE HOLDING. Bumping the six keys
      // above remounts them, so every useState/useRef in each one runs its initializer again and
      // re-reads the stores as they are NOW. The two App-owned transients that belong to those
      // screens rather than to App go with them: Lookup's five (its history lives in
      // store/lookupHistory, so lookupSelectedHistoryId names an entry in whatever the store held a
      // moment ago) and the guide's saved reading offset (captured against a panel that is about to
      // be closed).
      // ⚠ TWO CALLERS, AND THAT IS THE WHOLE POINT OF EXTRACTING IT. Full Reset has always done
      // this; a PRESET SWITCH is structurally a second Full Reset and must do exactly the same
      // discard, or the outgoing preset's run keeps playing on the incoming preset's data — the
      // 500-cards-becomes-4 bug (store/presetControl's switchPreset argues it in full). A second
      // hand-written copy of the six bumps is one forgotten line away from that bug, silently, on
      // whichever screen was missed.
      // ⚠ WHAT IT DELIBERATELY DOES **NOT** TOUCH: the settings/progress/modePrefs stores (Full
      // Reset resets those separately and BEFORE calling here, so the modes re-hydrate from the
      // emptied store; a switch must not, or it would wipe the preset it just opened), and the
      // current mode. Which mode you are on is App state belonging to no preset — no store has ever
      // held a "last mode" — so a switch leaves the player where they were, on a fresh screen.
      // useCallback with an empty dep list: every setter it closes over is a useState setter or a
      // ref, all stable for the life of the mount, so the registry subscription below can hold this
      // identity without re-subscribing on every render.
      const remountScreens=useCallback(()=>{
        setLookupInput("");setLookupOutput("");
        setLookupCalcDate(null);setLookupSelectedHistoryId(null);setLookupCalcOpen(false);
        setAoxResetKey(k=>k+1);
        setClassicResetKey(k=>k+1);
        setFlashResetKey(k=>k+1);
        setBlitzResetKey(k=>k+1);
        setDeductionResetKey(k=>k+1);
        setGuideResetKey(k=>k+1);
        guideScrollYRef.current=0;
      },[]);
      // ★★ THE PRESET SWITCH'S REMOUNT, WIRED TO THE FACT RATHER THAN TO THE CALLER. Anything that
      // changes which DATA the app is reading — store/presetControl's switchPreset, deleting the
      // preset you are on, making the preset you are on amnesic, or whatever a later group adds —
      // lands here, because the one thing all of them have in common is that the bytes underneath
      // these six screens were swapped. presetControl therefore takes no remount callback: there is
      // nothing for a call site to forget.
      // ⚠ store.subscribe, NOT a useEffect on the value, and the difference is load-bearing. zustand
      // runs subscribers SYNCHRONOUSLY inside the set, i.e. BEFORE switchPreset rehydrates the four
      // stores — and React batches every update made in one turn (18+ auto-batching, in a handler or
      // out of one), so neither half renders until switchPreset has RETURNED. The key bumps and the
      // four store reloads therefore land in ONE commit, and the screens' mount-time reads
      // (getInitialStats and friends) see the incoming preset the first time they run. An effect
      // keyed on activeId would
      // run a commit LATER, leaving one render in which the stores hold the new preset while the
      // screens still hold the old one; that render is harmless only for as long as no mode
      // screen's stat-mirror effect happens to re-fire in it, which is a dependency array's
      // business and not a contract anyone signed.
      // ⚠ THE COMPARISON IS activeDataId AND NOT activeId — store/amnesic owns that expression, and
      // owning it there rather than spelling it out here is the point. It answers one question:
      // WHICH BYTES are underneath the always-mounted screens — which preset, and which of that
      // preset's two storage areas its stats live in. Making a preset amnesic repoints the progress
      // store at sessionStorage without activeId moving an inch, so an activeId-only comparison
      // would leave the screens holding the parked stats while the store held the session's, and
      // the next answered question would write one into the other: the same 500-cards-becomes-4
      // failure, reached by a different door. A third repointing added later extends that one
      // expression instead of this line.
      // ⚠ It still ignores everything ELSE in the registry: renaming or creating a preset, or
      // flipping some OTHER preset's amnesic flag, all rewrite the registry value and none of them
      // may throw away a run in progress.
      useEffect(()=>usePresets.subscribe((s,prev)=>{if(activeDataId(s)!==activeDataId(prev))remountScreens();}),[remountScreens]);
      // The two inner scroll regions the panel owns (its own list and the changelog popup's),
      // their useScrollEdgeState hooks, and the footer-button caption auto-fit with its dep-less
      // layout effect and its ResizeObserver -> components/SettingsPanel. Every one of them reads
      // or writes an element that only exists while the panel is open, so all of them belong to
      // the component that owns that DOM.
      // Settings popover click-outside handler. Closes settings when the user taps
      // anywhere outside FOUR regions: the gear button itself (settingsRef), the
      // popover content (settingsPopoverRef), and the two CustomSelect wrappers in
      // the bar — mode (modeSelectRef) and preset (presetSelectRef). The select
      // exclusions are what let the user open and pick from either dropdown without
      // the settings popover auto-closing on the same tap — taps inside a trigger or
      // its open dropdown panel are inside that wrapper's subtree and therefore
      // "inside" for this check.
      // ⚠ THE PRESET ONE IS NOT DECORATIVE SYMMETRY. Its trigger sits in the bar the ⚙ panel hangs
      // off, so without this clause the FIRST press on it would close the panel and the menu it
      // opened would be sitting over a bar that had just changed under the finger — the exact
      // failure the mode exclusion was added for. components/PresetSwitcher makes its wrapperRef a
      // required prop so a future mount cannot skip this line; tests/topBar.dom pins the behaviour.
      useEffect(()=>{if(!settingsOpen)return;const h=(e: MouseEvent | TouchEvent)=>{const target=e.target as Element | null;const inBtn=settingsRef.current&&settingsRef.current.contains(target);const inPop=settingsPopoverRef.current&&settingsPopoverRef.current.contains(target);const inSel=(modeSelectRef.current&&modeSelectRef.current.contains(target))||(presetSelectRef.current&&presetSelectRef.current.contains(target));
        // Mousedown on the browser scrollbar registers e.target as <html> on Windows. Ignore that
        // case so dragging the scrollbar doesn't close the popover.
        const onScrollbar=target===document.documentElement||target===document.body;
        if(onScrollbar)return;
        // An open CustomSelect dropdown panel portals out to #root with role="listbox", so a tap
        // on an option lands OUTSIDE the popover in the DOM. Treat that as "inside" so picking a
        // row doesn't slam the settings popover shut before the selection registers.
        // ⚠ THIS CLAUSE IS GENERIC ON PURPOSE, and that is exactly why mounting the preset
        // switcher required no edit to this line: it matches WHICHEVER select is open — the bar's
        // mode select or its preset select — instead of naming one by ref. (It used to read "the
        // bar's mode select, the app's last one since the theme selects became PillTray rows";
        // the top-bar rebuild put a second select in the bar and made that false.)
        // ⚠ WHAT IT DOES NOT COVER IS A CLOSED SELECT'S TRIGGER — there is no listbox in the DOM
        // to match yet, so the press that OPENS a menu is not caught here. That is the whole job
        // of the two wrapper refs above, one per select, and why neither is redundant with this.
        const inListbox=!!(target&&target.closest&&target.closest('[role="listbox"]'));
        // The settings modals (Save Defaults Q7 / the defaults manager Q12+Q5 / the Clear confirm
        // Q5 / Changelog Q6) portal to #root with a full-screen scrim — clicks on any (scrim
        // included) are "inside": a scrim tap cancels only the POPUP (its own onClick handler),
        // never the settings panel beneath it.
        const inModal=!!(target&&target.closest&&target.closest('[data-settings-modal]'));
        if(!inBtn&&!inPop&&!inSel&&!inListbox&&!inModal){
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
      // Escape closes the settings popover. It bails when a TEXT-ENTRY input has focus, because
      // those have Escape semantics of their own (since round 15 every one of them DISCARDS the
      // edit — the year boxes, the defaults card's N field, the tap-to-type slider readouts)
      // and this listener would otherwise double-handle the same press. The guard is deliberately
      // NOT "any INPUT": range sliders keep focus after an adjust and have no Escape semantics of
      // their own — bailing on them would leave Escape dead until something else got focus.
      // ⚠ THE GUARD IS NOT WHAT PROTECTS THE YEAR BOXES, and relying on it is exactly how they broke:
      // it asks what has focus, and their handler blurs the box synchronously, so by the time this
      // ran the answer was "nothing" and the panel closed mid-edit. They stopPropagation instead, so
      // this listener never sees their press at all — see the note beside them, which is now over in
      // components/SettingsPanel with the inputs. ⚠ THIS HANDLER STAYS HERE, on DOCUMENT and in the
      // BUBBLE phase, and both facts are what make that stopPropagation work.
      useEffect(()=>{if(!settingsOpen)return;const h=(e: KeyboardEvent)=>{if(e.key!=="Escape")return;const ae=document.activeElement as HTMLInputElement | null;if(ae&&ae.tagName==="INPUT"&&ae.type!=="range")return;e.preventDefault();setSettingsOpen(false);};document.addEventListener('keydown',h);return()=>document.removeEventListener('keydown',h);},[settingsOpen]);
      // Close-on-drag-activate (Q5 rework): the pointer controller dispatches a bubbling "drag-dismiss"
      // CustomEvent from a drag-clicked member of a data-drag-dismiss menu (lib/pointerGestures) — the
      // settings popover card is the only such menu. Closing here is exactly a normal close, so the
      // settings apply-on-close pass (useSettingsCloseEffect) fires naturally. Installed once; the ref
      // check scopes it to the popover, and it's a no-op while settings is already closed (no popover DOM).
      useEffect(()=>{const h=(e: Event)=>{const t=e.target as Element | null;if(t&&settingsPopoverRef.current&&settingsPopoverRef.current.contains(t))setSettingsOpen(false);};document.addEventListener('drag-dismiss',h);return()=>document.removeEventListener('drag-dismiss',h);},[]);
      // NOTE: the four "close the popup when settings closes" effects that used to sit here are
      // GONE, not moved. Every one of them existed to clear state whose owner now unmounts with the
      // panel (components/SettingsPanel), so unmounting performs the same discard in one commit
      // instead of four. Their only other consumers — the openers, commits and Back registrations —
      // went into that component with them.
      // The gear-dot retirement USED to live here, as an effect watching [settingsOpen,gearDot]. It
      // moved up to toggleSettings (declared beside gearDot) — see the reasoning there. Nothing
      // else retires it, so this is the only pointer you need.
      // Restores the settings the ⚙ panel owns — the 15 menu values + the 2 year-range text mirrors —
      // AND the four capturable mode-screen prefs (Flash speed, both Blitz timers, the AoX run length)
      // to their EFFECTIVE defaults: the user's saved personal defaults when they exist (Q7,
      // store/userDefaults), the factory launch values otherwise. This is the exact MIRROR of Save
      // Defaults, which copies the same 19-value unit the other way — live → the snapshot.
      // ★ 19 IS THE SNAPSHOT'S SIZE, NOT THE GEAR'S. Keep the two apart:
      //   19 RESTORED / SAVED = the 15 store settings + the 4 capturable prefs. (This restore also
      //      rewrites the 2 year-range text mirrors, which are stored nowhere and so have nothing to
      //      copy back — hence 21 written here, 19 in the snapshot.)
      //   20 or 19 COMPARED by the gear's "modified" bar: 12 plain settings + the 4 prefs + the
      //      theme trio judged BY WHAT IS IN EFFECT (2 of the three with Use System On —
      //      darkTheme/lightTheme; 1 with it Off — manualTheme) + the 2 year-range TEXT MIRRORS.
      //      The dormant theme value(s) — one with Use System On, TWO with it Off — are never
      //      compared; settingsAtDefaults below says why at length.
      // ⚠ SO IT IS NO LONGER A SUBSET OF THE 19, and round 15 is what changed that: the 2 mirrors
      // are compared but not saved. Nothing breaks, because this restore WRITES them (the resetTo
      // line below) even though the snapshot has nothing to write back — the 21-written / 19-saved
      // asymmetry above is exactly what keeps "one tap clears a lit gear" true for the two terms
      // that are compared and not stored.
      // One tap therefore still always clears a lit gear
      // whatever diverged (round-6 extension: it used to touch the panel alone, stranding a gear lit
      // only by a mode-screen pref). Still leaves the NON-capturable
      // mode config (Blitz Per-Round/Question, Allow Mistakes, One-by-One, the Deduction sub-type, the
      // show/hide stat toggles) and stats/history untouched — Full Reset (which additionally wipes stats
      // and remounts every mode) and Reset Stats own those. The mode-screen prefs restore straight into
      // the live store; an ACTIVE Blitz round or AoX run reconciles to the new config on the popover
      // close, exactly as a ⚙ panel change does (each mode's useSettingsCloseEffect now watches its own
      // timer/run-length too). Triggers the unified popover-settings effect, which regenerates the
      // current date as appropriate (Random Format / Date Format / Leap Chance are always-regen).
      const resetSettings=()=>{
        // The 15 store-held settings in one shot (store/settings applySettings), then the 2 transient
        // text mirrors that live locally, then the 4 capturable mode-screen prefs (store/modePrefs
        // applyPrefs — the same call Full Reset makes; the other mode-prefs keep their live values).
        applySettingsStore(defSettings);
        yearRange.resetTo(defSettings.minY,defSettings.maxY);
        applyModePrefs(defPrefs);
        // …and (round-20 Q4, owner's explicit, confirmed decision) the SAVED AMNESIC STATE, onto the
        // ACTIVE preset. setPresetAmnesic no-ops when the flag already matches; when it actually flips
        // it reloads all four per-preset stores (store/presetControl's reloadPresetStores), which is a
        // documented genuine no-op for the two of those four this function just wrote — useSettings
        // (applySettingsStore) and useModePrefs (applyModePrefs); it never touches useProgress or
        // useUserDefaults. Both writes persist SYNCHRONOUSLY on every set, so storage already holds
        // today's applySettingsStore/applyModePrefs values by the time that reload reads them back
        // (useProgress/useUserDefaults are simply untouched by this function, so their reload is a
        // no-op for the ordinary reason — nothing here changed them — not because of that guarantee).
        // ⚠ resetSettings is ALSO fullReset's delegate for the
        // ENTIRE settings restore (see the note above pressResetSettings), so this line means Full
        // Reset restores the saved Amnesic state too — not just the footer's own Reset Settings button.
        // That reading is deliberate, not incidental: it keeps this function's "total, unconditional
        // contract" intact rather than special-casing Amnesic out of Full Reset's path, and it cannot
        // resurrect anything either way — fullReset's own discardParkedStats call below re-reads
        // selectAmnesic AFTER this line runs, so it already accounts for whichever state this leaves
        // the preset in.
        setPresetAmnesic(usePresets.getState().activeId,effectiveAmnesicDefault(savedDefaults));
      };
      // ★ THE FOOTER BUTTON'S HANDLER, and the round-14 dimmed-button guard lives HERE rather than
      // inside resetSettings ON PURPOSE. resetSettings is also fullReset's delegate for the ENTIRE
      // settings restore, so it must keep its total, unconditional contract. Guarded inside instead,
      // Full Reset silently stopped restoring exactly the bytes "modified" is deliberately blind to
      // — a dormant theme value (Use System ON parks manualTheme; OFF parks darkTheme/lightTheme)
      // and the two year-box text mirrors — and no offer in the panel could have told the user, since
      // by construction none of them reads those. Pinned by the Full Reset dormant-theme case in
      // tests/settingsPanel.defaults.dom.
      // ⚠ THE GUARD IS NOW THE ONLY THING MAKING THE DIMMED BUTTON INERT, the same shape as
      // armFullReset's in the panel. Round 14 wrote it as defense in depth behind a
      // pointer-events-none className that stopped taps while CSS could not stop a keyboard; B7
      // (round 15) removed that className so the not-allowed cursor could paint at all — a
      // pointer-events:none element is never hit-tested — leaving this line to refuse the pointer,
      // the keyboard and an assistive-technology press alike (components/controlClasses'
      // NOT_OFFERED_BTN_CLASS records why). Without it a dimmed Reset Settings still rewrote the
      // year boxes' text and that dormant theme value.
      const pressResetSettings=()=>{if(!settingsModified)return;resetSettings();};
      // Retires the Changelog link's dot. The FLAG is App's — the build-stamp detection above
      // sets it, and the gear's twin lives beside it — but the only reader and the only retirer
      // are both in the panel, so the panel gets the boolean and this callback and never touches
      // storage itself. useCallback so a panel re-render is never caused by this identity.
      const retireChangelogDot=useCallback(()=>{clearUpdateDot(CHANGELOG_DOT_KEY);},[]); // notifies → the dot re-reads false
      // The five modals' openers, closers and commits (openSaveDefaults / openManageDefaults /
      // openChangelog / openPresets / commitSaveDefaults / commitManageDefaults /
      // confirmClearDefaults and their close callbacks) -> components/SettingsPanel, with the
      // state they drive.
      // Full Reset — back to the launch state, where "launch" honors the user's SAVED personal
      // defaults (Q7): the ⚙ panel and the four captured mode prefs restore to the
      // store/userDefaults snapshot when one exists, everything else to factory (and the snapshot
      // itself survives — clearing it is the Save Defaults popup's job, never Full Reset's).
      // The five always-mounted mode components own ALL
      // gameplay state (stats, history, run/round progress, config toggles, timers) and the sixth
      // always-mounted screen, How to Play, owns its open panel, so bumping their *ResetKey props
      // below remounts them and resets every per-screen value to its hook
      // default in the same render. App therefore only resets what IT owns: the current mode,
      // the ⚙ settings (delegated to resetSettings → the Zustand store, the 2 input mirrors, and
      // — since round-6 Q7 — the 4 capturable mode prefs), the Lookup state, and the scroll position.
      // Deliberately NOT a location.reload() — this stays the single source of truth for "back to
      // launch" as offline/profile state is added.
      const fullReset=()=>{
        prevNonGuideModeRef.current="classic";
        switchMode("classic");
        setSettingsOpen(false);
        setAppAtBottom(true);
        setAppScrolledFromTop(false);
        // Settings popover → EFFECTIVE defaults (15 store values incl. theme + the 2 transient
        // input mirrors — the user's saved personal defaults when present). Since round-6 Q7 this
        // ALSO applies the 4 capturable mode prefs; the resetModePrefs()+applyModePrefs(defPrefs) pair
        // below re-establishes them over the factory modePrefs reset, so that write is subsumed here
        // (the net four-pref result is identical) — resetSettings keeps its standalone contract.
        // ⚠ UNCONDITIONAL, AND IT HAS TO BE. This is Full Reset's ONLY write to the settings store,
        // so resetSettings must stay total: the round-14 dimmed-button guard therefore lives on the
        // footer button (pressResetSettings) and not in here, or a Full Reset stops restoring the
        // very values "modified" is blind to. See the note above pressResetSettings.
        resetSettings();
        // Saved gameplay progress → wiped (Stage D1): clears lifetime stats + all-time bests in the
        // persisted store, making Full Reset permanent. Runs BEFORE the remount-key bumps below, so
        // the continuous modes re-hydrate from the now-empty store (blank stats).
        resetProgress();
        // ⚠ LOOKUP HISTORY LEFT THE PROGRESS STORE (Q1, round 20) BUT NOT FULL RESET'S REACH — the
        // owner's explicit call, and it is the ONE thing in this function that is not scoped to the
        // preset you pressed the button from. Every other line here is "wipe THIS preset's copy of
        // something"; Lookup history has exactly one copy, shared by every preset, so wiping it from
        // ANY preset wipes the only one there is. clearLookupHistory() (declared above, alongside
        // pushLookupHistory) already clears BOTH buckets — the permanent list and this session's
        // amnesic overflow — which is exactly right here too: a guest's session-only lookups should
        // not survive a Full Reset either, and a second, narrower clear would just be this one
        // rewritten. Runs here rather than folding into clearLookupHistory's own definition, because
        // this IS Full Reset choosing to reach for it, not a property of the function itself.
        clearLookupHistory();
        // ⚠ AND, IN AN AMNESIC PRESET, THE PARKED COPY TOO. resetProgress() writes through the
        // progress store, which while amnesic points at the SESSION copy — so on its own it would
        // leave the permanent stats sitting untouched behind the session, and turning Amnesic off
        // afterwards would RESURRECT stats the player had just destroyed. Full Reset is the one
        // control that means "everything, gone"; an erase cannot contaminate anything, so it is
        // outside the "nothing writes the permanent stats while amnesic" rule rather than an
        // exception to it. The argument in full is at store/amnesic's discardParkedStats.
        if (selectAmnesic(usePresets.getState())) discardParkedStats(usePresets.getState().activeId);
        // Per-mode setup (Flash speed, Blitz/AoX config, Deduction sub-type, the stat-visibility
        // toggles) → launch defaults. Runs BEFORE the remount-key bumps so the modes re-read the
        // now-default prefs. The store holds no "last mode" and never has — WHICH mode you were on
        // is plain useState in App, which is the whole reason a cold start always opens Classic.
        resetModePrefs();
        // …then push the four SAVED personal defaults (Flash speed, both Blitz timers, the AoX run length — Q7,
        // store/userDefaults, which deliberately SURVIVES Full Reset) back over that factory reset,
        // still before the remount-key bumps. Everything else in modePrefs (Per-Round/Question,
        // Deduction sub-type, Allow Mistakes, One-by-One, show/hide toggles) stays factory. A no-op
        // when nothing is saved (defPrefs = the factory values).
        applyModePrefs(defPrefs);
        // Remount all six always-mounted screens → their internal state resets to launch defaults,
        // and the transients that belong to them go too (Lookup's five UI fields — its saved HISTORY
        // is untouched, on purpose, same as resetProgress above — and the guide's saved reading
        // offset, which switchMode at the top of this function already captured on the way out of
        // the guide, so this clears it AFTER the capture rather than instead of it). ★ THE SAME CALL
        // A PRESET SWITCH MAKES; see remountScreens, which is shared precisely so the two can never
        // drift apart.
        // How to Play is in the six for its ONE piece of state, the open panel: it used to be
        // conditionally rendered, so leaving it dropped that for free — now that it stays mounted
        // (Q6, round 9), a reset that left a panel hanging open would not be the launch state.
        remountScreens();
        // App container to the top, synchronously — the scroll-ownership effect would do it one
        // commit later, and this avoids the flash in between.
        if(appScrollRef.current)appScrollRef.current.scrollTop=0;
      };
      // Android hardware Back closes these App-level overlays instead of quitting the app (Q1).
      // Settings popover → close it; How-to-Play (the 'guide' mode) → return to the previous game mode
      // (mirrors the H-key toggle). The mode menu + Show Codes register their own back entries from
      // CustomSelect / the mode components. See components/useBackButton.
      useBackButton(settingsOpen, ()=>setSettingsOpen(false), 'settings');
      // The four settings MODALS register their own Back entries from inside the panel
      // (components/SettingsPanel). The stack is chronological and a modal cannot open before the
      // panel that hosts its link, so 'settings' is still underneath all four and Back still
      // closes the modal first.
      useBackButton(mode==='guide', ()=>switchMode(prevNonGuideModeRef.current||'classic'), 'guide');
      // True when the whole ⚙ PANEL sits at its EFFECTIVE defaults — the user's saved personal
      // defaults when they exist (Q7, store/userDefaults), the factory launch values otherwise.
      // ⚠ NOT "every store value": at
      // least one of the theme trio is ALWAYS excluded (BOTH darkTheme and lightTheme while Use
      // System is Off), which is the whole point of themeAtDefaults just below —
      // 14 of the 15 settings are compared with Use System On, 13 with it Off. Say it that way; an
      // "every value" phrasing here is the over-claim this comment used to make.
      // ★ AND IT IS THE PANEL, NOT THE STORE: the last two terms are the two year-range TEXT
      // MIRRORS (components/useYearRangeMirrors), so a year that has been TYPED but not yet
      // committed reads as diverged. That is round 15's change and the OWNER'S REVERSAL of the call
      // he made in round 14 — "I want the reset settings and the full reset buttons not to wait
      // anymore for you to leave the year range boxes, and also apply that behavior to the settings
      // gear button bottom line thing", and, asked explicitly, "yeah include save defaults too".
      // ★ THE SHAPE IS THE POINT, AND IT IS NOT WHAT ROUND 13 HAD. Round 13 also let the mirrors
      // count, but through a SECOND binding that only Reset Settings and Full Reset read, so a
      // half-typed year offered those two while the gear stayed dark and Save Defaults stayed
      // dimmed — three buttons, two meanings of "changed" (hazard HC2 of the map). Round 14
      // collapsed that to one definition by DROPPING the mirrors; round 15 keeps the one definition
      // and ADDS them back to it. All four offers read this one expression, so they cannot disagree
      // about a half-typed year — or about anything else. Do not reintroduce a second at-defaults
      // boolean to "just" cover one button; extend this line instead.
      // ⚠ SAVE DEFAULTS CANNOT CLEAR A DIRTY BOX, and that is honest rather than a defect. Its
      // snapshot copies STORE values (openSaveDefaults reads useSettings.getState()), and a
      // half-typed "19" is not a value — there is nothing to save. So on a dirty box Save Defaults
      // is offered, saves everything else, and the gear STAYS lit until the box commits (blur /
      // Enter) or discards (Escape). The alternative — committing the boxes on the user's behalf
      // when he presses Save Defaults — would put a year he never confirmed into his permanent
      // defaults, which is worse than a bar that stays lit while a box is still mid-edit.
      // The theme trio is compared BY WHAT IS IN EFFECT, not by what is stored. Use System ON
      // means darkTheme/lightTheme are the live pair and manualTheme is dormant; OFF is the
      // reverse. Comparing a dormant value would make "modified" mean "some invisible byte
      // differs", and that fires for real: flipping Use System OFF seeds manualTheme from the
      // theme already on screen (so the switch never jumps the look), so on a light-mode phone an
      // OFF→ON round trip parks manualTheme at 'light' against a 'dusk' default — every visible
      // setting back at factory, yet the gear's violet bar lit, Reset Settings and Full Reset
      // both offered, permanently. Comparing only the live pair is both the honest definition and
      // the fix, and it retires the whole class of dormant-value false positives.
      const themeAtDefaults=useSystem?(darkTheme===defSettings.darkTheme&&lightTheme===defSettings.lightTheme):(manualTheme===defSettings.manualTheme);
      const settingsAtDefaults=randomFormat===defSettings.randomFormat&&dateFormat===defSettings.dateFormat&&inputStyle===defSettings.inputStyle&&rotateDots===defSettings.rotateDots&&useJulian===defSettings.useJulian&&minY===defSettings.minY&&maxY===defSettings.maxY&&leapChance===defSettings.leapChance&&janFebChance===defSettings.janFebChance&&julianChance===defSettings.julianChance&&saveStats===defSettings.saveStats&&useSystem===defSettings.useSystem&&themeAtDefaults&&yearRange.min.value===String(defSettings.minY)&&yearRange.max.value===String(defSettings.maxY);
      // The one derived boolean behind THREE of the four offers: the ⚙ gear indicator (Q8), the Save
      // Defaults dim AND the Reset Settings dim. True when live state diverges from the effective
      // defaults in EITHER store — any menu setting, either year BOX, or any of the four capturable
      // mode-screen prefs.
      // Its complement means "nothing new to save, and nothing for Reset Settings to undo", so those
      // three are literally the same expression and cannot drift apart. (Reset Settings watching the
      // panel alone would strand a gear lit only by a divergent mode-screen pref — round-6 Q7.)
      const settingsModified=!(settingsAtDefaults&&prefsAtDefaults);
      // Every per-mode piece of state now lives in the always-mounted mode components, which
      // each report a comprehensive freshness flag (config + stats + history + UI toggles) up
      // via onFreshChange. So isFullyReset = the launch mode (classic) + the ⚙ panel at its
      // effective defaults + the Lookup UI state (which lives here in App) + all five freshness flags.
      // It reads settingsAtDefaults, NOT settingsModified: the four capturable mode prefs reach
      // it through the freshness flags instead, which also cover the thirteen non-capturable ones.
      // Sharing that one term is what puts Full Reset on the SAME reading of a half-typed year as
      // the other three offers (round 15, the owner's call — see the note above it).
      // ⚠ LOOKUP HISTORY IS STILL A TERM HERE (Q1, round 20; the owner's explicit call, overriding an
      // earlier "Full Reset no longer touches it" draft this comment used to describe). Full Reset
      // still clears it — see fullReset above, which now calls clearLookupHistory() — so it still
      // belongs in "would pressing the button right now do anything". `displayLookupHistory` is used
      // rather than `lookupHistory` alone because it already merges in this session's amnesic
      // overflow (store/lookupHistory's mergeForDisplay), and Full Reset clears BOTH buckets in one
      // call — checking only the permanent list would leave the button lit while an amnesic session's
      // entries sat on screen with nothing left for the press to actually remove.
      const isFullyReset=mode==='classic'&&settingsAtDefaults&&displayLookupHistory.length===0&&lookupInput===""&&lookupOutput===""&&lookupCalcDate===null&&lookupSelectedHistoryId===null&&lookupCalcOpen===false&&aoxIsFresh&&classicIsFresh&&flashIsFresh&&blitzIsFresh&&deductionIsFresh;
      // The "disarm if state flips to fully-reset while armed" safety net went into the panel with
      // the rest of the two-tap machine. It used to have to sit exactly HERE, after the declaration
      // above, because its dependency array read isFullyReset and an earlier position was a real
      // TDZ crash; as a PROP on the other side of the boundary that hazard no longer exists, so
      // nothing constrains where these two declarations sit any more.
      return(
        <>
          {/* Both overlays are fixed z-100 covers; the Updating screen renders LATER in the DOM
              so it wins if a landscape launch coincides with an update (the reload happens
              regardless — rotating can't pause it, so Updating is the truthful screen). */}
          {landscapeBlocked?<RotateOverlay/>:null}
          {updating?<BootOverlay updating/>:null}
        {/* ★★ THE BAR'S WIDTH BUDGET, MEASURED — and it starts as a BUG REPORT, because the bar
            this rebuild replaced did not fit. Numbers below are from a real layout engine (headless
            Chromium, the dev build) at 360×800, the narrowest-and-tallest common Android phone;
            the root font there resolves to 15.6px (index.css clamps it to
            `min(0.95rem + 0.4vw, 1.95vh)`, so it grows with HEIGHT as much as width — which is why
            the phones that break this line are narrow AND tall, never simply narrow).

            WHAT SHIPPED (three controls, wordmark included) — content box 328.81px, content
            341.69px, i.e. 12.88px of OVERFLOW:
                logo 24.00 + gap 7.80 + wordmark 135.05          = 166.84
                gap 7.80
                ⚙ 40.25 + gap 7.80 + mode 119.00                 = 167.05
            Nothing truncated because nothing may shrink (both groups are shrink-0, deliberately —
            see the RIGHT group's note); it simply spilled, leaving the mode selector 2.72px from
            the screen edge against a 15.59px gutter on the left. That asymmetry WAS the visible
            symptom, and it is why "just add a fourth control" was never an option.

            WHAT THIS ROW COSTS NOW (Q6, round 20) — THERE IS NO SLACK LEFT TO MEASURE, BY
            CONSTRUCTION, and that is the invariant that replaced "22.70px of slack sits in the
            gap between two groups": the row is ONE flat flex container, three controls are
            `shrink-0` (fixed, content-sized) and the FOURTH — the preset switcher — is
            `flex-1 min-w-0`, so it consumes whatever the other three and their gaps do not, always,
            with nothing left over for `justify-between` to distribute any more (that utility is
            gone from the row for exactly this reason). scrollWidth == clientWidth at every width
            below, which is now a STRUCTURAL fact rather than a coincidence of an arithmetic sum
            landing under the ceiling — a flex-1 min-w-0 child cannot overflow its container by
            growing; it can only be squeezed toward its own MINIMUM (PRESET_NAME_COL,
            components/PresetSwitcher) if the other three ever grew too large to fit alongside it.
            FIXED (what the other three + three gaps cost, measured 360×800, root 15.6px):
                logo 24.00 + gap 5.84 + mode 107.30 + gap 5.84 + ⚙ 40.25 + gap 5.84  = 189.08
            FLOATS: the preset switcher gets whatever is left of the row's own content box —
            328.81 − 189.08 = 139.73px at 360×800 (up from the OLD fixed 117.03px it shipped Q4-5
            with; the reclaimed slack is exactly where it went). The ⚙'s right edge still lands at
            344.41 — 15.59px from the screen edge, matching the left gutter to the pixel, which is
            the same fact as "it fits" stated so a human can see it.

            THE THREE THINGS THAT PAID FOR THE FOURTH CONTROL IN THE FIRST PLACE (Q4-5, unchanged
            by Q6 — the fixed sum above is the same 189.08 either way, just regrouped): the
            wordmark's removal (−135.05px, the owner's call — the a11y cost is handled at the <h1>
            below), the mode selector's pr-9 → pr-6 (−11.70px), and gap-2 → gap-1.5 on all three
            gaps (−5.85px). Q6 spent nothing further and freed nothing further — it only changed
            WHO gets to spend whatever is left over turn by turn, from "nobody, it sits as a gap"
            to "the preset switcher, unconditionally".

            ⚠ THE FIXED SUM ABOVE IS THE THING TO WATCH NOW, not a slack number — the switcher's
            own MINIMUM (PRESET_NAME_COL) is what actually stops fitting first if the fixed sum
            ever grows. At 360×900 (root font 16.64px, the ceiling for any 360-wide device — the
            `0.95rem + 0.4vw` term caps there and `1.95vh` overtakes it at ~853px of height), the
            row's content box shrinks to 326.75 and the switcher still gets 126.95px of it —
            comfortably clear of the 6em (≈104px at that root) floor. tests/topBar.dom guards the
            structural half (which children carry `shrink-0` vs `flex-1 min-w-0`) as class reads,
            which is the most a jsdom suite can do about geometry no jsdom suite can compute.
            ⚠ AND CHROMIUM IS NOT AN IPHONE. Glyph advances differ, the system UI stack differs, and
            ONLY THE OWNER'S DEVICE can confirm the real thing. What is claimed here is that the
            arithmetic is no longer guesswork, not that the phone has agreed. (All of the numbers
            in this block, Q6's included, are a REAL headless-Chromium measurement of the dev
            build — not the paper arithmetic components/PresetSwitcher's own history warns against
            trusting on its own.)

            ⚠ --bar-h IS UNCHANGED BY ALL OF THIS, and that was checked rather than assumed: the
            resting bar measures 56.594px before and after, byte-identical, because the row's height
            has always been set by the pill controls (py-2 + text-sm + 1px borders = 37.09px) and
            never by the 19.5px wordmark that sat beside them. So index.css's hand-written
            placeholder `:root{--bar-h:57px}` is still right and MUST NOT be touched. If a later
            edit changes the bar's resting height AT ALL, that placeholder has to move with it or
            every cold start jumps by the difference before the ResizeObserver catches up — that
            exact bug has shipped once. The seven readers are listed at syncBarHeight above. */}
        {/* Bar (position:fixed): the bar is a CHROME-STYLE fixed element above
            everything — explicitly positioned at the viewport top so iOS PWA recognizes
            it as chrome UI and live-samples its bg-(--bg1) (theme-aware) for the
            status bar color. Sibling appScrollRef container (#appScroll) sits below it,
            position:absolute inset-0 with padding-top:var(--bar-h) so its content starts
            below the bar — in EVERY mode since round 13, the guide included.
            syncBarHeight elsewhere in App writes the bar's fractional rect height to --bar-h.
            Full width (no max-w) so theme bg + elevation shadow span edge-to-edge on
            screens wider than 480px; inner max-w-[30rem] wrapper holds the control row (it held
            the TITLE row until the wordmark came out — the budget block above says what replaced
            it, the <h1> below says what the name became).
            elev-shadow-down is UNCONDITIONAL — the bar is always this screen's top boundary, and
            how strongly it says so is the 0…1 --shade the edge effect writes onto this element
            (0 at rest, ramping to full over the first --fade-h of scroll). The class used to be
            toggled and cross-faded by a CSS transition, which is what left a shadow visibly
            fading out after a status-bar tap had already stopped the page dead.
            HtP-only bar pb-2.5: absorbs half (10px) of the 20px gap that sits between the title
            row and the first GuidePage panel. That gap used to be one mt-5 on the guide's
            wrapper; GuidePage's own root now carries the matching mt-2.5 instead, so the total
            stays 20px — but the visual "lock line" is centered between control row and first panel
            rather than sitting right at the control row's bottom edge. It is a GUIDE number, not an
            app-wide one: the game modes open on StatPanel's own mt-4 and Lookup on an mt-5
            wrapper, neither of which this pb-2.5 applies to.
            ⚠ The SPACE in `pt-5 ${` is REQUIRED — Tailwind v4's source scanner silently drops a
            utility glued directly to `${` when it appears nowhere else; without it the bar lost
            its pt-5 (20px) top padding and the whole site sat ~20px too high. Don't remove the
            space — tests/classGlueGuard.test.js now fails the suite on any glued class site.
            (Calendar Game layout bug-fix, 2026-06-01.) */}
        <header ref={htpStickyBarRef} style={{position:'fixed',top:0,left:0,right:0,zIndex:30}} className={`htp-sticky-bar elev-shadow-down bg-(--bg1) w-full pt-5 ${mode==="guide"?" pb-2.5":""}`}>
          <div className="mx-auto px-4 w-full max-w-[30rem] relative">
            {/* ★★ THE APP'S NAME, AND THE ONLY COPY OF IT LEFT ON SCREEN. The visible "Calendar
                Game" wordmark was deleted from this row (owner: it was "taking up a lot of valuable
                real estate" — 135.05px of a 328.81px line at 360px, measured, more than a third of
                the bar for a name the player already knows). But it was ALSO the page's only
                heading, and W5Logo beside it is deliberately aria-hidden BECAUSE the heading carried
                the name — so deleting it outright would have left the whole app unlabelled to
                assistive technology, with a decorative glyph where its name used to be.
                So the name stays, twice over, and neither half is optional:
                  • THIS <h1>, sr-only. Same text, same role, same accessible name, so a screen
                    reader still opens on "Calendar Game" and every getByRole('heading') in the suite
                    still means what it meant. It paints nothing.
                  • THE <header> ABOVE, which makes the bar a BANNER landmark — the structural half.
                    A lone visually-hidden heading is the cheap version of this fix and it is not
                    enough: landmark navigation is how a screen-reader user reaches site chrome, and
                    the bar is now four unlabelled-looking controls with no visible title over them.
                ⚠ AND BECAUSE THIS IS INVISIBLE, THE SUITE MUST NOT LEAN ON IT AS IF IT WERE NOT.
                Five sites used to tap or point at this heading as "somewhere on screen that isn't
                the ⚙ panel"; a sr-only element would have kept every one of them GREEN while
                testing a target no finger can reach. They now use something visible instead (the
                bar itself, or the Mode button) — tests/helpers/settingsPanel's outsideTarget,
                tests/app-mount, tests/persistence and tests/presetSwitch. tests/topBar.dom pins the
                honest version of the claim: the heading exists, it is sr-only, and NO visible node
                in the bar renders the words. */}
            <h1 className="sr-only">Calendar Game</h1>
            {/* ONE FLAT ROW, four direct children — logo, preset, mode, gear — rather than the two
                nested shrink-0 groups the bar shipped with (Q6, round 20). `justify-between` is
                GONE too: it existed to put the slack SOMEWHERE between two shrink-0 groups, and
                once one control is meant to consume that slack itself, a gap between groups is not
                where it belongs any more — see the budget block above for why the preset switcher
                is that one control. `flex-1 min-w-0` sits on the switcher's OWN wrapper below;
                every other child keeps `shrink-0`, unchanged from before. */}
            <div className="flex items-center gap-1.5">
              {/* ★ THE MARK FOLLOWS THE DOT LAYOUT (Settings → Display → Dot Layout) — BUT ONLY
                  WHILE Input IS Dots (Q3, round 20). The app icon IS that 7-dot grid, coordinate
                  for coordinate, so turning the input and leaving the mark upright would break the
                  very claim How-to-Play makes about them — while turning the mark when there are
                  no dots ANYWHERE on screen for it to correspond to is a different bug, and the one
                  this round fixes: `rotateDots` alone used to reach this prop unconditionally, so a
                  player on Buttons could leave it on and the mark sat turned forever with nothing
                  on screen it matched. `inputStyle==='dots' &&` is the fix, folded into the SAME
                  dotOrientationFor() call every other consumer uses rather than a separate branch —
                  the four weekday mode screens (and WeekdayAnswer through them) get the plain
                  derivation above instead, because they only ever consult it already inside their
                  own `inputStyle==='dots'` render branch and a second gate there would be dead code.
                  This is the ONE drawing of the mark that follows: the title bar is app chrome, with
                  no static counterpart on screen beside it. The three full-screen frames —
                  index.html's #boot, the Updating overlay and the rotate-back overlay — keep the
                  canonical upright form, because they stand next to (or back-to-back with) the
                  iOS launch PNGs that are pre-renders of #boot and cannot follow anything. That
                  is why W5Logo takes an ORIENTATION PROP defaulting to upright rather than
                  reading the store itself: the default IS the fixed brand mark, and a caller has
                  to ask for the player's. lib/dotLayout's DOT_MARK_ROTATION states the rest. */}
              <W5Logo className="shrink-0" dotOrientation={dotOrientationFor(inputStyle==='dots'&&rotateDots)} />
              {/* THE PRESET SWITCHER, standing exactly where the wordmark stood — the owner's
                  layout, and the trade the wordmark's real estate paid for: a name you already
                  know, replaced by the one fact the bar could not otherwise tell you (which
                  preset the numbers on screen belong to).
                  It is a CustomSelect, so it inherits the mode selector's press-drag gesture and
                  its portaled panel wholesale; components/PresetSwitcher argues why reuse is a
                  hard requirement rather than a preference, and — since Q6 — why its trigger is
                  the ONE control in this row that GROWS rather than sizing to content, with a
                  MINIMUM name-cell width rather than the fixed one it shipped with. wrapperRef is
                  REQUIRED there and feeds the ⚙ click-outside exclusion above — see that handler.
                  ⚠ `flex-1 min-w-0` LIVES ON THIS WRAPPING DIV, NOT ON THE TRIGGER ITSELF, and
                  that split is deliberate rather than incidental: CustomSelect's own top-level div
                  (the actual flex ITEM of the row above) is internal to that component and takes
                  no className from any caller, so THIS div is what stands in for it as the row's
                  flex item, with nothing between them for anything to disagree about — CustomSelect's
                  own div, `position:relative` and otherwise unstyled, defaults to filling 100% of
                  it (ordinary block behaviour, not a flex property). PresetSwitcher's OWN
                  `w-full min-w-0` on the trigger button is the other half of this chain — see that
                  file's export for where it picks up from here. */}
              <div className="flex-1 min-w-0">
                <PresetSwitcher wrapperRef={presetSelectRef} />
              </div>
              {/* THE MODE SELECTOR. Wrapped in its own `shrink-0` div for the identical structural
                  reason the switcher above is wrapped in `flex-1 min-w-0`: CustomSelect's own
                  top-level div takes no className, so making IT a `shrink-0` row item — rather than
                  leaving its sizing to flexbox's default (which shrinks by default, and would let
                  this control get squeezed once the switcher next to it is free to grow) — needs a
                  div of this file's own to carry the class. Nothing about the CONTROL changed: it
                  is still exactly as content-sized as it always was, just explicitly protected now
                  that content-sized is no longer everyone's default in this row.
                  Mode CustomSelect. Replaced the original native <select> as part of the
                  site-wide CustomSelect rollout that fixed iOS Safari's native picker
                  auto-close bug — see the CustomSelect component for full context.
                  wrapperRef={modeSelectRef} so the existing settings click-outside handler
                  keeps treating taps inside the mode dropdown the same way it treated taps
                  on the original <select>. showChevron renders the same ▲▼ indicator.
                  The menu always opens DOWNWARD, with no prop and no longer any flip logic to
                  say so (Q8, round 11 deleted round-8's auto-flip): the trigger sits IN the bar
                  the flip measured the space above against, so that space was structurally
                  negative and the branch was unreachable. This trigger is also WHY the panel can
                  be viewport-fixed and measured once per open — fixed chrome is the one place no
                  scroller can move it out from under the panel (see the caller contract at the
                  top of components/CustomSelect).
                  ⚠ pr-6, NOT pr-9 — one of the two cuts that paid for the fourth control (the
                  budget block above the bar has the arithmetic). The chevron is `absolute right-2`
                  and ~7px wide in both selects, so the glyph does not move: pr-9 was reserving
                  ~20px of clearance between the label and a glyph that needs ~8. pr-6 is what the
                  preset switcher beside it already wears, so the two now match by construction
                  instead of by coincidence. */}
              <div className="shrink-0">
                <CustomSelect wrapperRef={modeSelectRef} value={mode} onChange={(v)=>{switchMode(v);setSettingsOpen(false);}} options={MODE_LABELS} ariaLabel="Mode" showChevron pressDrag className="panel rounded-xl px-2.5 py-2 pr-6 text-sm focus:outline-hidden focus-ring text-left"/>
              </div>
              {/* THE ⚙ AT THE FAR EDGE. The gear moved from the INSIDE of the old right-hand pair
                  to the OUTSIDE of it (owner's layout: gear far right); flattening the row to four
                  siblings did not move it again. What the swap never disturbed: the ⚙ panel is
                  `absolute left-4 right-4 top-full` against the wrapper two lines up, never
                  against the gear, so it hangs in exactly the same place whichever end its button
                  sits at. The corner UpdateDot rides inside the button's own padding
                  ([data-update-dot="corner"] is inset .21em), so pushing the button to the row's
                  right edge cannot push the badge off it. `shrink-0` joins the existing `relative`
                  here rather than needing a wrapping div of its own — this IS this file's own div
                  already, so there is nothing to stand in for. */}
              <div className="relative shrink-0" ref={settingsRef}>
                {/* C2: the ⚙ is a press-drag trigger — pointerdown OPENS the panel so you can drag straight
                    into it + release on a control. aria-controls names its menu (the popover card,
                    id="settings-popover") so the pointer controller pairs the gesture with THIS panel,
                    resolved live by id (a press that CLOSES the panel pairs with nothing → inert). The
                    isPrimary/button guard mirrors the controller's pointer latch: a second finger or a
                    right-click must not toggle. onClick is kept for keyboard/tests; the controller
                    suppresses the trigger's click on a real press so it doesn't double-toggle.
                    gear-modified (Q8, the flush inside-bottom violet bar — index.css) marks live state ≠
                    the saved defaults while the panel is CLOSED (the open gear is solid purple, no
                    bar); the CORNER UpdateDot marks an update landed since the panel was last opened
                    (opening clears the flag — toggleSettings, which BOTH handlers below call — so it
                    too only ever shows CLOSED).
                    The gear is the one host in the app that clears the corner badge's per-axis
                    padding precondition (components/UpdateDot + index.css spell it out); its own
                    literal `relative` is what makes it the marker's containing block, since neither
                    indicator's class may be counted on to be present. The marker is aria-hidden, so
                    the aria-label carries BOTH booleans in every combination — the only accessible
                    name this button has, its visible content being a bare glyph. */}
                <button type="button" data-select-trigger aria-controls={settingsOpen?"settings-popover":undefined} onPointerDown={e=>{if(!e.isPrimary||(e.pointerType==='mouse'&&e.button!==0))return;toggleSettings();}} onClick={()=>toggleSettings()} className={`relative px-2.5 py-2 rounded-xl text-sm border ${settingsOpen?"btn-solid border-transparent":`panel text-(--tx-100-80) ${settingsModified?" gear-modified":""}`}`} aria-label={(()=>{const parts=[settingsModified?"modified":"",gearDot?"update":""].filter(Boolean);return parts.length?`Settings (${parts.join(", ")})`:"Settings";})()}>⚙<UpdateDot placement="corner" lit={gearDot}/></button>
              </div>
            </div>
            {/* ⚙ THE SETTINGS PANEL, at the slot its markup used to occupy inline. Three things
                about this line are load-bearing and none of them is style:
                  • CONDITIONALLY RENDERED. A closed panel must have NO DOM — the suite's role
                    queries are unscoped by design, so an always-mounted-and-hidden panel would
                    double every radio in the document. It is also what makes unmount the discard
                    for the five modals and the Full Reset arm.
                  • THIS POSITION. It is a sibling of the title/gear row inside the bar's `relative`
                    inner wrapper, and the card is `absolute top-full left-4 right-4` against that
                    wrapper. Anywhere else, or inside a wrapper of its own, and the panel silently
                    detaches from the bar.
                  • NOT MEMOISED. No React.memo, no useMemo around this element, no memoised props
                    object: PillGroup's tab-stop layout effect and the panel's footer fit both have
                    NO dependency array on purpose and must re-read the DOM on every pass. */}
            {settingsOpen&&<SettingsPanel
              cardRef={settingsPopoverRef}
              settingsModified={settingsModified}
              isFullyReset={isFullyReset}
              onResetSettings={pressResetSettings}
              onFullReset={fullReset}
              mode={mode}
              activeTheme={activeTheme}
              defPrefs={defPrefs}
              yearRange={yearRange}
              minYearRef={minInputRef}
              maxYearRef={maxInputRef}
              updateCheck={updateCheck}
              onCheckUpdates={onCheckUpdates}
              changelogDot={changelogDot}
              onRetireChangelogDot={retireChangelogDot}
            />}
          </div>
        </header>
        {/* THE app scroll container, and since round 13 there is no "except in guide mode" left in
            this comment: position:absolute inset:0 with padding-top:var(--bar-h) so content starts
            immediately below the bar; overscroll-contain keeps rubber-band bounce LOCAL to this
            container (the fixed bar above is unaffected); the fade-scroll-* masks mark overflowing
            edges. This is the one scroller on SCROLLER_CORE_CLASS rather than SCROLL_REGION_CLASS
            (components/scrollRegion): it fills the viewport, so its scrollbar already paints at the
            screen edge past the content wrapper's px-4 — no inner lane needed.
            id="appScroll" is a real styling hook, not decoration: index.css hangs the scrollport's
            seat (--seat-top + scroll-padding-top) and the focus-outline suppression off it, and
            neither can be expressed as a Tailwind utility.
            tabIndex −1 makes it PROGRAMMATICALLY focusable and nothing more — it is not in the tab
            order, so the app-wide Tab binding and the modals' tab traps (which enumerate
            button,input) are untouched. App focuses it on entry to the guide so the desktop
            keyboard scroll keys work immediately; see that effect for why. */}
        <div ref={appScrollRef} id="appScroll" tabIndex={-1} style={{paddingTop:'var(--bar-h)'}} className={`absolute inset-0 ${SCROLLER_CORE_CLASS} ${scrollFadeClass(appScrolledFromTop,appAtBottom)}`}>
        {/* Mode-content wrapper. min-h-full + flex column: the scroller above has a definite
            height, so "at least a screenful" gives a mode that wants to FIT the screen (Lookup) a
            definite box to fill, while a mode taller than the screen still grows normally and keeps
            its pb-3 under the content. Every child is a plain non-growing flex item pinned to the
            top, so the six always-mounted screens look exactly as before (the hidden ones are
            display:none and drop out of flex layout entirely).
            min-h-full is ACTIVE in guide mode now (round 13) where it used to be inert — the
            scroller was a classless auto-height block then, so min-height:100% resolved against an
            indefinite height and did nothing. It is benign and in fact correct: the guide is always
            far taller than a screenful, so the floor never binds, and on the one occasion it could
            (a section-less guide, i.e. never) it would do what it does for Lookup.
            pb-3 is likewise the same 0.75rem every other screen gets. It used to carry
            env(safe-area-inset-bottom) on top, and ONLY because document flow removed the 100dvh
            #root clamp that keeps the last panel above the iPhone home indicator; back inside the
            clamped box that term is dead, and adding it would pad the guide past every sibling. */}
        <div className="mx-auto px-4 w-full max-w-[30rem] min-h-full flex flex-col pb-3">
          {/* key={aoxResetKey} forces remount on Full Reset since AoxMode is always-mounted
              (display:none toggle on visible prop, not conditional rendering) and its internal
              state would otherwise persist across resets. See aoxResetKey declaration upstream
              for full rationale. */}
          {/* Per-mode error boundaries (ModeErrorBoundary): a crash in one mode is isolated —
              the bar + switcher + other modes keep working. The mode's reset key lives on the
              BOUNDARY now (not the inner component) so Full Reset remounts boundary+component
              together (clearing any caught error AND resetting the component's state). The
              always-mounted modes pass `active` so a hidden mode's crash paints nothing. */}
          <ModeErrorBoundary key={"aox-"+aoxResetKey} mode="MoX" active={mode==="aox"}>
            <AoxMode minY={minY} maxY={maxY} visible={mode==="aox"} fmtDate={fmtDate} useJulian={useJulian} genDate={genDate} leapChance={leapChance} janFebChance={janFebChance} julianChance={julianChance} randomFormat={randomFormat} inputStyle={inputStyle} dotOrientation={dotOrientation} dateFormat={dateFormat} saveStats={saveStats} settingsOpen={settingsOpen} onFreshChange={setAoxIsFresh}/>
          </ModeErrorBoundary>
          <ModeErrorBoundary key={"classic-"+classicResetKey} mode="Classic" active={mode==="classic"}>
            <ClassicMode visible={mode==="classic"} genDate={genDate} minY={minY} maxY={maxY} useJulian={useJulian} saveStats={saveStats} dateFormat={dateFormat} randomFormat={randomFormat} inputStyle={inputStyle} dotOrientation={dotOrientation} leapChance={leapChance} janFebChance={janFebChance} julianChance={julianChance} fmtDate={fmtDate} settingsOpen={settingsOpen} onFreshChange={setClassicIsFresh}/>
          </ModeErrorBoundary>
          <ModeErrorBoundary key={"flash-"+flashResetKey} mode="Flash" active={mode==="flash"}>
            <FlashMode visible={mode==="flash"} genDate={genDate} minY={minY} maxY={maxY} useJulian={useJulian} saveStats={saveStats} dateFormat={dateFormat} randomFormat={randomFormat} inputStyle={inputStyle} dotOrientation={dotOrientation} leapChance={leapChance} janFebChance={janFebChance} julianChance={julianChance} fmtDate={fmtDate} settingsOpen={settingsOpen} clockPaused={landscapeBlocked} onFreshChange={setFlashIsFresh}/>
          </ModeErrorBoundary>
          <ModeErrorBoundary key={"blitz-"+blitzResetKey} mode="Blitz" active={mode==="blitz"}>
            <BlitzMode visible={mode==="blitz"} genDate={genDate} minY={minY} maxY={maxY} useJulian={useJulian} saveStats={saveStats} dateFormat={dateFormat} randomFormat={randomFormat} inputStyle={inputStyle} dotOrientation={dotOrientation} leapChance={leapChance} janFebChance={janFebChance} julianChance={julianChance} fmtDate={fmtDate} settingsOpen={settingsOpen} clockPaused={landscapeBlocked} onFreshChange={setBlitzIsFresh}/>
          </ModeErrorBoundary>
          <ModeErrorBoundary key={"deduction-"+deductionResetKey} mode="Deduction" active={mode==="deduction"}>
            <DeductionMode visible={mode==="deduction"} minY={minY} maxY={maxY} useJulian={useJulian} saveStats={saveStats} dateFormat={dateFormat} randomFormat={randomFormat} leapChance={leapChance} janFebChance={janFebChance} julianChance={julianChance} settingsOpen={settingsOpen} onFreshChange={setDeductionIsFresh}/>
          </ModeErrorBoundary>
          {/* Lookup is the one FIT-TO-SCREEN mode: its wrapper takes the screenful the flex column
              above guarantees, and LookupCard divides it up (top card natural, history list gets
              the rest and scrolls). h-0 is what makes that exact rather than approximate — a flex
              item's height also feeds the PARENT's intrinsic height, so with height:auto a long
              history would push the wrapper past a screenful and the page would scroll again (the
              very bug the list's old fixed 440-pixel cap existed to prevent). height:0 adds nothing,
              the parent stays at its min-height (one screenful), and flex-auto grows this back to
              fill it. Rests on the same definite-height #root the clamped scroller already needs. */}
          {mode==="lookup"&&(<ModeErrorBoundary mode="Lookup" active={true}><div className="mt-5 flex flex-col flex-auto h-0 min-h-0"><LookupCard history={displayLookupHistory} onAddHistory={pushLookupHistory} onMoveHistory={moveHistoryEntryToTop} onClearHistory={clearLookupHistory} inputValue={lookupInput} onInputChange={setLookupInput} outputValue={lookupOutput} onOutputChange={setLookupOutput} calcDate={lookupCalcDate} onCalcDateChange={setLookupCalcDate} selectedHistoryId={lookupSelectedHistoryId} onSelectedHistoryIdChange={setLookupSelectedHistoryId} calcOpen={lookupCalcOpen} onCalcOpenChange={setLookupCalcOpen} fmtDate={fmtDate} dateFormat={dateFormat} useJulian={useJulian}/></div></ModeErrorBoundary>)}
          {/* How to Play is always-mounted like the five game modes (Q6, round 9), and for the same
              reason they are: leaving a screen must not destroy what you had set up on it. It used
              to be conditionally rendered, which is why a detour into a game mode closed whichever
              panel you had open — the component was unmounted and its state went with it. The
              display toggle lives on GuidePage's OWN root, where its mt-2.5 also lives: a wrapper
              here would keep that 10px margin in the flex column on every OTHER screen, silently
              lengthening them past the viewport (a phantom bottom fade and a scrollbar on modes
              that used to fit exactly). display:none generates no box at all, so the other five
              modes are untouched. `visible` also tells GuidePage to drop any in-flight scroll
              glide — with no unmount to do it, that is now the component's own job.
              scrollerRef HANDS IT THE SCROLLER (round 13), and that is a real property given up:
              the coordinator used to need no ref plumbing at all, because the thing it scrolled was
              the window and every screen in every browser has one. An overflow div has to be named,
              so App — which owns the container — passes it down. The ref itself, not its current
              value: App's own layout effects and GuidePage's toggle read it at different moments,
              and a value read at render time would be null on the first pass. */}
          <ModeErrorBoundary key={"guide-"+guideResetKey} mode="How to Play" active={mode==="guide"}><GuidePage visible={mode==="guide"} scrollerRef={appScrollRef}/></ModeErrorBoundary>
        </div>
        </div>
        {/* The guide's two soft edges — ⚠ KEPT ACROSS ROUND 13, and the reason changed. They exist
            because How to Play's edges are PROGRESSIVE: each strip's opacity is the same continuous
            --shade the edge effect writes onto the bar, so the whole screen's boundaries ramp on
            one number. The container's own fade-scroll-* masks are boolean state classes and are
            pinned off in guide mode (see the edge effect) precisely so these two are not doubled by
            a feather that snaps. Folding them into the shared masks would compile and would leave
            every shipped test name green — and would silently revert round 10 on the one page it
            was built for. index.css carries the same warning at the rules.
            position:fixed survives the move untouched: it paints over the VIEWPORT, and the
            scroller's box is `absolute inset-0` — the viewport — so the strips sit exactly over its
            edges while living outside it. The top strip tucks under the fixed bar at --bar-h, the
            bottom hugs the viewport floor, and both are pointer-events:none.
            Mounted for the WHOLE of guide mode, not per edge state: a strip at --shade 0 paints
            nothing, so a conditional mount would only re-add the on/off round 10 removed. */}
        {mode==="guide"?<div ref={docFadeTopRef} aria-hidden="true" className="doc-fade-top"/>:null}
        {mode==="guide"?<div ref={docFadeBottomRef} aria-hidden="true" className="doc-fade-bottom"/>:null}
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
    // MethodBreakdownSection (the whole Show Codes panel: button, Expander, freeze contract) →
    // src/components/MethodBreakdown.jsx. THE COMPONENT IS NOT IMPORTED HERE: this file renders no
    // codes panel at all any more — all five went with the mode screens (AoX included since Q5,
    // round 8) and Lookup's lives inside components/LookupCard. What App does import from that module
    // is the `CodeDate` TYPE alone, and only to type the lookupCalcDate it threads to LookupCard.
    // The ordering rules described just above are implemented there, not here.

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
    if (rootEl) createRoot(rootEl).render(<ErrorBoundary><App/></ErrorBoundary>);

    // Real-user error reporting (C1). DEPLOYED builds only. This flag is the BUILD-time half —
    // import.meta.env.PROD is false in `vite dev`, so dev never reports — but it is true for a
    // locally-SERVED production build too, so initObservability() adds the runtime half and refuses
    // on a loopback host (Q9). Lazy-loads the Sentry SDK as its own chunk (see
    // src/observability/sentry.ts); the error boundaries above call captureError() on a crash.
    if (rootEl && import.meta.env.PROD) initObservability();

    // Dev-only Core Web Vitals logging (Stage E0). The static import.meta.env.DEV guard
    // makes this dead code in a production build, so the call, reportWebVitals, and the
    // web-vitals library are all tree-shaken out of the shipped bundle.
    if (rootEl && import.meta.env.DEV) reportWebVitals();

    // Exported for the Step-6 characterization tests (the mode-untangle safety net). randomDate +
    // makeDedPuzzle are the real date/puzzle generators — exported for the C2 date-generation fuzz
    // (tests/dateGen.dom), which drives them across every settings combination to prove no setting can
    // produce a malformed or unanswerable question. bootHoldRemaining is the pure boot-splash hold
    // calculation (tests/bootSplash.dom). makeUpdateReloadGate + consumeSkipBootHold are the
    // auto-update path's testable core — the two-signal reload gate and the one-time post-update
    // splash-skip flag (tests/updateReloadGate.dom, tests/bootSplash.dom); the PROD-gated update
    // effect itself never runs under Vitest, it only wires these to the real SW.
    export { App, randomDate, makeDedPuzzle, bootHoldRemaining, BootOverlay, makeUpdateReloadGate, consumeSkipBootHold };
