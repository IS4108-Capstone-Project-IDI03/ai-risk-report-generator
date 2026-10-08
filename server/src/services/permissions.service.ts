import type { UserRole } from '../models/user.model'

// The agreed permission matrix (F-05). Every protected API route names one of
// these, and the client guards its screens with the same list (sent by
// /api/auth/login and /api/auth/me), so the matrix lives only here.
export const PERMISSIONS = [
  // List assessments and read their locations, observations and recordings.
  'assessments:view',
  // Create assessments, capture on site (sessions, locations, observations)
  // and change, delete or restore observations. Changing an assessment's own
  // observations also needs its assigned engineer (RV-10, CP-08).
  'assessments:edit',
  // Draft report sections (RAG).
  'reports:generate',
  // List knowledge documents and open their original files, e.g. a citation.
  'knowledge:view',
  // Upload knowledge documents and correct their details (KB-01).
  'knowledge:manage',
  // List and edit user accounts, including role assignment.
  'users:manage',
  // Open the usage and cost report (EV-04). The API narrows a risk engineer to
  // the reports assigned to them; a knowledge admin sees every report.
  'usage:view',
] as const

export type Permission = (typeof PERMISSIONS)[number]

//                    | Risk engineer | Knowledge admin
// assessments:view   |      yes      |      yes (read-only)
// assessments:edit   |      yes      |      -
// reports:generate   |      yes      |      -
// knowledge:view     |      yes      |      yes
// knowledge:manage   |      -        |      yes
// users:manage       |      -        |      yes
// usage:view         |      yes (own reports) | yes (all reports)
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  risk_engineer: [
    'assessments:view',
    'assessments:edit',
    'reports:generate',
    'knowledge:view',
    'usage:view',
  ],
  knowledge_admin: [
    'assessments:view',
    'knowledge:view',
    'knowledge:manage',
    'users:manage',
    'usage:view',
  ],
}

// A role outside the matrix, e.g. one left in an old session or record, gets
// nothing rather than failing open.
export function permissionsFor(role: string): Permission[] {
  return Object.hasOwn(ROLE_PERMISSIONS, role) ? [...ROLE_PERMISSIONS[role as UserRole]] : []
}

export function hasPermission(role: string, permission: Permission): boolean {
  return permissionsFor(role).includes(permission)
}
