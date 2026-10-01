// lib/buildStamp.ts — the last-run build stamp (round 6): which build's DEPLOY_TS this device
// last booted, persisted in PLAIN localStorage — deliberately not a zustand store, because it
// describes the CODE that ran (not user data) and must be readable synchronously at boot, before
// anything else. Every boot restamps; a mismatch between the stored stamp and the running build is
// how an update that landed SILENTLY is detected: closing the app releases the old service
// worker's last client, the browser completes the waiting worker's activation in the background,
// and the next open is already the new version with nothing left for the auto-update flow to
// bridge (an evicted Safari tab's fresh download reads the same way). App's build-change flash
// effect (main.tsx) owns the one detection per boot and turns it into the brief Updating screen;
// the changelog's GEAR dot (src/changelog) lights off the same detection there, while the
// CHANGELOG dot needs that detection AND a changed newest entry (see CHANGELOG_SEEN_KEY),
// before the restamp. try/catch throughout: localStorage can throw (privacy
// modes) and a broken stamp must never break boot — a blocked read acts like a first visit
// (nothing to announce).

export const BUILD_STAMP_KEY = 'cg-last-build'

export const readBuildStamp = (): string | null => {
  try {
    return localStorage.getItem(BUILD_STAMP_KEY)
  } catch {
    return null
  }
}

export const writeBuildStamp = (build: string): void => {
  try {
    localStorage.setItem(BUILD_STAMP_KEY, build)
  } catch {
    /* best-effort */
  }
}

// Pure: did the build change since this device's last run? A missing stamp is NOT a change — that
// is the first-ever visit (or blocked storage), and there is no previous version to announce.
export const buildChanged = (stored: string | null, current: string): boolean =>
  stored !== null && stored !== current
