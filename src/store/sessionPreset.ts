import { readItem, writeItem, removeItem } from './storageHealth.js'

// store/sessionPreset.ts — THE PRESET THIS BROWSING SESSION IS ON.
//
// ★ "WHICH PRESET AM I ON" IS THE SESSION'S, AND "WHICH PRESET WAS I ON LAST" IS THE DEVICE'S. They
// used to be one value — `activeId` in the permanent, shared preset registry (store/presets) — and a
// reload read it back to stay where the player was. That made a reload depend on a permanent write
// having landed, and on nobody else having made one since:
//   • a fresh open that the "Open in" pin moved had to WRITE the registry at that moment so the
//     reload that might follow would find it. On a device full to the byte that write was refused
//     and held only in memory, and the reload landed in the last visit's preset instead;
//   • another tab switching presets (live and staging are two tabs of one origin) moved this tab to
//     its preset at this tab's next reload.
// So the preset a session is on is kept where everything else session-lived is — sessionStorage,
// which a reload keeps and a real close clears (store/browsingSession) — and a reload reads THAT
// (store/presets' resolveActiveId; index.html's boot script beside it). The registry's `activeId`
// goes on being written by every change of preset, and means what it always meant to a fresh open
// with no pin: the preset that was active last. A fresh open WRITES NOTHING PERMANENT.
//
// ⚠ AN OLDER BUILD ON THIS ORIGIN KNOWS NOTHING OF THIS RECORD — it reloads to the registry's
// `activeId`, as it always has. Two consequences, both accepted and both only while such a build can
// still be loaded:
//   • a session an older build STARTED has no record; the reload that brings this build in falls
//     back to the registry's `activeId`, which that build kept current — the right preset;
//   • an older build loaded in THIS tab after a pinned fresh open here lands on the registry's
//     preset (the last visit's), not the pinned one. Nothing moves between presets, and it ends when
//     the tab is closed.
//
// ONE SMALL VALUE under one key — the preset's id. `cg-session-preset-v1` is new, so no older build
// reads it. Every access is guarded: a browser that refuses sessionStorage keeps nothing, and its
// next load is a fresh open (the answer store/browsingSession gives there too). A write the browser
// has no room for is held and reported like any other refused save (store/storageHealth).
// ⚠ index.html's pre-React boot script reads this key too (it has to know the preset before any
// module exists, to paint its theme); tests/bootTheme.dom runs that script against this file's
// record, so the two spellings cannot drift.

const KEY = 'cg-session-preset-v1'

/** The preset this session is on, as recorded — or null when nothing readable is on record. */
export function sessionPresetId(): number | null {
  try {
    const id = Number(readItem(window.sessionStorage, KEY))
    return Number.isInteger(id) && id > 0 ? id : null
  } catch {
    return null
  }
}

/**
 * Put the preset this session is on, on the session's record. Called for every change of the active
 * preset (store/presets' applyRegistry) and once per page load (src/main.tsx's boot effect — a pin
 * that moved a fresh open changes it with no registry edit at all). A session-storage write; nothing
 * permanent.
 */
export function recordSessionPreset(presetId: number): void {
  try {
    const text = String(presetId)
    if (readItem(window.sessionStorage, KEY) !== text) writeItem(window.sessionStorage, KEY, text)
  } catch {
    /* storage refused — this page's next load is a fresh open, which reads no record */
  }
}

/** Forget the record, i.e. "the app was closed" — the harness, which has no close. */
export function forgetSessionPreset(): void {
  try {
    removeItem(window.sessionStorage, KEY)
  } catch {
    /* storage refused — nothing was ever written */
  }
}
