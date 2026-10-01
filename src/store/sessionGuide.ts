// store/sessionGuide.ts — How to Play's PLACE (its open section and how far down you had read), kept
// across a RELOAD.
//
// THE OWNER'S RULE (store/browsingSession): "only truly closing the app starts fresh." The guide
// already held its place through every detour inside the app — it stays mounted (the open section is
// GuidePage's own state) and src/main.tsx keeps the reading offset in guideScrollYRef — but both lived
// only in memory, so a reload (pull-to-refresh, the update reload) put the reader back at the top with
// every section closed. This keeps the two for the session's lifetime, and a real close still clears
// them (the browser drops sessionStorage).
//
// ★ ITS LIFECYCLE:
//   • WRITTEN WHEN THE PAGE IS HIDDEN (lib/pageHidden) — `pagehide` (every reload fires it) and
//     `visibilitychange` → hidden (a backgrounded tab the browser may later discard fired that on its
//     way out). Never on scroll: the offset is only needed when the page goes away, so a reader's
//     scrolling costs nothing. GuidePage parks; App hands it the reading offset (main.tsx's
//     readGuideOffset, the one place that knows it — live while the guide is on screen, remembered
//     while it is not).
//   • RETIRED WHEN THE GUIDE UNMOUNTS — which a reload never does, and a crash onto the error card
//     does (so a place that somehow broke the guide cannot come back and break it again). A guide
//     that crashes on its very FIRST render never mounted, so it has no unmount: its error boundary
//     discards the place for it (src/main.tsx, ModeErrorBoundary's onCrash).
//   • AND DISCARDED BY main.tsx's remountScreens, the preset switch's and Full Reset's shared
//     remount, which has always thrown the guide's place away ("captured against a panel that is
//     about to be closed"). It must be discarded THERE, before the remount renders: the new GuidePage
//     reads its place during that render, before the old one's unmount cleanup would run.
//
// ONE SMALL JSON VALUE under one key; `cg-guide-place-v1` is new, so no older build on this shared
// origin reads it. Anything unreadable in it — a build this one has never seen, a hand-edited value —
// reads as "no place": the guide opens at the top with every section closed, as it always did. A
// section id this build does not have simply opens nothing, and the offset is clamped by the browser
// like any other scroll write. Every access is try/catch-wrapped (locked-down browsing throws on the
// property access, where the place is simply not kept).

const KEY = 'cg-guide-place-v1'

export interface GuidePlace {
  open: string | null // the open section's id, or null when every section is closed
  y: number //           the reading offset, in the app scroller's own scrollTop units
}

/** The guide's place as the last page left it this session, or null to open at the top, all closed. */
export function readGuidePlace(): GuidePlace | null {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (raw === null) return null
    const v: unknown = JSON.parse(raw)
    if (typeof v !== 'object' || v === null) return null
    const { open, y } = v as Record<string, unknown>
    if (!(open === null || typeof open === 'string')) return null
    if (typeof y !== 'number' || !Number.isFinite(y) || y < 0) return null
    return { open, y }
  } catch {
    return null
  }
}

/** Park the guide's place for the reload that may follow. The launch place parks nothing. */
export function writeGuidePlace(place: GuidePlace): void {
  if (place.open === null && place.y === 0) return discardGuidePlace()
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(place))
  } catch {
    discardGuidePlace() // refused — and an older place must not come back instead
  }
}

/**
 * Forget the guide's place: the guide unmounted, or the screens are about to be remounted. Also what
 * tests/setup/dom.js calls before every test — the harness has no "close the browser" event.
 */
export function discardGuidePlace(): void {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    /* storage refused — nothing was ever written */
  }
}
