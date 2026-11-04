// Asks before a filled-in site leaves the New Assessment form (CP-23): its
// documents move to the whole client. Called by SiteCard.tsx, which removes
// the site on confirm.
import { Button, Dialog } from '../../../design-system'

export function RemoveSiteDialog({
  name,
  documents,
  onRemove,
  onClose,
}: {
  name: string
  documents: number
  onRemove: () => void
  onClose: () => void
}) {
  return (
    <Dialog
      className="ds-dialog--v2"
      title={`Remove ${name}?`}
      description={
        documents
          ? `Its assessments are removed from this form, and ${documents === 1 ? 'its document moves' : `its ${documents} documents move`} to Whole client.`
          : 'Its assessments are removed from this form too.'
      }
      width={440}
      onClose={onClose}
      footer={
        <>
          <Button pill variant="secondary" onClick={onClose}>
            {'Cancel'}
          </Button>
          <Button pill variant="danger" onClick={onRemove}>
            {'Remove'}
          </Button>
        </>
      }
    />
  )
}
