// The "My preferences" panel (CB-05): the engineer's lasting facts for the knowledge assistant,
// with add, edit, delete and a memory on/off switch. A light dialog opened from the chat
// sidebar (components/ChatSidebar.tsx). Calls ../api.ts, which calls /api/chat/memory.
import { useEffect, useRef, useState } from 'react'
import { Button, Callout, Dialog, EmptyState, HelpTip, Switch } from '../../../design-system'
import { addFact, fetchMemory, removeFact, saveFact, setMemoryEnabled, type Memory } from '../api'
import '../preferences.css'
import { FactForm, PRIVACY_NOTE } from './FactForm'
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

  // Each change updates the list on screen from what the gateway returned. It works on the list as
  // it is when the answer arrives, so two requests in flight cannot bring back a deleted fact.
  const change = (update: (m: Memory) => Memory) => setMemory((m) => (m ? update(m) : m))
  // Shows why a switch or delete failed; add and edit show theirs under their own box.
  const [problem, setProblem] = useState('')
  // Read out by screen readers after an add, save or delete; nothing else tells them it worked.
  const [notice, setNotice] = useState('')
  const panel = useRef<HTMLDivElement>(null)
  const attempt = async (job: () => Promise<void>) => {
    setProblem('')
    try {
      await job()
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Something went wrong.')
    }
  }
  const facts = memory?.facts ?? []
  const maxChars = memory?.maxChars ?? 200
  const maxFacts = memory?.maxFacts ?? 20

  return (
    <Dialog
      // A bottom sheet on a phone, like every other dialog there.
      className="ds-dialog-sheet"
      title="My preferences"
      description="Lasting facts about your work. MarshBot takes them into account in every chat."
      width={560}
      onClose={onClose}
    >
      {failed ? (
        <Callout
          tone="warning"
          title="Could not load your preferences"
          actions={
            <Button pill variant="primary" onClick={() => setTries((n) => n + 1)}>
              Try again
            </Button>
          }
        >
          Check your connection and try again.
        </Callout>
      ) : !memory ? null : (
        <div className="preferences" ref={panel}>
          <p role="status" className="preferences__sr-only">
            {notice}
          </p>
          <div className="preferences__switch">
            <Switch
              label="Use my preferences in chats"
              checked={memory.enabled}
              onChange={(on) =>
                attempt(async () => {
                  const saved = await setMemoryEnabled(on)
                  change((m) => ({ ...m, enabled: saved.enabled }))
                })
              }
            />
            <HelpTip label="About preferences">
              <p>
                Your list is kept when this is off. A fact steers an answer; it is never cited as
                evidence.
              </p>
            </HelpTip>
          </div>
          {problem && <Callout tone="warning">{problem}</Callout>}
          {facts.length >= maxFacts ? (
            <Callout tone="info">
              You have {maxFacts} facts. Delete one to add another. {PRIVACY_NOTE}
            </Callout>
          ) : (
            <FactForm
              max={maxChars}
              label="Add a fact"
              submitLabel="Add fact"
              note={PRIVACY_NOTE}
              onSubmit={async (text) => {
                const added = await addFact(text)
                change((m) => ({ ...m, facts: [...m.facts, added] }))
                setNotice('Fact added')
              }}
            />
          )}
          {facts.length > 0 && (
            <h3 className="preferences__count">
              {facts.length} of {maxFacts} facts
            </h3>
          )}
          {facts.length === 0 ? (
            <EmptyState
              icon="brain"
              title="No facts yet"
              description="For example: I mostly survey Singapore offices."
              // The dialog's last line: the panel's own 20 px is the gap below it; the empty state's
              // usual 48 px on top of that left an empty band at the foot.
              style={{ paddingBottom: 0 }}
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
                    change((m) => ({ ...m, facts: m.facts.map((f) => (f.id === id ? saved : f)) }))
                    setNotice('Fact saved')
                  }}
                  onDelete={(id) =>
                    attempt(async () => {
                      await removeFact(id)
                      change((m) => ({ ...m, facts: m.facts.filter((f) => f.id !== id) }))
                      setNotice('Fact deleted')
                      // The deleted row had focus; without this it would be lost to the page.
                      panel.current?.querySelector('textarea')?.focus()
                    })
                  }
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </Dialog>
  )
}
