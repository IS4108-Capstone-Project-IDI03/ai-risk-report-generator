// A knowledge document's passages for the knowledge base browser (IN-17): one page at a
// time, filtered by the document's outline and pages, or searched. The ingestion service
// lists them (it reads Chroma); the RAG service ranks a search: by words with its keyword
// search (no paid call, nothing masked or recorded), or by meaning with Cohere (the query
// masked first when protection is on, the paid calls recorded). Read by engineers and admins.
import { isValidObjectId } from 'mongoose'
import { z } from 'zod'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
import { IngestionUnavailableError, listPassages, type PassageListing } from './ingestion.service'
import {
  KnowledgeDocumentNotFoundError,
  KnowledgeDocumentWrongStateError,
  labels,
} from './knowledge-document.service'
import { recordAiCalls } from './ai-usage.service'
import { chatPrivacy } from './privacy.service'
import { RagServiceError, searchPassages, searchPassagesByMeaning } from './rag.service'

// How many ranked passages a search keeps, best first: a page and a bit by words; by meaning
// fewer, as the reranker's scores fall away quickly after the best few.
const SEARCH_RESULTS = 30
const MEANING_RESULTS = 20

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
    mode: z.enum(['words', 'meaning'], 'Search by words or by meaning.').default('words'),
  })
  .refine((q) => q.pageFrom === undefined || q.pageTo === undefined || q.pageFrom <= q.pageTo, {
    message: 'The page range ends before it starts.',
    path: ['pageTo'],
  })
export type PassageListQuery = z.infer<typeof passageQuerySchema>

/**
 * Returns one page of a document's passages, how many match, and its outline (IN-17).
 * With `q`, the passages are the search's best matches (by words or by meaning), in rank
 * order, within the other filters; a search by meaning's paid calls are recorded for
 * `userId`. Throws KnowledgeDocumentNotFoundError (before asking any service),
 * KnowledgeDocumentWrongStateError for a search of a document that isn't active (both
 * searches skip its passages), and IngestionUnavailableError when a service is down or
 * the query couldn't be protected.
 */
export async function listKnowledgeDocumentPassages(
  id: string,
  query: PassageListQuery,
  userId?: string,
): Promise<PassageListing> {
  const { q, mode, offset, limit, chapter, section, pageFrom, pageTo } = query
  const filters = { offset, limit, chapter, section, pageFrom, pageTo }
  const document = isValidObjectId(id) ? await KnowledgeDocumentModel.findById(id).lean() : null
  if (!document) throw new KnowledgeDocumentNotFoundError()
  if (!q) return listPassages(id, filters)
  if (labels(document).status !== 'active') {
    throw new KnowledgeDocumentWrongStateError(
      'Search works once this document is active. Browse it by chapter or page meanwhile.',
    )
  }
  const found = mode === 'meaning' ? await byMeaning(q, id, userId) : await byWords(q, id)
  if (found.length === 0) {
    // Nothing matched; the outline still fills the chapter and section filters.
    const { outline } = await listPassages(id, { ...filters, offset: 0, limit: 1 })
    return { total: 0, passages: [], outline }
  }
  return listPassages(id, { ...filters, ids: found.map((passage) => passage.id) })
}

const searchFailed = () =>
  new IngestionUnavailableError('The search could not be run. Try again shortly.')

// The keyword search's best matches; no paid call.
async function byWords(q: string, id: string) {
  return searchPassages(q, [id], SEARCH_RESULTS).catch(() => {
    throw searchFailed()
  })
}

// The best matches by meaning, its paid calls recorded. A 503 from S4 is the query not being
// protected: nothing was sent, and the engineer is told why.
async function byMeaning(q: string, id: string, userId?: string) {
  try {
    const found = await searchPassagesByMeaning(q, id, await chatPrivacy(), MEANING_RESULTS)
    await recordAiCalls(asKnowledgeSearch(found.usage), { userId, documentId: id })
    return found.results
  } catch (error) {
    if (error instanceof RagServiceError && error.status === 503) {
      throw new IngestionUnavailableError(error.message)
    }
    throw searchFailed()
  }
}

// S4's retriever names every Cohere search `retrieval`, which the cost report counts as
// drafting; a search from the Passages view is its own feature.
function asKnowledgeSearch(usage: unknown): unknown {
  if (!Array.isArray(usage)) return usage
  return usage.map((item: unknown) =>
    item && typeof item === 'object' ? { ...item, feature: 'knowledge-search' } : item,
  )
}
