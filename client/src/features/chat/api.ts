// The knowledge assistant's connection to the gateway (CB-01). OpenUI's chat
// screen posts each question here and reads the answer back as a stream.
// Calls server/src/routes/chat.routes.ts.
import { agUIAdapter, fetchLLM } from '@openuidev/react-headless'

/** The chat screen's link to POST /api/chat, read as AG-UI events (the gateway's format). */
export const chatLLM = fetchLLM({ url: '/api/chat', streamAdapter: agUIAdapter() })
