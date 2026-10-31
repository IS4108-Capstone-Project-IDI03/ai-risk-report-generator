import { useState } from 'react'
import type { ReactNode } from 'react'
import { Badge, Button, Callout, Icon, Switch, Tabs, Tag } from '../../../design-system'
import {
  GatewayError,
  markChecklistItem,
  saveObservation,
  startCaptureSession,
  type Checklist,
  type ChecklistItem,
  type ChecklistView,
  type ReportSection,
  type SavedObservation,
  type ScopeStandard,
} from '../api'
import { categoryLabel } from '../categories'
import {
  areaProgress,
  caption,
  card,
  CHECK_LABEL,
  CHECK_TONE,
  country,
  draftingNeed,
  heading,
  itemDetail,
  itemTitle,
  muted,
  needLabel,
} from '../checklistChecks'
import { formatDayYearTime } from '../format'
import { AnswerDialog, type Answer, type AnswerPlace } from './ChecklistAnswer'
import { MoreMenu } from './MoreMenu'

// One checklist, shown in two places (CP-31): the assessment's Checklist tab
// and the sheet opened from capture. Both show it the same way, with the same
// answers: the facility's priority risks and the report sections on two tabs,
// each section by subsection, the relevant sections or all of them, and each
// item with its citations and its answer or the buttons to give one. Only
// where an answer's observation is saved differs (AnswerPlace).

// A subsection's name over its items: small capitals, so it reads as a label.
const eyebrow = {
  margin: 0,
  fontSize: 'var(--text-eyebrow-size)',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
} as const
const list = { listStyle: 'none', margin: 0, padding: 0 } as const
const row = {
  padding: 'var(--space-4) var(--space-6)',
  borderTop: '1px solid var(--border-subtle)',
} as const

// "NFPA 13", as engineers name a standard; its title when it has no number.
function shortName(s: Pick<ScopeStandard, 'title' | 'sourceType' | 'standardNumber'> | undefined) {
  if (!s) return 'Standard'
  const issuer = { nfpa_standard: 'NFPA', fm_standard: 'FM' }[s.sourceType ?? '']
  return issuer && s.standardNumber ? `${issuer} ${s.standardNumber}` : s.title
}

// Relevant sections or all of them, remembered in this browser so the tab and
// the sheet open the same way. Storage may be unavailable; it is only a convenience.
const ALL_SECTIONS_KEY = 'checklist.allSections'
function readAllSections() {
  try {
    return localStorage.getItem(ALL_SECTIONS_KEY) === 'true'
  } catch {
    return false
  }
}
function writeAllSections(all: boolean) {
  try {
    localStorage.setItem(ALL_SECTIONS_KEY, String(all))
  } catch {
    // Kept for this visit only.
  }
}

// A cited passage (CP-30 AC6), opened from its citation: the whole passage and
// a link to the original at that page.
function PassagePanel({ passage, checklist }: { passage: string; checklist: Checklist }) {
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

// Said of a quote the code could not find in the passage it cites (CP-30 AC6).
const UNVERIFIED = "The AI's quoted words are not word for word in this passage. Verify before use."

// An item's citations by standard and page, in the order first cited.
function groupCitations(citations: ChecklistItem['citations'], checklist: Checklist) {
  const pages = new Map<
    string,
    {
      key: string
      standard: Checklist['standards'][number] | undefined
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

// How the item was answered, by whom, where and when, with a way to see its
// observation or clear its mark; else the ways to answer it, for the assigned
// engineer. Confirm and Differs are the buttons; Not seen and Not applicable
// sit behind ⋯, as they are answered less often.
function AnswerControls({
  item,
  canAnswer,
  busy,
  onBegin,
  onMark,
  onView,
}: {
  item: ChecklistItem
  canAnswer: boolean
  busy: boolean
  onBegin: (kind: 'confirm' | 'differs') => void
  onMark: (mark: 'not_seen' | 'not_applicable' | null) => void
  onView: (observationId: string) => void
}) {
  const answers = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 'var(--space-3)',
    marginTop: 'var(--space-4)',
  } as const
  const check = item.check
  if (check) {
    return (
      <div style={answers}>
        <Badge tone={CHECK_TONE[check.result]}>{CHECK_LABEL[check.result]}</Badge>
        <span style={caption}>
          {[check.by, check.observation?.location, formatDayYearTime(new Date(check.at))]
            .filter(Boolean)
            .join(' · ')}
        </span>
        {check.observation ? (
          <Button variant="link" size="sm" onClick={() => onView(check.observation!.id)}>
            View observation
          </Button>
        ) : (
          canAnswer && (
            <Button variant="link" size="sm" disabled={busy} onClick={() => onMark(null)}>
              Clear
            </Button>
          )
        )}
      </div>
    )
  }
  if (!canAnswer) return null
  return (
    <div style={answers}>
      <Button iconLeft="check" disabled={busy} onClick={() => onBegin('confirm')}>
        Confirm
      </Button>
      <Button iconLeft="equal-not" disabled={busy} onClick={() => onBegin('differs')}>
        Differs
      </Button>
      <MoreMenu
        items={[
          { label: 'Not seen', icon: 'eye-off', onSelect: () => onMark('not_seen') },
          {
            label: 'Not applicable',
            icon: 'circle-slash',
            onSelect: () => onMark('not_applicable'),
          },
        ]}
      />
    </div>
  )
}

// One item: its wording (a template subsection by its heading, with what it
// covers), its categories and citations, and its answer.
function ItemRow({
  item,
  checklist,
  general,
  indent = false,
  fresh = false,
  answer,
}: {
  item: ChecklistItem
  checklist: Checklist
  // For the team's general check of a risk: why it has no specific one.
  general?: string
  // Under its template subsection's row, in the full view.
  indent?: boolean
  // New in a regenerate just made, in the place of an answer it did not keep,
  // so it may replace that answer: tinted and tagged to answer again.
  fresh?: boolean
  answer: ReactNode
}) {
  // Only the model's items are AI-written (CP-30 AC8); the template's and the
  // hazard list's own are the team's.
  const written = item.origin === 'standard' || item.origin === 'hazard'
  // Citations of one page of one standard share a chip; opened, it shows each quote.
  const pages = groupCitations(item.citations, checklist)
  const [open, setOpen] = useState<string | null>(null)
  const opened = pages.find((p) => p.key === open)
  const uncited = item.flags.includes('uncited') && !general
  const detail = itemDetail(item)
  return (
    <li
      aria-label={itemTitle(item)}
      style={{
        padding: `var(--space-5) var(--space-6) var(--space-5) ${indent ? 'var(--space-9)' : 'var(--space-6)'}`,
        borderTop: '1px solid var(--border-subtle)',
        // AI violet marks provisional machine-written text (docs/areas/ui.md).
        boxShadow: written ? 'inset 3px 0 0 var(--ai-border)' : undefined,
        background: fresh ? 'var(--diff-added-bg)' : undefined,
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 'var(--text-body-size)',
          lineHeight: '22px',
          fontWeight: item.origin === 'template' ? 600 : 400,
        }}
      >
        {fresh && (
          <Badge tone="info" style={{ marginRight: 'var(--space-3)' }}>
            Answer again?
          </Badge>
        )}
        {itemTitle(item)}
      </p>
      {detail && <p style={{ ...muted, marginTop: 'var(--space-2)' }}>{detail}</p>}
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
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 'var(--space-3)',
          marginTop: 'var(--space-3)',
        }}
      >
        <span style={caption}>{categoryLabel(item.COPE_dimension)}</span>
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
      {answer}
    </li>
  )
}

// A titled card of items: how many of them are answered and, for a report
// section, how many more observations it needs to be drafted (AC6-7). The
// items answered when it was first shown are folded under Answered, so the
// ones left come first; an item answered meanwhile stays where it is, so
// nothing moves under the engineer's thumb.
function Group({
  title,
  note,
  items,
  need,
  answered,
  children,
}: {
  title: string
  note?: ReactNode
  // Every item the card shows, answered or not.
  items: ChecklistItem[]
  need: number | null
  answered: ReactNode[]
  children: ReactNode
}) {
  const [unfolded, setUnfolded] = useState(false)
  const written = items.some((i) => i.origin === 'standard' || i.origin === 'hazard')
  const { checked } = areaProgress(items)
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
          <p style={{ ...caption, marginTop: 'var(--space-1)' }}>
            {checked} of {items.length} answered
            {need !== null && (
              <span style={{ color: need ? 'var(--status-moderate-fg)' : undefined }}>
                {' · '}
                {needLabel(need)}
              </span>
            )}
          </p>
        </div>
        {written && (
          <Badge tone="ai" icon="sparkles">
            AI-generated
          </Badge>
        )}
      </div>
      {children}
      {answered.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={unfolded}
            onClick={() => setUnfolded(!unfolded)}
            style={{
              ...row,
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              width: '100%',
              border: 'none',
              borderTop: '1px solid var(--border-subtle)',
              background: 'var(--surface-sunken)',
              textAlign: 'left',
              font: 'inherit',
              fontSize: 'var(--text-small-size)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            <Icon name={unfolded ? 'chevron-down' : 'chevron-right'} size={14} />
            Answered ({answered.length})
          </button>
          {unfolded && <ul style={list}>{answered}</ul>}
        </>
      )}
    </section>
  )
}

// "A", "A or B", "A, B or C".
function either(names: string[], word = 'or') {
  return names.length < 2
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} ${word} ${names[names.length - 1]}`
}

type Hazard = Checklist['hazards'][number]

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

// What answering needs from the screen showing the checklist; null for anyone
// but the assigned engineer, who sees the answers only.
export type ChecklistAnswering = {
  place: AnswerPlace
  // An observation saved from the checklist, for the screen's own lists.
  onSaved: (observation: SavedObservation) => void
  // Differs, to record in full capture instead.
  onFullCapture: (item: ChecklistItem) => void
}

export function ChecklistItems({
  reference,
  view,
  sections,
  setView,
  reload,
  answering,
  highlight,
  regenerateHint,
  onViewObservation,
}: {
  reference: string
  view: ChecklistView & { checklist: Checklist }
  sections: ReportSection[] | null
  setView: (view: ChecklistView) => void
  reload: () => Promise<void>
  answering: ChecklistAnswering | null
  // The new items that may replace answers a regenerate did not keep (CP-31).
  highlight?: Set<string>
  // What to do about an out-of-date checklist, from where it is shown.
  regenerateHint: string
  onViewObservation: (observationId: string) => void
}) {
  const { checklist } = view
  // Answered when first shown; the parent keys this by checklist, so a new one starts again.
  const [folded] = useState(() => new Set(checklist.items.filter((i) => i.check).map((i) => i.id)))
  const [part, setPart] = useState(checklist.hazards.length ? 'risks' : 'sections')
  const [allChosen, setAllChosen] = useState(readAllSections)
  // With no standard in scope no section adds anything, so all are shown.
  const noStandards = checklist.standards.length === 0
  const all = allChosen || noStandards
  const setAll = (next: boolean) => {
    setAllChosen(next)
    writeAllSections(next)
  }
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [answeringItem, setAnsweringItem] = useState<{
    kind: 'confirm' | 'differs'
    item: ChecklistItem
  } | null>(null)

  const begin = (kind: 'confirm' | 'differs', item: ChecklistItem) => {
    const place = answering!.place
    // On site, an answer is saved where the engineer is, so that comes first.
    if (place.kind === 'site' && !place.location) return place.choose()
    setAnsweringItem({ kind, item })
  }
  const mark = async (item: ChecklistItem, value: 'not_seen' | 'not_applicable' | null) => {
    setBusy(item.id)
    setError(null)
    try {
      setView(await markChecklistItem(reference, item.id, value))
    } catch (failed: unknown) {
      setError(
        failed instanceof GatewayError
          ? failed.message
          : 'The answer could not be saved. Try again.',
      )
    } finally {
      setBusy(null)
    }
  }
  const save = async (kind: 'confirm' | 'differs', item: ChecklistItem, answer: Answer) => {
    // Every observation belongs to a capture session; starting one is safe to
    // repeat, and on site one is already open.
    if (answering!.place.kind === 'tab') await startCaptureSession(reference)
    const saved = await saveObservation(
      reference,
      {
        note: answer.note,
        copeDimensions: item.COPE_dimension.length ? item.COPE_dimension : null,
        severity: answer.severity,
        locationId: answer.locationId,
        checklistItem: { itemId: item.id, result: kind === 'confirm' ? 'confirmed' : 'differs' },
      },
      [],
      answer.photos.map((photo) => ({ name: photo.name, image: photo })),
    )
    answering!.onSaved(saved)
    setAnsweringItem(null)
    await reload().catch(() => undefined)
  }
  const answer = (item: ChecklistItem) => (
    <AnswerControls
      item={item}
      canAnswer={!!answering}
      busy={busy === item.id}
      onBegin={(kind) => begin(kind, item)}
      onMark={(value) => void mark(item, value)}
      onView={onViewObservation}
    />
  )
  const itemRow = (item: ChecklistItem, extra: { general?: string; indent?: boolean } = {}) => (
    <ItemRow
      key={item.id}
      item={item}
      checklist={checklist}
      answer={answer(item)}
      fresh={!!highlight?.has(item.id)}
      {...extra}
    />
  )

  // What each tab shows: the risks' items, and the sections' as the switch is set.
  const riskItems = checklist.items.filter((i) => i.area === 'hazards')
  const shownInSection = (i: ChecklistItem) =>
    i.origin === 'standard' || (all && i.origin === 'template')
  const sectionItems = checklist.items.filter((i) => i.area !== 'hazards' && shownInSection(i))
  // A tab's answered items, and any to check after a regenerate lost answers.
  const count = (items: ChecklistItem[]) => {
    const fresh = items.filter((i) => highlight?.has(i.id)).length
    return `${areaProgress(items).checked}/${items.length}` + (fresh ? ` · ${fresh} to check` : '')
  }
  const outOfDate =
    checklist.facilityType !== view.scope.facilityType ||
    checklist.jurisdiction !== view.scope.jurisdiction

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      {outOfDate && (
        // The site was edited since: its hazards and standards may no longer apply.
        <Callout tone="warning" title="This checklist is out of date">
          It was generated for {checklist.facilityType} in {country(checklist.jurisdiction)}; the
          site is now {view.scope.facilityType} in {country(view.scope.jurisdiction)}.{' '}
          {regenerateHint}
        </Callout>
      )}
      <p style={muted}>
        {areaProgress(checklist.items).checked} of {checklist.items.length} answered
      </p>
      {error && (
        <div role="alert">
          <Callout tone="danger" title="Not saved">
            {error}
          </Callout>
        </div>
      )}
      {checklist.hazards.length === 0 && (
        // A facility type outside the hazard list's nine, e.g. an older site's.
        <Callout tone="info" title="No facility risks for this facility type">
          No facility risks are configured for &lsquo;{checklist.facilityType}&rsquo;, so this
          checklist has the report template&apos;s items and the standards&apos; items only.
        </Callout>
      )}
      <Tabs
        value={part}
        onChange={setPart}
        items={[
          ...(checklist.hazards.length
            ? [{ value: 'risks', label: `Priority risks ${count(riskItems)}` }]
            : []),
          { value: 'sections', label: `Report sections ${count(sectionItems)}` },
        ]}
      />

      {part === 'risks' && (
        <>
          <p style={muted}>
            Risks specific to {checklist.facilityType.toLowerCase()} sites, to check first.
          </p>
          {checklist.hazards.map((hazard) => {
            const items = riskItems.filter((i) => i.hazard === hazard.id)
            const general = (item: ChecklistItem) =>
              item.origin === 'hazard_list' ? generalCheck(hazard, view.standards) : undefined
            return (
              <Group
                key={hazard.id}
                title={hazard.name}
                items={items}
                need={null}
                note={
                  riskNote(hazard) && (
                    <p style={{ ...caption, marginTop: 'var(--space-1)' }}>{riskNote(hazard)}</p>
                  )
                }
                answered={items
                  .filter((i) => folded.has(i.id))
                  .map((i) => itemRow(i, { general: general(i) }))}
              >
                <ul style={list}>
                  {items
                    .filter((i) => !folded.has(i.id))
                    .map((i) => itemRow(i, { general: general(i) }))}
                </ul>
              </Group>
            )
          })}
        </>
      )}

      {part === 'sections' && (
        <SectionsPart
          checklist={checklist}
          sections={sections}
          all={all}
          noStandards={noStandards}
          setAll={setAll}
          shown={shownInSection}
          folded={folded}
          itemRow={itemRow}
        />
      )}

      {answeringItem && answering && (
        <AnswerDialog
          kind={answeringItem.kind}
          item={answeringItem.item}
          place={answering.place}
          onClose={() => setAnsweringItem(null)}
          onSave={(given) => save(answeringItem.kind, answeringItem.item, given)}
          onFullCapture={() => {
            setAnsweringItem(null)
            answering.onFullCapture(answeringItem.item)
          }}
        />
      )}
    </div>
  )
}

// The report sections, each once. Relevant sections (the default) shows only
// the sections the ticked standards add requirements to, under their
// subsection, and names the rest in one line, so none goes missing
// unexplained. All sections shows every template subsection as an item, with
// those requirements beneath it.
function SectionsPart({
  checklist,
  sections,
  all,
  noStandards,
  setAll,
  shown,
  folded,
  itemRow,
}: {
  checklist: Checklist
  sections: ReportSection[] | null
  all: boolean
  noStandards: boolean
  setAll: (all: boolean) => void
  shown: (item: ChecklistItem) => boolean
  folded: Set<string>
  itemRow: (item: ChecklistItem, extra?: { indent?: boolean }) => ReactNode
}) {
  // The view the switch is on reads as chosen; the other, muted.
  const side = (chosen: boolean) =>
    ({
      fontSize: 'var(--text-small-size)',
      fontWeight: chosen ? 600 : 400,
      color: chosen ? 'var(--text-primary)' : 'var(--text-secondary)',
    }) as const
  const label = (text: string) => (
    <p style={{ ...eyebrow, ...row, background: 'var(--surface-sunken)' }}>{text}</p>
  )
  const addedTo = (areaId: string) =>
    checklist.items.filter((i) => i.area === areaId && i.origin === 'standard')
  const empty = checklist.areas.filter((area) => addedTo(area.id).length === 0)
  return (
    <>
      {noStandards ? (
        <p style={muted}>No standards were selected, so every report section is shown.</p>
      ) : (
        // A switch between two named views: the relevant sections, or all of them.
        <div
          style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-5)' }}
        >
          <button
            type="button"
            onClick={() => setAll(false)}
            style={{
              border: 'none',
              background: 'none',
              padding: 0,
              font: 'inherit',
              cursor: 'pointer',
              ...side(!all),
            }}
          >
            Relevant sections
          </button>
          <Switch
            label={<span style={side(all)}>All sections</span>}
            checked={all}
            onChange={setAll}
          />
        </div>
      )}
      {checklist.areas.map((area) => {
        const added = addedTo(area.id)
        if (!all && added.length === 0) return null
        const items = checklist.items.filter((i) => i.area === area.id && shown(i))
        const rows = checklist.items.filter((i) => i.area === area.id && i.origin === 'template')
        const open = (i: ChecklistItem) => !folded.has(i.id)
        // Requirements under no template subsection come first, as General,
        // then each subsection's. In all sections a subsection is its own item
        // while unanswered; otherwise, and in relevant sections, its name is a
        // label over its requirements.
        const parts = [
          {
            name: 'General',
            template: null as ChecklistItem | null,
            items: added.filter((i) => !rows.some((r) => r.subsection === i.subsection)),
          },
          ...rows.map((r) => ({
            name: r.subsection ?? '',
            template: all ? r : null,
            items: added.filter((i) => i.subsection === r.subsection),
          })),
        ]
          .map((part) => ({
            ...part,
            items: part.items.filter(open),
            template: part.template && open(part.template) ? part.template : null,
          }))
          .filter((part) => part.template || part.items.length > 0)
        return (
          <Group
            key={area.id}
            title={`${area.id}. ${area.title}`}
            items={items}
            need={draftingNeed(area.id, sections)}
            answered={items.filter((i) => !open(i)).map((i) => itemRow(i))}
          >
            {added.length === 0 && (
              <p style={{ ...muted, ...row }}>Nothing specific in the selected standards.</p>
            )}
            {parts.map((part) => (
              <div key={part.name}>
                {!part.template && label(part.name)}
                <ul style={list}>
                  {part.template && itemRow(part.template)}
                  {part.items.map((item) => itemRow(item, { indent: !!part.template }))}
                </ul>
              </div>
            ))}
          </Group>
        )
      })}
      {!all && empty.length > 0 && (
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
              onClick={() => setAll(true)}
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
