// The "Use the checklist", "Check your observations" and "Find your site walks" walkthroughs (F-12).
// Tags: checklist.* (screens/Checklist.tsx, ChecklistItems), observations.* and observation.* (the
// Observations tab and an observation's page), proposals.tab.* (screens/SiteWalks.tsx).
// Read by features/walkthrough/registry.ts. Play on the practice assessment's Checklist and Observations tabs.
import type { WalkthroughDef } from '../walkthrough/types'

export const WALKTHROUGHS: WalkthroughDef[] = [
  {
    // Starts when: First time the Checklist tab opens (offered). Tell only: no AI runs.
    id: 'checklist',
    name: 'Use the checklist',
    group: 'Capturing on site',
    roles: ['risk_engineer', 'knowledge_admin'],
    kind: 'tell',
    screen: 'checklist',
    place: { path: '/assessment?ref={practice}&tab=checklist' },
    offer:
      'I see this is your first time on the Checklist tab.\n\nWould you like me to walk you through it?',
    steps: [
      {
        target: 'checklist.standards',
        say: "The checklist starts with the **standards** for this site. I've listed the ones in the knowledge base that match its facility type and jurisdiction, so you can choose the ones you want to use.",
      },
      {
        // The button only an engineer has. The admin's words (below) point at the PDF icon instead.
        target: 'checklist.generate',
        only: 'risk_engineer',
        say: "Once you've chosen, press **Generate checklist** and I'll write it from those standards. It takes about half a minute.",
      },
      {
        // The admin's one step about the PDF icon (the words name it, so it is what is lit).
        // Optional: the icon only shows once there is a checklist; without this an admin on an
        // assessment with no checklist would get "I can't find what I wanted to show you".
        target: 'checklist.download',
        optional: true,
        only: 'knowledge_admin',
        say: "Only the assigned engineer can generate the checklist, but you're welcome to read it, and you can download it as a PDF here.",
      },
      {
        // The checklist's items, each with its round mark. Optional: an empty checklist has none.
        target: 'checklist.answers',
        optional: true,
        only: 'risk_engineer',
        say: "When you're on site, press the round mark beside each item as you go:\n- Once for a **tick** if what you saw matches.\n- Twice for a **cross** if it doesn't.\n- Three times if you didn't get to see it.\nYou can link a ticked or crossed item to an observation.",
      },
      {
        // The icon only shows once there is a checklist. Engineers only: the admin's step above says it.
        target: 'checklist.download',
        optional: true,
        only: 'risk_engineer',
        say: "If you'd like to take the checklist with you, you can download it as a PDF here. You can also open it while you're adding an observation.",
      },
    ],
  },
  {
    // Starts when: First time the Observations tab opens (offered); plays on the practice assessment.
    // Step 5 ends on the observation's page, so step 6 first presses its Back button to return to the list.
    id: 'observations',
    name: 'Check your observations',
    group: 'Capturing on site',
    roles: ['risk_engineer', 'knowledge_admin'],
    kind: 'hands',
    screen: 'observations',
    place: { path: '/assessment?ref={practice}&tab=observations' },
    offer:
      'I see this is your first time on the Observations tab.\n\nWould you like me to show you around?',
    steps: [
      {
        // The location tree and the Add location button (a phone's Location button, which holds both).
        target: ['observations.locations', 'observations.add-location?'],
        apart: true,
        say: 'Observations are grouped by where you saw them: the building, the level and the location. Before you add your first observation, you can add a location here.',
      },
      {
        // The headings (a phone's list has none) and the first row. Optional: skipped when there is no row.
        target: ['observations.head?', 'observations.row-1'],
        optional: true,
        say: 'Each row is one thing you saw on site. The **Status** mark on the right tells you where it is: still being written out, being read, waiting for you, or done.',
      },
      {
        // Open the amber row. The next step is on the observation's page.
        target: 'observations.to-check',
        mood: 'idle',
        say: "When a row is **amber**, it means I've suggested a category or severity and I'd like you to check it. I only use an observation in the report once both are set. Let's do this one together: go ahead and open the row.",
        do: [{ press: 'observations.to-check' }],
      },
      {
        // The practice observation's Category is amber. The cut-out goes round the whole Category
        // field (the words are about it); the field lights its Confirm (cp24.css). The person's part
        // ends when the Confirm is saved (ObservationDetails.tsx), not on the press: a refused save
        // leaves this step showing, and Confirm can be pressed again.
        target: 'observation.category-field',
        mood: 'idle',
        say: "This is the observation's page. The **Category** field is in **amber**, because it holds my suggestion and it's waiting for you to check it. If it looks right to you, go ahead and press **Confirm category**.",
        do: [{ signal: 'observation-category-confirmed', at: 'observation.category-field' }],
      },
      {
        // The result: Category's amber is gone. Only Category is amber on the practice observation
        // (server/src/services/practice/records.ts), so this one Confirm leaves it Complete.
        target: 'observation.category-field',
        mood: 'pleased',
        say: "Nicely done! The amber mark is gone from **Category** because you've confirmed it, and this observation is now ready to be used in the report.",
      },
      {
        // Back to the list first (the page the last step ended on), then the search and the four filters.
        open: ['observation.back'],
        target: ['observations.search', 'observations.filter-status'],
        say: 'You can search through your notes, recordings and scanned pages here. You can also narrow the list down by **category**, **severity**, **type** or **status**.',
      },
      {
        // The Add observation button, whose menu holds the two ways the words name.
        target: 'observations.add',
        only: 'risk_engineer',
        say: "When you want to add more, press **Add observation**. You'll find 2 ways to do it:\n- **Add observation manually**, one at a time.\n- **Record a site walk**, where you talk as you walk and I turn it into observations for you to check.",
      },
    ],
  },
  {
    // Starts when: First time the Site Walk Proposals list shows its tabs. One bubble, no dimming; not an offer.
    id: 'proposals-list',
    name: 'Find your site walks',
    group: 'Capturing on site',
    roles: ['risk_engineer', 'knowledge_admin'],
    kind: 'tell',
    bare: true,
    screen: 'proposals-list',
    place: { path: '/assessment?ref={practice}&tab=observations&walk=list' },
    steps: [
      {
        // The first and last tab frame the tab bar.
        target: ['proposals.tab.ready', 'proposals.tab.added'],
        say: "Every site walk you record shows up here:\n- **In progress** while I'm still reading it.\n- **Ready to review** when it needs you.\n- **Added** once it's on the assessment.",
      },
    ],
  },
]
