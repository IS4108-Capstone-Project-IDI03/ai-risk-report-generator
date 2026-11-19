// Settings > Drafting: the share of drafted sections that should cite a standard (GN-16 AC5).
// Called by Settings.tsx. An admin saves it for everyone; an engineer reads it.
import { useState } from 'react'
import { Button, Input } from '../../../design-system'
import { saveGlobal, type Settings } from '../api'
import { SaveStatus } from '../components/SaveStatus'
import { SetByAdmin } from '../components/SetByAdmin'
import { useSave } from '../useSave'

type Props = { settings: Settings; onSaved: (settings: Settings) => void }

export function DraftingSection({ settings, onSaved }: Props) {
  // The box starts from the saved target and starts over when that changes (without this, another
  // admin's save would leave the old number here, and Save would put it back).
  const saved = String(settings.standardCiteTarget)
  const [text, setText] = useState(saved)
  const [base, setBase] = useState(saved)
  if (base !== saved) {
    setBase(saved)
    setText(saved)
  }
  const [problem, setProblem] = useState('')
  const { state, run, reset } = useSave(onSaved)
  const edit = settings.canEditGlobal
  // A whole number from 0 to 100 only; anything else never leaves the browser.
  const save = () => {
    const n = Number(text)
    if (!/^\d+$/.test(text.trim()) || n > 100)
      return setProblem('Enter a whole number from 0 to 100.')
    setProblem('')
    run(() => saveGlobal({ standardCiteTarget: n }))
  }
  return (
    <div className="st-stack">
      {!edit && <SetByAdmin />}
      <div className="st-row">
        <Input
          label="Sections citing a standard"
          hint="Review warns when fewer drafted sections cite a standard than this. It never blocks."
          error={problem || undefined}
          inputMode="numeric"
          size="lg"
          value={text}
          disabled={!edit}
          onChange={(e) => {
            setText(e.target.value)
            setProblem('')
            reset()
          }}
        />
        <span className="st-note">%</span>
      </div>
      {edit && (
        <div className="st-row-head">
          <Button variant="primary" size="lg" disabled={state.status === 'saving'} onClick={save}>
            Save
          </Button>
          <SaveStatus state={state} />
        </div>
      )}
    </div>
  )
}
