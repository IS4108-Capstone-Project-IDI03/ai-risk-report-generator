// The Focus button in the Assessments top bar (AS-06 AC 12, boards 08 and 09): "Focus" with the
// number of assessments in Focus, opening a popover with the top three and a "See all" link
// to the full list. Hidden when nothing is in Focus. On a phone the popover is a sheet (built
// into Popover). Used by screens/Dashboard. Calls FocusRow and FocusAllDialog.
import { useState } from 'react'
import { Icon, Popover, useIsPhone } from '../../../design-system'
import { FocusAllDialog } from './FocusAllDialog'
import { FocusRow, type FocusItem } from './FocusRow'
import './focus.css'

/** Returns the button and its popover, or nothing when `items` is empty. `onOpen` opens a row's
    assessment (the list's own open path, reading the row's data-id). */
export function FocusButton({
  items,
  onOpen,
}: {
  items: FocusItem[]
  onOpen: (e: React.MouseEvent<HTMLElement>) => void
}) {
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
  const phone = useIsPhone()
  if (!items.length) return null
  // Opens the assessment first (it reads the clicked row), then closes what held the row.
  const pick = (e: React.MouseEvent<HTMLElement>) => {
    onOpen(e)
    setOpen(false)
    setAll(false)
  }
  return (
    <>
      <Popover
        open={open}
        onOpenChange={setOpen}
        ariaLabel="Focus list"
        align="right"
        className="mb-focus-anchor"
        surfaceClassName="mb-focus-surface"
        trigger={
          <button
            type="button"
            className="mb-focus-btn ds-press"
            data-open={open ? '' : undefined}
            aria-label={`Focus, ${items.length} ${items.length === 1 ? 'assessment' : 'assessments'}`}
            onClick={() => setOpen(!open)}
          >
            <Icon name="target" size={16} />
            {'Focus'}
            <span className="mb-focus-count">{items.length}</span>
          </button>
        }
      >
        <div className="mb-focus-pop">
          {/* The phone sheet already titles itself "Focus list". */}
          {!phone && <h2 className="mb-focus-title">{'Focus list'}</h2>}
          <p className="mb-focus-helper">
            {'The three most urgent assessments for you to work on first.'}
          </p>
          <ol className="mb-focus-rows">
            {items.slice(0, 3).map((item, i) => (
              <FocusRow key={item.reference} item={item} rank={i + 1} onOpen={pick} />
            ))}
          </ol>
          <div className="mb-focus-foot">
            <button
              type="button"
              className="mb-focus-all"
              onClick={() => {
                setOpen(false)
                setAll(true)
              }}
            >
              {`See all ${items.length}`}
              <Icon name="chevron-right" size={14} />
            </button>
          </div>
        </div>
      </Popover>
      {all && <FocusAllDialog items={items} onOpen={pick} onClose={() => setAll(false)} />}
    </>
  )
}
