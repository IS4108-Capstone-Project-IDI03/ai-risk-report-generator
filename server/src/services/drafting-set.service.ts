// The standards selected on an assessment (AS-01 AC3): what the Ask tab
// searches, and the drafting set, the only standards text proposed for a
// section may cite (AS-04 AC4). The latest checklist's standards (CP-30) are
// the ones selected; before any checklist, every standard that applies to the
// site. Read from knowledge_documents now, so one withdrawn since the
// checklist is no longer searched or citable. Used by assessment-ask.service
// and text-proposal.service.
import type { Types } from 'mongoose'
import { selectedStandardIds } from './checklist.service'
import {
  listApplicableStandards,
  listIngestedDocuments,
  type KnowledgeDocumentDto,
} from './knowledge-document.service'

export const STANDARD_TYPES = new Set(['fm_standard', 'nfpa_standard', 'local_standard'])

// A document's name as the prompt shows it: "FM Global 2-81 (2026)" for a
// standard, else its title. As rag-service's app/chat/answer.py names them.
export function documentName(d: KnowledgeDocumentDto): string {
  if (!d.standardNumber) return d.title
  const name = d.issuingBody ? `${d.issuingBody} ${d.standardNumber}` : d.standardNumber
  return d.edition ? `${name} (${d.edition})` : name
}

// Whether search can return a standard's passages: finished, not withdrawn and
// with no Unconfirmed details (KB-01, IN-05).
export const searchable = (d: KnowledgeDocumentDto) =>
  d.status === 'complete' && !d.withdrawn && d.unconfirmed.length === 0

// The assessment's selected standards, searchable now, and whether they are
// the latest checklist's (else every one that applies to the site).
// `documents` are the finished knowledge documents, when already read.
export async function selectedStandards(
  assessment: Types.ObjectId,
  site: { jurisdiction: string; facilityType: string },
  documents?: KnowledgeDocumentDto[],
): Promise<{ standards: KnowledgeDocumentDto[]; fromChecklist: boolean }> {
  const [selected, all] = await Promise.all([
    selectedStandardIds(assessment),
    documents ?? listIngestedDocuments(),
  ])
  const chosen =
    selected ??
    (await listApplicableStandards(site.facilityType, site.jurisdiction)).map((d) => d.id)
  const wanted = new Set(chosen)
  return {
    standards: all.filter(
      (d) => wanted.has(d.id) && searchable(d) && STANDARD_TYPES.has(d.sourceType ?? ''),
    ),
    fromChecklist: selected !== null,
  }
}
