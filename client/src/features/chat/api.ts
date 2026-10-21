// The knowledge assistant's connection to the gateway (CB-01). OpenUI's chat
// screen posts each question here and reads the answer back as a stream.
// Calls server/src/routes/chat.routes.ts.
import { agUIAdapter, fetchLLM } from '@openuidev/react-headless'
import { request } from '../assessments/api'

/** The chat screen's link to POST /api/chat, read as AG-UI events (the gateway's format). */
export const chatLLM = fetchLLM({ url: '/api/chat', streamAdapter: agUIAdapter() })

/** One passage as GET /api/chat/passages/:id sends it (CB-02). Boxes are in PDF points, origin bottom-left. */
export type Passage = {
  id: string
  documentId: string
  text: string
  headings: string[]
  pageStart: number | null
  pageEnd: number | null
  boxes: { page: number; l: number; t: number; r: number; b: number }[]
}

/** Returns the full text and page boxes of the passage a citation points to. */
export async function fetchPassage(id: string, signal?: AbortSignal): Promise<Passage> {
  // The shared helper also sends an expired session back to sign-in (F-04).
  const path = `/api/chat/passages/${encodeURIComponent(id)}`
  return (await request<Passage>('GET', path, undefined, signal)).data
}

/** Sends a risk engineer's request to add the document behind `question` (CB-07). */
export function askAdminToAdd(question: string, message: string): Promise<unknown> {
  return request('POST', '/api/knowledge-gaps', message ? { question, message } : { question })
}
