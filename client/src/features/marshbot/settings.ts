// AS-06 MarshBot settings: every tunable number in one place (spec: "All numbers in one settings file").

// ---- Activity tracking (useActivity, AS-06 Architecture 5) ----
// Engaged time counts while the tab is visible and the person did something this recently.
export const ACTIVITY_IDLE_MS = 30_000
// How often engaged time is added up.
export const ACTIVITY_TICK_MS = 1_000
// A piece of content counts as seen after this long on screen...
export const SEEN_MS = 1_000
// ...with at least this share of it showing.
export const SEEN_RATIO = 0.5

// ---- The conversation thread (MarshBot Overview) ----
// A gap this long between two turns of one session shows their time between them ("10:41").
export const TURN_GAP_MS = 2 * 60_000
// A reply that moves the stage is stamped up to this long before or after the stage's own date
// (the gateway stamps the turns first): close enough to be the reply that moved it.
export const MILESTONE_SLACK_MS = 10_000

// New bot messages appear one at a time (components/thread/useReveal.ts): the first this long after
// the typing dots appeared (at once if it arrives later), each next one this long after the one
// before.
export const FIRST_MESSAGE_MS = 700
export const MESSAGE_GAP_MS = 1500
// The choices under a pushed turn are their own beat: they appear this long after its last message
// (shorter than a message's gap: nothing is being typed, so the dots are not shown).
export const ACTIONS_MS = 600

// The Overview's area (the page minus the app sidebar) needs this much to keep the rail: the
// rail's 248 px (marshbot.css .mb-rail) and a conversation of about 560 px. Narrower, the rail
// folds into the stage bar on top (useNarrowArea.ts).
export const RAIL_AREA_MIN = 248 + 560
