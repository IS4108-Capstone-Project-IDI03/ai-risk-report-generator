// The "My preferences" panel (CB-05): the engineer's lasting facts for the knowledge assistant,
// with add, edit, delete and a memory on/off switch. A light dialog opened from the chat
// sidebar (components/ChatSidebar.tsx). Calls ../api.ts, which calls /api/chat/memory.
import { useEffect, useState } from 'react'
import { Button, Callout, Dialog, EmptyState, Switch } from '../../../design-system'
import { addFact, fetchMemory, removeFact, saveFact, setMemoryEnabled, type Memory } from '../api'
import '../preferences.css'
import { FactForm } from './FactForm'
import { FactRow } from './FactRow'

/** Loads the memory when opened, then shows the switch, the add box and the list of facts. */
export function PreferencesPanel({ onClose }: { onClose: () => void }) {
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

  // Each change updates the list on screen from what the gateway returned.
  const change = (next: Partial<Memory>) => setMemory((m) => (m ? { ...m, ...next } : m))
  const facts = memory?.facts ?? []
  const maxChars = memory?.maxChars ?? 200
  const maxFacts = memory?.maxFacts ?? 20

  return (
    <Dialog
      title="My preferences"
      description="Lasting facts about your work. MarshBot takes them into account in every chat."
      width={560}
      onClose={onClose}
    >
      {failed ? (
        <Callout
          tone="warning"
          title="Could not load your preferences"
          actions={<Button onClick={() => setTries((n) => n + 1)}>Try again</Button>}
        >
          Check your connection and try again.
        </Callout>
      ) : !memory ? null : (
        <div className="preferences">
          <Switch
            label="Use my preferences in chats"
            checked={memory.enabled}
            onChange={async (on) => change(await setMemoryEnabled(on))}
          />
          <p className="preferences__note">
            Turn this off and MarshBot stops using your facts. Your list is kept. Do not type client
            names or site details. A fact steers an answer; it is never cited as evidence.
          </p>
          {facts.length >= maxFacts ? (
            <Callout tone="info">You have {maxFacts} facts. Delete one to add another.</Callout>
          ) : (
            <FactForm
              max={maxChars}
              label="Add a fact"
              submitLabel="Add fact"
              onSubmit={async (text) => change({ facts: [...facts, await addFact(text)] })}
            />
          )}
          <h3 className="preferences__count">
            {facts.length} of {maxFacts} facts
          </h3>
          {facts.length === 0 ? (
            <EmptyState
              icon="brain"
              title="No facts yet"
              description="For example: I mostly survey Singapore offices."
            />
          ) : (
            <ul className={memory.enabled ? 'fact-list' : 'fact-list fact-list--off'}>
              {facts.map((fact) => (
                <FactRow
                  key={fact.id}
                  fact={fact}
                  max={maxChars}
                  onSave={async (id, text) => {
                    const saved = await saveFact(id, text)
                    change({ facts: facts.map((f) => (f.id === id ? saved : f)) })
                  }}
                  onDelete={async (id) => {
                    await removeFact(id)
                    change({ facts: facts.filter((f) => f.id !== id) })
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </Dialog>
  )
}
