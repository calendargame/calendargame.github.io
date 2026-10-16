import { createContext, useContext } from 'react'

// The ⚙ Settings picker LOCK, published by a PillGroup (components/PillGroup) and read by the
// PillTray segments inside it (components/PillTray). One boolean is the whole lock: the group's
// dim, each segment's aria-disabled, PillTray's onChange guard, and the group's tab stops all
// derive from it, so a locked picker can never be locked three ways out of four.
//
// Its own module because the two components that share it are two modules, and a context is
// neither of them — a component file that also exports a hook breaks Fast Refresh for that file
// (react-refresh/only-export-components), which is the rule's point rather than its pedantry.
//
// The default is false: a tray outside any group is simply live.
export const PillGroupLock = createContext(false)
export const usePillGroupLock = () => useContext(PillGroupLock)

// ★ AND THE OTHER STATE A PICKER CAN BE IN: NOT IN EFFECT (Round 26). Kept, still changeable, and not
// acting right now — a chance setting the year range cannot use, Rotate Dots while Input is Buttons.
// A PillGroup with a `dormant` reason publishes the id of the element that holds the reason's
// words; the segments inside point their aria-describedby at it and draw the outlined look
// (components/PillTray). null = in effect. Unlike the lock it changes NOTHING a press does.
export const PillGroupDormant = createContext<string | null>(null)
export const usePillGroupDormant = () => useContext(PillGroupDormant)
