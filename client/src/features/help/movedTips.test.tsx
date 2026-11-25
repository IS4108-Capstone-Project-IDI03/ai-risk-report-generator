// F-13 test seam 3 (decisions 1 and 4): the tips that exist today keep their words, word for word,
// now that they sit on the shared HelpTip. The expected strings were copied from the sources
// before the move (CaptureHelp, ProposalHelp, the recorder's HelpSheet).
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { CaptureHelp } from '../assessments/components/CaptureHelp'
import { ProposalHelp } from '../site-walk/components/ProposalHelp'
import { RecordingHelp } from '../site-walk/components/RecordingHelp'

afterEach(cleanup)

const lines = (name: string) => {
  fireEvent.click(screen.getByRole('button', { name }))
  return [...screen.getByRole('dialog', { name }).querySelectorAll('li')].map((li) =>
    li.textContent?.replace(/\s+/g, ' ').trim(),
  )
}

describe('the tips that exist today', () => {
  it('New Observation: capture help', () => {
    render(<CaptureHelp proposal={false} />)
    expect(lines('How to add an observation')).toEqual([
      'Pick the location you are standing in.',
      'Write a note, record your voice, take photos or scan handwritten pages.',
      'Choose its categories and severity, then save. The location stays for the next one.',
    ])
  })

  it('New Observation: capture help while building a site walk proposal', () => {
    render(<CaptureHelp proposal />)
    expect(lines('How to add an observation')[2]).toBe(
      'Choose a category and severity, then add it to the site walk. Nothing reaches the assessment until Create all.',
    )
  })

  it('Site walk proposal', () => {
    render(<ProposalHelp />)
    expect(lines('How to review a proposal')).toEqual([
      'Go through each location. A red mark shows what an observation still needs.',
      'Change, add or delete locations and observations. Every edit saves as you go.',
      'Press Create all to add everything to the assessment. Until then, none of it is.',
    ])
  })

  it('Site walk recorder guide, under the same name', () => {
    render(<RecordingHelp />)
    expect(lines('How to record a site walk')).toEqual([
      'Press Save recording at each pause, then start the next one at the next location.',
      'A recording stops by itself at 20 minutes. You hear a tone and see a message a minute before.',
      'Type a note between recordings for anything that is easier to write than to say.',
      'Say the building, level and area as you arrive, e.g. “Block A, Level 1, loading bay”.',
      'Photos are matched to what you say around the time you take them.',
      'Keep this screen open. If the phone locks, recording stops, and what you said is kept.',
    ])
  })
})
