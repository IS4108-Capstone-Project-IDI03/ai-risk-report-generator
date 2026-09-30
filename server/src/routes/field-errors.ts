import type { ZodError } from 'zod'

// The first problem with each invalid field, keyed by path, e.g.
// { "site.name": "Site name is required." }.
export function fieldErrors(error: ZodError) {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) fields[issue.path.map(String).join('.')] ??= issue.message
  return fields
}
