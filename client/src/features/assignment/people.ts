// How the engineer picker words and orders people (RV-11, boards 09, 12, 13):
// Me first with the caller's initials, then the rest by name, each with a short role word.
// Used by components/EngineerPicker.tsx.
import type { Person } from './api'

// Short words, as the boards draw them (the accounts screen's long labels don't fit a row).
const ROLE_WORD: Record<string, string> = { risk_engineer: 'Engineer', knowledge_admin: 'Admin' }

/** Returns a role as the picker words it; an unknown role is shown as it is. */
export const roleWord = (role: string) => ROLE_WORD[role] ?? role

/** Returns the people to choose from: Me first, then the others by name, minus `leaveOut`. */
export function pickable(people: Person[], me: { id: string; name: string }, leaveOut?: string) {
  const others = people.filter((p) => p.id !== me.id).sort((a, b) => a.name.localeCompare(b.name))
  const mine: Person = {
    id: me.id,
    name: me.name,
    role: people.find((p) => p.id === me.id)?.role ?? 'knowledge_admin',
  }
  return [mine, ...others].filter((p) => p.id !== leaveOut)
}
