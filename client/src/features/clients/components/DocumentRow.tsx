// One file in the client's Documents tab (CP-23 AC14, board 07): file tile, name
// and where it came from, its Tag pill, added date, size, and the actions
// (open the original, delete). On a phone: name and tag only, and a ⋯ More sheet
// (Download, Change tag, Delete document; board 22). Called by screens/DocumentsTab.
// Opens /api/client-documents/:id/file in a new tab.
import { useState } from 'react'
import {
  FileTile,
  Icon,
  IconButton,
  IconRegistry,
  Sheet,
  TagPicker,
  useIsPhone,
  type TagOption,
} from '../../../design-system'
import { formatDay } from '../../assessments/format'
import { documentDownloadUrl, documentFileUrl, type ClientDocument } from '../api'
import { fileSize } from '../formatClient'
import { DocumentTagCell } from './DocumentTagCell'
import { RowAction } from './RowAction'

export function DocumentRow({
  doc,
  tagOptions,
  onTag,
  onDelete,
  fresh = false,
  retagged = false,
  leaving = false,
}: {
  doc: ClientDocument
  tagOptions: TagOption[]
  onTag: (doc: ClientDocument, value: string) => void
  onDelete: (doc: ClientDocument) => void
  // Board 17 · 7: just uploaded (tint), just retagged (tag cross-fade), being deleted (fade-out).
  fresh?: boolean
  retagged?: boolean
  leaving?: boolean
}) {
  const phone = useIsPhone()
  const [more, setMore] = useState(false)
  const [tagging, setTagging] = useState(false)
  if (phone)
    return (
      <tr
        data-fresh={fresh || undefined}
        data-retagged={retagged || undefined}
        data-leaving={leaving || undefined}
      >
        <td className="cl-cell-main cl-doc-phone">
          <div className="cl-flex">
            <FileTile name={doc.name} contentType={doc.contentType} />
            <span className="cl-lines">
              <span className="cl-line-1" dir="auto">
                {doc.name}
              </span>
              <span className="cl-line-2 cl-doc-tag">
                <Icon name="tag" size={14} />
                <span className="cl-ellip">{doc.tag}</span>
              </span>
            </span>
            <IconButton
              icon="ellipsis"
              label={`More actions for ${doc.name}`}
              tooltip="More actions"
              size="lg"
              onClick={() => setMore(true)}
            />
          </div>
          <Sheet
            open={more}
            onClose={() => setMore(false)}
            title={doc.name}
            actions={[
              {
                label: 'Download',
                icon: 'download',
                onSelect: () => window.open(documentDownloadUrl(doc.id), '_blank', 'noopener'),
              },
              { label: 'Change tag', icon: 'tag', onSelect: () => setTagging(true) },
              {
                label: 'Delete document',
                icon: IconRegistry.action.discard,
                destructive: true,
                onSelect: () => onDelete(doc),
              },
            ]}
          />
          <Sheet
            open={tagging}
            onClose={() => setTagging(false)}
            title="Tag this document"
            subtitle={doc.name}
            cancel
          >
            <TagPicker
              radios
              options={tagOptions}
              value={tagOptions.find((o) => o.label === doc.tag)?.value}
              onChange={(value) => {
                setTagging(false)
                onTag(doc, value)
              }}
            />
          </Sheet>
        </td>
      </tr>
    )
  return (
    <tr
      data-fresh={fresh || undefined}
      data-retagged={retagged || undefined}
      data-leaving={leaving || undefined}
    >
      <td className="cl-cell-main">
        <div className="cl-flex">
          <FileTile name={doc.name} contentType={doc.contentType} />
          <span className="cl-lines">
            <span className="cl-line-1" title={doc.name}>
              <span className="cl-ellip" dir="auto">
                {doc.name}
              </span>
            </span>
            <span className="cl-line-2">{doc.originLabel}</span>
          </span>
        </div>
      </td>
      <td data-label="Tag" key={doc.tag}>
        <DocumentTagCell doc={doc} options={tagOptions} onChoose={(v) => onTag(doc, v)} />
      </td>
      <td data-label="Added" className="cl-num-text">
        {formatDay(new Date(doc.uploadedAt))}
      </td>
      <td data-label="Size" className="cl-num-text cl-size">
        {fileSize(doc.size)}
      </td>
      <td className="cl-cell-actions">
        <span className="cl-row-actions cl-row-actions--always">
          <RowAction
            icon="download"
            label={`Open ${doc.name}`}
            tooltip="Open file"
            href={documentFileUrl(doc.id)}
          />
          <RowAction
            icon={IconRegistry.action.discard}
            label={`Delete ${doc.name}`}
            tooltip="Delete document"
            danger
            onClick={() => onDelete(doc)}
          />
        </span>
      </td>
    </tr>
  )
}
