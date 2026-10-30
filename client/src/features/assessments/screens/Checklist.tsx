import { useState } from 'react'
import {
  Badge,
  Button,
  Callout,
  Checkbox,
  EmptyState,
  Icon,
  Switch,
  Tag,
} from '../../../design-system'
import {
  generateChecklist,
  GatewayError,
  type Checklist as ChecklistData,
  type ChecklistItem,
  type ChecklistView,
  type ScopeStandard,
} from '../api'
import { JURISDICTIONS } from '../demo-data'
import { formatDay } from '../format'
import { plural } from '../reviewDisplay'
import { useChecklist } from '../useChecklist'

const card = {
  background: 'var(--surface-card)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-sm)',
  overflow: 'hidden',
} as const
const muted = {
  margin: 0,
  fontSize: 'var(--text-small-size)',
  color: 'var(--text-secondary)',
} as const
const caption = { ...muted, fontSize: 'var(--text-caption-size)' } as const
const heading = { margin: 0, fontSize: '17px', fontWeight: 600 } as const
// A subsection's name over its items: small capitals, so it reads as a label.
const eyebrow = {
  margin: 0,
  fontSize: 'var(--text-eyebrow-size)',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
} as const

const country = (code: string) => JURISDICTIONS.find((j) => j.value === code)?.label ?? code

// "NFPA 13 · 2025" from what the knowledge base knows of a standard.
function designation(s: Pick<ScopeStandard, 'issuingBody' | 'standardNumber' | 'edition'>) {
  const name = [s.issuingBody, s.standardNumber].filter(Boolean).join(' ')
  return [name, s.edition].filter(Boolean).join(' · ')
}

// "NFPA 13", as engineers name a standard; its title when it has no number.
function shortName(s: Pick<ScopeStandard, 'title' | 'sourceType' | 'standardNumber'> | undefined) {
  if (!s) return 'Standard'
  const issuer = { nfpa_standard: 'NFPA', fm_standard: 'FM' }[s.sourceType ?? '']
  return issuer && s.standardNumber ? `${issuer} ${s.standardNumber}` : s.title
}

// A cited passage (AC6), opened from its citation: the whole passage and a link
// to the original at that page.
function PassagePanel({ passage, checklist }: { passage: string; checklist: ChecklistData }) {
  const source = checklist.sources[passage]
  // As rag-service's MAX_HEADING_CHARS: a longer "heading" is body text misread as one.
  const headings = (source?.headings ?? []).filter((h) => h.length <= 200)
  const standard = checklist.standards.find((s) => s.id === source?.doc_id)
  const page = source?.page_start
  return (
    <div
      style={{
        marginTop: 'var(--space-4)',
        padding: 'var(--space-5) var(--space-6)',
        background: 'var(--surface-sunken)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <p style={caption}>
        {[standard?.title ?? 'Standard', standard?.edition, page != null ? `p. ${page}` : null]
          .filter(Boolean)
          .join(', ')}
        {headings.length ? ` › ${headings.join(' › ')}` : ''}
      </p>
      {source && (
        <blockquote
          tabIndex={0}
          aria-label="Passage text"
          style={{
            margin: 'var(--space-4) 0',
            fontFamily: 'var(--font-serif)',
            fontSize: '14px',
            lineHeight: '22px',
            whiteSpace: 'pre-wrap',
          }}
        >
          {source.text}
        </blockquote>
      )}
      {source?.doc_id && (
        <a
          href={
            `/api/knowledge-documents/${encodeURIComponent(source.doc_id)}/file` +
            (page != null ? `#page=${page}` : '')
          }
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 'var(--text-caption-size)' }}
        >
          Open the original PDF{page != null ? ` at page ${page}` : ''}
        </a>
      )}
    </div>
  )
}

// Said of a quote the code could not find in the passage it cites (AC6).
const UNVERIFIED = "The AI's quoted words are not word for word in this passage. Verify before use."

// An item's citations by standard and page, in the order first cited.
function groupCitations(citations: ChecklistItem['citations'], checklist: ChecklistData) {
  const pages = new Map<
    string,
    {
      key: string
      standard: ChecklistData['standards'][number] | undefined
      page: number | null | undefined
      citations: ChecklistItem['citations']
    }
  >()
  for (const c of citations) {
    const source = checklist.sources[c.ref]
    const key = `${source?.doc_id ?? c.ref}:${source?.page_start ?? ''}`
    const group = pages.get(key) ?? {
      key,
      standard: checklist.standards.find((s) => s.id === source?.doc_id),
      page: source?.page_start,
      citations: [],
    }
    pages.set(key, { ...group, citations: [...group.citations, c] })
  }
  return [...pages.values()]
}

function ItemRow({
  item,
  checklist,
  general,
  indent = false,
}: {
  item: ChecklistItem
  checklist: ChecklistData
  // For the team's general check of a risk: why it has no specific one.
  general?: string
  // Under its template subsection's row, in the full view.
  indent?: boolean
}) {
  // Only the model's items are AI-written (AC8); the template's and the hazard
  // list's own are the team's.
  const written = item.origin === 'standard' || item.origin === 'hazard'
  // Citations of one page of one standard share a chip; opened, it shows each quote.
  const pages = groupCitations(item.citations, checklist)
  const [open, setOpen] = useState<string | null>(null)
  const opened = pages.find((p) => p.key === open)
  const uncited = item.flags.includes('uncited') && !general
  return (
    <li
      style={{
        padding: `var(--space-5) var(--space-6) var(--space-5) ${indent ? 'var(--space-9)' : 'var(--space-6)'}`,
        borderTop: '1px solid var(--border-subtle)',
        // AI violet marks provisional machine-written text (docs/areas/ui.md).
        boxShadow: written ? 'inset 3px 0 0 var(--ai-border)' : undefined,
      }}
    >
      <p style={{ margin: 0, fontSize: 'var(--text-body-size)', lineHeight: '22px' }}>
        {item.text}
      </p>
      {general && (
        <p
          style={{
            ...caption,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 'var(--space-3)',
            marginTop: 'var(--space-3)',
          }}
        >
          <Icon
            name="triangle-alert"
            size={13}
            color="var(--status-moderate-fg)"
            style={{ marginTop: 2, flex: '0 0 auto' }}
          />
          {general}
        </p>
      )}
      {(pages.length > 0 || uncited) && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 'var(--space-3)',
            marginTop: 'var(--space-4)',
          }}
        >
          {pages.map(({ key, standard, page, citations }) => (
            <span key={key} style={{ display: 'contents' }}>
              <button
                type="button"
                aria-expanded={open === key}
                onClick={() => setOpen(open === key ? null : key)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  height: '24px',
                  padding: '0 8px',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  background: open === key ? 'var(--surface-sunken)' : 'var(--surface-card)',
                  color: 'var(--text-secondary)',
                  font: 'inherit',
                  fontSize: 'var(--text-caption-size)',
                  cursor: 'pointer',
                }}
              >
                <Icon name="book-marked" size={12} color="var(--text-muted)" />
                {shortName(standard)}{' '}
                {page != null && <span style={{ fontFamily: 'var(--font-mono)' }}>p. {page}</span>}
                <Icon name={open === key ? 'chevron-up' : 'chevron-down'} size={12} />
              </button>
              {citations.some((c) => !c.quoteFound) && (
                <Badge tone="moderate" icon="triangle-alert">
                  Unverified quote
                </Badge>
              )}
            </span>
          ))}
          {uncited && (
            <Badge tone="moderate" icon="triangle-alert">
              No standard to cite
            </Badge>
          )}
        </div>
      )}
      {opened && (
        <>
          {opened.citations.map((c) => (
            <p
              key={c.quote}
              style={{
                ...muted,
                marginTop: 'var(--space-4)',
                paddingLeft: 'var(--space-5)',
                borderLeft: '2px solid var(--border-default)',
              }}
            >
              “{c.quote}”
              {!c.quoteFound && (
                <span
                  style={{
                    ...caption,
                    display: 'block',
                    marginTop: 'var(--space-2)',
                    color: 'var(--status-moderate-fg)',
                  }}
                >
                  {UNVERIFIED}
                </span>
              )}
            </p>
          ))}
          {[...new Set(opened.citations.map((c) => c.ref))].map((ref) => (
            <PassagePanel key={ref} passage={ref} checklist={checklist} />
          ))}
        </>
      )}
    </li>
  )
}

// A titled card of items, the AI-generated ones marked once in its header.
function Group({
  title,
  note,
  children,
  items,
}: {
  title: string
  note?: React.ReactNode
  children: React.ReactNode
  items: ChecklistItem[]
}) {
  const written = items.some((i) => i.origin === 'standard' || i.origin === 'hazard')
  return (
    <section aria-label={title} style={card}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 'var(--space-3) var(--space-6)',
          padding: 'var(--space-5) var(--space-6)',
        }}
      >
        <div>
          <h4 style={{ ...heading, fontSize: 'var(--text-body-size)' }}>{title}</h4>
          {note}
        </div>
        {written && (
          <Badge tone="ai" icon="sparkles">
            AI-generated
          </Badge>
        )}
      </div>
      {children}
    </section>
  )
}

const list = { listStyle: 'none', margin: 0, padding: 0 } as const
const row = {
  padding: 'var(--space-4) var(--space-6)',
  borderTop: '1px solid var(--border-subtle)',
} as const

function SectionHeading({ title }: { title: string }) {
  return <h3 style={{ ...heading, marginTop: 'var(--space-6)' }}>{title}</h3>
}

// One template subsection (AC3): its heading beside what to check there.
function TemplateRow({ item }: { item: ChecklistItem }) {
  const detail = item.text === item.subsection ? null : item.text
  return (
    <div
      style={{ ...row, display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2) var(--space-6)' }}
    >
      <strong style={{ flex: '0 0 220px', fontSize: 'var(--text-small-size)', fontWeight: 600 }}>
        {item.subsection}
      </strong>
      <span style={{ ...muted, flex: '1 1 320px' }}>
        {detail}
        {item.fields.length > 0 && (
          <>
            {detail && ' '}
            Covers: {item.fields.join(', ')}.
          </>
        )}
      </span>
    </div>
  )
}

// "A", "A or B", "A, B or C".
function either(names: string[], word = 'or') {
  return names.length < 2
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} ${word} ${names[names.length - 1]}`
}

type Hazard = ChecklistData['hazards'][number]

// Under a risk's name, when its own standards were ticked: which they are.
function riskNote(hazard: Hazard) {
  return hazard.inScope.length > 0 ? `Checked against ${hazard.standards.join(', ')}.` : null
}

// Why a risk has only the team's general check, and what would give it a specific one.
function generalCheck(hazard: Hazard, available: ScopeStandard[]) {
  if (hazard.inScope.length > 0) return 'The selected standards set nothing specific for this risk.'
  const known = (name: string) =>
    available.some((s) => shortName(s).toLowerCase() === name.toLowerCase())
  const toTick = hazard.standards.filter(known)
  return (
    'None of the selected standards covers this risk. ' +
    (toTick.length > 0
      ? `Selecting ${either(toTick)} above would give specific checks.`
      : `Adding ${either(hazard.standards)} to the knowledge base would give specific checks.`)
  )
}

// Each report section once, in one of two views. Relevant sections (the
// default) shows only the sections the ticked standards add requirements to,
// under their subsection, and names the rest in one line, so none goes missing
// unexplained. All sections shows every template subsection, with those
// requirements beneath it.
function SectionBySection({ checklist }: { checklist: ChecklistData }) {
  const [relevantOnly, setRelevantOnly] = useState(true)
  const label = (text: string) => (
    <p style={{ ...eyebrow, ...row, background: 'var(--surface-sunken)' }}>{text}</p>
  )
  // The view the switch is on reads as chosen; the other, muted.
  const side = (chosen: boolean) =>
    ({
      fontSize: 'var(--text-small-size)',
      fontWeight: chosen ? 600 : 400,
      color: chosen ? 'var(--text-primary)' : 'var(--text-secondary)',
    }) as const
  const addedTo = (areaId: string) =>
    checklist.items.filter((i) => i.area === areaId && i.origin === 'standard')
  const empty = checklist.areas.filter((area) => addedTo(area.id).length === 0)
  return (
    <>
      <SectionHeading title="Report sections" />
      {/* A switch between two named views: the relevant sections, or all of them. */}
      <div
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-5)' }}
      >
        <button
          type="button"
          onClick={() => setRelevantOnly(true)}
          style={{
            border: 'none',
            background: 'none',
            padding: 0,
            font: 'inherit',
            cursor: 'pointer',
            ...side(relevantOnly),
          }}
        >
          Relevant sections
        </button>
        <Switch
          label={<span style={side(!relevantOnly)}>All sections</span>}
          checked={!relevantOnly}
          onChange={(all) => setRelevantOnly(!all)}
        />
      </div>
      {checklist.areas.map((area) => {
        const added = addedTo(area.id)
        if (relevantOnly && added.length === 0) return null
        const rows = checklist.items.filter((i) => i.area === area.id && i.origin === 'template')
        // Requirements under no template subsection come first, then each subsection's.
        const parts = [
          {
            key: '',
            template: null,
            items: added.filter((i) => !rows.some((r) => r.subsection === i.subsection)),
          },
          ...rows.map((r) => ({
            key: r.id,
            template: r,
            items: added.filter((i) => i.subsection === r.subsection),
          })),
        ].filter((part) => part.items.length > 0 || (!relevantOnly && part.template))
        return (
          <Group key={area.id} title={`${area.id}. ${area.title}`} items={added}>
            {added.length === 0 && (
              <p style={{ ...muted, ...row }}>Nothing specific in the selected standards.</p>
            )}
            {parts.map((part) => (
              <div key={part.key}>
                {part.template === null ? (
                  label('General')
                ) : relevantOnly ? (
                  label(part.template.subsection ?? '')
                ) : (
                  <TemplateRow item={part.template} />
                )}
                <ul style={list}>
                  {part.items.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      checklist={checklist}
                      indent={!relevantOnly && part.template !== null}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </Group>
        )
      })}
      {relevantOnly && empty.length > 0 && (
        // The sections left out, each its own tag: their titles hold commas of their own.
        <section aria-label="No specific requirements">
          <p style={muted}>No specific requirements for:</p>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 'var(--space-3)',
              marginTop: 'var(--space-3)',
            }}
          >
            {empty.map((area) => (
              <Tag key={area.id}>
                {area.id}. {area.title}
              </Tag>
            ))}
            <button
              type="button"
              onClick={() => setRelevantOnly(false)}
              style={{
                border: 'none',
                background: 'none',
                padding: '0 var(--space-2)',
                font: 'inherit',
                fontSize: 'var(--text-small-size)',
                color: 'var(--text-link)',
                cursor: 'pointer',
              }}
            >
              Show all sections
            </button>
          </div>
        </section>
      )}
    </>
  )
}

// The standards to leave unticked by default: those the latest checklist left
// out, unless added to the knowledge base since it was generated. Before any
// checklist, every standard is ticked.
function leftOut(view: ChecklistView): Set<string> {
  const last = view.checklist
  if (!last) return new Set()
  const generated = new Date(last.provenance.generated_at)
  return new Set(
    view.standards
      .filter(
        (s) => !last.standards.some((u) => u.id === s.id) && new Date(s.uploadedAt) <= generated,
      )
      .map((s) => s.id),
  )
}

// The checklist itself: the facility's priority risks first, then each report
// section once. `available` is every standard that applies to the site now, so a
// risk without a specific check can say which to tick or add.
function ChecklistBody({
  checklist,
  available,
}: {
  checklist: ChecklistData
  available: ScopeStandard[]
}) {
  const generated = new Date(checklist.provenance.generated_at)
  const hazardItems = checklist.items.filter((i) => i.area === 'hazards')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <p style={{ ...caption, fontFamily: 'var(--font-mono)' }}>
        Generated {formatDay(generated)}{' '}
        {generated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ·{' '}
        {checklist.provenance.model ?? 'no model called'} ·{' '}
        {plural(checklist.standards.length, 'standard')} · {checklist.provenance.checklist_version}
      </p>

      {checklist.hazards.length === 0 ? (
        // A facility type outside the hazard list's nine, e.g. an older site's.
        <Callout tone="info" title="No facility risks for this facility type">
          No facility risks are configured for &lsquo;{checklist.facilityType}&rsquo;, so this
          checklist has the report template&apos;s items and the standards&apos; items only.
        </Callout>
      ) : (
        <>
          <SectionHeading title="Priority risks" />
          {checklist.hazards.map((hazard) => {
            const items = hazardItems.filter((i) => i.hazard === hazard.id)
            return (
              <Group
                key={hazard.id}
                title={hazard.name}
                items={items}
                note={
                  riskNote(hazard) && (
                    <p style={{ ...caption, marginTop: 'var(--space-1)' }}>{riskNote(hazard)}</p>
                  )
                }
              >
                <ul style={list}>
                  {items.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      checklist={checklist}
                      general={
                        item.origin === 'hazard_list' ? generalCheck(hazard, available) : undefined
                      }
                    />
                  ))}
                </ul>
              </Group>
            )
          })}
        </>
      )}

      <SectionBySection checklist={checklist} />
    </div>
  )
}

// The assessment's Checklist tab (CP-30): the standards that apply to the site,
// ticked to choose which the checklist uses (AC1-2), and the latest checklist
// (AC9). Only the assigned engineer generates; anyone who can open the
// assessment reads it.
export function Checklist({ reference, canGenerate }: { reference: string; canGenerate: boolean }) {
  const { view, setView, loadError } = useChecklist(reference)
  // The engineer's own ticks, for the checklist shown when they were made; a new
  // checklist starts again from the standards it used (leftOut).
  const [ticks, setTicks] = useState<{ checklist: string | null; unticked: Set<string> } | null>(
    null,
  )
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (loadError) {
    return (
      <div style={{ padding: '24px' }}>
        <Callout tone="danger" title="The checklist could not be loaded">
          {loadError}
        </Callout>
      </div>
    )
  }
  if (!view) return <p style={{ ...muted, padding: '24px' }}>Loading the checklist…</p>

  const shownId = view.checklist?.id ?? null
  // The standards unticked; everything else applicable is in scope.
  const unticked = ticks && ticks.checklist === shownId ? ticks.unticked : leftOut(view)
  const setUnticked = (next: Set<string>) => setTicks({ checklist: shownId, unticked: next })
  const chosen = view.standards.filter((s) => !unticked.has(s.id))
  const generate = async () => {
    setRunning(true)
    setError(null)
    try {
      setView(
        await generateChecklist(
          reference,
          chosen.map((s) => s.id),
        ),
      )
    } catch (failure: unknown) {
      setError(
        failure instanceof GatewayError
          ? failure.message
          : 'The checklist could not be generated. Try again.',
      )
    } finally {
      setRunning(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-6)',
        padding: 'var(--space-8)',
        maxWidth: '1080px',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 'var(--space-5)',
        }}
      >
        <h2 style={{ ...heading, fontSize: '20px', flex: '1 1 360px' }}>Pre-survey checklist</h2>
        {canGenerate && (
          <Button
            variant={view.checklist ? 'secondary' : 'primary'}
            iconLeft="sparkles"
            loading={running}
            disabled={running}
            onClick={() => void generate()}
          >
            {view.checklist ? 'Regenerate checklist' : 'Generate checklist'}
          </Button>
        )}
      </div>
      {running && <p style={muted}>Generating the checklist. This takes about half a minute.</p>}

      {/* Folded once there is a checklist: the standards matter again only to regenerate. */}
      <details open={!view.checklist} aria-label="Standards to use" style={card}>
        <summary
          style={{
            cursor: 'pointer',
            padding: 'var(--space-5) var(--space-6)',
            fontWeight: 600,
            fontSize: 'var(--text-body-size)',
          }}
        >
          Standards to use ({chosen.length} of {view.standards.length} selected)
        </summary>
        <div style={{ padding: '0 var(--space-6) var(--space-6)' }}>
          {view.standards.length === 0 ? (
            <p style={muted}>
              No standards in the knowledge base apply to {view.scope.facilityType} in{' '}
              {country(view.scope.jurisdiction)}. The checklist will have the template and
              facility-risk items only. Ask a knowledge admin to add the standards.
            </p>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 420px), 1fr))',
                gap: 'var(--space-4) var(--space-8)',
              }}
            >
              {view.standards.map((s) => (
                <Checkbox
                  key={s.id}
                  label={s.title}
                  description={designation(s) || undefined}
                  checked={!unticked.has(s.id)}
                  disabled={!canGenerate || running}
                  onChange={(checked) => {
                    const next = new Set(unticked)
                    if (checked) next.delete(s.id)
                    else next.add(s.id)
                    setUnticked(next)
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </details>

      {error && (
        <Callout tone="danger" title="Couldn't generate the checklist">
          {error}
          {view.checklist && ' The checklist below is the last one generated.'}
        </Callout>
      )}

      {view.checklist &&
        (view.checklist.facilityType !== view.scope.facilityType ||
          view.checklist.jurisdiction !== view.scope.jurisdiction) && (
          // The site was edited since: its hazards and standards may no longer apply.
          <Callout tone="warning" title="This checklist is out of date">
            It was generated for {view.checklist.facilityType} in{' '}
            {country(view.checklist.jurisdiction)}; the site is now {view.scope.facilityType} in{' '}
            {country(view.scope.jurisdiction)}.{' '}
            {canGenerate
              ? 'Regenerate it for the site as it is now.'
              : "The assessment's assigned engineer can regenerate it."}
          </Callout>
        )}

      {view.checklist ? (
        <ChecklistBody checklist={view.checklist} available={view.standards} />
      ) : (
        <EmptyState
          icon="list-checks"
          title="No checklist yet"
          description={
            canGenerate
              ? 'Choose the standards to use, then generate the checklist.'
              : "The assessment's assigned engineer generates its checklist."
          }
        />
      )}
    </div>
  )
}
