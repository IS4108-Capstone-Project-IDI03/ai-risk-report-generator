// MarshBot's numbers in one place (AS-06). The pause between messages is the
// client's (client/src/features/marshbot/); Focus's work-left days are in
// focus.service.ts (FOCUS_WORK_DAYS).
export const ASSISTANT = {
  // The coverage check (AC 7) runs at most this often while evidence keeps changing.
  coverageMinIntervalMs: 5 * 60_000,
  // "Read" (Architecture 5): this share of the items, each on screen this long.
  readShare: 0.8,
  readMs: 2_000,
  // The checklist reminder starts this many days before the survey (AC 8).
  checklistReminderDays: 3,
  // A report due within this many days raises "due soon".
  dueSoonDays: 7,
  // An area with fewer than this share of its checklist items answered is thin.
  thinShare: 0.5,
  // A section decided in less engaged time than this, while less than
  // `mostlySeenShare` of its findings were on screen, went by quickly (AC 10).
  quickDecisionMs: 60_000,
  mostlySeenShare: 0.5,
  // MarshBot is pleased for this long after something is resolved.
  pleasedMs: 10 * 60_000,
  // Opens closer together than this are one visit, so a pushed refresh keeps "since last time".
  sameVisitMs: 30 * 60_000,
  // Resolved items kept on the brief, for "since last time" and the tick-off.
  keepResolved: 50,
  // Earlier exchanges kept on the brief.
  keepThread: 50,
}
