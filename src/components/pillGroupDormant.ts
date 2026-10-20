import { createContext, useContext } from 'react'

// A ⚙ Settings picker NOT IN EFFECT (Round 26), published by a PillGroup (components/PillGroup) and read
// by the PillTray segments inside it (components/PillTray): kept, still changeable, and not acting right
// now — a chance setting the year range cannot use, Rotate Dots while Input is Buttons. A PillGroup with a `dormant` reason publishes the id of the element that holds the
// reason's words; the segments inside point their aria-describedby at it and draw the outlined look.
// null = in effect. It changes NOTHING a press does.
//
// Its own module because the two components that share it are two modules, and a context is neither of
// them — a component file that also exports a hook breaks Fast Refresh for that file
// (react-refresh/only-export-components), which is the rule's point rather than its pedantry.
export const PillGroupDormant = createContext<string | null>(null)
export const usePillGroupDormant = () => useContext(PillGroupDormant)
