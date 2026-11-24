// "My glossary" in Settings > Note-taking (CP-35): the person's own shorthand terms, each with
// its meaning, a Remove per row and an Add form. Called by screens/NoteTakingSection.
// Each change saves at once with saveMine and shows a toast; Remove carries Undo.
import { useState } from 'react'
import { Button, Icon, IconAction, Input } from '../../../design-system'
import { saveMine, type GlossaryEntry } from '../api'
import { glossaryProblem } from '../noteRules'
import type { useSave } from '../useSave'
import { SaveStatus } from './SaveStatus'
import { SettingBlock } from './SettingBlock'

// The save state and the problem live in NoteTakingSection, so the two areas can clear each
// other's messages. onStart runs first on every action to do that.
type Props = {
  glossary: GlossaryEntry[]
  save: ReturnType<typeof useSave>
  problem: string
  onProblem: (problem: string) => void
  onStart: () => void
}

export function GlossaryEditor({ glossary, save, problem, onProblem, onStart }: Props) {
  const { state, run } = save
  const [term, setTerm] = useState('')
  const [meaning, setMeaning] = useState('')

  // Checks the entry first, so a bad one never reaches the gateway.
  const add = async () => {
    onStart()
    const found = glossaryProblem({ term, meaning }, glossary)
    onProblem(found)
    if (found) return
    await run(
      () => saveMine({ glossary: [...glossary, { term: term.trim(), meaning: meaning.trim() }] }),
      'Term added',
    )
    setTerm('')
    setMeaning('')
  }
  return (
    <SettingBlock
      title="My glossary"
      help="Words you use on site, and what they mean. They are kept for your notes only."
    >
      {glossary.length === 0 ? (
        <p className="st-note">No terms yet.</p>
      ) : (
        <ul className="st-gloss">
          {glossary.map((g) => (
            <li key={g.term} className="st-gloss-row">
              <span>
                <strong>{g.term}</strong> {'→'} {g.meaning}
              </span>
              <IconAction
                icon="trash-2"
                label={`Remove ${g.term}`}
                tooltip="Remove term"
                style={{ color: 'var(--red-600)' }}
                onClick={() => {
                  onStart()
                  // Undo saves the list as it was, so the term comes back in its old place.
                  void run(
                    () => saveMine({ glossary: glossary.filter((x) => x !== g) }),
                    'Term removed',
                    () => void run(() => saveMine({ glossary })),
                  )
                }}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="st-editor">
        <div className="st-field">
          <Input
            label="Term"
            value={term}
            maxLength={30}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
        <div className="st-field st-field--wide">
          <Input
            label="Meaning"
            value={meaning}
            maxLength={120}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setMeaning(e.target.value)}
          />
        </div>
        <Button
          variant="secondary"
          pill
          iconLeft="plus"
          loading={state.status === 'saving'}
          onClick={add}
        >
          Add
        </Button>
      </div>
      <SaveStatus state={state} />
      {problem && (
        <p className="st-err" role="alert">
          <Icon name="octagon-alert" size={14} color="var(--red-600)" /> {problem}
        </p>
      )}
    </SettingBlock>
  )
}
