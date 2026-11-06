// Photos attached to a chat question (CB-08): check and store an upload, find its faces, show it
// again, describe it for the answer. Called by routes/chat.routes.ts and chat-conversation.service.ts.
// Calls storage.service.ts (S3) and speech.service.ts (S5: face check and vision).
import { randomUUID } from 'node:crypto'
import type { Readable } from 'node:stream'
import { ChatError } from './chat-error'
import { photoFormat } from './observation.service'
import { SpeechServiceError, checkChatPhotoFaces, describeChatPhoto } from './speech.service'
import { deleteObject, getObjectStream, putObject } from './storage.service'

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024 // must match the raw-body limit in routes/chat.routes.ts
export const MAX_PHOTOS = 3

// An id is `<uuid>.jpg|png`, or `<uuid>.blurred.jpg` for the copy with faces blurred. The shape is
// checked before it becomes part of a storage key, so no id can reach another folder.
const ID = /^[0-9a-f-]{36}(\.blurred)?\.(jpg|png)$/
const keyOf = (userId: string, id: string) => `chat-photos/${userId}/${id}`
export const photoUrl = (id: string) => `/api/chat/photos/${id}`

/** Checks, stores and face-checks an upload. Returns its id, the faces found, and the blurred copy's id (or null). */
export async function addPhoto(userId: string, bytes: Buffer) {
  if (!bytes.length) throw new ChatError(400, 'That photo is empty.')
  const format = photoFormat(bytes)
  if (!format) throw new ChatError(415, 'Only JPG and PNG photos can be attached.')
  if (bytes.length > MAX_PHOTO_BYTES) throw new ChatError(413, 'That photo is over 8 MB.')

  const base = randomUUID()
  const id = `${base}.${format.extension}`
  await putObject(keyOf(userId, id), bytes, format.contentType)
  try {
    const { faces, blurred } = await checkChatPhotoFaces(keyOf(userId, id))
    if (!faces || !blurred) return { id, faces: 0, blurredId: null }
    const blurredId = `${base}.blurred.jpg`
    await putObject(keyOf(userId, blurredId), blurred, 'image/jpeg')
    return { id, faces, blurredId }
  } catch (error) {
    // Fail closed: a photo whose faces could not be checked is not kept.
    await deleteObject(keyOf(userId, id)).catch(() => {})
    if (error instanceof SpeechServiceError)
      throw new ChatError(503, 'Faces could not be checked. Try again in a moment.')
    throw error
  }
}

/** Returns a photo's bytes and type to its owner; anyone else's, or a made-up id, is a 404. */
export async function openPhoto(
  userId: string,
  id: string,
): Promise<{ stream: Readable; contentType: string }> {
  if (!ID.test(id)) throw new ChatError(404, 'Photo not found.')
  try {
    return {
      stream: await getObjectStream(keyOf(userId, id)),
      contentType: id.endsWith('.png') ? 'image/png' : 'image/jpeg',
    }
  } catch {
    throw new ChatError(404, 'Photo not found.')
  }
}

// The other version of the same photo: the original for a blurred id, or the blurred copy.
const counterparts = (id: string) => {
  const base = id.slice(0, 36)
  return id.includes('.blurred.') ? [`${base}.jpg`, `${base}.png`] : [`${base}.blurred.jpg`]
}

/** Removes the photos and their other versions. Used when a chat is deleted or an attachment dropped. */
export async function removePhotos(userId: string, ids: string[]) {
  const all = ids.filter((id) => ID.test(id)).flatMap((id) => [id, ...counterparts(id)])
  await Promise.all(all.map((id) => deleteObject(keyOf(userId, id)).catch(() => {})))
}

/** Checks the ids the engineer sent with a question: up to 3, each a photo id of the right shape. */
export function sentPhotoIds(requested: unknown): string[] {
  if (requested === undefined || requested === null) return []
  if (!Array.isArray(requested) || requested.some((id) => typeof id !== 'string' || !ID.test(id)))
    throw new ChatError(400, 'Those photos could not be attached.')
  if (requested.length > MAX_PHOTOS)
    throw new ChatError(400, `Attach up to ${MAX_PHOTOS} photos to a question.`)
  return requested
}

/**
 * Keeps only the version the engineer chose: the other version (the original when blurred was
 * sent, or the blurred copy) is deleted, so a photo with a face is not left in storage.
 * Throws a 400 for a photo that is not the engineer's.
 */
export async function keepChosen(userId: string, ids: string[]) {
  for (const id of ids) {
    try {
      ;(await getObjectStream(keyOf(userId, id))).destroy()
    } catch {
      throw new ChatError(400, 'Those photos could not be attached.')
    }
  }
  await Promise.all(
    ids
      .flatMap((id) => counterparts(id))
      .map((id) => deleteObject(keyOf(userId, id)).catch(() => {})),
  )
}

/**
 * The context lines S4 shows the answer model, one per photo: what it shows, and what could not
 * be made out. S4 masks them like the rest of the question (PV-03). Throws SpeechServiceError.
 */
export async function photoContext(userId: string, ids: string[]) {
  const described = await Promise.all(ids.map((id) => describeChatPhoto(keyOf(userId, id))))
  return described.map(({ description, unclear }, i) => ({
    description: 'Photo the engineer attached',
    value: `Photo ${i + 1}: ${description}${unclear ? ` Could not make out: ${unclear}` : ''}`,
  }))
}
