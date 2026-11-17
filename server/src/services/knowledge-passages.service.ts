// A knowledge document's passages for the knowledge base browser (IN-17): one page at a
// time, filtered by the document's outline and pages, or searched by words. The ingestion
// service lists them (it reads Chroma); the RAG service's keyword search ranks a search,
// with no paid call, so nothing is masked or recorded. Read by engineers and admins.
import { isValidObjectId } from 'mongoose'
import { z } from 'zod'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
import { IngestionUnavailableError, listPassages, type PassageListing } from './ingestion.service'
import {
  KnowledgeDocumentNotFoundError,
  KnowledgeDocumentWrongStateError,
  labels,
} from './knowledge-document.service'
import { searchPassages } from './rag.service'

// How many ranked passages a search keeps: a page and a bit, best first.
const SEARCH_RESULTS = 30

const wholeNumber = () => z.coerce.number('Use a whole number.').int('Use a whole number.')

// The query string of GET /api/knowledge-documents/:id/passages. `chapter` and `section`
// are names from the outline, "" included (front matter); a search is `q` by words.
export const passageQuerySchema = z
  .object({
    offset: wholeNumber().min(0, 'The offset can’t be negative.').default(0),
    limit: wholeNumber()
      .min(1, 'Show at least one passage.')
      .max(100, 'Show at most 100 passages.')
      .default(25),
    chapter: z.string().max(200).optional(),
    section: z.string().max(200).optional(),
    pageFrom: wholeNumber().min(1, 'Pages start at 1.').optional(),
    pageTo: wholeNumber().min(1, 'Pages start at 1.').optional(),
    q: z.string().trim().max(200).optional(),
    mode: z.enum(['words'], 'Search by words.').default('words'),
  })
  .refine((q) => q.pageFrom === undefined || q.pageTo === undefined || q.pageFrom <= q.pageTo, {
    message: 'The page range ends before it starts.',
    path: ['pageTo'],
  })
export type PassageListQuery = z.infer<typeof passageQuerySchema>

/**
 * Returns one page of a document's passages, how many match, and its outline (IN-17).
 * With `q`, the passages are the keyword search's best matches, in rank order, within the
 * other filters. Throws KnowledgeDocumentNotFoundError (before asking any service),
 * KnowledgeDocumentWrongStateError for a search of a document that isn't active (the
 * search skips its passages), and IngestionUnavailableError when a service is down.
 */
export async function listKnowledgeDocumentPassages(
  id: string,
  query: PassageListQuery,
): Promise<PassageListing> {
  // `mode` is always "words" for now; search by meaning would read it.
  const { q, offset, limit, chapter, section, pageFrom, pageTo } = query
  const filters = { offset, limit, chapter, section, pageFrom, pageTo }
  const document = isValidObjectId(id) ? await KnowledgeDocumentModel.findById(id).lean() : null
  if (!document) throw new KnowledgeDocumentNotFoundError()
  if (!q) return listPassages(id, filters)
  if (labels(document).status !== 'active') {
    throw new KnowledgeDocumentWrongStateError(
      'Search works once this document is active. Browse it by chapter or page meanwhile.',
    )
  }
  const found = await searchPassages(q, [id], SEARCH_RESULTS).catch(() => {
    throw new IngestionUnavailableError('The search could not be run. Try again shortly.')
  })
  if (found.length === 0) {
    // Nothing matched; the outline still fills the chapter and section filters.
    const { outline } = await listPassages(id, { ...filters, offset: 0, limit: 1 })
    return { total: 0, passages: [], outline }
  }
  return listPassages(id, { ...filters, ids: found.map((passage) => passage.id) })
}
