// Section 3 Opportunities for Improvement (GN-05): one OFI as a block of the report's page
// (OfiBlock, used by OfiReviewPanel in Review) and the accepted ones as the report has them (OfisInReport,
// used by Review and the document's ReportParts). Calls api.ts.
import { Fragment, useState } from 'react'
import type * as React from 'react'
import {
  Badge,
  Button,
  Callout,
  EvidenceCitation,
  Icon,
  IconRegistry,
  Input,
} from '../../../design-system'
import { OFI_CATEGORIES as CATEGORIES } from '../reviewDisplay'
import {
  GatewayError,
  type AcceptedOfi,
  type Ofi,
  type OfiLossValues,
  type SavedObservation,
} from '../api'
import { formatAmount } from '../reportFigures'
import { formatDay } from '../format'
import { locationText } from '../locations'
import { ObservationExcerpt } from './ObservationExcerpt'

const label = { margin: 0, fontSize: '13px', color: 'var(--text-muted)' } as const
const muted = { margin: 0, fontSize: '15px', color: 'var(--text-secondary)' } as const

// Priority on the platform's fixed risk scale: Priority 1 is the most urgent.
const PRIORITY_TONE: Record<string, string> = {
  'Priority 1': 'critical',
  'Priority 2': 'high',
  'Priority 3': 'moderate',
  'Priority 4': 'low',
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
        source: o.location ? locationText(o.location) : 'Site observation',
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

// One OFI in the same AI draft box as a section draft's subsections. On the Review
// tab a suggestion has Accept, an accepted OFI its number, and each its sources and
// precedent. On Generation, which only generates (Miya, 12 Oct), it is shown alone:
// no sources, precedent or Accept, which are read and done in Review.
export function OfiBlock({
  ofi,
  number = null,
  observations,
  onAccept,
  onSaveLossValues,
  busy = false,
  withSources = true,
  walk,
}: {
  ofi: Ofi
  // Set once accepted: the OFI's report number.
  number?: string | null
  observations: SavedObservation[]
  onAccept?: () => void
  onSaveLossValues?: (values: OfiLossValues) => Promise<void>
  busy?: boolean
  withSources?: boolean
  // Walkthrough tags (F-12), as data-walk: the heading bar, the whole card, the Accept button, and
  // the label cell of the table row to show down to. Set on the first of a list only.
  walk?: { header?: string; card?: string; accept?: string; tableRow?: string }
}) {
  const [showSources, setShowSources] = useState(false)
  const saved = JSON.stringify(ofi.lossExpectancy ?? null)
  const [loaded, setLoaded] = useState(saved)
  const [typed, setTyped] = useState(() => typedLossValues(ofi.lossExpectancy))
  const [saveError, setSaveError] = useState<string | null>(null)
  if (loaded !== saved) {
    setLoaded(saved)
    setTyped(typedLossValues(ofi.lossExpectancy))
  }
  const save = async () => {
    setSaveError(null)
    const pair = (v: { pd: string; bi: string }) => ({
      pd: v.pd === '' ? null : Number(v.pd),
      bi: v.bi === '' ? null : Number(v.bi),
    })
    try {
      await onSaveLossValues?.({ current: pair(typed.current), after: pair(typed.after) })
    } catch (e) {
      setSaveError(
        e instanceof GatewayError ? e.message : 'Loss values could not be saved. Try again.',
      )
    }
  }
  const precedent = ofi.precedent ? ofi.sources[ofi.precedent] : null
  const count =
    ofi.observations.filter((id) => observations.some((o) => o.id === id)).length +
    ofi.standards.filter((id) => ofi.sources[id]).length +
    (precedent ? 1 : 0)
  // A gap between the box and what follows it (save row, error, precedent, sources),
  // or the save row sits flush against the box's border. 12px matches .rv-maturity's
  // gap above Save scores (review.css).
  return (
    <div data-ofi style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* CP-35: this OFI's fix was based on a recommendation the engineer wrote in a split note */}
      {ofi.fromRecommendation && (
        <div>
          <Badge tone="info" icon="lightbulb">
            From your recommendation
          </Badge>
        </div>
      )}
      {/* The OFI on the report's page: its category, Marsh's table, then its sources and, while
          it is a suggestion, Accept at the right (as a finding's decision sits). A suggestion is
          on the AI tint until accepted. */}
      <article className={'rv-ofi' + (onAccept ? ' is-pending' : '')} data-walk={walk?.card}>
        <div className="rv-ofi-head" data-walk={walk?.header}>
          <h4 className="rv-ofi-category">{ofi.category}</h4>
        </div>
        <OfiTable
          number={number}
          title={ofi.title}
          rows={templateRows(ofi, observations)}
          lossExpectancy={ofi.lossExpectancy}
          typed={onSaveLossValues ? typed : undefined}
          onChange={setTyped}
          disabled={busy}
          walk={walk?.tableRow}
        />
        {(withSources || onAccept) && (
          <div className="rv-finding-bar rv-ofi-foot">
            {withSources && (
              <button
                type="button"
                className="rv-sub-sources"
                aria-expanded={showSources}
                onClick={() => setShowSources((open) => !open)}
              >
                <Icon name="link" size={13} />
                {count + (count === 1 ? ' source' : ' sources')}
              </button>
            )}
            {onAccept && (
              <span className="rv-finding-actions">
                <Button
                  pill
                  variant="secondary"
                  size="sm"
                  iconLeft={IconRegistry.action.accept}
                  aria-label={`Accept ${ofi.title}`}
                  data-walk={walk?.accept}
                  disabled={busy}
                  onClick={onAccept}
                >
                  Accept
                </Button>
              </span>
            )}
          </div>
        )}
      </article>
      {onSaveLossValues && ofi.category !== 'Management Programs' && (
        <div className="rv-figures-actions">
          <span className="rv-muted">Amounts in US$. Totals update when saved.</span>
          <Button
            pill
            variant="primary"
            size="sm"
            disabled={busy}
            onClick={() => void save()}
            aria-label={`Save loss values for ${ofi.title}`}
          >
            Save loss values
          </Button>
        </div>
      )}
      {saveError && (
        <Callout tone="danger" title="Loss values not saved">
          {saveError}
        </Callout>
      )}
      {/* The precedent, outside the box since it is not part of the draft (AC2). */}
      {withSources && precedent && (
        <p style={{ ...label, margin: 0 }}>
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
function typedLossValues(values?: Ofi['lossExpectancy']) {
  return {
    current: { pd: String(values?.current.pd ?? ''), bi: String(values?.current.bi ?? '') },
    after: { pd: String(values?.after.pd ?? ''), bi: String(values?.after.bi ?? '') },
  }
}
type TypedLossValues = ReturnType<typeof typedLossValues>

// A saved amount with the template's "$" beside it; "Not entered" stays bare.
const dollars = (n: number | null) =>
  n === null ? (
    formatAmount(n)
  ) : (
    <span className="rv-figures-item">
      <span aria-hidden="true">$</span>
      <span>{formatAmount(n)}</span>
    </span>
  )

const LOSS_FIGURES = Symbol('current loss figures')
const AFTER_LOSS_FIGURES = Symbol('after loss figures')
type Cell = [string, React.ReactNode | typeof LOSS_FIGURES | typeof AFTER_LOSS_FIGURES]
function OfiTable({
  number,
  title,
  rows,
  lossExpectancy,
  typed,
  onChange,
  disabled,
  walk,
}: {
  // null for a suggestion: it is numbered once accepted.
  number: string | null
  title: string
  rows: Cell[][]
  lossExpectancy?: Ofi['lossExpectancy']
  typed?: TypedLossValues
  onChange?: (values: TypedLossValues) => void
  disabled?: boolean
  // Walkthrough tag (F-12): the label cell of the first row left "To be completed" (else the
  // Priority row), so a highlight can run from the heading bar down to it. A cell, not the row:
  // the table scrolls sideways in its box, and a row is wider than the box shows.
  walk?: string
}) {
  const shownTo = Math.max(
    1,
    rows.findIndex((cells) => cells.some(([, value]) => value === OPEN)),
  )
  // 8 px each side, so the loss rows' seven cells fit Review's page column without scrolling.
  const cell = {
    padding: '8px',
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
    <div className="rv-maturity-scroll">
      <table
        className="rv-ofi-table"
        style={{
          width: '100%',
          minWidth: typed ? 680 : undefined,
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
                  <th
                    scope="row"
                    style={{ ...cell, ...rowLabel }}
                    colSpan={1}
                    data-walk={i === shownTo && j === 0 ? walk : undefined}
                  >
                    {name}
                  </th>
                  {value === LOSS_FIGURES || value === AFTER_LOSS_FIGURES ? (
                    // The template’s six cells; amounts are entered by the engineer.
                    (['pd', 'bi', 'total'] as const).map((figure) => (
                      <Fragment key={figure}>
                        <td style={{ ...cell, fontWeight: 600 }}>
                          {{ pd: 'PD LE', bi: 'BI LE', total: 'TOTAL' }[figure]}
                        </td>
                        <td style={cell}>
                          {/* "$" beside the amount, as the template shows it (p. 8). */}
                          {typed && figure !== 'total' ? (
                            <span className="rv-figures-item">
                              <span aria-hidden="true">$</span>
                              <Input
                                size="sm"
                                type="number"
                                min={0}
                                max={1e13}
                                step="0.01"
                                disabled={disabled}
                                aria-label={`${value === LOSS_FIGURES ? 'Current' : 'After completion'} ${figure === 'pd' ? 'PD LE' : 'BI LE'} (US$)`}
                                value={typed[value === LOSS_FIGURES ? 'current' : 'after'][figure]}
                                onChange={(e) => {
                                  const period = value === LOSS_FIGURES ? 'current' : 'after'
                                  onChange?.({
                                    ...typed,
                                    [period]: { ...typed[period], [figure]: e.target.value },
                                  })
                                }}
                              />
                            </span>
                          ) : (
                            dollars(
                              lossExpectancy?.[value === LOSS_FIGURES ? 'current' : 'after'][
                                figure
                              ] ?? null,
                            )
                          )}
                        </td>
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
    </div>
  )
}

// An OFI's rows as Marsh's template has them for its category (pp. 8-9): Physical
// Protection and Other add the RTM, client, advisory and loss rows. A field nobody has
// filled says so; loss figures are entered by the engineer.
const OPEN = 'To be completed'

// The Observation row (GN-07 AC14): the OFI's own wording, then each photo of the
// observations it rests on, whole and at its own aspect ratio, as the report shows
// evidence. A deleted observation's photos are left out, as everywhere else.
// Capped at 360 px and never stretched past its own size: the table is full width,
// so a photo sized to the cell would fill the screen and blur.
function observationCell(ofi: Ofi, observations: SavedObservation[]) {
  const photos = observations
    .filter((o) => ofi.observations.includes(o.id) && !o.deleted)
    .flatMap((o) => o.photos)
  return (
    <>
      {ofi.observation}
      {photos.length > 0 && (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
          {photos.map((p) => (
            <img
              key={p.id}
              src={p.url}
              alt={p.name}
              loading="lazy"
              style={{
                display: 'block',
                width: 'auto',
                maxWidth: 'min(100%, 360px)',
                height: 'auto',
              }}
            />
          ))}
        </span>
      )}
    </>
  )
}

function templateRows(ofi: Ofi, observations: SavedObservation[]): Cell[][] {
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
      [['Observation', observationCell(ofi, observations)]],
      [['Effort of implementation', ofi.effort]],
    ]
  return [
    ...head,
    [['Related RTM ID', OPEN]],
    [['Description', ofi.description]],
    [['Observation', observationCell(ofi, observations)]],
    [['Client response', OPEN]],
    [['Marsh advisory comment', OPEN]],
    [['Loss expectancy (current, in US$)', LOSS_FIGURES]],
    [['Loss expectancy (after completion)', AFTER_LOSS_FIGURES]],
    [['Effort of implementation', ofi.effort]],
    [['Loss scenario', OPEN]],
  ]
}

// One accepted OFI with Marsh's fields, as it reads in the report (AC4, AC5).
function ReportOfi({ ofi, observations }: { ofi: AcceptedOfi; observations: SavedObservation[] }) {
  return (
    <div style={{ marginTop: '12px' }}>
      <OfiTable
        number={ofi.number}
        title={ofi.title}
        rows={templateRows(ofi, observations)}
        lossExpectancy={ofi.lossExpectancy}
      />
    </div>
  )
}

// Section 3 as the report has it: the accepted OFIs under their categories, in
// report order. Shared by the Generation row and the Review tab.
export function OfisInReport({
  accepted,
  observations,
}: {
  accepted: AcceptedOfi[]
  // For each OFI's photos (GN-07 AC14).
  observations: SavedObservation[]
}) {
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
          <ReportOfi key={o.id} ofi={o} observations={observations} />
        ))}
    </div>
  ))
}
