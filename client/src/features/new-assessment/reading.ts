// What the reading screen says about each file (CP-23, board 14): the status
// words a file steps through while it is read, and a failed file's short
// error and fix. Pure helpers. Called by useIntake.ts and the reading components.
import { fileKind } from '../../design-system'
import type { IntakeFile } from './api'

// Every file after it is opened; must match board 14's words.
const COMMON = [
  'Hiding client details',
  'Finding the client',
  'Finding sites',
  'Finding dates',
  'Checking contacts',
  'Almost done',
]

/** Returns the status words a file steps through, by its type. */
export function stepsFor(name: string, pasted = false) {
  const kind = pasted ? 'email' : fileKind(name)
  if (kind === 'email') return ['Reading the email', 'Opening attachments', ...COMMON]
  if (kind === 'word') return ['Reading pages', ...COMMON]
  return ['Opening file', ...COMMON]
}

// Seconds each word shows; the last holds until the real result.
export const STEP_SECONDS = 2
// Files start one second apart, so they don't move in lockstep.
export const START_GAP = 1

/** Returns a file's status words `elapsed` seconds into the read, or null while it waits. */
export function stepAt(steps: string[], index: number, elapsed: number) {
  const t = elapsed - index * START_GAP
  if (t < 0) return null
  return steps[Math.min(steps.length - 1, Math.floor(t / STEP_SECONDS))]
}

export type Failure = { error: string; fix: string; retry: boolean }

/** Returns a failed file's short error (red) and fix (grey), from the gateway's reason. */
export function failureOf(file: Pick<IntakeFile, 'name' | 'reason'>): Failure {
  const reason = file.reason ?? ''
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : ''
  // An email attachment of a type we can't read: the gateway words it already
  // (must match microservices/ingestion-service/app/extract_text.py).
  const attachment = /^(Can't read \.\w+ attachments\.) (.+)$/.exec(reason)
  // The gateway's own words for these (the file's name is shown above them), shown as sent.
  const worded = /^(File is damaged\.|Password-protected\.|Can't read \.\w+ files\.) (.+)$/.exec(
    reason,
  )
  if (worded) return { error: worded[1], fix: worded[2], retry: false }
  if (attachment) return { error: attachment[1], fix: attachment[2], retry: false }
  if (/not a PDF, Word or email/i.test(reason))
    return {
      error: ext ? `Can't read .${ext} files.` : "Can't read this file.",
      fix: 'Add PDF, Word, Outlook (.msg) or .eml files.',
      retry: false,
    }
  if (/empty|no pages/i.test(reason))
    return { error: 'File is empty.', fix: 'Add a file that has content.', retry: false }
  if (/password/i.test(reason))
    return {
      error: 'Password-protected.',
      fix: 'Remove the password and upload it again.',
      retry: false,
    }
  if (/not a valid|cannot be opened|could not be opened|damaged|corrupt/i.test(reason))
    return { error: 'File is damaged.', fix: 'Save it again and re-add it.', retry: false }
  return { error: "Couldn't read it.", fix: 'Try again.', retry: true }
}

// Must match the types the gateway accepts (client-intake upload).
export const ACCEPT = '.pdf,.doc,.docx,.msg,.eml'
const ACCEPTED = ACCEPT.split(',')
/** Returns the files of a type the gateway refuses, by name. */
export const refusedType = (files: File[]) =>
  files.filter((f) => !ACCEPTED.some((ext) => f.name.toLowerCase().endsWith(ext)))
