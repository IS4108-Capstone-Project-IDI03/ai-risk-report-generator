// The red "Usage not shown" callout with Try again (EV-04), shown when a usage query fails.
// Used by every usage screen. The message says the cause, then the fix (v2 wording rule).
import { Button, Callout } from '../../../design-system'

/** Returns the error callout; `message` is the cause and the way out. */
export function LoadError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <Callout
      tone="danger"
      title="Usage not shown"
      actions={
        <Button variant="secondary" size="sm" pill onClick={retry}>
          Try again
        </Button>
      }
    >
      <span role="alert">{message}</span>
    </Callout>
  )
}

export const LOAD_FAILED = 'Usage could not be loaded. Check your connection and try again.'
