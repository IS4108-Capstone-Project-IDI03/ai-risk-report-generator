// The short error and fix shown for a file that could not be read (CP-23 AC4,
// board 14). Tests reading.ts failureOf.
import { describe, expect, it } from 'vitest'
import { failureOf } from './reading'

describe('failureOf', () => {
  it('names an unreadable email attachment type and how to fix it, with no retry', () => {
    const failure = failureOf({
      name: 'Attachment: old.doc (from 01_request.eml)',
      reason: "Can't read .doc attachments. Save it as .docx or PDF and add it.",
    })
    expect(failure).toEqual({
      error: "Can't read .doc attachments.",
      fix: 'Save it as .docx or PDF and add it.',
      retry: false,
    })
  })

  it('shows the server’s damaged-PDF words as sent, the name being on its own line', () => {
    expect(
      failureOf({
        name: '02_broken.pdf',
        reason: 'File is damaged. Save it again as a PDF and add it.',
      }),
    ).toEqual({
      error: 'File is damaged.',
      fix: 'Save it again as a PDF and add it.',
      retry: false,
    })
  })
})
