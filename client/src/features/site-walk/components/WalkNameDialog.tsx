// Names a site walk (CP-22 AC13, round 3): asked at Finish walk, and again from
// the proposal's pencil to rename it. The name is required, so every proposal
// is told apart by a name the engineer chose. Used by screens/Recording.tsx and
// components/ProposalHeader.tsx; saved by api.ts finishWalk / renameWalk.
import { useState, type FormEvent } from 'react'
import { Dialog, Input } from '../../../design-system'

export function WalkNameDialog({
  title,
  action,
  initial = '',
  phone,
  busy,
  problem,
  onSave,
  onClose,
}: {
  title: string
  // The submit button's words, e.g. "Finish walk".
  action: string
  initial?: string
  phone: boolean
  busy?: boolean
  // Why the last save failed, from the gateway.
  problem?: string | null
  onSave: (name: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(initial)
  const blank = !name.trim()
  function submit(e: FormEvent) {
    e.preventDefault()
    if (!blank && !busy) onSave(name.trim())
  }
  return (
    <Dialog
      className={phone ? 'ds-dialog-sheet' : undefined}
      title={title}
      width={440}
      onClose={busy ? undefined : onClose}
    >
      <form className="cap-form" onSubmit={submit} aria-label={title}>
        <Input
          label="Name"
          required
          size="lg"
          autoFocus
          // must match walkNameSchema's max in server/src/services/site-walk.service.ts
          maxLength={80}
          placeholder="e.g. Tower B podium"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {problem && (
          <p className="swr-problem" role="alert">
            {problem}
          </p>
        )}
        <div className="cap-form-actions">
          <button
            type="button"
            className="cap-btn cap-btn--secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button type="submit" className="cap-btn cap-btn--primary" disabled={blank || busy}>
            {busy ? 'Saving…' : action}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
