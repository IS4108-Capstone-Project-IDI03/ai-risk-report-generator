// Service-to-service endpoint for AI-call usage (EV-03). The ingestion worker
// posts what a document's OCR and embedding used when it finishes, fails or is
// cancelled; it has no session, so this is mounted in index.ts behind
// requireServiceKey, outside the requireAuth chain, like the notifications route.
import { Router } from 'express'
import { recordAiCalls } from '../services/ai-usage.service'

const router = Router()

// A document posts one item per stage and model, so a handful in practice.
const MAX_ITEMS = 100

// 204 once saved. Items the recorder cannot use (unknown feature or service)
// are dropped there, as for every other caller; only a body that is not a
// usage list at all is refused.
router.post('/', async (req, res) => {
  const usage = (req.body as { usage?: unknown } | undefined)?.usage
  if (!Array.isArray(usage) || usage.length > MAX_ITEMS) {
    res.status(400).json({ error: `usage must be a list of at most ${MAX_ITEMS} items.` })
    return
  }
  await recordAiCalls(usage)
  res.status(204).end()
})

export default router
