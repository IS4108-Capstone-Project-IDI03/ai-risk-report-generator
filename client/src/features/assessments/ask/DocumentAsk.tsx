import { useState } from 'react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { IconButton } from '../../../design-system'
import { rangeOf } from '../comments/anchor'
import { ObservationView, PassageView } from '../components/SourcePanel'
import { AskPanel } from './AskPanel'
import type { AskPassage } from './passage'
import type { AskWorkflow } from './useAsk'

// The Ask tab's questions and answers in the document editor (AS-02), in the
// panel over the editor's right edge where the comments list opens (full width
// on a phone). The same conversation as the review workspace's Ask tab: a
// passage asked about here shows there, and the other way round. Whether a
// passage is still in the text is read from the document as it is now, edits
// not yet saved included; a source an answer cites opens at the top.
export function DocumentAsk({
  editor,
  ask,
  overlay,
  onShowPassage,
  onClose,
}: {
  editor: Editor
  ask: AskWorkflow
  // Drawn over the document, in a narrow window.
  overlay: boolean
  onShowPassage: (passage: AskPassage) => void
  onClose: () => void
}) {
  // Read again whenever the text changes, by identity: a deep comparison of
  // the document on every key press would cost more than drawing the panel.
  const doc = useEditorState({
    editor,
    selector: ({ editor: e }) => e.state.doc,
    equalityFn: (a, b) => a === b,
  })
  const [source, setSource] = useState<string | null>(null)
  const passage = source ? ask.items.flatMap((i) => i.passages).find((p) => p.id === source) : null
  const observation = source?.startsWith('O:')
    ? ask.items.flatMap((i) => i.observations).find((o) => o.id === source.slice(2))
    : null
  return (
    <aside className={overlay ? 'cm-panel is-overlay dm-ask' : 'cm-panel dm-ask'} aria-label="Ask">
      <div className="cm-panel-head">
        <h2 className="cm-panel-title">Ask about this assessment</h2>
        <IconButton icon="x" size="sm" label="Close Ask" onClick={onClose} />
      </div>
      <div className="cm-panel-body om-scroll">
        {(passage || observation) && (
          <article
            className="rv-viewer dm-ask-source"
            aria-label={passage ? 'Source passage' : 'Field observation'}
          >
            {passage ? (
              <PassageView passage={passage} number={undefined} onClose={() => setSource(null)} />
            ) : (
              <ObservationView
                observation={observation!}
                number={undefined}
                onClose={() => setSource(null)}
                note="As sent with the question."
              />
            )}
          </article>
        )}
        <AskPanel
          ask={ask}
          current={source}
          onCite={(ref) => setSource(ref)}
          locate={(anchor) => rangeOf(doc, anchor) !== null}
          onShowPassage={onShowPassage}
        />
      </div>
    </aside>
  )
}
