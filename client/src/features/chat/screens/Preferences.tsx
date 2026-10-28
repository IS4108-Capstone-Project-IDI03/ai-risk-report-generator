// The "My preferences" page (CB-05): the engineer's lasting facts for the knowledge assistant,
// with add, edit, delete and a memory on/off switch. Rendered by AssessmentApp for the
// 'preferences' screen. Calls ../api.ts, which calls /api/chat/memory.
import { useEffect, useState } from 'react'
import { Button, Callout, Card, EmptyState, Switch } from '../../../design-system'
import { addFact, fetchMemory, removeFact, saveFact, setMemoryEnabled, type Memory } from '../api'
import { FactForm } from '../components/FactForm'
import { FactRow } from '../components/FactRow'
import '../preferences.css'

/** Loads the memory, then shows the switch, the add box and the list of facts. */
export function Preferences({ notify }: { notify: (message: string) => void }) {
  const [memory, setMemory] = useState<Memory | null>(null)
  const [failed, setFailed] = useState(false)
  // Bumping `tries` loads again (the Try again button).
  const [tries, setTries] = useState(0)
  useEffect(() => {
    let stale = false
    fetchMemory().then(
      (loaded) => {
        if (stale) return
        setFailed(false)
        setMemory(loaded)
      },
      () => !stale && setFailed(true),
    )
    return () => {
      stale = true
    }
  }, [tries])

  if (failed)
    return (
      <div className="preferences">
        <Callout
          tone="warning"
          title="Could not load your preferences"
          actions={<Button onClick={() => setTries((n) => n + 1)}>Try again</Button>}
        >
          Check your connection and try again.
        </Callout>
      </div>
    )
  if (!memory) return null
  const { enabled, facts, maxFacts, maxChars } = memory
  const full = facts.length >= maxFacts
  // Each change updates the list on screen from what the gateway returned.
  const change = (next: Partial<Memory>) => setMemory({ ...memory, ...next })
  return (
    <div className="preferences">
      <Card
        title="Memory"
        subtitle="Turn this off and MarshBot neither learns nor uses your facts. Your list is kept."
      >
        <Switch
          label="Use my preferences in chats"
          checked={enabled}
          onChange={async (on) => change(await setMemoryEnabled(on))}
        />
      </Card>
      <Callout tone="info" title="Keep it general">
        Do not type client names or site details. A fact steers MarshBot's answers; it is never
        cited as evidence.
      </Callout>
      <Card
        title="My facts"
        subtitle={`${facts.length} of ${maxFacts}. Each fact is up to ${maxChars} characters.`}
      >
        {full ? (
          <Callout tone="info">You have {maxFacts} facts. Delete one to add another.</Callout>
        ) : (
          <FactForm
            max={maxChars}
            label="Add a fact"
            submitLabel="Add fact"
            onSubmit={async (text) => {
              const fact = await addFact(text)
              change({ facts: [...facts, fact] })
              notify('Fact added')
            }}
          />
        )}
        {facts.length === 0 ? (
          <EmptyState
            icon="brain"
            title="No facts yet"
            description="For example: I mostly survey Singapore offices."
          />
        ) : (
          <ul className="fact-list">
            {facts.map((fact) => (
              <FactRow
                key={fact.id}
                fact={fact}
                max={maxChars}
                onSave={async (id, text) => {
                  const saved = await saveFact(id, text)
                  change({ facts: facts.map((f) => (f.id === id ? saved : f)) })
                  notify('Fact saved')
                }}
                onDelete={async (id) => {
                  await removeFact(id)
                  change({ facts: facts.filter((f) => f.id !== id) })
                  notify('Fact deleted')
                }}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
