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
