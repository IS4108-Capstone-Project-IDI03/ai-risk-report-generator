// One personal setting: the admin default, my own value, and Reset to default. S-01 AC11, AC12.
// Used by DraftingSection and DefaultsSection. An admin also edits the default for everyone.
import { useState } from 'react'
import { Button, Input } from '../../../design-system'
import type { PersonalKey, PersonalSetting as Setting, PersonalValue, Settings } from '../api'
import { saveGlobal, saveMine } from '../api'
import { useSave } from '../useSave'
import { SaveStatus } from './SaveStatus'
import { SetByAdmin } from './SetByAdmin'

type Props = {
  name: PersonalKey
  label: string
  suffix?: string
  numeric?: boolean
  setting: Setting<PersonalValue>
  canEditGlobal: boolean
  onSaved: (settings: Settings) => void
}

const shown = (v: PersonalValue, suffix = '') => (v === null ? 'none' : `${v}${suffix}`)

// A box that edits one value and saves it with its own button.
function Editor(props: {
  label: string
  initial: PersonalValue
  numeric: boolean
  save: (v: PersonalValue) => Promise<Settings>
  onSaved: (s: Settings) => void
  extra?: React.ReactNode
}) {
  const [draft, setDraft] = useState(props.initial === null ? '' : String(props.initial))
  const { state, run } = useSave(props.onSaved)
  const text = draft.trim()
  // An empty box clears my value; a number box sends a number, never text.
  const value: PersonalValue = text === '' ? null : props.numeric ? Number(text) : text
  // Checked here so the person sees a plain message, not the server's wording (the server checks too).
  const problem = !props.numeric
    ? text.length > 80
      ? 'Use 80 characters or fewer.'
      : null
    : value !== null && !(Number.isInteger(value) && value >= 0 && value <= 100)
      ? 'Enter a whole number from 0 to 100.'
      : null
  return (
    <div className="st-editor">
      <Input
        label={props.label}
        type={props.numeric ? 'number' : 'text'}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        error={problem ?? undefined}
        min={props.numeric ? 0 : undefined}
        max={props.numeric ? 100 : undefined}
        maxLength={props.numeric ? undefined : 80}
      />
      <Button size="md" disabled={!!problem} onClick={() => run(() => props.save(value))}>
        Save
      </Button>
      {props.extra}
      <SaveStatus state={state} />
    </div>
  )
}

export function PersonalSettingField({
  name,
  label,
  suffix,
  numeric = false,
  setting,
  canEditGlobal,
  onSaved,
}: Props) {
  const reset = useSave(onSaved)
  return (
    <div className="st-row">
      <div className="st-row-label">{label}</div>
      <p className="st-note">Admin default: {shown(setting.default, suffix)}</p>
      {/* key remounts the box when the saved value changes, so it shows what was stored */}
      <Editor
        key={`mine-${setting.own}`}
        label={label.toLowerCase().startsWith('my ') ? label : `My ${label.toLowerCase()}`}
        initial={setting.own}
        numeric={numeric}
        save={(v) => saveMine({ [name]: v })}
        onSaved={onSaved}
        extra={
          <Button
            variant="ghost"
            size="md"
            disabled={setting.own === null}
            onClick={() => reset.run(() => saveMine({ [name]: null }))}
          >
            Reset to default
          </Button>
        }
      />
      <SaveStatus state={reset.state} />
      {canEditGlobal ? (
        <Editor
          key={`def-${setting.default}`}
          label={`Default for everyone: ${label.toLowerCase()}`}
          initial={setting.default}
          numeric={numeric}
          save={(v) => saveGlobal({ defaults: { [name]: v } })}
          onSaved={onSaved}
        />
      ) : (
        <SetByAdmin />
      )}
    </div>
  )
}
