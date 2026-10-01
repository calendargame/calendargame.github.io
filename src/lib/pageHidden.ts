// lib/pageHidden.ts — "the page is going away, or to the background": the one moment anything kept
// only for the browsing session has to be written down.
//
// Two events, and both are needed:
//   • `pagehide` — fired by every reload and every navigation away, just before the page stops;
//   • `visibilitychange` → hidden — fired when the tab or the installed app goes to the background.
//     A mobile browser may later DISCARD a backgrounded page without firing anything else, so this is
//     the last notice such a page ever gets.
// A reload therefore usually calls `fn` twice (hidden, then pagehide); the callers write the same
// value both times.
//
// Returns the function that stops listening.
export function onPageHidden(fn: () => void): () => void {
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') fn()
  }
  window.addEventListener('pagehide', fn)
  document.addEventListener('visibilitychange', onVisibilityChange)
  return () => {
    window.removeEventListener('pagehide', fn)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}
