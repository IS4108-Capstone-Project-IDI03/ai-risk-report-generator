// Service-to-service endpoint for how to protect a knowledge document (PV-05).
// The ingestion worker asks before it reads a document; it has no session, so
// this is mounted in index.ts behind requireServiceKey, outside the requireAuth
// chain, like the notifications and AI-usage routes.
import { Router } from 'express'
import {
  KnowledgeDocumentNotFoundError,
  knowledgeDocumentPrivacy,
} from '../services/knowledge-document.service'

const router = Router()

// `{enabled, known_entities, detect?}`, the `privacy` field every service gets
// (the epic's Rule 1). The names to mask are client details: never sent to the
// browser, only to a service holding the key.
router.get('/:id/privacy', async (req, res) => {
  try {
    res.json(await knowledgeDocumentPrivacy(req.params.id))
  } catch (error: unknown) {
    if (!(error instanceof KnowledgeDocumentNotFoundError)) throw error
    res.status(404).json({ error: error.message })
  }
})

export default router
