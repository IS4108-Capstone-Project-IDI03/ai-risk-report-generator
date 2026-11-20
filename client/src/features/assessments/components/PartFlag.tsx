// One amber warning on a proposed note part (CP-35): an unknown shorthand term (add it to the
// glossary) or a number or unit that may have changed (confirm it looks right).
// Called by PartRow. An unknown term blocks Confirm until it is resolved here.
import { useState } from 'react'
import { Button, Icon, Input } from '../../../design-system'
import { GatewayError, type PartFlag as Flag } from '../api'

type Props = {
  flag: Flag
  onClear: () => void
  onAddTerm: (term: string, meaning: string) => Promise<void>
}

export function PartFlag({ flag, onClear, onAddTerm }: Props) {
  const [asking, setAsking] = useState(false)
  const [meaning, setMeaning] = useState('')
  const [problem, setProblem] = useState('')
  const unknown = flag.type === 'unknown_term'

  // A refused save keeps the flag, so the term is never treated as known when it is not.
  const save = async () => {
    if (!meaning.trim()) return setProblem('Write what it means first.')
    try {
      await onAddTerm(flag.detail, meaning.trim())
      onClear()
    } catch (e) {
      setProblem(e instanceof GatewayError ? e.message : 'Could not save to your glossary.')
    }
  }
  return (
    <div className="sp-flag">
      <span className="sp-flag-text">
        <Icon name="triangle-alert" size={14} color="var(--amber-600)" />
        {unknown
          ? `Unknown shorthand: "${flag.detail}"`
          : `A number or unit may have changed: ${flag.detail}`}
      </span>
      {!asking && (
        <Button variant="secondary" size="lg" onClick={unknown ? () => setAsking(true) : onClear}>
          {unknown ? 'Add to my glossary' : 'Looks right'}
        </Button>
      )}
      {asking && (
        <span className="sp-flag-ask">
          <Input
            label={`What "${flag.detail}" means`}
            size="lg"
            value={meaning}
            maxLength={120}
            onChange={(e) => setMeaning(e.target.value)}
          />
          <Button variant="primary" size="lg" onClick={save}>
            Save term
          </Button>
          <Button variant="ghost" size="lg" onClick={() => setAsking(false)}>
            Cancel term
          </Button>
        </span>
      )}
      {problem && (
        <span className="sp-err" role="alert">
          <Icon name="octagon-alert" size={14} color="var(--red-600)" /> {problem}
        </span>
      )}
    </div>
  )
}
