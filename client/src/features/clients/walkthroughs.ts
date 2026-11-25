// The three client walkthroughs (F-12): Find a client (the Clients list), Look around a client's
// page, Read a client's insights. Tags sit in features/clients; all tell-only, on the person's real clients.
// Read by features/walkthrough/registry.ts. The client page and Insights open through the list's first client.
import type { WalkthroughDef } from '../walkthrough/types'

export const WALKTHROUGHS: WalkthroughDef[] = [
  {
    // Starts when: First time the Clients list opens (offered).
    id: 'clients',
    name: 'Find a client',
    group: 'Day to day',
    roles: ['risk_engineer', 'knowledge_admin'],
    kind: 'tell',
    screen: 'clients',
    place: { path: '/clients' },
    offer:
      "Hi, I see it's your first time in the Clients tab.\n\nWould you like me to show you around?",
    steps: [
      {
        // At: The table's headings and its first row.
        target: ['clients.head', 'clients.row-1'],
        say: "This is where you'll find your clients. A client shows up here as soon as you have an assessment for it, and each row shows its sites, its open assessments and **what's due next**.",
      },
      {
        // At: The first row's icons (a phone's row has one More button).
        target: 'clients.row-1.actions',
        say: 'When you point to a row, you can start a **new assessment** for that client, rename it or remove it. If one of the icons is greyed out, just point to it to see why.',
      },
      {
        // At: The first client's name.
        target: 'clients.row-1.name',
        say: "And when you'd like to see more about a client, press its name to open its page.",
      },
    ],
  },
  {
    // Starts when: First time any client page opens (offered).
    id: 'client-page',
    name: "Look around a client's page",
    group: 'Day to day',
    roles: ['risk_engineer', 'knowledge_admin'],
    kind: 'tell',
    screen: 'client-page',
    // A client's page has no fixed address, so it opens the first client from the list.
    place: { path: '/clients', open: ['clients.row-1.name'] },
    offer:
      "I see it's your first time opening a client's page.\n\nWould you like me to show you around?",
    steps: [
      {
        // At: The four tabs.
        target: 'client.tabs',
        say: "Everything about this client is in these 4 tabs:\n- **Open work** lists your assessments that are still in progress.\n- **Sites** lists every site and its assessments.\n- **Documents** keeps the client's files together.\n- **Insights** adds up what you've found across all their sites.",
      },
      {
        // At: The client facts panel (right). A phone has no panel, so the step is skipped there.
        target: 'client.facts',
        optional: true,
        say: "This panel gives you the key facts at a glance: where the client operates, when you first and last surveyed them, what's due next, and who to contact.",
      },
      {
        // At: The Sites tab.
        target: 'client.tab.sites',
        say: "Under **Sites**, you can edit a site's details. Please be careful with the jurisdiction and facility type, because changing them means that site's checklists and drafts will need to be redone.",
      },
      {
        // At: The Documents tab.
        target: 'client.tab.documents',
        say: "Under **Documents**, each file is tagged to the client, a site or an assessment, so it's always easy to find later.",
      },
      {
        // At: The Insights tab.
        target: 'client.tab.insights',
        say: "And the first time you open **Insights**, I'll offer to show you around there too.",
      },
    ],
  },
  {
    // Starts when: First time the Insights tab opens on a client that has data (offered).
    id: 'insights',
    name: "Read a client's insights",
    group: 'Day to day',
    roles: ['risk_engineer', 'knowledge_admin'],
    kind: 'tell',
    screen: 'client-insights',
    // Opens the first client, then its Insights tab (offered only when that client has data).
    place: { path: '/clients', open: ['clients.row-1.name', 'client.tab.insights'] },
    offer:
      "I see it's your first time opening Insights.\n\nWould you like me to explain what you're looking at?",
    steps: [
      {
        // At: The five tiles.
        target: 'insights.tiles',
        say: 'These figures are **counted** directly from your observations, not written by AI. They come from your latest assessment at each site.',
      },
      {
        // At: The summary card.
        target: 'insights.summary',
        say: 'The **summary** is the only part I write, and I only write it when you ask me to. Each statement shows its source, and the summary never goes into a report.',
      },
      {
        // At: The Sites needing attention card, "Where the findings are" and "Change between visits", one by one
        // (round all three, the box would also hold the summary card and be taller than the screen).
        target: ['insights.attention', 'insights.grid', 'insights.change'],
        apart: true,
        say: "Further down, you'll find the sites that **need attention** first, where the findings are, and how each site has changed between visits.",
      },
    ],
  },
]
