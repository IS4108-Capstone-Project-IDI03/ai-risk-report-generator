// "My glossary" in Settings > Note-taking (CP-35): the person's own shorthand terms, each with
// its meaning, a Remove per row and an Add form. Called by screens/NoteTakingSection.
// Each change saves at once with saveMine.
import { useState } from 'react'
import { Button, Icon, Input } from '../../../design-system'
import { saveMine, type GlossaryEntry } from '../api'
import { glossaryProblem } from '../noteRules'
import type { useSave } from '../useSave'
import { SaveStatus } from './SaveStatus'

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
    await run(() =>
      saveMine({ glossary: [...glossary, { term: term.trim(), meaning: meaning.trim() }] }),
    )
    setTerm('')
    setMeaning('')
  }
  return (
    <div className="st-row">
      <div className="st-row-label">My glossary</div>
      <p className="st-note">
        Words you use on site, and what they mean. They are kept for your notes only.
      </p>
      {glossary.length === 0 ? (
        <p className="st-note">No terms yet.</p>
      ) : (
        <ul className="st-gloss">
          {glossary.map((g) => (
            <li key={g.term} className="st-gloss-row">
              <span>
                <strong>{g.term}</strong> {'→'} {g.meaning}
              </span>
              <Button
                variant="ghost"
                size="lg"
                aria-label={`Remove ${g.term}`}
                onClick={() => {
                  onStart()
                  void run(() => saveMine({ glossary: glossary.filter((x) => x !== g) }))
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="st-editor">
        <Input
          label="Term"
          size="lg"
          value={term}
          maxLength={30}
          onChange={(e) => setTerm(e.target.value)}
        />
        <Input
          label="Meaning"
          size="lg"
          value={meaning}
          maxLength={120}
          onChange={(e) => setMeaning(e.target.value)}
        />
        <Button variant="secondary" size="lg" onClick={add}>
          Add
        </Button>
        <SaveStatus state={state} />
      </div>
      {problem && (
        <p className="st-err" role="alert">
          <Icon name="octagon-alert" size={14} color="var(--red-600)" /> {problem}
        </p>
      )}
    </div>
  )
}
