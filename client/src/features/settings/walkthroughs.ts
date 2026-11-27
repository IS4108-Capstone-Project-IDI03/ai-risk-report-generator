// The "Change your settings" walkthrough (F-12): a tour of the Settings menu, offered the first time
// Settings opens. Tags are the menu items' data-walk attributes in Settings.tsx.
// Read by features/walkthrough/registry.ts. Plays on the Settings screen.
import type { WalkthroughDef } from '../walkthrough/types'

export const WALKTHROUGHS: WalkthroughDef[] = [
  {
    // Starts when: First time Settings opens (offered).
    id: 'settings',
    name: 'Change your settings',
    group: 'Day to day',
    roles: ['risk_engineer', 'knowledge_admin'],
    kind: 'tell',
    screen: 'settings',
    place: { path: '/settings' },
    offer:
      "Hi, I see it's your first time in the Settings tab.\n\nWould you like me to show you around?",
    steps: [
      {
        // At: Menu: Password, Chat and voice   (selector hint from the old code: settings menu (first group))
        target: ['settings.menu.password', 'settings.menu.chat'],
        say: 'These first 2 settings are **yours**:\n- **Password** is where you change your password.\n- **Chat and Voice** sets how my answers are read aloud.',
      },
      {
        // At: the whole "Set by admin" group. Privacy Words shows to an admin only, so it is lit where it is.
        target: [
          'settings.menu.models',
          'settings.menu.source-priority',
          'settings.menu.checklist',
          'settings.menu.privacy-words?',
        ],
        // Names them: a phone's menu row can't show all three at once.
        say: "**Models**, **Source Priority** and **Checklist** are set by an admin for everyone, so you can see them but you can't change them.",
        sayAdmin:
          'These are yours to set **for everyone**:\n- **Models** chooses the AI for each task.\n- **Source Priority** decides which source wins when 2 of them disagree.\n- **Checklist** holds the questions every new checklist starts with.\n- **Privacy Words** sets which words are always, or never, hidden from the AI.',
      },
      {
        // At: Menu: Walkthroughs (new)   (selector hint from the old code: menu item "Walkthroughs")
        target: 'settings.menu.walkthroughs',
        say: 'And **Walkthroughs** is where you can replay any walkthrough whenever you like, on its own or several in a row.',
      },
    ],
  },
]
