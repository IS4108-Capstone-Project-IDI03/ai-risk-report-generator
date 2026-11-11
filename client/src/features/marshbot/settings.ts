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

// ---- Message pacing (MarshBot Overview, board 12) ----
// The pause after one message before the next starts typing (spec: one setting, 5 to 10 s).
export const MESSAGE_PAUSE_MS = 8_000
// How long the typing dots show before a message's words start.
export const TYPING_MS = 900
// One word appears this often; each fades in over 240 ms like the chatbot's letters (chat.css .chat-ch).
export const WORD_MS = 45
// A widget's fade-and-rise, before the next part of the message starts.
export const WIDGET_MS = 180
// A ticked-off row holds its tick this long before it folds away.
export const TICK_HOLD_MS = 1_200
