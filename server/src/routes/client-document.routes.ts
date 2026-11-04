// A client's kept documents (CP-23 AC14, AC16), mounted at
// /api/client-documents: open the original, or delete it. The list is
// GET /api/clients/:id/documents (client.routes.ts). Calls client-document.service.ts.
import { Router, type Response } from 'express'
import { requirePermission } from '../middleware/auth.middleware'
import {
  ClientDocumentFileError,
  ClientDocumentNotFoundError,
  deleteClientDocument,
  getClientDocumentFile,
  placementSchema,
  retagClientDocument,
} from '../services/client-document.service'
import { sendFile } from './byte-range'
import { refuseClientChange } from './client.routes'

const router = Router()

// 404 for an unknown document, 502 when S3 refused its delete; 403 for one
// whose client the user has no assessment at (refuseClientChange), as the client page.
function refuse(error: unknown, res: Response) {
  if (error instanceof ClientDocumentFileError) {
    res.status(502).json({ error: error.message })
    return
  }
  if (!(error instanceof ClientDocumentNotFoundError)) return refuseClientChange(error, res)
  res.status(404).json({ error: error.message })
}

// attachment saves the file (?download=1); inline shows it. filename= is an
// ASCII fallback for old clients; filename* is the full name, RFC 5987 encoded
// (encodeURIComponent leaves ' ( ) * bare, which that format does not allow).
export function contentDisposition(name: string, download: boolean) {
  const ascii = name.replace(/[^\x20-\x7e]|["\\%]/g, '_')
  const full = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `${download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${full}`
}

// The original file, shown in the browser where it can be (inline), with
// byte ranges so a large PDF opens quickly.
router.get('/:id/file', requirePermission('assessments:view'), async (req, res) => {
  try {
    const file = await getClientDocumentFile(req.params.id, res.locals.user!)
    await sendFile(req, res, file, {
      'Content-Disposition': contentDisposition(file.name, req.query.download === '1'),
    })
  } catch (error) {
    refuse(error, res)
  }
})

// Changes the document's tag (whole client, a site or an assessment of its client).
// 200 with the document; 400 for a tag that isn't this client's.
router.patch('/:id', requirePermission('assessments:edit'), async (req, res) => {
  const tag = placementSchema.safeParse(req.body?.placement)
  if (!tag.success) {
    res.status(400).json({ error: 'Choose where the document belongs.' })
    return
  }
  try {
    res.json(await retagClientDocument(req.params.id, tag.data, res.locals.user!))
  } catch (error) {
    refuse(error, res)
  }
})

// Deletes a document added by mistake (AC16), after the engineer confirms. 204;
// 502 when its file couldn't be deleted (the document stays).
router.delete('/:id', requirePermission('assessments:edit'), async (req, res) => {
  try {
    await deleteClientDocument(req.params.id, res.locals.user!)
    res.status(204).end()
  } catch (error) {
    refuse(error, res)
  }
})

export default router
