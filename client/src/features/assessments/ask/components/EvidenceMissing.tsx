// What evidence an Ask answer or proposed text lacks (AS-01 AC4), as a tinted line inside
// MarshBot's bubble: "Evidence missing: <what>". Drawn by AnswerTurn.tsx and ProposalTurn.tsx.
import { Icon } from '../../../../design-system'

/** Returns one "Evidence missing" line per gap the answer names. */
export function EvidenceMissing({ missing }: { missing: string[] }) {
  return missing.map((m, i) => (
    <p key={i} className="ask-missing">
      <Icon name="circle-help" size={14} color="var(--text-muted)" />
      <span>
        <span className="ask-missing-label">Evidence missing: </span>
        {m}
      </span>
    </p>
  ))
}
