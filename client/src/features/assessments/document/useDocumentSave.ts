import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { GatewayError, saveSectionDocument } from '../api'
import { fromEditorDoc } from './convert'
import type { DocumentPart } from './sections'

// How long typing must pause before the document saves itself (AC13).
export const AUTOSAVE_PAUSE_MS = 1500

export type SaveStatus =
  // Everything shown is saved.
  | 'saved'
  // Changed since the last save, which waits for typing to pause.
  | 'unsaved'
  | 'saving'
  // The last save failed; it is tried again on the next pause or Save.
  | 'failed'
  // A section was saved elsewhere, or drafted again: reload before saving.
  | 'conflict'

type Shown = { status: SaveStatus; savedAt: string | null; problem: string | null }

// The saving itself, made once per opened document, so the editor's
// callbacks can hold on to it.
function createSaver(reference: string, parts: DocumentPart[], show: (s: Partial<Shown>) => void) {
  let editor: Editor | null = null
  // Each section's text as last saved, and what its next save is built on.
  let saved = new Map<string, string>()
  const base = new Map(parts.map((p) => [p.id, { baseVersion: p.baseVersion, draftId: p.draftId }]))
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<boolean> | null = null
  let status: SaveStatus = 'saved'
  const set = (next: SaveStatus, more: Partial<Shown> = {}) => {
    status = next
    show({ status: next, ...more })
  }
  const textOf = (document: unknown) => JSON.stringify(document)

  // The sections whose text differs from what was last saved.
  const changed = () =>
    editor
      ? [...fromEditorDoc(editor.state.doc)].flatMap(([id, document]) =>
          saved.get(id) === textOf(document) ? [] : [{ id, document }],
        )
      : []

  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void save(), AUTOSAVE_PAUSE_MS)
  }

  // One save of every changed section, in turn. False if one was refused.
  const run = async (): Promise<boolean> => {
    if (timer) clearTimeout(timer)
    timer = null
    if (status === 'conflict') return false
    const pending = changed()
    if (!pending.length) {
      set('saved')
      return true
    }
    set('saving', { problem: null })
    for (const { id, document } of pending) {
      const on = base.get(id)!
      try {
        const version = await saveSectionDocument(reference, id, { ...on, document })
        saved.set(id, textOf(document))
        base.set(id, { ...on, baseVersion: version.version })
        show({ savedAt: version.savedAt })
      } catch (error: unknown) {
        set(error instanceof GatewayError && error.status === 409 ? 'conflict' : 'failed', {
          problem: error instanceof Error ? error.message : 'The document was not saved.',
        })
        return false
      }
    }
    // Typing during the save is saved on the next pause.
    if (changed().length) {
      set('unsaved')
      schedule()
    } else set('saved')
    return true
  }

  // Saves now, after any save already running.
  const save = async (): Promise<boolean> => {
    while (running) await running
    const attempt = run()
    running = attempt
    try {
      return await attempt
    } finally {
      running = null
    }
  }

  return {
    // Starts from the editor as it opened: nothing is unsaved yet.
    attach(opened: Editor) {
      editor = opened
      saved = new Map(
        [...fromEditorDoc(opened.state.doc)].map(([id, document]) => [id, textOf(document)]),
      )
    },
    // Told of every change to the document: it saves once typing pauses.
    changedNow() {
      if (status === 'conflict') return
      if (status !== 'saving') set('unsaved')
      schedule()
    },
    save,
    // Unsaved work: changed since the last save, or a save still running.
    dirty: () => status === 'saving' || changed().length > 0,
    // Stops saving, e.g. once the engineer discards their changes.
    stop() {
      if (timer) clearTimeout(timer)
      timer = null
      editor = null
    },
    // The editor is going: saves what is unsaved now instead of after a pause.
    leave() {
      if (timer) clearTimeout(timer)
      timer = null
      if (status !== 'conflict' && changed().length) void save()
    },
  }
}

// Saves the document editor's sections (RV-08 AC13): each section whose text
// changed since it was last saved becomes a new version, built on the version
// and draft it was edited from. Saves once typing pauses, or at once with
// `save`. `savedAt` is when the last save finished.
export function useDocumentSave(
  reference: string,
  parts: DocumentPart[],
  // When the document was last saved before it was opened, if ever.
  lastSavedAt: string | null = null,
) {
  const [shown, setShown] = useState<Shown>({
    status: 'saved',
    savedAt: lastSavedAt,
    problem: null,
  })
  const [saver] = useState(() =>
    createSaver(reference, parts, (next) => setShown((now) => ({ ...now, ...next }))),
  )
  // Left some other way, as by the browser's Back: unsaved changes are saved
  // rather than lost.
  useEffect(() => () => saver.leave(), [saver])
  return { ...shown, saver }
}
