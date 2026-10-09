import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect } from 'vitest'
import type { UserRole } from '../features/accounts/api'
import type { Session } from '../features/auth/api'

// Test sessions for each role, with the permissions the gateway sends for it
// (ROLE_PERMISSIONS in server/src/services/permissions.service.ts).
export const SESSIONS: Record<UserRole, Session> = {
  risk_engineer: {
    user: { id: '6ab39017e45cf009e4507731', name: 'Alex Rowe', role: 'risk_engineer' },
    permissions: [
      'assessments:view',
      'assessments:edit',
      'reports:generate',
      'knowledge:view',
      'usage:view',
    ],
    notifications: { total: 0, unread: 0 },
  },
  knowledge_admin: {
    user: { id: '6ab39017e45cf009e4507734', name: 'Sana Patel', role: 'knowledge_admin' },
    permissions: [
      'assessments:view',
      'knowledge:view',
      'knowledge:manage',
      'users:manage',
      'usage:view',
    ],
    notifications: { total: 0, unread: 0 },
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
