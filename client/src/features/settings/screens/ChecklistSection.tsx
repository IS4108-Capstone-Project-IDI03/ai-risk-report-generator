// Settings > Checklist (CP-37 AC4): the fixed questions every checklist gets for a site type. A
// knowledge admin picks a site type, adds, edits and removes its items, and restores removed
// ones. Anyone else sees that an admin sets them. Called by Settings.tsx. Calls the fixed item
// functions in api.ts through useFixedItems.
import { useState } from 'react'
import { Button, EmptyState, Input, Select, toast } from '../../../design-system'
import { GatewayError } from '../../assessments/api'
import {
  addFixedItem,
  editFixedItem,
  removeFixedItem,
  restoreFixedItem,
  type FixedItem,
} from '../api'
import { FixedItemRow } from '../components/FixedItemRow'
import { SetByAdmin } from '../components/SetByAdmin'
import { useFixedItems } from '../useFixedItems'

const message = (error: unknown, fallback: string) =>
  error instanceof GatewayError && error.message ? error.message : fallback

export function ChecklistSection({ canEdit }: { canEdit: boolean }) {
  if (!canEdit) return <SetByAdmin />
  return <Editor />
}

function Editor() {
  const { data, problem, reload } = useFixedItems()
  const [type, setType] = useState('')
  const [text, setText] = useState('')
  const [area, setArea] = useState('')
  const [addError, setAddError] = useState('')

  if (problem)
    return (
      <p className="st-err" role="alert">
        {problem}{' '}
        <Button variant="link" onClick={() => void reload()}>
          Try again
        </Button>
      </p>
    )
  if (!data) return <p className="st-note">Loading…</p>
  const facilityType = type || data.facilityTypes[0] || ''
  const mine = data.items.filter((i) => i.facilityType === facilityType)
  const active = mine.filter((i) => !i.removed)
  const removed = mine.filter((i) => i.removed)

  // Runs one change, then reads the list again; returns the error to show, or ''.
  const run = async (change: () => Promise<unknown>, fallback: string) => {
    try {
      await change()
      await reload()
      return ''
    } catch (error) {
      return message(error, fallback)
    }
  }
  const add = async () => {
    if (!text.trim()) return setAddError('Write the question first.')
    const problem = await run(
      () =>
        addFixedItem({
          facilityType,
          text: text.trim(),
          ...(area.trim() && { area: area.trim() }),
        }),
      'The item was not added. Try again.',
    )
    setAddError(problem)
    if (!problem) {
      setText('')
      setArea('')
      toast.success('Item added')
    }
  }
  const remove = async (item: FixedItem) => {
    const problem = await run(() => removeFixedItem(item.id), 'The item was not removed.')
    if (problem) toast.error(problem)
    else toast.success('Item removed')
  }
  const restore = async (item: FixedItem) => {
    const problem = await run(() => restoreFixedItem(item.id), 'The item was not restored.')
    if (problem) toast.error(problem)
    else toast.success('Item restored')
  }

  return (
    <div className="st-stack">
      <p className="st-note">
        Fixed questions appear on every checklist for the site type, whatever past reports say.
      </p>
      <Select
        label="Site type"
        value={facilityType}
        options={data.facilityTypes}
        onChange={(e) => setType(e.target.value)}
      />
      {active.length === 0 ? (
        <EmptyState icon="list-checks" title={`No fixed items for ${facilityType} yet`} />
      ) : (
        <ul className="st-cl-list" aria-label={`Fixed items for ${facilityType}`}>
          {active.map((item) => (
            <FixedItemRow
              key={item.id + item.text + item.area}
              item={item}
              onSave={(id, t, a) =>
                run(() => editFixedItem(id, { text: t, area: a }), 'The change was not saved.')
              }
              onRemove={(i) => void remove(i)}
            />
          ))}
        </ul>
      )}
      <form
        className="st-stack"
        aria-label="Add a fixed item"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <Input label="New question" value={text} onChange={(e) => setText(e.target.value)} />
        <Input
          label="Report section (optional)"
          value={area}
          onChange={(e) => setArea(e.target.value)}
        />
        {addError && (
          <p className="st-err" role="alert">
            {addError}
          </p>
        )}
        <div className="st-row-head">
          <Button type="submit" variant="primary" size="lg">
            Add item
          </Button>
        </div>
      </form>
      {removed.length > 0 && (
        <details>
          <summary className="st-row-label">Removed ({removed.length})</summary>
          <ul className="st-cl-list">
            {removed.map((item) => (
              <li key={item.id} className="st-cl-row">
                <div className="st-cl-text">{item.text}</div>
                <Button
                  variant="pill"
                  aria-label={`Restore ${item.text}`}
                  onClick={() => void restore(item)}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
