// One passage's row in the Passages dialog (IN-17), and beneath it when open, the passage in
// full: the region of the page a table, formula or picture was read from, a manual clause's
// screenshots (IN-18), then its text. Used by components/PassagesDialog.tsx.
import { Badge, Icon, IconRegistry } from '../../../design-system'
import { screenshotUrl, type DocumentPassage } from '../api'
import { KINDS, pages } from '../passageText'
import { CitedImage } from '../../sources/CitedImage'
import { CitedRegion } from '../../sources/CitedRegion'
import { PassageBody } from '../../sources/PassageBody'
import { useFoldedText } from '../../sources/useFoldedText'
import { usePassage } from '../../sources/usePassage'

/** One passage's row, and beneath it when open, the passage in full. */
export function PassageRow({
  passage: p,
  documentId,
  fileUrl,
  open,
  onToggle,
}: {
  passage: DocumentPassage
  documentId: string
  // Null for a manual document, which has no file (IN-18).
  fileUrl: string | null
  open: boolean
  onToggle: () => void
}) {
  const panel = `kb-passage-${p.id}`
  const heading = p.headings.at(-1)
  return (
    <>
      <tr
        className={open ? 'kb-prow is-open' : 'kb-prow'}
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest('button')) onToggle()
        }}
      >
        <td className="kb-pcol-pos">{p.position}</td>
        <td className="kb-pcol-section">
          <button
            type="button"
            className="kb-ptoggle"
            aria-expanded={open}
            aria-controls={panel}
            onClick={onToggle}
          >
            <Icon
              name={open ? IconRegistry.action.expand : IconRegistry.action.forward}
              size={14}
            />
            <span className={heading ? undefined : 'is-none'}>{heading ?? 'No heading'}</span>
          </button>
        </td>
        <td className="kb-pcol-text">
          <span className="kb-pexcerpt">{p.text}</span>
        </td>
        <td className="kb-pcol-kind">
          <span className="kb-pkind">
            {KINDS[p.kind]}
            {p.generated && <Badge tone="violet">Generated</Badge>}
          </span>
        </td>
        <td className="kb-pcol-pages">{pages(p)}</td>
      </tr>
      {open && (
        <tr className="kb-pdetail-row">
          <td colSpan={5}>
            <PassageDetail id={panel} passage={p} documentId={documentId} fileUrl={fileUrl} />
          </td>
        </tr>
      )}
    </>
  )
}

/** The opened passage: the region of the page a table, formula or picture was read
    from (loaded only for those), or a manual clause's screenshots (IN-18), then its
    full text. */
function PassageDetail({
  id,
  passage: p,
  documentId,
  fileUrl,
}: {
  id: string
  passage: DocumentPassage
  documentId: string
  // Null for a manual document: there is no page to draw a region from (IN-18).
  fileUrl: string | null
}) {
  // A manual document has no file, so no region to load for it.
  const loaded = usePassage(p.kind === 'text' || !fileUrl ? undefined : p.id)
  const fold = useFoldedText(
    loaded.status === 'ready' ? loaded.passage.region : null,
    (p.images ?? []).length > 0,
  )
  return (
    <section id={id} className="kb-pdetail" aria-label={`Passage ${p.position}`}>
      {/* The original first, as in chat (KB-02): a picture's description can run long. */}
      {loaded.status === 'ready' && fileUrl && (
        <CitedRegion fileUrl={fileUrl} region={loaded.passage.region} onDrawn={fold.onDrawn} />
      )}
      <CitedImage
        urls={(p.images ?? []).map((key) => screenshotUrl(documentId, key))}
        alt={KINDS[p.kind]}
      />
      {p.generated && (
        <p className="kb-pgenerated">
          This picture was described by AI, so these aren’t the document’s own words.
        </p>
      )}
      <PassageBody text={p.text} quote="" className="kb-passage-body" folded={fold.folded} />
    </section>
  )
}
