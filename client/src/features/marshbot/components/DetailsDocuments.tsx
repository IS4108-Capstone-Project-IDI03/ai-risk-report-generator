// The Details panel's Client Documents block (AS-06, board D1): the newest few with a count,
// See All, and a way to add one to this assessment. Called by DetailsContent.tsx. Calls
// clients/api.ts getClientDocuments and uploadClientDocuments.
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { AddRow, FileTile, IconAction, toast } from '../../../design-system'
import type { Assessment } from '../../assessments/api'
import { formatDay } from '../../assessments/format'
import { getClientDocuments, uploadClientDocuments, type ClientDocument } from '../../clients/api'
import { fileSize } from '../../clients/formatClient'
import { toastUploadResults } from '../../clients/uploadToast'
import { ACCEPT } from '../../new-assessment/reading'
import { DetailsHeading, DetailsLink } from './DetailsHeading'

/** Returns the client's documents about this assessment, newest first ('failed' when they couldn't be read), and `reload`, which reads them again. */
// eslint-disable-next-line react-refresh/only-export-components -- the hook belongs with its block
export function useDocuments(record: Pick<Assessment, 'clientId' | 'id' | 'site'>) {
  const [docs, setDocs] = useState<ClientDocument[] | 'failed' | null>(null)
  // Bumped to read the list again; the old list stays on screen meanwhile, so nothing flashes.
  const [reads, setReads] = useState(0)
  useEffect(() => {
    if (!record.clientId) return
    const abort = new AbortController()
    getClientDocuments(record.clientId, abort.signal)
      .then((all) =>
        setDocs(
          all
            .filter(({ placement: p }) =>
              p.kind === 'client'
                ? true
                : p.kind === 'site'
                  ? p.siteId === record.site.id
                  : p.assessmentId === record.id,
            )
            .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)),
        ),
      )
      .catch(() => {
        if (!abort.signal.aborted) setDocs('failed')
      })
    return () => abort.abort()
  }, [record.clientId, record.site.id, record.id, reads])
  return { docs, reload: () => setReads((n) => n + 1) }
}

/** Returns `busy` while files go up and `run`, which uploads them to this assessment, says how it went (in `toasterId`'s toaster), and reads the list again. */
// eslint-disable-next-line react-refresh/only-export-components -- the hook belongs with its block
export function useAddDocuments(
  record: Pick<Assessment, 'clientId' | 'id'>,
  toasterId: string | undefined,
  reload: () => void,
) {
  const [busy, setBusy] = useState(false)
  // False once the panel is gone: its own toaster went with it, so the result must use the app's.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const run = async (files: File[]) => {
    // A record with no client (a sample) has nowhere to keep a document.
    if (!record.clientId) return
    setBusy(true)
    try {
      const results = await uploadClientDocuments(record.clientId, files, {
        kind: 'assessment',
        assessmentId: record.id,
      })
      if (toastUploadResults(results, mounted.current ? toasterId : undefined)) reload()
    } catch {
      // Without this a gateway that can't be reached would leave the engineer guessing.
      toast.error('Upload failed', {
        description: 'Check your connection and try again.',
        toasterId: mounted.current ? toasterId : undefined,
      })
    }
    if (mounted.current) setBusy(false)
  }
  return { busy, run }
}

/** Returns the block; `shown` is how many rows fit, `links` makes it one row with just its actions, and `add` (for someone who may edit) is the add action. */
export function DetailsDocuments({
  docs,
  shown,
  links = false,
  onSeeAll,
  add,
}: {
  docs: ClientDocument[] | 'failed'
  shown: number
  links?: boolean
  // Opens the client page's Documents tab (CP-23), where every document is.
  onSeeAll?: () => void
  add?: { busy: boolean; run: (files: File[]) => void }
}) {
  const picker = useRef<HTMLInputElement>(null)
  const block = useRef<HTMLElement>(null)
  // Focus follows the add control. Its press leaves focus on it while the files go up (it is only
  // aria-disabled), but the first document swaps the add row for the plus beside the heading, and
  // the swap would drop focus to the page. So when the upload started with focus on the add
  // control, focus goes to whichever add control is shown once the work is done and the list is in.
  const keepFocus = useRef(false)
  const busy = add?.busy
  const count = Array.isArray(docs) ? docs.length : -1
  useEffect(() => {
    const root = block.current
    const addControl = () =>
      root?.querySelector<HTMLElement>('.ds-add-row, [aria-label="Add a Client Document"]')
    if (busy) {
      keepFocus.current = !!addControl() && document.activeElement === addControl()
      return
    }
    if (!keepFocus.current) return
    // Only a focus that was dropped is put back; one the user moved on is left where it is.
    const at = document.activeElement
    if (!at || at === document.body) {
      addControl()?.focus()
      keepFocus.current = false
    } else if (at !== addControl()) keepFocus.current = false
  }, [busy, count])
  if (docs === 'failed')
    return (
      <section>
        <DetailsHeading>Client Documents</DetailsHeading>
        <p className="mb-none">Couldn’t load the client’s documents.</p>
      </section>
    )
  const more = docs.length - shown
  const seeAll = docs.length > 0 && onSeeAll && (
    <DetailsLink aria-label="See All Client Documents" onClick={onSeeAll}>
      See All
    </DetailsLink>
  )
  // The hidden picker both add controls open. Its files go up at once, then it is cleared so
  // the same file can be chosen again.
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length) add?.run(files)
  }
  const pick = () => picker.current?.click()
  const picked = add && (
    <input
      ref={picker}
      type="file"
      multiple
      hidden
      accept={ACCEPT}
      aria-label="Choose client documents to add"
      onChange={choose}
    />
  )
  // With documents (or no room for a row) the add action is a plus beside the heading's links.
  const plus = add && (docs.length > 0 || links) && (
    <IconAction
      icon="plus"
      label="Add a Client Document"
      tooltip="Add a Client Document"
      // The label is wider than the icon: it ends at the icon's right edge, inside the panel.
      placement="top-end"
      className="mb-hit"
      loading={add.busy}
      onClick={pick}
    />
  )
  const actions = (
    <>
      {plus}
      {seeAll}
    </>
  )
  if (links)
    return (
      <section ref={block}>
        {picked}
        <DetailsHeading
          big
          count={docs.length}
          link={seeAll || plus ? actions : <span className="mb-none">None yet</span>}
        >
          Client Documents
        </DetailsHeading>
      </section>
    )
  return (
    <section ref={block}>
      {picked}
      <DetailsHeading count={docs.length} link={seeAll || plus ? actions : undefined}>
        Client Documents
      </DetailsHeading>
      {docs.length === 0 &&
        (add ? (
          <AddRow loading={add.busy} onClick={pick}>
            Add a Client Document
          </AddRow>
        ) : (
          <p className="mb-none">None yet</p>
        ))}
      {shown > 0 && (
        <ul className="mb-docs">
          {docs.slice(0, shown).map((d) => (
            <li key={d.id}>
              <FileTile name={d.name} contentType={d.contentType} />
              <span className="mb-doc-text">
                <span className="mb-doc-name" title={d.name} dir="auto">
                  {d.name}
                </span>
                <span className="mb-doc-detail">
                  {`${fileSize(d.size)} · ${formatDay(new Date(d.uploadedAt))}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {more > 0 && <p className="mb-more">{`+${more} more`}</p>}
    </section>
  )
}
