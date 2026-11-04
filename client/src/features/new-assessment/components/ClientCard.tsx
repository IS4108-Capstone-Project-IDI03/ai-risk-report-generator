// The client card of the New Assessment form (CP-23, boards 08, 09, 12): a
// new client's name and division, or a recorded client chosen from the list
// (avatar, name, Change). Either way the documents
// button sits at the right. Used by screens/NewAssessmentForm.tsx.
import { useState } from 'react'
import { Button, Combobox, Icon } from '../../../design-system'
import { ClientAvatar } from '../../clients/components/ClientAvatar'
import type { NewAssessmentForm } from '../useNewAssessment'
import { DocumentsPopover } from './DocumentsPopover'
import { ErrorLine, TextField } from './Field'
import { Suggestion } from './Suggestion'

// A recorded client: chosen when the typed name is one on the list.
function ChooseClient({ f }: { f: NewAssessmentForm }) {
  const [text, setText] = useState('')
  const error = f.errors['client.id']
  return (
    <section className="na-card" aria-label="Client">
      <div className="na-card-head">
        <span className="na-tile">
          <Icon name="building-2" size={16} />
        </span>
        <h2>{'Client'}</h2>
      </div>
      <div className="na-field" data-error={error ? '' : undefined}>
        <Combobox
          label={<span className="na-label">{'Client'}</span>}
          required
          placeholder="Search your clients"
          options={f.clients.map((c) => c.name)}
          value={text}
          error={error && <ErrorLine text={error} />}
          onValueChange={(name) => {
            setText(name)
            const match = f.clients.find((c) => c.name.toLowerCase() === name.trim().toLowerCase())
            if (match) f.chooseClient(match.id)
          }}
        />
      </div>
    </section>
  )
}

export function ClientCard({ f }: { f: NewAssessmentForm }) {
  const { client, clientMode } = f.form
  if (clientMode === 'existing' && !client.id) return <ChooseClient f={f} />
  if (clientMode === 'existing') {
    const name = f.listedClient?.name ?? client.name
    return (
      <section className="na-card na-client-chosen" aria-label="Client">
        <ClientAvatar name={name} small />
        <span className="na-client-text">
          <strong dir="auto">{name}</strong>
        </span>
        <span className="na-card-actions">
          <DocumentsPopover f={f} />
          <Button
            variant="ghost"
            className="na-text-btn"
            aria-label="Change client"
            onClick={() => f.chooseClient('')}
          >
            {'Change'}
          </Button>
        </span>
      </section>
    )
  }
  return (
    <section className="na-card" aria-label="Client">
      <div className="na-card-head">
        <span className="na-tile">
          <Icon name="building-2" size={16} />
        </span>
        <h2>{'Client'}</h2>
        <span className="na-card-actions">
          <DocumentsPopover f={f} />
        </span>
      </div>
      <div className="na-grid na-grid--2">
        <div>
          <TextField
            label="Client name"
            required
            placeholder="e.g. Harbourline Properties"
            value={client.name}
            notSure={client.notSure.includes('name')}
            error={f.errors['client.name']}
            onChange={(e) => f.setClientName(e.target.value)}
          />
          <Suggestion name={f.clientSuggestion} onUse={f.useClient} />
        </div>
        <TextField
          label="Division"
          placeholder="e.g. Logistics"
          value={client.division}
          notSure={client.notSure.includes('division')}
          error={f.errors['client.division']}
          onChange={(e) => f.setDivision(e.target.value)}
        />
      </div>
    </section>
  )
}
