// The Split note button and panel under the Note box (CP-35): shows the proposed parts in three
// groups, lets the engineer fix them, and confirms them (held as fParts until Save observation).
// Called by screens/SiteObservation. Calls useSplitNote and PartRow.
import { useEffect } from 'react'
import { Button, Icon } from '../../../design-system'
import { Tip } from '../../help/Tip'
import { useWalkStep } from '../../site-walk/walkSteps'
import { signal } from '../../walkthrough/signals'
import type { Part } from '../api'
import {
  addTo,
  clearFlag,
  editText,
  KINDS,
  mergeNext,
  moveTo,
  nextInGroup,
  remove,
  split,
  summary,
} from '../noteParts'
import { PartRow } from './PartRow'
import { useSplitNote } from './useSplitNote'
import '../split-note.css'

// Each group heading's data-walk tag (F-12): "Use note codes and Split note" lights the three headings one by one.
const GROUP_WALK = {
  fact: 'new-observation.split-facts',
  info_request: 'new-observation.split-info-requests',
  recommendation: 'new-observation.split-recommendations',
} as const

type Props = {
  reference: string
  note: string
  saving: boolean
  parts: Part[] | null
  setParts: (parts: Part[] | null) => void
}

export function SplitNotePanel({ reference, note, saving, parts, setParts }: Props) {
  const s = useSplitNote(reference, note, parts, setParts)
  const { draft, setDraft } = s
  const blocked = draft.some((p) => p.flags.some((f) => f.type === 'unknown_term'))
  const empty = !draft.some((p) => p.text.trim())
  const reason = blocked
    ? 'Add each unknown shorthand to your glossary first.'
    : empty
      ? 'Add some text to a part first.'
      : ''
  const change = (next: Part[]) => setDraft(next)
  // F-12: the walkthrough waits for the parts to show; this tells it they have.
  const opened = s.status === 'open'
  useEffect(() => {
    if (opened) signal('note-split-opened')
  }, [opened])
  // A failed split ends the try-it with MarshBot's "didn't work" line instead of leaving it waiting.
  const walking = useWalkStep('split-note') > 0
  const failed = !!s.error
  useEffect(() => {
    if (walking && failed) signal('try-it-failed')
  }, [walking, failed])

  return (
    <div className="sp">
      {s.status !== 'open' && s.status !== 'confirmed' && (
        <div className="sp-lead">
          <Button
            variant="secondary"
            size="lg"
            disabled={!note.trim() || saving || s.status === 'loading'}
            loading={s.status === 'loading'}
            data-walk="new-observation.split"
            onClick={s.start}
          >
            Split note
          </Button>
          <Tip id="new-observation.split-note" align="left" />
        </div>
      )}
      {s.stale && <p className="sp-note">The note changed, so split it again.</p>}
      {s.error && (
        <p className="sp-err" role="alert">
          <Icon name="octagon-alert" size={14} color="var(--red-600)" />
          <span>{s.error.problem}</span>
          <span className="sp-fix">{s.error.fix}</span>
        </p>
      )}
      {s.status === 'confirmed' && parts && (
        <p className="sp-summary">
          <Icon name="circle-check" size={16} color="var(--green-600)" />
          <span>{summary(parts)}</span>
          <Button variant="secondary" size="lg" onClick={s.edit}>
            Edit parts
          </Button>
        </p>
      )}
      {s.status === 'open' && (
        <section
          className="sp-panel"
          aria-label="Split note"
          data-walk="new-observation.split-panel"
        >
          {KINDS.map(({ kind, heading }) => {
            const group = draft.filter((p) => p.kind === kind)
            return (
              <div key={kind} className="sp-group" role="group" aria-label={heading}>
                <h3 className="sp-heading" data-walk={GROUP_WALK[kind as keyof typeof GROUP_WALK]}>
                  <span className={`sp-chip sp-chip--${kind}`}>{heading}</span>
                  <span className="sp-count">{group.length}</span>
                </h3>
                {group.length === 0 ? (
                  <p className="sp-none">None</p>
                ) : (
                  <ul className="sp-list">
                    {group.map((part) => (
                      <PartRow
                        key={part.id}
                        part={part}
                        hasNext={!!nextInGroup(draft, part.id)}
                        onText={(t) => change(editText(draft, part.id, t))}
                        onMove={(k) => change(moveTo(draft, part.id, k))}
                        onSplit={() => change(split(draft, part.id))}
                        onMerge={() => change(mergeNext(draft, part.id))}
                        onDelete={() => change(remove(draft, part.id))}
                        onClearFlag={(f) => change(clearFlag(draft, part.id, f))}
                        onAddTerm={s.addTerm}
                      />
                    ))}
                  </ul>
                )}
                <Button variant="ghost" size="lg" onClick={() => change(addTo(draft, kind))}>
                  + Add part
                </Button>
              </div>
            )
          })}
          <div className="sp-foot">
            <Button
              variant="primary"
              size="lg"
              disabled={!!reason}
              onClick={s.confirm}
              title={reason}
            >
              Confirm all parts
            </Button>
            <Button variant="secondary" size="lg" onClick={s.cancel}>
              Cancel
            </Button>
            {reason && <span className="sp-fix">{reason}</span>}
          </div>
        </section>
      )}
    </div>
  )
}
