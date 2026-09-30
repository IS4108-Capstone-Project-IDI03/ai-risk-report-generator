import { Router } from 'express'
import { generateReport } from '../services/rag.service'
import { requirePermission } from '../middleware/auth.middleware'

const router = Router()

router.post('/generate', requirePermission('reports:generate'), async (req, res) => {
  const result = await generateReport(req.body)
  res.json(result)
})

export default router
