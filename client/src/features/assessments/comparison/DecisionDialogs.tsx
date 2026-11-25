// The Comparison tab's decision dialogs (RV-13): changing an item's outcome,
// pairing it with other current evidence, and pairing a New item with the
// previous report's item it matches. Each saves one decision through the
// gateway, which records it with the engineer's name and time; a refused one
// shows its reason under the field it is about. Called by ComparisonDetail.
import { useState } from 'react'
import { Button, Checkbox, Dialog, Radio, Select, Textarea } from '../../../design-system'
import type { ComparisonItem, CurrentSource, Decision, Outcome } from './api'
import { CHOOSABLE, OUTCOME_LABEL, itemTitle, sourceLabel } from './comparisonDisplay'
import type { DecisionRefusal } from './useComparison'

const MAX_NOTE = 500

type Save = (decision: Decision) => Promise<DecisionRefusal | null>

// The dialog's buttons and its saving state: Save closes it once the gateway took it.
function useSave(onClose: () => void) {
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<DecisionRefusal | null>(null)
  const save = async (send: () => Promise<DecisionRefusal | null>) => {
    setBusy(true)
    const refused = await send()
    setBusy(false)
    if (refused) setRefusal(refused)
    else onClose()
  }
  return { busy, refusal, save }
}

function Footer({
  busy,
  onClose,
  onSave,
  label = 'Save',
}: {
  busy: boolean
  onClose: () => void
  onSave: () => void
  label?: string
}) {
  return (
    <>
      <Button pill variant="secondary" onClick={onClose} disabled={busy}>
        {'Cancel'}
      </Button>
      <Button pill variant="primary" onClick={onSave} disabled={busy} loading={busy}>
        {label}
      </Button>
    </>
  )
}

// Fixed with nothing current behind it needs a short note (AC "Setting Fixed
// without a current source requires a short note").
const needsNote = (outcome: Outcome, sources: number) => outcome === 'fixed' && !sources

function NoteField({
  value,
  onChange,
  required,
  error,
}: {
  value: string
  onChange: (v: string) => void
  required: boolean
  error?: string
}) {
  return (
    <Textarea
      label={required ? 'Note' : 'Note (optional)'}
      hint={required ? 'Say how you know it was fixed: nothing current records it.' : undefined}
      rows={3}
      maxLength={MAX_NOTE}
      value={value}
      error={error}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

/** Changing a previous item's outcome. Not checked is offered only once nothing current is paired. */
export function OutcomeDialog({
  item,
  onClose,
  onDecide,
}: {
  item: ComparisonItem
  onClose: () => void
  onDecide: Save
}) {
  const choices = CHOOSABLE.filter((o) => o !== 'not_checked' || !item.sources.length)
  const start = item.outcome && item.outcome !== 'new' ? item.outcome : choices[0]
  const [outcome, setOutcome] = useState<Outcome>(start)
  const [note, setNote] = useState(item.decided?.note ?? '')
  const { busy, refusal, save } = useSave(onClose)
  const required = needsNote(outcome, item.sources.length)
  const [noteError, setNoteError] = useState<string | undefined>()
  const submit = () => {
    if (required && !note.trim()) {
      setNoteError('Add a short note saying how you know it was fixed.')
      return
    }
    void save(() =>
      onDecide({ action: 'outcome', outcome, ...(note.trim() && { note: note.trim() }) }),
    )
  }
  return (
    <Dialog
      open
      className="ds-dialog--v2"
      title="Change outcome"
      width={480}
      onClose={onClose}
      footer={<Footer busy={busy} onClose={onClose} onSave={submit} />}
    >
      <fieldset className="cmp-choices">
        <legend className="cmp-label">{'Outcome'}</legend>
        {choices.map((o) => (
          <Radio
            key={o}
            name="cmp-outcome"
            label={OUTCOME_LABEL[o]}
            checked={outcome === o}
            onChange={() => setOutcome(o)}
          />
        ))}
      </fieldset>
      <NoteField
        value={note}
        onChange={(v) => {
          setNote(v)
          setNoteError(undefined)
        }}
        required={required}
        error={noteError ?? refusal?.fields.note ?? refusal?.fields.outcome}
      />
    </Dialog>
  )
}

const GROUPS: { kind: CurrentSource['kind']; label: string }[] = [
  { kind: 'observation', label: 'Observations' },
  { kind: 'finding', label: 'Draft findings' },
  { kind: 'recommendation', label: 'Draft OFIs' },
]

/** Re-pairing a previous item: which current evidence it is compared with, and its outcome. */
export function PairDialog({
  item,
  sources,
  onClose,
  onDecide,
}: {
  item: ComparisonItem
  sources: CurrentSource[]
  onClose: () => void
  onDecide: Save
}) {
  const [chosen, setChosen] = useState<string[]>(item.sources)
  const start = item.outcome && item.outcome !== 'new' ? item.outcome : 'unchanged'
  const [outcome, setOutcome] = useState<Outcome>(start)
  const [note, setNote] = useState('')
  const { busy, refusal, save } = useSave(onClose)
  const choices = CHOOSABLE.filter((o) => o !== 'not_checked' || !chosen.length)
  const effective = choices.includes(outcome) ? outcome : choices[0]
  const required = needsNote(effective, chosen.length)
  const [noteError, setNoteError] = useState<string | undefined>()
  const toggle = (key: string, on: boolean) =>
    setChosen((now) => (on ? [...now, key] : now.filter((k) => k !== key)))
  const submit = () => {
    if (required && !note.trim()) {
      setNoteError('Add a short note saying how you know it was fixed.')
      return
    }
    void save(() =>
      onDecide({
        action: 'pair',
        sources: chosen,
        outcome: effective,
        ...(note.trim() && { note: note.trim() }),
      }),
    )
  }
  return (
    <Dialog
      open
      className="ds-dialog--v2"
      title="Re-pair with current evidence"
      description="Choose what in this assessment this previous item is compared with."
      width={560}
      onClose={onClose}
      footer={<Footer busy={busy} onClose={onClose} onSave={submit} />}
    >
      <div className="cmp-pick">
        {GROUPS.map((g) => {
          const list = sources.filter((s) => s.kind === g.kind)
          if (!list.length) return null
          return (
            <fieldset key={g.kind} className="cmp-choices">
              <legend className="cmp-label">{g.label}</legend>
              {list.map((s) => (
                <Checkbox
                  key={s.key}
                  label={sourceLabel(s)}
                  description={s.text}
                  checked={chosen.includes(s.key)}
                  onChange={(on) => toggle(s.key, on)}
                />
              ))}
            </fieldset>
          )
        })}
      </div>
      {refusal?.fields.sources && <p className="cmp-error">{refusal.fields.sources}</p>}
      <Select
        label="Outcome"
        value={effective}
        options={choices.map((o) => ({ value: o, label: OUTCOME_LABEL[o] }))}
        onChange={(e) => setOutcome(e.target.value as Outcome)}
        error={refusal?.fields.outcome}
      />
      <NoteField
        value={note}
        onChange={(v) => {
          setNote(v)
          setNoteError(undefined)
        }}
        required={required}
        error={noteError ?? refusal?.fields.note}
      />
    </Dialog>
  )
}

/**
 * Pairing a New item with the previous report's item it matches: saved as a
 * pairing of that previous item, which then lists it with its other sources.
 */
export function PairNewDialog({
  source,
  previousItems,
  onClose,
  onDecide,
}: {
  source: CurrentSource
  previousItems: ComparisonItem[]
  onClose: () => void
  onDecide: (item: string, decision: Decision) => Promise<DecisionRefusal | null>
}) {
  const [target, setTarget] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome>('unchanged')
  const { busy, refusal, save } = useSave(onClose)
  const [pickError, setPickError] = useState<string | undefined>()
  const sources = new Map([[source.key, source]])
  const choices = CHOOSABLE.filter((o) => o !== 'not_checked')
  const submit = () => {
    const item = previousItems.find((i) => i.key === target)
    if (!item) {
      setPickError('Choose the previous item it matches.')
      return
    }
    void save(() =>
      onDecide(item.key, {
        action: 'pair',
        sources: [...new Set([...item.sources, source.key])],
        outcome,
      }),
    )
  }
  return (
    <Dialog
      open
      className="ds-dialog--v2"
      title="Pair with a previous item"
      description={`${sourceLabel(source)}: choose the previous report's item it matches.`}
      width={560}
      onClose={onClose}
      footer={<Footer busy={busy} onClose={onClose} onSave={submit} label="Pair" />}
    >
      <fieldset className="cmp-choices cmp-pick">
        <legend className="cmp-label">{'Previous report'}</legend>
        {previousItems.map((i) => (
          <Radio
            key={i.key}
            name="cmp-target"
            label={itemTitle(i, sources)}
            description={i.previous?.quote}
            checked={target === i.key}
            onChange={() => {
              setTarget(i.key)
              setPickError(undefined)
            }}
          />
        ))}
      </fieldset>
      {(pickError || refusal?.message) && (
        <p className="cmp-error">{pickError ?? refusal?.message}</p>
      )}
      <Select
        label="Outcome"
        value={outcome}
        options={choices.map((o) => ({ value: o, label: OUTCOME_LABEL[o] }))}
        onChange={(e) => setOutcome(e.target.value as Outcome)}
      />
    </Dialog>
  )
}
