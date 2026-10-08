// The choices on a document's Review page and what each one says and does
// (IN-07). Used by components/DecisionPanel.tsx and screens/ReviewDocument.tsx.
// The gateway allows the same choices (POST /api/knowledge-documents/:id/decision).
import type { DecisionChoice, DocumentMatch, KnowledgeDocument } from './api'

export type Choice = {
  value: DecisionChoice
  label: string
  // One line saying what the choice does, shown under its radio.
  consequence: string
  // Set when the choice deletes a document, so the page asks first: this
  // document ('self') or the one it matches ('other').
  deletes?: 'self' | 'other'
  // The choice that usually fits this kind of match, tagged on the page but
  // never pre-selected, so a delete is always the admin's own click.
  usual: boolean
}

// The usual choice per kind of match: a newer edition replaces the stored
// one, an earlier one is kept out of use, a copy goes.
const USUAL: Record<DocumentMatch['kind'], DecisionChoice> = {
  newer_edition: 'supersede',
  earlier_edition: 'add_as_older',
  possible_copy: 'discard_new',
}

// "NFPA 13" (2022 edition)", or just the title when the edition is unknown.
export const named = (title: string, edition: string | null) =>
  edition ? `${title} (${edition} edition)` : title

// Every choice, in the order they are offered (safest first). The consequence
// is written from the reviewed document `d` and the document it matches.
const CHOICES: Record<
  DecisionChoice,
  {
    label: string
    consequence: (d: KnowledgeDocument, other: DocumentMatch['document']) => string
    deletes?: 'self' | 'other'
  }
> = {
  // Keep both gives this document the matched one's status (the gateway's rule),
  // so beside a withdrawn edition it stays out of use too.
  keep_both: {
    label: 'Keep both',
    consequence: (_d, other) =>
      other.withdrawn
        ? `This document is kept as withdrawn, like ${named(other.title, other.edition)}, so reports never use it.`
        : `This document becomes active. ${named(other.title, other.edition)} stays as it is.`,
  },
  supersede: {
    label: 'Replace stored edition',
    consequence: (d, other) =>
      `${named(d.title, d.edition)} becomes active. ${named(other.title, other.edition)} is withdrawn.`,
  },
  add_as_older: {
    label: 'Keep as older edition',
    consequence: (_d, other) =>
      `This document is kept as withdrawn, so reports never use it. ${named(other.title, other.edition)} stays as it is.`,
  },
  discard_new: {
    label: 'Delete this document',
    consequence: () => 'Deletes this document, its file and its passages. This cannot be undone.',
    deletes: 'self',
  },
  discard_other: {
    label: 'Delete stored document',
    consequence: (_d, other) =>
      `Deletes ${named(other.title, other.edition)} and makes this document active. This cannot be undone.`,
    deletes: 'other',
  },
}

/** Returns the choices open to a document that has a match, safest first. */
export function choicesFor(d: KnowledgeDocument): Choice[] {
  const match = d.match
  if (!match) return []
  // Must match allowedChoices in server/src/services/knowledge-document-decision.service.ts.
  const open: DecisionChoice[] = [
    'keep_both',
    ...(match.kind === 'newer_edition' ? (['supersede'] as const) : []),
    ...(match.kind === 'earlier_edition' ? (['add_as_older'] as const) : []),
    'discard_new',
    ...(match.otherNeedsReview ? (['discard_other'] as const) : []),
  ]
  return open.map((value) => {
    const { label, consequence, deletes } = CHOICES[value]
    return {
      value,
      label,
      consequence: consequence(d, match.document),
      deletes,
      usual: USUAL[match.kind] === value,
    }
  })
}

/** Returns the sentence that confirms a decision on the list it returns to. */
export function outcomeMessage(d: KnowledgeDocument, choice: DecisionChoice): string {
  const mine = named(d.title, d.edition)
  const theirs = d.match
    ? named(d.match.document.title, d.match.document.edition)
    : 'The other document'
  switch (choice) {
    case 'keep_both':
      // Beside a withdrawn document it is kept withdrawn (see keep_both above).
      return d.match?.document.withdrawn
        ? `Kept both. ${mine} is withdrawn, like ${theirs}.`
        : `Kept both. ${mine} is now active.`
    case 'discard_new':
      return `${mine} deleted.`
    case 'discard_other':
      return `${theirs} deleted. ${mine} is now active.`
    case 'supersede':
      return `${mine} is now active. ${theirs} is withdrawn.`
    case 'add_as_older':
      return `${mine} kept as an older edition. It is withdrawn.`
  }
}
