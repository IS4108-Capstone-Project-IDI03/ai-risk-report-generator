// The right card of the reading screen (CP-23 AC2, board 10, motion 3): what
// has been found so far, in rows (client 1, sites 4, assessments 4), each a grey
// placeholder until its item is revealed, and only the filled rows once read; "+ N more sites" when
// there are more (on a phone one row each: the first and "+ N", board 24); a green New badge on what isn't recorded yet. Used by
// screens/ReadingDocuments.tsx.
import type { ReactNode } from 'react'
import {
  AssessmentTypeTile,
  Icon,
  NewBadge,
  useIsPhone,
  type AssessmentType,
} from '../../../design-system'
import type { IntakeResult } from '../api'
import { FOUND_ROWS } from '../useIntake'

type Item = { key: string; tile: ReactNode; text: string; isNew: boolean }

const tile = (icon: string) => (
  <span className="na-tile">
    <Icon name={icon} size={16} />
  </span>
)
const typeOf = (v: string | null): AssessmentType | null =>
  v === 'Follow-up visit' || v === 'Follow-up' ? 'Follow-up' : (v as AssessmentType | null)

// Up to 4 rows; past that, 3 and a "+ N more" row.
function capped<T>(all: T[], toItem: (x: T) => Item, more: (n: number) => Item) {
  if (all.length <= FOUND_ROWS) return all.map(toItem)
  return [...all.slice(0, FOUND_ROWS - 1).map(toItem), more(all.length - FOUND_ROWS + 1)]
}

/** Returns the found items in the order they are revealed: client, sites, assessments. */
function itemsOf(r: IntakeResult) {
  const siteName = (ref: string) => r.sites.find((s) => s.ref === ref)?.name.value ?? 'Site'
  const client: Item[] = r.client.name.value
    ? [
        {
          key: 'client',
          tile: tile('building-2'),
          text: r.client.name.value,
          isNew: !r.client.existingId,
        },
      ]
    : []
  const sites = capped(
    r.sites,
    (s) => ({
      key: s.ref,
      tile: tile('map-pin'),
      text: s.name.value ?? 'Unnamed site',
      isNew: !s.existingId,
    }),
    (n) => ({
      key: 'more-sites',
      tile: tile('circle-plus'),
      text: `+ ${n} more sites`,
      isNew: false,
    }),
  )
  const assessments = capped(
    r.assessments,
    (a) => {
      const type = typeOf(a.visitType.value)
      return {
        key: a.ref,
        tile: type ? <AssessmentTypeTile type={type} size={32} /> : tile('flag'),
        text: siteName(a.siteRef) + (type ? ' · ' + type : ''),
        isNew: true,
      }
    },
    (n) => ({
      key: 'more-assessments',
      tile: tile('circle-plus'),
      text: `+ ${n} more assessments`,
      isNew: false,
    }),
  )
  return { client, sites, assessments }
}

function Section({
  title,
  rows,
  items,
  from,
  revealed,
  done,
}: {
  title: string
  rows: number
  items: Item[]
  // How many items were revealed before this section's first.
  from: number
  revealed: number
  // The result is in: rows past the last item are dropped.
  done: boolean
}) {
  // Nothing of this kind was found: no heading over an empty list.
  if (done && !items.length) return null
  return (
    <div className="na-found-group">
      <h3>{title}</h3>
      <ul>
        {Array.from({ length: rows }, (_, k) => {
          const item = items[k]
          const shown = !!item && from + k < revealed
          // The grey placeholder fades out under its item; once the read is in, a row
          // with nothing to show is dropped, so the group is only as tall as its items.
          if (done && !item) return null
          const state = shown ? 'shown' : 'wait'
          return (
            <li key={'row-' + k} className="na-found-row" data-state={state}>
              <span className="na-found-wait" aria-hidden="true">
                <span />
                <span />
              </span>
              {shown && (
                <span className="na-found-item">
                  {item.tile}
                  <span key={item.text} className="na-found-text" dir="auto" title={item.text}>
                    {item.text}
                  </span>
                  {item.isNew && <NewBadge />}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// A phone's one row for a group: its first item, then "+ N" for the rest (board 24).
// The assessments row reads type first, as the board shows it.
function oneRow(all: Item[], count: number, text?: string): Item[] {
  if (!all.length) return []
  const label = text ?? all[0].text
  return [{ ...all[0], text: count > 1 ? `${label} +${count - 1}` : label }]
}

export function FoundSoFar({
  result,
  revealed,
}: {
  result: IntakeResult | null
  revealed: number
}) {
  const phone = useIsPhone()
  const full = result ? itemsOf(result) : { client: [], sites: [], assessments: [] }
  const { client } = full
  // `from` counts the items the reveal passes, so it keeps the full lists' lengths.
  const first = result?.assessments[0]
  const type = first && typeOf(first.visitType.value)
  const sites = phone && result ? oneRow(full.sites, result.sites.length) : full.sites
  const assessments =
    phone && result
      ? oneRow(
          full.assessments,
          result.assessments.length,
          first && type
            ? type +
                ' · ' +
                (result.sites.find((s) => s.ref === first.siteRef)?.name.value ?? 'Site')
            : undefined,
        )
      : full.assessments
  return (
    <section className="na-card na-found" aria-label="Found so far">
      <h2>{'Found so far'}</h2>
      <Section
        title="Client"
        rows={1}
        items={client}
        from={0}
        revealed={revealed}
        done={!!result}
      />
      <Section
        title="Sites"
        rows={phone ? 1 : FOUND_ROWS}
        items={sites}
        from={client.length}
        revealed={revealed}
        done={!!result}
      />
      <Section
        title="Assessments"
        rows={phone ? 1 : FOUND_ROWS}
        items={assessments}
        from={client.length + full.sites.length}
        revealed={revealed}
        done={!!result}
      />
    </section>
  )
}
