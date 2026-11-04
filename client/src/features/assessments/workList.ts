// Small helpers for the Assessments list (CP-23). Used by components/WorkRow,
// WorkToolbar and screens/Dashboard.
import type { AssessmentType } from '../../design-system'

/** Returns the assessment type's name as shown ("Follow-up visit" is stored, "Follow-up" shown). */
export function typeName(stored: string): AssessmentType {
  if (stored.startsWith('Follow-up')) return 'Follow-up'
  return stored === 'Resurvey' ? 'Resurvey' : 'First survey'
}
