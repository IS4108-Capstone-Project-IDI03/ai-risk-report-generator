// The tag picker (CP-36): Fact, Info request, Recommendation, any mix, none = Fact. Also asks the
// gateway to suggest tags and shows the answer as a line the engineer accepts or ignores; it never
// changes the chips by itself. Called by screens/SiteObservation.tsx, screens/ObservationPage.tsx
// and the site walk proposal page. Calls api.suggestKinds.
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../../design-system'
import { suggestKinds, type Kind } from '../api'
import { KINDS, KIND_LABEL, sortKinds } from '../noteKinds'
import '../kind-picker.css'

// A note shorter than this is too little to suggest from.
const MIN_SUGGEST = 8

export function KindPicker({
  value,
  onChange,
  reference,
  text,
  blurred = '',
  disabled = false,
}: {
  value: Kind[]
  onChange: (kinds: Kind[]) => void
  // The assessment; without it (or without text) there is nothing to suggest from.
  reference: string | null | undefined
  // The words to suggest from: the note, or a transcription or description.
  text: string
  // The note as it was when the engineer last left the box; a new value asks once.
  blurred?: string
  disabled?: boolean
}) {
  const [suggested, setSuggested] = useState<Kind[] | null>(null)
  const [touched, setTouched] = useState(value.length > 0)
  // Counts asks, so an old answer arriving late never replaces a newer one.
  const asks = useRef(0)

  // Asks for a suggestion; any failure leaves the picker as it was.
  async function ask(words: string) {
    if (!reference || words.trim().length < MIN_SUGGEST) return
    const mine = ++asks.current
    try {
      const kinds = await suggestKinds(reference, words)
      if (mine === asks.current && kinds.length) setSuggested(sortKinds(kinds))
    } catch {
      /* silent: a suggestion is only a help */
    }
  }
  // On leaving the box: ask once, only while the picker is untouched.
  useEffect(() => {
    // ask only sets state after its network call returns, never during the effect itself.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- as above
    if (blurred && !touched && value.length === 0) void ask(blurred)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new blur asks
  }, [blurred])

  const toggle = (kind: Kind) => {
    setTouched(true)
    onChange(sortKinds(value.includes(kind) ? value.filter((k) => k !== kind) : [...value, kind]))
  }
  const canSuggest = !!reference && text.trim().length >= MIN_SUGGEST
  return (
    <fieldset className="kp" disabled={disabled}>
      <legend className="kp-legend">{'Tags'}</legend>
      <div className="kp-chips">
        {KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className="kp-chip"
            data-kind={kind}
            aria-pressed={value.includes(kind)}
            onClick={() => toggle(kind)}
          >
            {KIND_LABEL[kind]}
          </button>
        ))}
        {canSuggest && (
          <Button
            variant="pill"
            iconLeft="sparkles"
            style={{ height: 44 }}
            onClick={() => void ask(text)}
          >
            {'Suggest'}
          </Button>
        )}
      </div>
      <p className="kp-hint">
        {'Pump is old and should be replaced? Tag it Fact and Recommendation.'}
      </p>
      {suggested && (
        <div className="kp-suggest" role="status">
          <span>{'Looks like: ' + suggested.map((k) => KIND_LABEL[k]).join(' + ')}</span>
          <Button
            variant="pill"
            style={{ height: 44 }}
            onClick={() => {
              setTouched(true)
              onChange(suggested)
              setSuggested(null)
            }}
          >
            {'Use these'}
          </Button>
          <Button variant="pill" style={{ height: 44 }} onClick={() => setSuggested(null)}>
            {'Ignore'}
          </Button>
        </div>
      )}
    </fieldset>
  )
}
