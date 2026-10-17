// A row's tokens, short (1.6M), with the exact count on hover. Used by the
// overview and document tables (EV-04).
import { DASH, formatTokens } from '../format'

export function TokensCell({ tokens }: { tokens: number }) {
  if (tokens <= 0) return <>{DASH}</>
  return <span title={`${tokens.toLocaleString('en-US')} tokens`}>{formatTokens(tokens)}</span>
}
