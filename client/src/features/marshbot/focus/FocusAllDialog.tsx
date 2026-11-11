// The full Focus list (AS-06 AC 12, board 09): a v2 dialog with every assessment in Focus,
// ranked, each with its Report due cell. Opened by FocusButton's "See all". Calls FocusRow.
import { Dialog } from '../../../design-system'
import { FocusRow, type FocusItem } from './FocusRow'

/** Returns the dialog; picking a row opens that assessment through `onOpen`. */
export function FocusAllDialog({
  items,
  onOpen,
  onClose,
}: {
  items: FocusItem[]
  onOpen: (e: React.MouseEvent<HTMLElement>) => void
  onClose: () => void
}) {
  return (
    <Dialog
      className="ds-dialog--v2 mb-focus-dialog"
      title="Focus list"
      description={`${items.length} ${items.length === 1 ? 'assessment' : 'assessments'}, most urgent first.`}
      width={760}
      onClose={onClose}
    >
      <ol className="mb-focus-rows">
        {items.map((item, i) => (
          <FocusRow key={item.reference} item={item} rank={i + 1} onOpen={onOpen} showDue />
        ))}
      </ol>
    </Dialog>
  )
}
