// Section 3 Opportunities for Improvement as the first row of the Report
// generation table (GN-05): draft suggestions, accept them one by one or all at
// once, and see the accepted ones as the report has them. Used by
// screens/SectionDrafts.tsx, which passes its table's column grid. Calls api.ts.
import { Fragment, useState } from 'react'
import type * as React from 'react'
import { AIDraftBlock, Badge, Button, EvidenceCitation } from '../../../design-system'
import {
  acceptOfi,
  draftOfis,
  GatewayError,
  type AcceptedOfi,
  type Ofi,
  type OfiList,
  type SavedObservation,
} from '../api'
import { formatDay } from '../format'
import { useOfis } from '../useOfis'
import { ObservationExcerpt } from './ObservationExcerpt'

const card = {
  background: 'var(--surface-card)',
  border: '1px solid var(--border-default)',
  borderRadius: '8px',
  padding: '16px 20px',
} as const
const label = { margin: 0, fontSize: '13px', color: 'var(--text-muted)' } as const
const muted = { margin: 0, fontSize: '15px', color: 'var(--text-secondary)' } as const
const note = { display: 'block', marginTop: '4px', fontSize: '14px' } as const
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// Priority on the platform's fixed risk scale: Priority 1 is the most urgent.
const PRIORITY_TONE: Record<string, string> = {
  'Priority 1': 'critical',
  'Priority 2': 'high',
  'Priority 3': 'moderate',
  'Priority 4': 'low',
}
// Section 3's order, as in the template.
const CATEGORIES = ['Management Programs', 'Physical Protection', 'Other']
// The observations OFIs are drafted from, as in rag-service orchestrator.OFI_SEVERITIES.
const OFI_SEVERITIES = ['critical', 'high', 'moderate']

// Can this observation lead to an OFI: categorised, rated moderate or worse, and with
// a note or finished transcript to draft from (as the gateway's drafting evidence).
function isCandidate(o: SavedObservation) {
  return (
    Boolean(o.copeDimensions?.length) &&
    OFI_SEVERITIES.includes(o.severity) &&
    (Boolean(o.note?.trim()) || o.recordings.some((r) => r.transcription.transcript))
  )
}

// The past OFI's title from its chunk, whose rows read "2025-02: Description;
// <title>: …" (how ingestion flattens the OFI table).
function precedentTitle(text: string): string | null {
  return text.match(/^[^:;]+: [^;]+; ([^:]+):/)?.[1].trim() ?? null
}

// The suggestion's evidence as cards, as a section draft shows its sources: the
// observations it rests on, the standards it cites and the past OFI it adapts (AC2).
function Sources({ ofi, observations }: { ofi: Ofi; observations: SavedObservation[] }) {
  const cards: React.ComponentProps<typeof EvidenceCitation>[] = []
  for (const id of ofi.observations) {
    const o = observations.find((x) => x.id === id)
    if (o)
      cards.push({
        kind: 'observation',
        source: o.location
          ? [o.location.name, o.location.floor].filter(Boolean).join(', ')
          : 'Site observation',
        locator: o.copeDimensions?.join(', '),
        excerpt: <ObservationExcerpt observation={o} />,
      })
  }
  for (const id of ofi.standards) {
    const s = ofi.sources[id]
    if (s)
      cards.push({
        kind: 'standard',
        source: s.headings?.join(' › ') || s.doc_id || 'Standard',
        locator: s.page_start != null ? `p. ${s.page_start}` : undefined,
        excerpt: s.text,
      })
  }
  const precedent = ofi.precedent ? ofi.sources[ofi.precedent] : null
  if (precedent)
    cards.push({
      kind: 'report',
      source: ofi.precedentReport ?? 'A past Marsh report',
      locator: precedentTitle(precedent.text) ?? undefined,
      excerpt: precedent.text,
    })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
      {cards.map((c, i) => (
        <EvidenceCitation key={i} index={i + 1} {...c} />
      ))}
    </div>
  )
}

// One OFI in the same AI draft box as a section draft's subsections: a suggestion
// (with Accept) on Generation, or an accepted, numbered OFI on the Review tab,
// where it reads like the sections' AI drafts. Its sources open below it.
export function OfiBlock({
  ofi,
  number = null,
  observations,
  onAccept,
  busy = false,
}: {
  ofi: Ofi
  // Set once accepted: the OFI's report number.
  number?: string | null
  observations: SavedObservation[]
  onAccept?: () => void
  busy?: boolean
}) {
  const [showSources, setShowSources] = useState(false)
  const precedent = ofi.precedent ? ofi.sources[ofi.precedent] : null
  const count =
    ofi.observations.filter((id) => observations.some((o) => o.id === id)).length +
    ofi.standards.filter((id) => ofi.sources[id]).length +
    (precedent ? 1 : 0)
  return (
    <div>
      <AIDraftBlock
        heading={ofi.category}
        status="draft"
        // Nothing checks yet that the sources say what the OFI claims, so not high.
        confidence="medium"
        evidenceCount={count}
        onShowEvidence={() => setShowSources((open) => !open)}
        onAccept={onAccept}
        acceptLabel={`Accept ${ofi.title}`}
        acceptDisabled={busy}
      >
        <OfiTable number={number} title={ofi.title} rows={templateRows(ofi)} />
      </AIDraftBlock>
      {/* The precedent, outside the box since it is not part of the draft (AC2). */}
      {precedent && (
        <p style={{ ...label, margin: '6px 0 0' }}>
          Based on past report:{' '}
          {[ofi.precedentReport ?? 'a past Marsh report', precedentTitle(precedent.text)]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      {showSources && <Sources ofi={ofi} observations={observations} />}
    </div>
  )
}

// One OFI as Marsh's template lays it out (p. 8): a title row, then label and value
// cells, two pairs to a row where the template has them side by side.
// The template's loss expectancy cells, drawn as the row's own cells (below).
const LOSS_FIGURES = Symbol('loss figures')
type Cell = [string, React.ReactNode | typeof LOSS_FIGURES]
function OfiTable({
  number,
  title,
  rows,
}: {
  // null for a suggestion: it is numbered once accepted.
  number: string | null
  title: string
  rows: Cell[][]
}) {
  const cell = {
    padding: '8px 12px',
    border: '1px solid var(--border-subtle)',
    verticalAlign: 'top',
    textAlign: 'left',
  } as const
  const rowLabel = { ...label, fontWeight: 500, fontSize: '13px' } as const
  const heading = {
    background: 'var(--surface-nav)',
    color: 'var(--text-inverse)',
    fontWeight: 700,
    fontSize: '16px',
  } as const
  return (
    <table
      style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontFamily: 'var(--font-sans)',
        fontSize: '15px',
        lineHeight: '22px',
      }}
    >
      {/* A label column, then six value columns: a row of one pair spans all six, two
          pairs split them, and loss expectancy gives each of its six cells one. */}
      <colgroup>
        <col style={{ width: '160px' }} />
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <col key={n} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {/* Number left, title right, white on the navbar's navy, as in the template. */}
          <th style={{ ...cell, ...heading }}>{number ?? '—'}</th>
          <th colSpan={6} style={{ ...cell, ...heading }}>
            {title}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((cells, i) => (
          <tr key={i}>
            {cells.map(([name, value], j) => (
              <Fragment key={name}>
                <th scope="row" style={{ ...cell, ...rowLabel }} colSpan={1}>
                  {name}
                </th>
                {value === LOSS_FIGURES ? (
                  // PD LE | $ | BI LE | $ | TOTAL | $, amounts left blank (never the model's).
                  ['PD LE', 'BI LE', 'TOTAL'].map((figure) => (
                    <Fragment key={figure}>
                      <td style={{ ...cell, fontWeight: 600 }}>{figure}</td>
                      <td style={cell}>$</td>
                    </Fragment>
                  ))
                ) : (
                  <td style={cell} colSpan={cells.length === 1 ? 6 : j === 0 ? 2 : 3}>
                    {value}
                  </td>
                )}
              </Fragment>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// An OFI's rows as Marsh's template has them for its category (pp. 8-9): Physical
// Protection and Other add the RTM, client, advisory and loss rows. A field nobody has
// filled says so; loss figures are never the model's (backlog rule), so they stay open.
const OPEN = 'To be completed'

function templateRows(ofi: Ofi): Cell[][] {
  const date = ofi.issueDate ? formatDay(new Date(ofi.issueDate)) : OPEN
  const head: Cell[][] = [
    [
      ['Status', ofi.status],
      ['Issue date', date],
    ],
    [
      ['Priority', <Badge tone={PRIORITY_TONE[ofi.priority]}>{ofi.priority}</Badge>],
      ['Type', ofi.type],
    ],
    // Left blank for people to fill: the issuer (Marsh, or the consultant's name)
    // and the insurer's own reference.
    [
      ['OFI issued by', ''],
      ['Insurer rec no.', ''],
    ],
  ]
  if (ofi.category === 'Management Programs')
    return [
      ...head,
      [['Description', ofi.description]],
      [['Observation', ofi.observation]],
      [['Effort of implementation', ofi.effort]],
    ]
  return [
    ...head,
    [['Related RTM ID', OPEN]],
    [['Description', ofi.description]],
    [['Observation', ofi.observation]],
    [['Client response', OPEN]],
    [['Marsh advisory comment', OPEN]],
    [['Loss expectancy (current, in US$)', LOSS_FIGURES]],
    [['Loss expectancy (after completion)', LOSS_FIGURES]],
    [['Effort of implementation', ofi.effort]],
    [['Loss scenario', OPEN]],
  ]
}

// One accepted OFI with Marsh's fields, as it reads in the report (AC4, AC5).
function ReportOfi({ ofi }: { ofi: AcceptedOfi }) {
  return (
    <div style={{ marginTop: '12px' }}>
      <OfiTable number={ofi.number} title={ofi.title} rows={templateRows(ofi)} />
    </div>
  )
}

// Section 3 as the report has it: the accepted OFIs under their categories, in
// report order. Shared by the Generation row and the Review tab.
export function OfisInReport({ accepted }: { accepted: AcceptedOfi[] }) {
  if (!accepted.length)
    return (
      <p style={muted}>
        No Opportunities for Improvement are in the report yet. Accept a suggestion to add it.
      </p>
    )
  return CATEGORIES.filter((c) => accepted.some((o) => o.category === c)).map((c) => (
    <div key={c} style={{ marginTop: '12px' }}>
      <h5 style={{ margin: 0, fontSize: '15px' }}>{c}</h5>
      {accepted
        .filter((o) => o.category === c)
        .map((o) => (
          <ReportOfi key={o.id} ofi={o} />
        ))}
    </div>
  ))
}

// What opens under the row: suggestions to accept, then the OFIs in the report.
function OfiPanel({
  ofis,
  observations,
  canDraft,
  busy,
  onAccept,
}: {
  ofis: OfiList
  observations: SavedObservation[]
  canDraft: boolean
  busy: boolean
  onAccept: (ids: string[]) => void
}) {
  return (
    <section
      aria-label="3. Opportunities for Improvement"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '16px 20px 20px',
        background: 'var(--surface-sunken)',
        borderBottom: '1px solid var(--border-default)',
      }}
    >
      {ofis.suggestions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
          <p style={{ ...muted, flex: '1 1 320px' }}>
            {plural(ofis.suggestions.length, 'suggestion')}, not in the report until accepted.
            Accept each one that should be in Section 3.
          </p>
          {canDraft && ofis.suggestions.length > 1 && (
            <Button
              variant="secondary"
              size="sm"
              iconLeft="check-check"
              disabled={busy}
              onClick={() => onAccept(ofis.suggestions.map((o) => o.id))}
            >
              Accept all
            </Button>
          )}
        </div>
      )}
      {ofis.suggestions.map((o) => (
        <OfiBlock
          key={o.id}
          ofi={o}
          observations={observations}
          busy={busy}
          onAccept={canDraft ? () => onAccept([o.id]) : undefined}
        />
      ))}
      <section aria-label="Opportunities for Improvement in the report" style={card}>
        <h4 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 500 }}>In the report</h4>
        <OfisInReport accepted={ofis.accepted} />
      </section>
    </section>
  )
}

export function OfiRow({
  reference,
  canDraft,
  observations,
}: {
  reference: string
  canDraft: boolean
  observations: SavedObservation[]
}) {
  const { ofis, setOfis, loadError } = useOfis(reference)
  const [open, setOpen] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  // Busy while a draft or accept runs: each returns the whole list, which replaces
  // what is shown, so two at once could show a stale list.
  const busy = drafting || accepting
  const candidates = observations.filter(isCandidate).length

  const draft = async () => {
    setDrafting(true)
    setFailure(null)
    try {
      setOfis(await draftOfis(reference))
      setOpen(true)
    } catch (error: unknown) {
      setFailure(
        error instanceof GatewayError
          ? error.message
          : 'The Opportunities for Improvement were not drafted.',
      )
    }
    setDrafting(false)
  }
  // Accepts one or several suggestions, one call each, in the order shown.
  const accept = async (ids: string[]) => {
    setAccepting(true)
    setFailure(null)
    try {
      for (const id of ids) setOfis(await acceptOfi(reference, id))
    } catch (error: unknown) {
      setFailure(error instanceof GatewayError ? error.message : 'A suggestion was not accepted.')
    }
    setAccepting(false)
  }

  const suggested = ofis?.suggestions.length ?? 0
  const inReport = ofis?.accepted.length ?? 0
  const state = drafting
    ? { tone: 'ai', icon: 'sparkles', label: 'Drafting' }
    : failure
      ? { tone: 'critical', icon: 'octagon-alert', label: 'Failed' }
      : suggested
        ? { tone: 'ai', icon: 'sparkles', label: `${plural(suggested, 'suggestion')} to review` }
        : inReport
          ? { tone: 'low', icon: 'check', label: `${inReport} in the report` }
          : candidates
            ? { tone: 'neutral', icon: 'circle-dashed', label: 'Not drafted' }
            : { tone: 'moderate', icon: 'triangle-alert', label: 'Insufficient evidence' }

  return (
    <Fragment>
      <div style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div
          className="generation-row"
          style={{
            display: 'grid',
            alignItems: 'center',
            padding: '12px 20px',
          }}
        >
          <span
            style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--text-muted)' }}
          >
            3
          </span>
          <span style={{ minWidth: 0, paddingRight: '20px' }}>
            <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '16px', fontWeight: 500 }}>
                Opportunities for Improvement
              </span>
            </span>
            {suggested > 0 && inReport > 0 && (
              <span style={{ ...note, color: 'var(--text-secondary)' }}>
                {inReport} already in the report.
              </span>
            )}
            {!candidates && !suggested && !inReport && (
              <span style={{ ...note, color: 'var(--text-secondary)' }}>
                Needs an observation rated moderate or worse.
              </span>
            )}
            {loadError && (
              <span style={{ ...note, color: 'var(--status-critical-fg)' }}>{loadError}</span>
            )}
            {failure && (
              <span role="alert" style={{ ...note, color: 'var(--status-critical-fg)' }}>
                {failure}
              </span>
            )}
          </span>
          <span className="generation-status">
            <Badge tone={state.tone} icon={state.icon}>
              {state.label}
            </Badge>
          </span>
          <span style={{ fontSize: '15px', color: 'var(--text-secondary)' }}>
            {plural(candidates, 'observation')}
          </span>
          <span
            style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '8px' }}
          >
            {ofis && (suggested > 0 || inReport > 0) && (
              <Button
                variant="ghost"
                size="sm"
                iconLeft="file-text"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
              >
                {open ? 'Hide OFIs' : 'View OFIs'}
              </Button>
            )}
            {canDraft && ofis && candidates > 0 && (
              <Button
                variant="ghost"
                size="sm"
                iconLeft="sparkles"
                loading={drafting}
                disabled={busy}
                onClick={() => void draft()}
              >
                {drafting ? 'Drafting…' : suggested || inReport ? 'Redraft OFIs' : 'Draft OFIs'}
              </Button>
            )}
          </span>
        </div>
      </div>
      {open && ofis && (
        <OfiPanel
          ofis={ofis}
          observations={observations}
          canDraft={canDraft}
          busy={busy}
          onAccept={(ids) => void accept(ids)}
        />
      )}
    </Fragment>
  )
}
