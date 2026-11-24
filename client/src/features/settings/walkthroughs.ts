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
        // At: Menu: Password, Chat and voice, Note-taking   (selector hint from the old code: settings menu (first group))
        target: ['settings.menu.password', 'settings.menu.chat', 'settings.menu.note-taking'],
        say: 'These first 3 settings are **yours**:\n- **Password** is where you change your password.\n- **Chat and Voice** sets how my answers are read aloud.\n- **Note-Taking** holds your note codes and your glossary.',
      },
      {
        // At: Note-taking   (selector hint from the old code: menu item "Note-taking")
        target: 'settings.menu.note-taking',
        say: "**Note-Taking** is worth a visit. It's where you set the codes you start a line with, and where you can teach me the words you use on site.",
      },
      {
        // At: Menu: Models and Source priority   (selector hint from the old code: settings menu "Set by admin")
        target: ['settings.menu.models', 'settings.menu.source-priority'],
        say: "These 2 are set by an admin for everyone, so you can see them but you can't change them.",
        sayAdmin:
          'These 2 are for you to set **for everyone**. **Models** chooses the AI for each task, and **Source Priority** decides which source wins when 2 of them disagree.',
      },
      {
        // At: Menu: Walkthroughs (new)   (selector hint from the old code: menu item "Walkthroughs")
        target: 'settings.menu.walkthroughs',
        say: 'And **Walkthroughs** is where you can replay any walkthrough whenever you like, on its own or several in a row.',
      },
    ],
  },
]
