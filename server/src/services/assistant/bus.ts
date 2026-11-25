// The in-process channel that tells open Overviews their brief changed (AS-06),
// open Generation and Review tabs that drafting moved on (GN-13), and the open
// Observations tab and observation page that background work changed an
// observation (CP-24). Called by recheck.service.ts after it saves a brief, by
// drafting-run.service.ts, and by observation*.service.ts.
// Listened to by the assistant events route (server-sent events) for each open page.
import { EventEmitter } from 'node:events'

// shortcut: one gateway process only; move to Redis pub/sub if the gateway ever runs as several instances.
const bus = new EventEmitter()
// One listener per open Overview; without this, Node warns after 10.
bus.setMaxListeners(0)

/** Tells every open Overview of `reference` that its brief changed; returns nothing. */
export function publishBriefChanged(reference: string, updatedAt: string): void {
  bus.emit(reference, updatedAt)
}

/** Returns whether any Overview of `reference` is open now (a server-sent event stream is listening). */
export function isWatched(reference: string): boolean {
  return bus.listenerCount(reference) > 0
}

/** Tells every open page of `reference` that a part's drafting moved on (GN-13); returns nothing. */
export function publishDrafting(reference: string): void {
  bus.emit(`drafting:${reference}`)
}

/** Calls `listener` whenever `reference`'s drafting moves on; returns the unsubscribe function. */
export function onDrafting(reference: string, listener: () => void): () => void {
  bus.on(`drafting:${reference}`, listener)
  return () => bus.off(`drafting:${reference}`, listener)
}

/** Tells every open page of `reference` that background work changed one of its observations (CP-24); returns nothing. */
export function publishObservations(reference: string): void {
  bus.emit(`observations:${reference}`)
}

/** Calls `listener` whenever background work changes one of `reference`'s observations; returns the unsubscribe function. */
export function onObservations(reference: string, listener: () => void): () => void {
  bus.on(`observations:${reference}`, listener)
  return () => bus.off(`observations:${reference}`, listener)
}

/** Calls `listener` whenever `reference`'s brief changes; returns the unsubscribe function. */
export function onBriefChanged(
  reference: string,
  listener: (updatedAt: string) => void,
): () => void {
  bus.on(reference, listener)
  return () => bus.off(reference, listener)
}
