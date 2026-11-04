// The engineer's clients (CP-18, rebuilt CP-23 board 05), from the sidebar: the
// kit's top bar, then one card: search, Report due and Jurisdiction filters,
// sort and New assessment, a table opening each client's page and a footer
// count. Drawn from the work list, so it lists exactly the clients the engineer
// may open. A client whose sites are all removed waits under Removed clients.
// Calls components/ClientTable and the client dialogs.
import { useEffect, useState, type ReactNode } from 'react'
import {
  Button,
  EmptyState,
  IconRegistry,
  SearchField,
  TableFooter,
  TopBar,
  toast,
} from '../../design-system'
import {
  NewAssessmentButton,
  type StartMode,
} from '../new-assessment/components/NewAssessmentButton'
import { useCompact } from '../assessments/useCompact'
import { listClientInfo, type ClientListInfo } from './api'
import { dueState, type ClientFacts, type DueState } from './clientFacts'
import { RemoveDialog, RenameClientDialog } from './ClientDialogs'
import { ClientTable } from './components/ClientTable'
import { FilterMenu } from './components/FilterMenu'
import { SortMenu } from './components/SortMenu'
import { country, plural } from './formatClient'
import '../assessments/assessment-list.css'
import './clients.css'

export type ClientListItem = {
  id: string
  name: string
  // Every site the engineer visits there is removed.
  removed: boolean
  // Its listed sites.
  sites: number
  // The jurisdiction codes of its listed sites, each once.
  jurisdictions: string[]
  facts: ClientFacts
  // Its name and its sites' names, lower case.
  search: string
  open: () => void
}

const DUE_CHOICES: { value: DueState; label: string }[] = [
  { value: 'late', label: 'Late' },
  { value: 'soon', label: 'Due within 7 days' },
  { value: 'ok', label: 'On track' },
  { value: 'none', label: 'Not set' },
]
const SORTS = [
  { value: 'name', label: 'Name, A to Z', icon: 'arrow-down-a-z' },
  { value: 'survey', label: 'Next survey, soonest first', icon: 'calendar' },
  { value: 'due', label: 'Next report due, soonest first', icon: 'calendar-clock' },
  { value: 'open', label: 'Most open assessments first', icon: 'clipboard-list' },
]
// A client with no date sorts last.
const byDate = (a?: string, b?: string) => (a ?? '9999').localeCompare(b ?? '9999')

export function ClientList({
  clients,
  loading,
  failed,
  onNewAssessment,
  onStart,
  onChanged,
  bell,
}: {
  clients: ClientListItem[]
  loading: boolean
  failed: boolean
  // Starts a new assessment for the client (the create form with it chosen).
  onNewAssessment: (client: { id: string; name: string }) => void
  // The toolbar's New assessment, with its ways to start; absent when the engineer may not create.
  onStart?: (mode: StartMode) => void
  // After a rename or removal: the work list reloads (its own message is not shown).
  onChanged: (message: string) => void
  // The notification bell, on desktop.
  bell?: ReactNode
}) {
  const compact = useCompact()
  const [q, setQ] = useState('')
  const [due, setDue] = useState('')
  const [jurisdiction, setJurisdiction] = useState('')
  const [sort, setSort] = useState('name')
  const [showRemoved, setShowRemoved] = useState(false)
  const [dialog, setDialog] = useState<{ kind: 'rename' | 'remove'; c: ClientListItem } | null>(
    null,
  )
  // The work list has no division or rights; the clients list does. Without it the table shows none.
  const [info, setInfo] = useState<Map<string, ClientListInfo>>(new Map())
  // Bumped after a rename or removal, so the rights are read again.
  const [infoKey, setInfoKey] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    listClientInfo(controller.signal).then(setInfo, () => undefined)
    return () => controller.abort()
  }, [infoKey])
  const removed = clients.filter((c) => c.removed)
  const inView = showRemoved ? removed : clients.filter((c) => !c.removed)
  const search = q.trim().toLowerCase()
  const shown = inView
    .filter(
      (c) =>
        (!search || c.search.includes(search)) &&
        (!due || dueState(c.facts) === due) &&
        (!jurisdiction || c.jurisdictions.includes(jurisdiction)),
    )
    .sort((a, b) =>
      sort === 'survey'
        ? byDate(a.facts.nextSurvey?.date, b.facts.nextSurvey?.date)
        : sort === 'due'
          ? byDate(a.facts.nextDue?.date, b.facts.nextDue?.date)
          : sort === 'open'
            ? b.facts.open - a.facts.open
            : 0,
    )
  const late = shown.reduce((n, c) => n + c.facts.late, 0)
  const jurisdictions = [...new Set(inView.flatMap((c) => c.jurisdictions))].map((value) => ({
    value,
    label: country(value),
  }))

  // After a rename or removal: the app reloads its lists and a toast says what happened.
  const saved = (message: string) => {
    setDialog(null)
    setInfoKey((n) => n + 1)
    onChanged('')
    toast.success(message)
  }
  const filtered = !!search || !!due || !!jurisdiction
  return (
    <div className="cl-page">
      <TopBar
        eyebrow="Risk engineering"
        title="Clients"
        bell={bell}
        action={
          compact && onStart ? (
            <span className="at-topnew">
              <NewAssessmentButton onStart={onStart} />
            </span>
          ) : undefined
        }
      />
      <div className="cl-content cl-content--list">
        <section aria-label="Clients" className="cl-card">
          <div className="cl-toolbar">
            <SearchField
              label="Search clients by name or site"
              placeholder="Search clients"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="cl-pills">
              <FilterMenu name="Report due" choices={DUE_CHOICES} value={due} onChange={setDue} />
              <FilterMenu
                name="Jurisdiction"
                choices={jurisdictions}
                value={jurisdiction}
                onChange={setJurisdiction}
              />
              {(showRemoved || removed.length > 0) && (
                <Button
                  variant="pill"
                  aria-pressed={showRemoved}
                  iconLeft={showRemoved ? 'arrow-left' : IconRegistry.action.discard}
                  onClick={() => setShowRemoved(!showRemoved)}
                >
                  {showRemoved ? 'Back to clients' : `Removed clients (${removed.length})`}
                </Button>
              )}
              <SortMenu choices={SORTS} value={sort} onChange={setSort} />
            </div>
            {onStart && !compact && (
              <span className="cl-toolbar-end">
                <NewAssessmentButton onStart={onStart} />
              </span>
            )}
          </div>
          {loading ? (
            <p role="status" className="cl-empty-title">
              {'Loading your clients…'}
            </p>
          ) : failed || shown.length === 0 ? (
            <EmptyState
              icon={IconRegistry.object.client}
              title={
                failed
                  ? 'Your clients could not be loaded'
                  : filtered
                    ? 'No clients match'
                    : showRemoved
                      ? 'No removed clients'
                      : 'No clients yet'
              }
              description={
                failed
                  ? 'The gateway could not be reached. Check your connection and try again.'
                  : filtered
                    ? 'Change the search or the filters to see more.'
                    : showRemoved
                      ? 'A client shows here once all its sites are removed.'
                      : removed.length
                        ? 'Every client of yours is removed. Removed clients lists them.'
                        : 'A client shows here once one of your assessments is for it.'
              }
            />
          ) : (
            <>
              <ClientTable
                rows={shown.map((c) => ({
                  ...c,
                  division: info.get(c.id)?.division ?? null,
                  rights: info.get(c.id) ?? null,
                  newAssessment: () => onNewAssessment(c),
                  rename: () => setDialog({ kind: 'rename', c }),
                  remove: () => setDialog({ kind: 'remove', c }),
                }))}
                sort={sort}
              />
              <TableFooter
                late={late ? `${plural(late, 'report')} late` : undefined}
                onLateClick={() => setDue('late')}
              >
                {plural(shown.length, 'client')}
              </TableFooter>
            </>
          )}
        </section>
      </div>
      {dialog?.kind === 'rename' && (
        <RenameClientDialog client={dialog.c} onClose={() => setDialog(null)} onSaved={saved} />
      )}
      {dialog?.kind === 'remove' && (
        <RemoveDialog
          target={{ kind: 'client', id: dialog.c.id, name: dialog.c.name, sites: dialog.c.sites }}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
    </div>
  )
}
