import type { UserRole } from '../models/user.model'

// The agreed permission matrix (F-05). Every protected API route names one of
// these, and the client guards its screens with the same list (sent by
// /api/auth/login and /api/auth/me), so the matrix lives only here.
export const PERMISSIONS = [
  // List assessments and read their locations, observations and recordings.
  'assessments:view',
  // Create assessments, capture on site (sessions, locations, observations)
  // and change, delete or restore observations. Changing an assessment's own
  // observations also needs its assigned engineer (RV-10, CP-08). A knowledge
  // admin holds it too (RV-11), so every "assigned engineer" check below is what
  // keeps an admin read-only on someone else's assessment.
  'assessments:edit',
  // Choose which engineer an assessment is for when creating it, and move an
  // existing one to another engineer (RV-11). Knowledge admins only.
  'assessments:assign',
  // Draft report sections (RAG), and decide on their findings: accept, edit,
  // reject, regenerate (RV-02). Also needs the assigned engineer.
  'reports:generate',
  // Export the finished report as a PDF or Word file (EX-01). Also needs the
  // assigned engineer, and the report to be complete (export.service).
  'reports:export',
  // Comment on the report in the document editor, reply, and resolve and
  // reopen threads (RV-03). Also needs an assessment the user can open: its
  // assigned engineer, or a knowledge admin (comment.service).
  'reports:comment',
  // Ask questions about an assessment in the review workspace's Ask tab and
  // read one's own earlier answers there (AS-01). Also needs an assessment the
  // user can open: its assigned engineer, or a knowledge admin.
  'reports:ask',
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
// assessments:view   |      yes      |      yes
// assessments:edit   |      yes      |      yes (RV-11: only on their own assessments)
// assessments:assign |      -        |      yes
// reports:generate   |      yes      |      yes (RV-11: only on their own assessments)
// reports:export     |      yes      |      yes (RV-11: only on their own assessments)
// reports:comment    |      yes      |      yes
// reports:ask        |      yes      |      yes
// knowledge:view     |      yes      |      yes
// knowledge:manage   |      -        |      yes
// users:manage       |      -        |      yes
// usage:view         |      yes (own reports) | yes (all reports)
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  risk_engineer: [
    'assessments:view',
    'assessments:edit',
    'reports:generate',
    'reports:export',
    'reports:comment',
    'reports:ask',
    'knowledge:view',
    'usage:view',
  ],
  knowledge_admin: [
    'assessments:view',
    'assessments:edit',
    'assessments:assign',
    'reports:generate',
    'reports:export',
    'reports:comment',
    'reports:ask',
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
