// The Knowledge base's five walkthroughs (F-12): browse (engineer), manage (admin), add a document,
// review a document and answer requests. All tell-only. Tags are the data-walk attributes in this
// folder (screens/, components/, KnowledgeBase.tsx). Read by features/walkthrough/registry.ts.
import type { WalkthroughDef } from '../walkthrough/types'

export const WALKTHROUGHS: WalkthroughDef[] = [
  {
    // Starts when: First time an engineer opens the Knowledge base (offered).
    id: 'kb-engineer',
    name: 'Browse the knowledge base',
    group: 'Day to day',
    roles: ['risk_engineer'],
    kind: 'tell',
    screen: 'knowledge-base',
    place: { path: '/admin/knowledge-base', open: ['knowledge.tab.documents'] },
    offer:
      "Hi, I see it's your first time in the Knowledge base tab.\n\nWould you like me to show you around?",
    steps: [
      {
        // A phone has no table headings, so only the first row is lit there.
        target: ['knowledge.head?', 'knowledge.row-1'],
        say: "This is everything I draw on when I draft and answer: the **FM, NFPA and local standards**, and Marsh's past reports. You can read all of it here, and the admins keep it up to date.",
      },
      {
        target: ['knowledge.status.head?', 'knowledge.status.row-1'],
        say: 'I only use documents that are marked **Active**. If a document is marked **Needs review** or **Withdrawn**, I leave it out until an admin has dealt with it.',
      },
      {
        open: ['knowledge.row-1.open'],
        target: 'knowledge.details',
        optional: true,
        say: "If you open a row, you'll see the document's details. And **View passages** shows you the actual text that I search through.",
      },
    ],
  },
  {
    // Starts when: Admin home screen: first time it opens (offered), or straight from the Welcome.
    id: 'kb-admin',
    name: 'Manage the knowledge base',
    group: 'Admin tasks',
    roles: ['knowledge_admin'],
    kind: 'tell',
    screen: 'knowledge-base',
    place: { path: '/admin/knowledge-base', open: ['knowledge.tab.documents'] },
    offer:
      "Hi, I see it's your first time in the Knowledge base tab.\n\nWould you like me to show you around?",
    steps: [
      {
        target: ['knowledge.tab.documents', 'knowledge.tab.add', 'knowledge.tab.requests'],
        say: "The knowledge base is yours to manage, and it has 3 tabs:\n- **Documents** shows everything that's in it.\n- **Add documents** is where you upload new ones.\n- **Requests** shows the questions I couldn't answer for an engineer.",
      },
      {
        target: ['knowledge.status.head?', 'knowledge.status.row-1'],
        say: "I only use documents that are marked **Active**. When you see **Needs review**, it means I couldn't confirm one of the details, or the document looks like a copy or another edition of one we already have.",
      },
      {
        target: 'knowledge.review-banner',
        optional: true,
        say: "Whenever a document needs your review, this banner will take you straight to it. Until you've decided, new reports can't use that document.",
      },
      {
        open: ['knowledge.row-1.open'],
        target: ['knowledge.edit', 'knowledge.history', 'knowledge.passages', 'knowledge.withdraw'],
        optional: true,
        say: 'When you open a row, the icons at the bottom let you:\n- **Edit details** to correct them.\n- **Edit history** to see what has changed.\n- **View passages** to read its text.\n- **Withdraw** it, which keeps the file but stops new reports from using it.',
      },
      {
        target: [
          'knowledge.filter.source',
          'knowledge.filter.country',
          'knowledge.filter.facility',
          'knowledge.filter.status',
        ],
        say: "And if you're looking for something in particular, you can filter by source type, country, facility type or status.",
      },
    ],
  },
  {
    // Starts when: First time the Add documents tab opens (offered). Tell only: nothing is uploaded, reading a real document takes too long.
    id: 'kb-add',
    name: 'Add a document',
    group: 'Admin tasks',
    roles: ['knowledge_admin'],
    kind: 'tell',
    screen: 'knowledge-add',
    place: { path: '/admin/knowledge-base', open: ['knowledge.tab.add'] },
    offer:
      "I see it's your first time adding documents.\n\nWould you like me to explain what happens when you upload one?",
    steps: [
      {
        target: 'knowledge-add.panel',
        say: "This is where you add a standard or a past report. The nice part is that **you don't need to fill in anything**: I read the title, edition, country and facility type from the file itself.",
      },
      {
        target: ['knowledge-add.head', 'knowledge-add.row-1'],
        say: 'After that, I read through the whole document in the background. A long standard can take a while, so please feel free to leave this page while I work.',
      },
      {
        target: 'knowledge-add.needs-review',
        optional: true,
        say: "If there's a detail I couldn't confirm, or the document looks like another edition of one we have, it comes back as **Needs review**. It won't be used until you've dealt with it, and you'll find it waiting in your Inbox.",
      },
      {
        target: ['knowledge-add.type-needed.status', 'knowledge-add.type-needed.action'],
        optional: true,
        say: "If you see **Type needed**, it means I couldn't tell what kind of document it is. Just choose its type in that row, and then press **Start reading**.",
      },
      {
        target: 'knowledge-add.manual',
        say: "And if you don't have a PDF, you can press **Enter a standard manually** and type it in clause by clause.",
      },
    ],
  },
  {
    // Starts when: First time a Review document screen opens (offered).
    id: 'kb-review',
    name: 'Review a document',
    group: 'Admin tasks',
    roles: ['knowledge_admin'],
    kind: 'tell',
    screen: 'knowledge-review',
    place: {
      path: '/admin/knowledge-base',
      open: ['knowledge.tab.documents', 'knowledge.review-open'],
    },
    offer:
      "I see it's your first time reviewing a document.\n\nWould you like me to walk you through it?",
    steps: [
      {
        target: 'knowledge-review.confirm',
        optional: true,
        say: "Let's start with the details. Please fill in the fields that are marked **Unconfirmed**, and then save.",
      },
      {
        target: ['knowledge-review.differences', 'knowledge-review.sides'],
        optional: true,
        say: 'If this document matches one we already have, you can compare their passages here by switching between **Stored** and **New**. Turning on **Differences only** hides the parts that are the same.',
      },
      {
        target: 'knowledge-review.choices',
        optional: true,
        // From its end: on a phone, under MarshBot's whole sheet at the top, all three choices show.
        show: 'end',
        say: "Then it's up to you what happens to it. You can keep both, replace the one we have, or delete one of them. I'll mark the **usual choice** for you, but the decision is always yours.",
      },
    ],
  },
  {
    // Starts when: First time the Requests tab opens while it holds an open request (offered). With no requests there is nothing to show, so nothing is offered.
    id: 'kb-requests',
    name: 'Answer knowledge requests',
    group: 'Admin tasks',
    roles: ['knowledge_admin'],
    kind: 'tell',
    screen: 'knowledge-requests',
    place: { path: '/admin/knowledge-base', open: ['knowledge.tab.requests'] },
    offer:
      "I see it's your first time opening Requests.\n\nWould you like me to explain how they work?",
    steps: [
      {
        target: 'knowledge-requests.row-1',
        say: "When I can't answer an engineer's question, they can ask you to add the document that would. Each request shows you **their question** and any message they've added.",
      },
      {
        target: ['knowledge-requests.row-1.fill', 'knowledge-requests.row-1.dismiss'],
        say: "Once you've added the document, press **Mark filled** and choose it, and I'll let the engineer know. If it's not something we hold, you can press **Dismiss** and give a reason.",
      },
    ],
  },
]
