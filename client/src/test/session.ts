import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect } from 'vitest'
import type { UserRole } from '../features/accounts/api'
import type { Session } from '../features/auth/api'
import type { WalkthroughRecord } from '../features/walkthrough/types'

// Tests never get a walkthrough over them: the Welcome counts as played and offers are off (F-12).
export const QUIET_WALKTHROUGHS: WalkthroughRecord = {
  welcomeAt: '2026-01-01T00:00:00.000Z',
  offers: false,
  seen: {},
  otherWay: [],
  counts: {},
  practice: null,
}

// Test sessions for each role, with the permissions the gateway sends for it
// (ROLE_PERMISSIONS in server/src/services/permissions.service.ts).
export const SESSIONS: Record<UserRole, Session> = {
  risk_engineer: {
    user: { id: '6ab39017e45cf009e4507731', name: 'Alex Rowe', role: 'risk_engineer' },
    permissions: [
      'assessments:view',
      'assessments:edit',
      'reports:generate',
      'reports:export',
      'reports:comment',
      'reports:ask',
      'knowledge:view',
      'usage:view',
    ],
    notifications: { total: 0, unread: 0, inboxTodo: 0, newestInbox: null, newestBell: null },
    walkthroughs: QUIET_WALKTHROUGHS,
  },
  knowledge_admin: {
    user: { id: '6ab39017e45cf009e4507734', name: 'Sana Patel', role: 'knowledge_admin' },
    permissions: [
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
      'settings:manage',
    ],
    notifications: { total: 0, unread: 0, inboxTodo: 0, newestInbox: null, newestBell: null },
    walkthroughs: QUIET_WALKTHROUGHS,
  },
}

// Who the mocked sign-in (see setup.ts) signs in. Reset to a risk engineer
// after each test.
export const testAuth: { role: UserRole } = { role: 'risk_engineer' }

// Signs in through the form and waits for the workspace to replace it.
export async function signIn(role: UserRole = 'risk_engineer') {
  testAuth.role = role
  fireEvent.change(screen.getByLabelText(/Work email/), { target: { value: 'demo@marsh.com' } })
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'sample-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull())
}
