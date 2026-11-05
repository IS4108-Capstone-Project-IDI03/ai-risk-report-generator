// Browser routes and the route guard (F-05). Each screen has a URL path and
// needs one permission from the signed-in user's role. The permissions come
// from the gateway with the session, and the gateway enforces the same matrix
// on its API (403), so hiding or blocking a screen here is for the user's
// benefit; it is not the security boundary.
import type { UserRole } from '../accounts/api'
import type { Permission, Session } from './api'

export type Screen =
  | 'dashboard'
  | 'create'
  | 'field'
  | 'assessment'
  | 'users'
  | 'knowledge'
  | 'usage'
  | 'chat'
  | 'clients'
  | 'client'

export const SCREEN_PATHS: Record<Screen, string> = {
  dashboard: '/assessments',
  create: '/assessments/new',
  field: '/site-observation',
  assessment: '/assessment',
  users: '/admin/users',
  knowledge: '/admin/knowledge-base',
  usage: '/usage-costs',
  chat: '/ask',
  // The engineer's clients (CP-18), and each one's page at '/clients/<id>';
  // see clientIdForPath.
  clients: '/clients',
  client: '/clients',
}

const SCREEN_PERMISSIONS: Record<Screen, Permission> = {
  dashboard: 'assessments:view',
  create: 'assessments:edit',
  field: 'assessments:edit',
  assessment: 'assessments:view',
  users: 'users:manage',
  knowledge: 'knowledge:manage',
  usage: 'usage:view',
  chat: 'knowledge:view',
  // Engineers manage the clients and sites of their own assessments (CP-18).
  clients: 'assessments:edit',
  client: 'assessments:edit',
}

// A client's page (CP-18): '/clients/<id>'.
export const CLIENT_PATH = `${SCREEN_PATHS.client}/`

// The id of the client a path opens, or null for any other path.
export function clientIdForPath(pathname: string): string | null {
  const id = pathname.match(new RegExp(`^${CLIENT_PATH}([^/]+)/*$`))?.[1]
  if (!id) return null
  try {
    return decodeURIComponent(id)
  } catch {
    return null
  }
}

// A knowledge document's Review page (IN-07) is part of the knowledge screen:
// '/admin/knowledge-base/review/<id>'.
export const KNOWLEDGE_REVIEW_PATH = `${SCREEN_PATHS.knowledge}/review/`

// The id of the document a path asks to review, or null for any other path.
export function reviewIdForPath(pathname: string): string | null {
  const id = pathname.match(new RegExp(`^${KNOWLEDGE_REVIEW_PATH}([^/]+)/*$`))?.[1]
  if (!id) return null
  try {
    return decodeURIComponent(id)
  } catch {
    // A malformed escape such as %E0 is not a document id; without this it would crash the page.
    return null
  }
}

// Tabs of the assessment workspace that change the report. Overview and
// Observations only need the workspace itself.
const TAB_PERMISSIONS: Record<string, Permission> = {
  generate: 'reports:generate',
  // Read by anyone who can comment on the report, a knowledge admin too;
  // its decisions still take reports:generate (RV-03 AC7).
  review: 'reports:comment',
  // Exporting the finished report (EX-01 AC2).
  export: 'reports:export',
}

// Where each role starts after signing in, or on opening the site root.
const HOME: Record<UserRole, Screen> = {
  risk_engineer: 'dashboard',
  knowledge_admin: 'knowledge',
}

// The screen a path names; '/' and unknown paths name the role's home.
export function screenForPath(pathname: string, session: Session): Screen {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (reviewIdForPath(path)) return 'knowledge'
  if (clientIdForPath(path)) return 'client'
  // '/clients' alone is the list of clients.
  const match = (Object.keys(SCREEN_PATHS) as Screen[]).find(
    (s) => s !== 'client' && SCREEN_PATHS[s] === path,
  )
  return match ?? homeScreen(session)
}

export function homeScreen(session: Session): Screen {
  return HOME[session.user.role] ?? 'dashboard'
}

export function canOpen(screen: string, session: Session): boolean {
  const needs = SCREEN_PERMISSIONS[screen as Screen]
  return needs !== undefined && session.permissions.includes(needs)
}

export function canOpenTab(tab: string, session: Session): boolean {
  const needs = TAB_PERMISSIONS[tab]
  return needs === undefined || session.permissions.includes(needs)
}

export function can(permission: Permission, session: Session): boolean {
  return session.permissions.includes(permission)
}
