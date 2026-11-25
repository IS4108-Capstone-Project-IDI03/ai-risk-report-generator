// The Documents table's groups (KB-01): one band per source type, in this order. Used by
// screens/KnowledgeDocuments.tsx and components/DocumentToolbar.tsx (the Source type filter).
import { IconRegistry } from '../../design-system'
import type { SourceType } from './api'

// One of the table's bands (AC1); a null source type is the Unconfirmed group (IN-05).
export type Group = { sourceType: SourceType | null; title: string; icon: string }

export const GROUPS: Group[] = [
  { sourceType: 'fm_standard', title: 'FM standards', icon: IconRegistry.evidence.standard },
  { sourceType: 'nfpa_standard', title: 'NFPA standards', icon: IconRegistry.evidence.standard },
  { sourceType: 'local_standard', title: 'Local standards', icon: IconRegistry.evidence.standard },
  { sourceType: 'marsh_report', title: 'Past Marsh reports', icon: IconRegistry.evidence.report },
  { sourceType: null, title: 'Source type unconfirmed', icon: 'circle-help' },
]
