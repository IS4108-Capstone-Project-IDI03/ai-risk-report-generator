// A loaded client page (CP-23, boards 06 and 07): header with tabs, Back, the
// removed callout, the tab's content and the facts panel, and the dialogs for
// the client and its sites. Called by ClientPage. Calls the tab screens;
// restores and dialog saves reload the page, the work list and show a toast.
import { useState, type ReactNode } from 'react'
import { Sheet, Tabs, toast } from '../../../design-system'
import { restoreClient, restoreSite, type ClientPage as Page, type ClientPageSite } from '../api'
import { clientFacts, type FactVisit } from '../clientFacts'
import {
  EditSiteDialog,
  RemoveDialog,
  RenameClientDialog,
  RestoreSiteDialog,
} from '../ClientDialogs'
import { ClientFacts } from '../components/ClientFacts'
import { ClientHeader, type HeaderAction } from '../components/ClientHeader'
import { RemovedCallout } from '../components/RemovedCallout'
import { plural } from '../formatClient'
import { useClientDocuments } from '../useClientDocuments'
import { DocumentsTab } from './DocumentsTab'
import { OpenWorkTab } from './OpenWorkTab'
import { SitesTab } from './SitesTab'
import type { ClientRecordProps } from '../ClientPage'

// A site's dialog; the client's own open from the header.
type Open =
  | { kind: 'edit'; site: ClientPageSite }
  | { kind: 'remove'; site: ClientPageSite }
  | { kind: 'restoreName'; site: ClientPageSite }

type TabId = 'open' | 'sites' | 'documents'

export function ClientRecord({
  page,
  onClients,
  bell,
  reload,
  dialog,
  closeDialog,
  menu,
  onNewAssessment,
  onOpen,
  onChanged,
  startTab,
}: ClientRecordProps & { page: Page; onClients: () => void; bell?: ReactNode }) {
  const [tab, setTab] = useState<TabId>(startTab ?? 'open')
  const [open, setOpen] = useState<Open | null>(null)
  const [busy, setBusy] = useState(false)
  const [details, setDetails] = useState(false)
  const docs = useClientDocuments(page.id)

  const client = { id: page.id, name: page.name }
  // A change saved: the page and the work list read it again, and a toast says so.
  // The app's own message is left empty so it doesn't show a second toast.
  const changed = (message: string) => {
    setOpen(null)
    closeDialog()
    void reload()
    onChanged('')
    toast.success(message)
  }
  // Restores run at once, unless the site's name was taken: then it needs a new one.
  const restore = async (run: () => Promise<string>) => {
    if (busy) return
    setBusy(true)
    try {
      changed(await run())
    } catch (failure: unknown) {
      toast.error('Nothing was restored', {
        description: failure instanceof Error ? failure.message : 'Try again.',
      })
    }
    setBusy(false)
  }
  const restoreOne = (site: ClientPageSite) =>
    site.nameTaken
      ? setOpen({ kind: 'restoreName', site })
      : void restore(async () => {
          await restoreSite(site.id)
          return `${site.name} restored.`
        })
  const restoreAll = () =>
    restore(async () => {
      const { restored, nameTaken } = await restoreClient(page.id)
      return (
        `${plural(restored, 'site')} restored.` +
        (nameTaken.length
          ? ` ${nameTaken.join(', ')} ${nameTaken.length === 1 ? 'needs' : 'need'} a new name: restore ${nameTaken.length === 1 ? 'it' : 'them'} from Removed sites.`
          : '')
      )
    })

  const listed = page.sites.filter((s) => !s.removed)
  const facts = clientFacts(
    listed.flatMap((s) =>
      s.visits.map((v): FactVisit => ({
        site: s.name,
        surveyDate: v.siteVisitDate,
        dueDate: v.reportDueDate,
        archived: v.status === 'archived',
        done: v.status === 'archived' || v.status === 'finalised',
      })),
    ),
  )
  // Rename and Remove open through the app's menu model; each shows disabled, with its reason, when refused.
  const headerAction = (label: string, rule: Page['rename']): HeaderAction | null => {
    const item = menu?.items.find((x) => x.label === label)
    return item ? { ...rule, open: () => item.onSelect() } : null
  }
  const documentCount = docs.documents?.length ?? page.documents
  const showFacts = tab !== 'documents'

  return (
    <>
      <ClientHeader
        name={page.name}
        rename={headerAction('Rename client', page.rename)}
        remove={headerAction('Remove client', page.remove)}
        onNewAssessment={page.removed ? null : onNewAssessment}
        onDetails={() => setDetails(true)}
        onBack={onClients}
        bell={bell}
        tabs={
          <Tabs
            style={{ borderBottom: 'none' }}
            items={[
              { value: 'open', label: 'Open work', count: facts.open },
              { value: 'sites', label: 'Sites', count: listed.length },
              { value: 'documents', label: 'Documents', count: documentCount },
            ]}
            value={tab}
            onChange={(t) => setTab(t as TabId)}
          />
        }
      />
      <div className="cl-content">
        <RemovedCallout page={page} busy={busy} onRestore={restoreAll} />
        <div className="cl-body" data-panel={showFacts || undefined}>
          <div className="cl-main">
            {/* Keyed by tab so each switch replays the 180 ms fade-and-rise (board 17 · 1). */}
            <div key={tab} className="cl-panel">
              {tab === 'open' && <OpenWorkTab page={page} onOpen={onOpen} />}
              {tab === 'sites' && (
                <SitesTab
                  page={page}
                  busy={busy}
                  onOpen={onOpen}
                  onEdit={(site) => setOpen({ kind: 'edit', site })}
                  onRemove={(site) => setOpen({ kind: 'remove', site })}
                  onRestore={restoreOne}
                />
              )}
              {tab === 'documents' && <DocumentsTab clientId={page.id} docs={docs} />}
            </div>
          </div>
          {showFacts && (
            <ClientFacts
              facts={facts}
              division={page.division}
              sites={listed}
              contacts={page.contacts}
            />
          )}
        </div>
      </div>

      {/* Phone: the facts panel is hidden; its content opens from the More sheet. */}
      <Sheet open={details} onClose={() => setDetails(false)} title={page.name}>
        <ClientFacts
          facts={facts}
          division={page.division}
          sites={listed}
          contacts={page.contacts}
          sheet
        />
      </Sheet>
      {dialog === 'rename' && !page.removed && (
        <RenameClientDialog client={client} onClose={closeDialog} onSaved={changed} />
      )}
      {dialog === 'remove' && !page.removed && (
        <RemoveDialog
          target={{ kind: 'client', ...client, sites: listed.length }}
          onClose={closeDialog}
          onSaved={changed}
        />
      )}
      {open?.kind === 'edit' && (
        <EditSiteDialog
          site={open.site}
          assessments={open.site.assessments}
          onClose={() => setOpen(null)}
          onSaved={changed}
        />
      )}
      {open?.kind === 'remove' && (
        <RemoveDialog
          target={{ kind: 'site', id: open.site.id, name: open.site.name }}
          onClose={() => setOpen(null)}
          onSaved={changed}
        />
      )}
      {open?.kind === 'restoreName' && (
        <RestoreSiteDialog site={open.site} onClose={() => setOpen(null)} onSaved={changed} />
      )}
    </>
  )
}
