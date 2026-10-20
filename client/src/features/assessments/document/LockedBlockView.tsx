import { useContext } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { Button, IconRegistry } from '../../../design-system'
import type { AcceptedOfi } from '../api'
import { AppendixPhotos } from '../components/AppendixPhotos'
import { LossEstimateFigures } from '../components/LossEstimateFigures'
import { PurposeScope } from '../components/PurposeScope'
import { RiskQualityFigures } from '../components/RiskQualityFigures'
import { DocumentPartsContext } from './parts'
import { LOSS_LEVEL_IDS } from './sections'

const LABELS: Record<string, string> = {
  purpose: 'From the assessment details',
  ofis: 'Opportunities for Improvement in the report',
  'risk-quality': 'Risk quality scores and ratings',
  'loss-estimates': 'Values and loss estimates',
  table: 'Table filled from measured values',
  appendix: 'Photos chosen for Appendix A',
}

// Section 5's level tables, read-only: their drafted rows are the text below.
const BELOW = new Map(
  LOSS_LEVEL_IDS.flatMap((level) =>
    ['Scenario', 'Assumptions'].map(
      (part) =>
        [
          `Level ${level} ${part}`,
          <span className="rv-muted">{`In Level ${level} ${part} below`}</span>,
        ] as const,
    ),
  ),
)

function OfiList({ ofis }: { ofis: AcceptedOfi[] }) {
  if (!ofis.length)
    return (
      <p className="rv-muted">
        No OFIs are in the report yet. Suggestions are drafted on Generation and accepted in the
        review workspace.
      </p>
    )
  return (
    <ol className="dm-ofi-list">
      {ofis.map((o) => (
        <li key={o.id}>
          <span className="dm-ofi-number">{o.number}</span> {o.title}{' '}
          <span className="rv-muted">
            · {o.category} · {o.priority} priority
          </span>
        </li>
      ))}
    </ol>
  )
}

// A part of the report filled in elsewhere, shown read-only where it sits in
// the document (the locked blocks of schema.ts).
export function LockedBlockView({ node }: NodeViewProps) {
  const parts = useContext(DocumentPartsContext)
  const kind = node.attrs.kind as string
  const section = node.attrs.section as string
  if (!parts) return <NodeViewWrapper />
  const { reference } = parts
  const body =
    kind === 'purpose' ? (
      <PurposeScope text={parts.purposeAndScope} error={null} />
    ) : kind === 'ofis' ? (
      <OfiList ofis={parts.ofis} />
    ) : kind === 'risk-quality' ? (
      <RiskQualityFigures reference={reference} canEdit={false} />
    ) : kind === 'loss-estimates' ? (
      <LossEstimateFigures reference={reference} canEdit={false} drafted={BELOW} />
    ) : kind === 'appendix' ? (
      <AppendixPhotos reference={reference} canEdit={false} />
    ) : (
      <p className="rv-muted">
        This table is completed from measured values, so it is not written here.
      </p>
    )
  // Section 1 changes with the assessment details, a table with its values.
  const where = kind === 'purpose' || kind === 'table' ? null : section
  return (
    <NodeViewWrapper className="dm-locked" data-kind={kind} contentEditable={false}>
      <div className="dm-locked-bar">
        <span className="rv-label">{LABELS[kind] ?? 'Filled in elsewhere'}</span>
        <span className="dm-locked-note">Not edited here</span>
        {where && (
          <Button
            variant="ghost"
            size="sm"
            iconRight={IconRegistry.action.openExternal}
            onClick={() => parts.onOpen(where)}
          >
            Change in the review workspace
          </Button>
        )}
      </div>
      <div className="dm-locked-body">{body}</div>
    </NodeViewWrapper>
  )
}
