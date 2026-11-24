// Settings > Note-taking (CP-35): the three line codes for shorthand notes, and the person's
// glossary. Called by Settings.tsx. Everyone edits their OWN values, so no "set by admin" line.
// Each good save is a toast (Reset and glossary removals carry Undo); a failure stays inline.
import { useState } from 'react'
import { Button, Icon, Input } from '../../../design-system'
import { saveMine, type NoteCodes, type Settings } from '../api'
import { GlossaryEditor } from '../components/GlossaryEditor'
import { SaveStatus } from '../components/SaveStatus'
import { SettingBlock } from '../components/SettingBlock'
import { codeProblem, DEFAULT_CODES } from '../noteRules'
import { useSave } from '../useSave'

type Props = { settings: Settings; onSaved: (settings: Settings) => void }
const FIELDS: { key: keyof NoteCodes; label: string }[] = [
  { key: 'fact', label: 'Fact code' },
  { key: 'info_request', label: 'Info request code' },
  { key: 'recommendation', label: 'Recommendation code' },
]

export function NoteTakingSection({ settings, onSaved }: Props) {
  const { state, run, reset: clearState } = useSave(onSaved)
  // Which button is saving, so only that one shows its loading state.
  const [pending, setPending] = useState<'save' | 'reset' | null>(null)
  const glossary = useSave(onSaved)
  const [codes, setCodes] = useState<NoteCodes>(settings.noteTaking.codes)
  const [problem, setProblem] = useState('')
  const [glossaryError, setGlossaryError] = useState('')

  // Every action starts by clearing both areas' old messages. Without it an old red alert
  // stays beside a new "Saved", or lingers after the other area's action.
  const clearCodes = () => {
    setProblem('')
    clearState()
  }
  const clearGlossary = () => {
    setGlossaryError('')
    glossary.reset()
  }
  const startCodeAction = () => {
    clearCodes()
    clearGlossary()
  }

  // Save is for a code that differs from the saved one; with nothing changed there is nothing to send.
  const saved = settings.noteTaking.codes
  const changed = FIELDS.some((f) => codes[f.key] !== saved[f.key])

  // Without the check, a duplicate code would only come back as a gateway error.
  const save = async () => {
    startCodeAction()
    const found = codeProblem(codes)
    setProblem(found)
    if (found) return
    setPending('save')
    await run(() => saveMine({ noteCodes: codes }), 'Codes saved')
    setPending(null)
  }
  // Undo puts the codes that were saved before the reset back, in the boxes and in the gateway.
  const reset = async () => {
    startCodeAction()
    setCodes(DEFAULT_CODES)
    setPending('reset')
    await run(
      () => saveMine({ noteCodes: null }),
      'Codes reset to defaults',
      () => {
        setCodes(saved)
        void run(() => saveMine({ noteCodes: saved }))
      },
    )
    setPending(null)
  }
  return (
    <>
      <SettingBlock
        title="My codes"
        help="These are yours. A line that starts with your code, like IR: hydrant test report, is sorted with no guessing."
      >
        <div className="st-fields">
          {FIELDS.map((f) => (
            <Input
              key={f.key}
              label={f.label}
              value={codes[f.key]}
              maxLength={8}
              // Short codes like IR are not words; a spell-check squiggle under them is noise.
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => {
                startCodeAction()
                setCodes({ ...codes, [f.key]: e.target.value })
              }}
            />
          ))}
        </div>
        {problem && (
          <p className="st-err" role="alert">
            <Icon name="octagon-alert" size={14} color="var(--red-600)" /> {problem}
          </p>
        )}
        <div className="st-editor st-editor--actions">
          <Button
            variant="primary"
            pill
            loading={pending === 'save'}
            disabledReason={
              changed ? undefined : { title: 'No changes', text: 'Change a code, then save.' }
            }
            onClick={save}
          >
            Save
          </Button>
          <Button variant="secondary" pill loading={pending === 'reset'} onClick={reset}>
            Reset to defaults
          </Button>
          <SaveStatus state={state} />
        </div>
      </SettingBlock>
      <GlossaryEditor
        glossary={settings.noteTaking.glossary}
        save={glossary}
        problem={glossaryError}
        onProblem={setGlossaryError}
        onStart={() => {
          clearCodes()
          clearGlossary()
        }}
      />
    </>
  )
}
