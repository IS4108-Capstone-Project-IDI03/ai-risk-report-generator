// Settings > Note-taking (CP-35): the three line codes for shorthand notes, and the person's
// glossary. Called by Settings.tsx. Everyone edits their OWN values, so no "set by admin" line.
import { useState } from 'react'
import { Button, Icon, Input } from '../../../design-system'
import { saveMine, type NoteCodes, type Settings } from '../api'
import { GlossaryEditor } from '../components/GlossaryEditor'
import { SaveStatus } from '../components/SaveStatus'
import { codeProblem, DEFAULT_CODES } from '../noteRules'
import { useSave } from '../useSave'

type Props = { settings: Settings; onSaved: (settings: Settings) => void }
const FIELDS: { key: keyof NoteCodes; label: string }[] = [
  { key: 'fact', label: 'Fact code' },
  { key: 'info_request', label: 'Info request code' },
  { key: 'recommendation', label: 'Recommendation code' },
]

export function NoteTakingSection({ settings, onSaved }: Props) {
  const { state, run } = useSave(onSaved)
  const [codes, setCodes] = useState<NoteCodes>(settings.noteTaking.codes)
  const [problem, setProblem] = useState('')

  // Without the check, a duplicate code would only come back as a gateway error.
  const save = () => {
    const found = codeProblem(codes)
    setProblem(found)
    if (!found) void run(() => saveMine({ noteCodes: codes }))
  }
  const reset = () => {
    setProblem('')
    setCodes(DEFAULT_CODES)
    void run(() => saveMine({ noteCodes: null }))
  }
  return (
    <div className="st-stack">
      <div className="st-row">
        <p className="st-note">
          These are yours. A line that starts with your code, like IR: hydrant test report, is
          sorted with no guessing.
        </p>
        <div className="st-editor">
          {FIELDS.map((f) => (
            <Input
              key={f.key}
              label={f.label}
              size="lg"
              value={codes[f.key]}
              maxLength={8}
              onChange={(e) => setCodes({ ...codes, [f.key]: e.target.value })}
            />
          ))}
        </div>
        {problem && (
          <p className="st-err" role="alert">
            <Icon name="octagon-alert" size={14} color="var(--red-600)" /> {problem}
          </p>
        )}
        <div className="st-editor">
          <Button variant="primary" size="lg" onClick={save}>
            Save
          </Button>
          <Button variant="secondary" size="lg" onClick={reset}>
            Reset to defaults
          </Button>
          <SaveStatus state={state} />
        </div>
      </div>
      <GlossaryEditor glossary={settings.noteTaking.glossary} onSaved={onSaved} />
    </div>
  )
}
