// Which assessment the text fields below belong to, for dictation (CP-27). Fields drawn deep in a
// screen (a comment's reply box, the Ask box) read it here instead of being passed it.
import { createContext, useContext, type ReactNode } from 'react'

const Scope = createContext<string | null>(null)

/** Lets the fields inside dictate into the assessment `reference`. */
export function DictationScope({
  reference,
  children,
}: {
  reference: string
  children: ReactNode
}) {
  return <Scope.Provider value={reference}>{children}</Scope.Provider>
}

/** The assessment the field is in, or null outside any (then it has no Dictate button). */
// eslint-disable-next-line react-refresh/only-export-components
export const useDictationReference = () => useContext(Scope)
