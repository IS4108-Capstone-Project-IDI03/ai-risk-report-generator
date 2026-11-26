// The Export tab's "Left to finish" card (EX-01): the gateway's export blockers (blockersFrom in
// server/src/services/export.service.ts) grouped under their section, each a task row that opens
// where it is finished (Generation or Review). Once nothing is left, one done row. Open comment
// threads (RV-03 AC9) follow as a reminder row that never blocks. Called by screens/ReportExport.
import { ListCard, TaskRow } from '../../../design-system'
import type { ExportBlocker } from '../api'
import { Tip } from '../../help/Tip'

type Props = {
  // null until the check has answered.
  blockers: ExportBlocker[] | null
  openThreads: number
  // The assigned engineer: their turn, so each task's tile is amber.
  canExport: boolean
  onReview: (section?: string) => void
  onGenerate: () => void
}

/** Returns the blockers grouped by section, in the gateway's order. */
function bySection(blockers: ExportBlocker[]) {
  const groups = new Map<string, ExportBlocker[]>()
  for (const b of blockers) groups.set(b.title, [...(groups.get(b.title) ?? []), b])
  return [...groups.entries()].map(([title, items]) => ({ title, items }))
}

export function ExportChecklist({ blockers, openThreads, canExport, onReview, onGenerate }: Props) {
  return (
    <>
      <ListCard
        as="section"
        className="ex-card"
        data-walk="export.left"
        aria-labelledby="ex-left-title"
        titleId="ex-left-title"
        title={
          <>
            Left to finish <Tip id="export.left-to-finish" />
          </>
        }
      >
        {blockers?.length ? (
          <ul className="ex-groups">
            {bySection(blockers).map((group) => (
              <li key={group.title} className="ex-group">
                <h3 className="ex-group-title">{group.title}</h3>
                {group.items.map((b, i) => (
                  <TaskRow
                    key={`${b.sectionId}-${i}`}
                    icon={b.where === 'generation' ? 'sparkles' : 'user-round-search'}
                    title={b.reason}
                    detail={b.where === 'generation' ? 'Finish on Generation' : 'Finish in Review'}
                    active={canExport}
                    label={
                      b.where === 'generation'
                        ? `Open Generation for ${b.title}`
                        : `Open review for ${b.title}`
                    }
                    onOpen={() => (b.where === 'generation' ? onGenerate() : onReview(b.sectionId))}
                  />
                ))}
              </li>
            ))}
          </ul>
        ) : (
          <TaskRow
            icon={blockers ? 'file-check' : 'circle-dashed'}
            title={blockers ? 'Nothing left to finish' : 'Not checked yet'}
            detail={
              blockers ? 'Every section is written and reviewed' : 'The check runs as the tab opens'
            }
            done={!!blockers}
          />
        )}
      </ListCard>

      {openThreads > 0 && (
        <ListCard as="section" className="ex-card" label="Reminder">
          <TaskRow
            icon="messages-square"
            title={`${openThreads} comment thread${openThreads === 1 ? ' is' : 's are'} still open`}
            detail="A reminder only: they don't stop the export, and no comments appear in the file."
            // The count and meaning stay in the name: aria-label replaces the row's visible text.
            label={`Open review: ${openThreads} comment thread${openThreads === 1 ? ' is' : 's are'} still open`}
            onOpen={() => onReview()}
          />
        </ListCard>
      )}
    </>
  )
}
