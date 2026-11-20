// "New assessment" (CP-23, boards 03 and 05): one navy button whose menu offers the
// two starts, each with its tile. Used by the Assessments toolbar and the Clients
// screens. Calls the design system's AddMenuButton; callers get the chosen StartMode.
import { AddMenuButton, type AddMenuOption } from '../../../design-system'

export type StartMode = 'form' | 'documents'
const STARTS: AddMenuOption<StartMode>[] = [
  {
    value: 'form',
    icon: 'pencil-line',
    label: 'Fill in the form',
    note: 'Enter the client, sites and dates yourself.',
    tone: 'form',
  },
  {
    value: 'documents',
    icon: 'upload',
    label: 'Start from client documents',
    note: 'Add their emails and letters. The form fills itself in.',
    tone: 'docs',
  },
]

/** Returns the New assessment button and its menu; `onStart` gets the chosen start. */
export function NewAssessmentButton({ onStart }: { onStart: (mode: StartMode) => void }) {
  return (
    <AddMenuButton label="New assessment" options={STARTS} onChoose={onStart}>
      {'New assessment'}
    </AddMenuButton>
  )
}
