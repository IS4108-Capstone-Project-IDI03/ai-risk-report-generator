// "New assessment" (CP-23, boards 03 and 05): one navy button whose menu offers the
// two starts, each with its tile. Used by the Assessments toolbar and the Clients
// screens. Calls the design system's AddMenuButton; callers get the chosen StartMode.
import { useState } from 'react'
import { AddMenuButton, type AddMenuOption } from '../../../design-system'
import { useWalkthroughScreen } from '../../walkthrough/useWalkthroughScreen'

export type StartMode = 'form' | 'documents'
const STARTS: AddMenuOption<StartMode>[] = [
  {
    value: 'form',
    icon: 'pencil-line',
    label: 'Fill in the form',
    note: 'Enter the client, sites and dates yourself.',
    tone: 'form',
    walk: 'new-assessment.start-form',
  },
  {
    value: 'documents',
    icon: 'upload',
    label: 'Start from client documents',
    note: 'Add their emails and letters. The form fills itself in.',
    tone: 'docs',
    walk: 'new-assessment.start-documents',
  },
]

// F-12: while the menu is open it is the "new-choice" screen, so MarshBot can point at it.
// Mounted only while open, so the hook's cleanup says the menu has gone when it closes.
function MenuShowing() {
  useWalkthroughScreen('new-choice', true)
  return null
}

/** Returns the New assessment button and its menu; `onStart` gets the chosen start. */
export function NewAssessmentButton({ onStart }: { onStart: (mode: StartMode) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <AddMenuButton
        label="New assessment"
        options={STARTS}
        onChoose={onStart}
        walk="new-assessment.button"
        menuWalk="new-assessment.menu"
        onOpenChange={setOpen}
      >
        {'New assessment'}
      </AddMenuButton>
      {open && <MenuShowing />}
    </>
  )
}
