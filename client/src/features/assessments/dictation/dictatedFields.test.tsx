// Each assessment text field CP-27 gives a Dictate button: the dictated words land in that field.
// The microphone and the gateway are fakes (fakeMicrophone.ts).
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { NoteComposer } from '../../site-walk/components/NoteComposer'
import { AskPanel } from '../ask/AskPanel'
import { useAsk } from '../ask/useAsk'
import { CommentComposer } from '../comments/CommentComposer'
import type { ChecklistItem } from '../api'
import { AnswerDialog } from '../components/ChecklistAnswer'
import { TranscriptDialog } from '../components/ObservationDialogs'
import { ObservationNote } from '../components/ObservationNote'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import { DictationScope } from './scope'
import { DICTATED, dictate, fakeMicrophone, fakeMicrophoneEachTest } from './fakeMicrophone'

fakeMicrophoneEachTest()
// jsdom has no modal dialogs; the app's Dialog opens one.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})

const REFERENCE = 'RPT-2026-0411'

describe('dictating into a field (CP-27)', () => {
  it("an observation's note: the words go in, and are saved on leaving it", async () => {
    const save = vi.fn(async () => true)
    render(<ObservationNote note="" canChange save={save} reference={REFERENCE} />)

    await dictate()

    const note = screen.getByRole('textbox', { name: 'Note' })
    await waitFor(() => expect(note).toHaveValue(DICTATED))
    fireEvent.blur(note)
    await waitFor(() => expect(save).toHaveBeenCalledWith({ note: DICTATED }))
  })

  it("a site walk's note, between recordings", async () => {
    function Walk() {
      const [note, setNote] = useState('Block A.')
      return <NoteComposer value={note} onChange={setNote} onAdd={() => {}} reference={REFERENCE} />
    }
    render(<Walk />)
    const box = screen.getByRole('textbox', { name: 'Add a note' })
    box.focus()
    ;(box as HTMLTextAreaElement).setSelectionRange(8, 8)

    await dictate()

    await waitFor(() => expect(box).toHaveValue(`Block A. ${DICTATED}`))
  })

  it("a recording's transcript correction: the words go in and are saved with it", async () => {
    const saveTranscript = vi.fn(async () => true)
    const v = { liveReference: REFERENCE, closeObsDialog: () => {}, saveTranscript }
    const dialog = { recording: { name: 'Recording 1', text: '' } }
    render(
      <TranscriptDialog
        v={v as unknown as AssessmentWorkflow}
        dialog={dialog as unknown as NonNullable<AssessmentWorkflow['obsDialog']>}
      />,
    )

    await dictate()

    const box = screen.getByRole('textbox', { name: 'Transcript' })
    await waitFor(() => expect(box).toHaveValue(DICTATED))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(saveTranscript).toHaveBeenCalledWith(DICTATED))
  })

  it('a comment on the report, inside the assessment', async () => {
    const onSubmit = vi.fn(async () => null)
    render(
      <DictationScope reference={REFERENCE}>
        <CommentComposer label="Reply" submitLabel="Reply" onSubmit={onSubmit} />
      </DictationScope>,
    )

    await dictate()

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue(DICTATED),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ body: DICTATED }))
  })

  it('a question in the Ask tab', async () => {
    // The Ask tab's opening read: nothing asked yet.
    fakeMicrophone.other = () =>
      Response.json({
        scope: {
          observations: 1,
          standards: [],
          standardsFrom: 'applicable',
          jurisdiction: 'SG',
          facilityType: 'Warehouse',
          pastReports: 0,
        },
        archived: false,
        conversations: [],
        conversation: null,
        questions: [],
      })
    function Tab() {
      const ask = useAsk(REFERENCE, true)
      return <AskPanel ask={ask} current={null} onCite={() => {}} />
    }
    render(<Tab />)

    await dictate()

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue(DICTATED),
    )
  })

  it("a checklist answer's note: what was seen", async () => {
    const item = {
      id: 'i1',
      area: '7',
      subsection: null,
      origin: 'standard',
      hazard: null,
      text: 'In-rack sprinklers on racks over 6 m.',
      fields: [],
      COPE_dimension: ['Protection'],
      citations: [],
      flags: [],
    } as unknown as ChecklistItem
    render(
      <AnswerDialog
        kind="differs"
        item={item}
        place={{ kind: 'tab', locations: [], last: null }}
        onClose={() => {}}
        onSave={async () => {}}
        onFullCapture={() => {}}
        reference={REFERENCE}
      />,
    )

    await dictate()

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'What you saw' })).toHaveValue(DICTATED),
    )
  })
})
