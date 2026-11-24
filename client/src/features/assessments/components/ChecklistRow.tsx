// One checklist question as a plain row (CP-37): a state box that cycles on click, the question,
// a quiet "Fixed" tag, a "from ..." line, a link menu on ticked and crossed rows, and a ⋯ menu that appears on hover or focus. Called by ChecklistItems.
import { useState } from 'react'
import { Icon } from '../../../design-system'
import type { CheckResult, ChecklistItem } from '../api'
import { ChecklistEditText } from './ChecklistEditText'
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

// The "from ..." line under a question: its standards, else the past reports it came from.
function sourceLine(item: ChecklistItem) {
  const titles = item.sourceStandards?.length
    ? item.sourceStandards.map((s) => s.title)
    : (item.sourceReports ?? []).map((r) => r.title)
  return titles.length ? `from ${titles.join(', ')}` : null
}

/** Returns one question's row; the menus show only when there is something to do in them. */
export function ChecklistRow({
  item,
  canChange,
  flash,
  onMark,
  onSaveText,
  onRemove,
  onToggleImportant,
  onRecord,
  onViewObservation,
  onLinkExisting,
  onCreateObservation,
  onUnlink,
}: {
  item: ChecklistItem
  canChange: boolean
  flash: boolean
  onMark: (next: Mark | null) => void
  onSaveText: (text: string) => Promise<void>
  onRemove: () => void
  // Marks the item important, or removes the mark; the menu says which.
  onToggleImportant: () => void
  // Only in the site walk: record what was seen as a difference.
  onRecord?: () => void
  onViewObservation: (observationId: string) => void
  // Only for the engineer answering: the link menu on a ticked or crossed row.
  onLinkExisting?: () => void
  onCreateObservation?: () => void
  onUnlink?: () => void
}) {
  const [editing, setEditing] = useState(false)
  // True after an edit closes, so the text fades back in instead of snapping.
  const [faded, setFaded] = useState(false)
  const title = item.text
  const source = sourceLine(item)
  const state = STATE[item.check?.result ?? 'none']
  const observation = item.check?.observation
  const answered = item.check?.result === 'confirmed' || item.check?.result === 'differs'
  const menu: MoreMenuItem[] = [
    { label: 'Edit', icon: 'pencil', onSelect: () => (setFaded(false), setEditing(true)) },
    {
      label: item.important ? 'Remove importance' : 'Mark as important',
      icon: 'star',
      onSelect: onToggleImportant,
    },
    { label: 'Delete', icon: 'trash-2', onSelect: onRemove },
    ...(onRecord ? [{ label: 'Record what you saw...', icon: 'mic', onSelect: onRecord }] : []),
  ]
  const linkMenu: MoreMenuItem[] = observation
    ? [
        {
          label: 'View observation',
          icon: 'eye',
          onSelect: () => onViewObservation(observation.id),
        },
        ...(onUnlink ? [{ label: 'Unlink observation', icon: 'unlink', onSelect: onUnlink }] : []),
      ]
    : [
        ...(onLinkExisting
          ? [{ label: 'Link existing observation', icon: 'link', onSelect: onLinkExisting }]
          : []),
        ...(onCreateObservation
          ? [{ label: 'Create new observation', icon: 'plus', onSelect: onCreateObservation }]
          : []),
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
        <ChecklistEditText
          initial={item.text}
          label={`Edit ${title}`}
          onSave={onSaveText}
          onDone={() => (setFaded(true), setEditing(false))}
        />
      ) : (
        <span className={'cl-row-text' + (faded ? ' cl-fade' : '')}>
          {item.important && (
            <Icon
              name="star"
              size={14}
              title="Important"
              className="cl-important"
              color="var(--text-secondary)"
            />
          )}
          {title}
          {item.fixed && <span className="cl-suffix">Fixed</span>}
          {observation && (
            <button
              type="button"
              className="cl-link"
              onClick={() => onViewObservation(observation.id)}
            >
              View observation
            </button>
          )}
          {source && (
            <span className="cl-source" title={source}>
              {source}
            </span>
          )}
        </span>
      )}
      {canChange && !editing && answered && linkMenu.length > 0 && (
        <span className="cl-link-menu">
          <MoreMenu
            items={linkMenu}
            icon="link"
            size="sm"
            label="Link an observation"
            popoverLabel="Link an observation"
          />
        </span>
      )}
      {canChange && !editing && (
        <span className="cl-more">
          <MoreMenu items={menu} size="sm" label={`More actions for ${title}`} />
        </span>
      )}
    </li>
  )
}
