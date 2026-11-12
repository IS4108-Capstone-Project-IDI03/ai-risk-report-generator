// The knowledge assistant's connection to the gateway (CB-01). OpenUI's chat
// screen posts each question here and reads the answer back as a stream.
// Calls server/src/routes/chat.routes.ts. Its chat storage (CB-03) saves the chats there.
import {
  agUIAdapter,
  fetchLLM,
  type ChatStorage,
  type Message,
  type Thread,
} from '@openuidev/react-headless'
import { withPhotos } from './photoStore'
import { smoothAdapter } from './smoothAdapter'
import { request } from '../assessments/api'

/** The chat screen's link to POST /api/chat, read as AG-UI events (the gateway's format). */
export const chatLLM = fetchLLM({
  url: '/api/chat',
  streamAdapter: smoothAdapter(agUIAdapter()),
  // The photos chosen for the question go with it (CB-08).
  fetch: withPhotos((input, init) => fetch(input, init)),
})

/** One passage as GET /api/chat/passages/:id sends it (CB-02). Boxes are in PDF points, origin bottom-left. */
export type Passage = {
  id: string
  documentId: string
  text: string
  headings: string[]
  pageStart: number | null
  pageEnd: number | null
  boxes: PageBox[]
  /** The part of the original page a table, formula or picture was read from (KB-02); null or
   * absent for plain text and an attached PDF's page. */
  region?: { kind: 'table' | 'formula' | 'picture'; boxes: PageBox[] } | null
  /** The text holds a model's description of a picture, not the document's words (IN-13). */
  generated?: boolean
}

/** A rectangle on a PDF page, in points from the page's bottom-left corner. */
export type PageBox = { page: number; l: number; t: number; r: number; b: number }

/** Returns the full text and page boxes of the passage a citation points to. */
export async function fetchPassage(id: string, signal?: AbortSignal): Promise<Passage> {
  // The shared helper also sends an expired session back to sign-in (F-04).
  const path = `/api/chat/passages/${encodeURIComponent(id)}`
  return (await request<Passage>('GET', path, undefined, signal)).data
}

// What the chat list is filtered by; set by the sidebar's search box (CB-03 AC3).
let search = ''
/** Sets the words the next chat-list load searches for; empty lists every chat. */
export function setChatSearch(text: string) {
  search = text.trim()
}

const CHATS = '/api/chat/conversations'

/** A message's text; OpenUI allows content parts, but this chat only sends plain text. */
const textOf = (content: unknown) => (typeof content === 'string' ? content : '')

/** OpenUI's thread storage (CB-03): saved chats live behind the gateway's /api/chat/conversations. */
export const chatStorage: ChatStorage = {
  thread: {
    listThreads: async () => {
      const query = search ? `?q=${encodeURIComponent(search)}` : ''
      return { threads: (await request<{ threads: Thread[] }>('GET', CHATS + query)).data.threads }
    },
    createThread: async (first) =>
      (await request<Thread>('POST', CHATS, { message: { content: textOf(first.content) } })).data,
    getMessages: async (id) =>
      (await request<{ messages: Message[] }>('GET', `${CHATS}/${id}`)).data.messages,
    updateThread: async (thread) =>
      (await request<Thread>('PATCH', `${CHATS}/${thread.id}`, { title: thread.title })).data,
    deleteThread: async (id) => {
      await request('DELETE', `${CHATS}/${id}`)
    },
  },
}

/** For a message with siblings (retries, edited questions): all their ids and which one is shown (CB-04). */
export type Versions = Record<string, { ids: string[]; index: number }>
type View = { messages: Message[]; versions: Versions }

/** Returns the saved chat's messages on screen and their versions. */
export async function fetchView(threadId: string): Promise<View> {
  const { messages, versions } = (await request<View>('GET', `${CHATS}/${threadId}`)).data
  return { messages, versions: versions ?? {} }
}

/** Switches a saved chat to the version holding `messageId`; returns the new messages and versions. */
export async function switchVersion(threadId: string, messageId: string): Promise<View> {
  return (await request<View>('PATCH', `${CHATS}/${threadId}/active`, { messageId })).data
}

/** One fact in "My preferences" (CB-05). */
export type Fact = { id: string; text: string; createdAt: string }
/** What GET /api/chat/memory sends: the switch, the facts and the limits the form shows. */
export type Memory = { enabled: boolean; facts: Fact[]; maxFacts: number; maxChars: number }

const MEMORY = '/api/chat/memory'

/** Returns the signed-in user's switch and facts. */
export async function fetchMemory(): Promise<Memory> {
  return (await request<Memory>('GET', MEMORY)).data
}
/** Turns memory on or off; returns the new state. The facts are kept either way. */
export async function setMemoryEnabled(enabled: boolean): Promise<Memory> {
  return (await request<Memory>('PATCH', MEMORY, { enabled })).data
}
/** Adds a fact. Throws GatewayError (400 bad text, 409 at the limit). */
export async function addFact(text: string): Promise<Fact> {
  return (await request<Fact>('POST', `${MEMORY}/facts`, { text })).data
}
/** Changes a fact's text. */
export async function saveFact(id: string, text: string): Promise<Fact> {
  return (await request<Fact>('PATCH', `${MEMORY}/facts/${id}`, { text })).data
}
/** Deletes a fact for good. */
export async function removeFact(id: string): Promise<void> {
  await request('DELETE', `${MEMORY}/facts/${id}`)
}

/** Sends a risk engineer's request to add the document behind `question` (CB-07). */
export function askAdminToAdd(question: string, message: string): Promise<unknown> {
  return request('POST', '/api/knowledge-gaps', message ? { question, message } : { question })
}

/** Turns a short recording of a spoken question into text (CB-10). Throws GatewayError with the reason. */
export async function transcribeQuestion(audio: Blob): Promise<string> {
  return (await request<{ text: string }>('POST', '/api/chat/transcribe', audio)).data.text
}

/** A photo the gateway has stored and checked for faces (CB-08). `blurredId` is the copy with faces blurred. */
export type UploadedPhoto = { id: string; faces: number; blurredId: string | null }

/** Stores a photo for the next question and finds its faces. Throws GatewayError with the reason. */
export async function uploadChatPhoto(file: File): Promise<UploadedPhoto> {
  return (await request<UploadedPhoto>('POST', '/api/chat/photos', file)).data
}
/** Removes a photo that was attached but not sent. */
export async function removeChatPhoto(id: string): Promise<void> {
  await request('DELETE', `/api/chat/photos/${id}`)
}
/** Where a stored photo is shown from. */
export const photoUrl = (id: string) => `/api/chat/photos/${id}`

/** A PDF the gateway has read (CB-09): its pages, any pages with no text, and whether it looks like instructions. */
export type UploadedPdf = {
  id: string
  name: string
  pages: number
  skipped: number[]
  flagged: boolean
}
/** Reads a PDF for the next question. Throws GatewayError with the reason (scanned, protected, too long...). */
export async function uploadChatPdf(file: File): Promise<UploadedPdf> {
  return (await request<UploadedPdf>('POST', '/api/chat/pdfs', file)).data
}
/** Removes a PDF that was attached but not sent. */
export async function removeChatPdf(id: string): Promise<void> {
  await request('DELETE', `/api/chat/pdfs/${id}`)
}
