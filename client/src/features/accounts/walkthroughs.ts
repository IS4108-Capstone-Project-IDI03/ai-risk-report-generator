// The "Manage user accounts" walkthrough (F-12): admin only, a tour of the User accounts list.
// Read by features/walkthrough/registry.ts. Tags are in features/accounts/UserAccounts.tsx.
import type { WalkthroughDef } from '../walkthrough/types'

export const WALKTHROUGHS: WalkthroughDef[] = [
  {
    // Starts when: First time User accounts opens (offered).
    id: 'accounts',
    name: 'Manage user accounts',
    group: 'Admin tasks',
    roles: ['knowledge_admin'],
    kind: 'tell',
    screen: 'accounts',
    place: { path: '/admin/users' },
    offer:
      "Hi, I see it's your first time in the User accounts tab.\n\nWould you like me to show you around?",
    steps: [
      {
        // At: The table's headings and its first row (a narrow screen's list has one row alone).
        target: ['accounts.head', 'accounts.row-1'],
        say: "This is everyone who has an account. Each person's **role** decides what they can open:\n- **Risk engineers** work on their own assessments.\n- **Knowledge admins** can also manage the knowledge base and these accounts.",
      },
      {
        // At: The Add account button.
        target: 'accounts.add',
        say: "When someone new joins, press **Add account**. They'll be emailed a link to set their own password, and the link works for 72 hours.",
      },
      {
        // At: The first name in the table.
        target: 'accounts.row-1.name',
        say: "You can open anyone's profile to edit it, send their invitation again, or turn off **Account active** to deactivate their account. You can't change your own role or deactivate yourself, though: another admin has to do that.",
      },
    ],
  },
]
