// One checklist question as a plain row (CP-37): a state box that cycles on click, the question,
// a muted suffix, and a ⋯ menu that appears on hover or focus. Called by ChecklistItems.
import { useState } from 'react'
import { Icon } from '../../../design-system'
import type { CheckResult, ChecklistItem } from '../api'
import { itemTitle } from '../checklistChecks'
import { MoreMenu, type MoreMenuItem } from './MoreMenu'
import '../checklist.css'

export type Mark = 'confirmed' | 'differs' | 'not_seen'

// none -> tick -> cross -> not seen -> none. Not applicable (set before) goes to none.
const NEXT: Record<string, Mark | null> = {
  none: 'confirmed',
  confirmed: 'differs',
  differs: 'not_seen',
  not_seen: null,
  not_applicable: null,
}
const STATE: Record<string, { icon: string | null; label: string }> = {
  none: { icon: null, label: 'Not checked' },
  confirmed: { icon: 'check', label: 'Confirmed' },
  differs: { icon: 'x', label: 'Differs' },
  not_seen: { icon: 'eye-off', label: 'Not seen' },
  not_applicable: { icon: 'minus', label: 'Not applicable' },
}

// The mark an item moves to when its state box is pressed.
function nextMark(result: CheckResult | undefined): Mark | null {
  return NEXT[result ?? 'none']
}

// "Fixed", and "Past report: <title>" where the question came from past reports.
function suffix(item: ChecklistItem) {
  const parts = [
    item.fixed && 'Fixed',
    item.sourceReports?.length &&
      `Past report: ${item.sourceReports.map((r) => r.title).join(', ')}`,
  ].filter(Boolean)
  return parts.join(' · ')
}

/** Returns one question's row; the menu shows only when there is something to do in it. */
export function ChecklistRow({
  item,
  canChange,
  flash,
  onMark,
  onSaveText,
  onRemove,
  onRecord,
  onViewObservation,
}: {
  item: ChecklistItem
  canChange: boolean
  flash: boolean
  onMark: (next: Mark | null) => void
  onSaveText: (text: string) => Promise<void>
  onRemove: () => void
  // Only in the site walk: record what was seen as a difference.
  onRecord?: () => void
  onViewObservation: (observationId: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(item.text)
  const [saving, setSaving] = useState(false)
  const title = itemTitle(item)
  const state = STATE[item.check?.result ?? 'none']
  const observation = item.check?.observation
  const save = async () => {
    const next = text.trim()
    if (!next || next === item.text) return setEditing(false)
    setSaving(true)
    try {
      await onSaveText(next)
      setEditing(false)
    } catch {
      // The parent says why; the box stays open to try again.
    } finally {
      setSaving(false)
    }
  }
  const menu: MoreMenuItem[] = [
    { label: 'Edit', icon: 'pencil', onSelect: () => (setText(item.text), setEditing(true)) },
    { label: 'Delete', icon: 'trash-2', onSelect: onRemove },
    ...(onRecord ? [{ label: 'Record what you saw...', icon: 'mic', onSelect: onRecord }] : []),
  ]
  return (
    <li
      id={'checklist-item-' + item.id}
      aria-label={title}
      className={'cl-row' + (flash ? ' cl-row-flash' : '')}
    >
      {observation || !canChange ? (
        // Answered through an observation, or not the engineer's to change: shown, not pressed.
        <span
          className="cl-state"
          role="img"
          aria-label={state.label}
          data-mark={item.check?.result ?? 'none'}
        >
          {state.icon && <Icon name={state.icon} size={16} />}
        </span>
      ) : (
        <button
          type="button"
          className="cl-state"
          data-mark={item.check?.result ?? 'none'}
          aria-label={`${title}: ${state.label}, press to change`}
          onClick={() => onMark(nextMark(item.check?.result))}
        >
          {state.icon && <Icon name={state.icon} size={16} />}
        </button>
      )}
      {editing ? (
        <input
          className="cl-edit"
          aria-label={`Edit ${title}`}
          autoFocus
          value={text}
          disabled={saving}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <span className="cl-row-text">
          {title}
          {suffix(item) && <span className="cl-suffix">{suffix(item)}</span>}
          {observation && (
            <button
              type="button"
              className="cl-link"
              style={{ marginLeft: 8 }}
              onClick={() => onViewObservation(observation.id)}
            >
              View observation
            </button>
          )}
        </span>
      )}
      {canChange && !editing && (
        <span className="cl-more">
          <MoreMenu items={menu} label={`More actions for ${title}`} />
        </span>
      )}
    </li>
  )
}
