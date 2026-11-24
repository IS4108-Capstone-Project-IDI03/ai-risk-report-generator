// The three tell-only walkthroughs after Review (F-12): the document editor, Version history and Export.
// Read by features/walkthrough/registry.ts. Tags are in screens/DocumentEdit.tsx, document/, components/VersionHistory.tsx
// and screens/ReportExport.tsx. Replays open the practice assessment first.
import type { WalkthroughDef } from '../walkthrough/types'

export const WALKTHROUGHS: WalkthroughDef[] = [
  {
    // Starts when: First time Edit document (engineer) or Open document (admin) is pressed (offered).
    id: 'document',
    name: 'Edit the report as a document',
    group: 'Writing the report',
    roles: ['risk_engineer', 'knowledge_admin'],
    kind: 'tell',
    screen: 'document',
    // The Review tab's Edit document (engineer) or Open document (admin) button is pressed for the person.
    place: { path: '/assessment?ref={practice}&tab=review', open: ['review.edit-document'] },
    offer:
      "I see it's your first time in the document editor.\n\nWould you like me to show you around?",
    steps: [
      {
        // At: The whole editor (its toolbar and the report text).
        target: 'document.page',
        say: "This is the whole report as **one document**. You can type anywhere that isn't locked. Your changes are saved whenever you pause, and every save is kept as a version you can go back to.",
        sayAdmin:
          'This is the whole report as one document. You can read all of it, and you can **comment** on any part.',
      },
      {
        // At: The first paragraph still as drafted (a decoration in document/plugins.ts).
        // Optional: a report whose paragraphs have all been changed has no violet one to point at.
        target: 'document.violet',
        only: 'risk_engineer',
        optional: true,
        say: 'Text in **violet** is still exactly as I drafted it. As soon as you change it, it becomes yours and turns black.',
      },
      {
        // At: The first locked block (a decoration in document/plugins.ts).
        target: 'document.locked',
        say: 'The grey blocks are **filled in elsewhere**. Scores, loss tables, Opportunities for Improvement and photos all come from Review, so the document and the Review tab always match.',
      },
      {
        // At: the three tools one by one, Comment, Ask about this and Rewrite this (the admin has no
        // Rewrite this).
        target: ['document.comment', 'document.ask', 'document.rewrite?'],
        apart: true,
        say: 'When you select some text, you can do 3 things with it:\n- **Comment** to leave a comment on it.\n- **Ask about this** to ask me about it.\n- **Rewrite this** to have me rewrite it.',
        sayAdmin:
          'When you select some text, you can press **Comment** to leave a comment, or **Ask about this** to ask me about it. The engineer will see your comment right beside the text.',
      },
      {
        // At: Page layout switch.
        target: 'document.page-layout',
        say: "And if you'd like to see the report as it will be exported, you can switch to **Page layout** here.",
      },
    ],
  },
  {
    // Starts when: First time Version history opens (offered).
    id: 'versions',
    name: 'Go back to an earlier version',
    group: 'Writing the report',
    roles: ['risk_engineer', 'knowledge_admin'],
    kind: 'tell',
    screen: 'versions',
    // Version history is pressed on the section Review opens on.
    place: { path: '/assessment?ref={practice}&tab=review', open: ['review.version-history'] },
    offer:
      "I see it's your first time in Version history.\n\nWould you like me to show you how it works?",
    steps: [
      {
        // At: The Versions list (right).
        target: 'versions.list',
        say: 'Every draft and every save of this section is kept here, along with who made it and when. Open any version to compare it with the current text.',
      },
      {
        // At: Restore this version button only. Optional: only the assigned engineer has it.
        target: 'versions.restore',
        optional: true,
        say: 'If you ever need an older version back, press **Restore this version**. Restoring saves it as a new version, so nothing is ever lost.',
      },
    ],
  },
  {
    // Starts when: First time the Export tab opens (offered).
    // Note: The practice report arrives with 2 items left to finish, so this shows a real list. Finishing them and exporting the practice report is a good first goal, and nothing forces it.
    id: 'export',
    name: 'Export the report',
    group: 'Writing the report',
    roles: ['risk_engineer', 'knowledge_admin'],
    kind: 'tell',
    screen: 'export',
    place: { path: '/assessment?ref={practice}&tab=export' },
    offer:
      'I see this is your first time on the Export tab.\n\nWould you like me to walk you through it?',
    steps: [
      {
        // At: The status message at the top.
        target: 'export.status',
        say: "A report can only be exported once it's **complete**, so I check it for you every time you open this tab.",
      },
      {
        // At: The "Left to finish" card.
        target: 'export.left',
        say: 'This card lists whatever is still left to do. Each arrow takes you straight to the tab where you can sort it out.',
      },
      {
        // At: The Export card's Format and Include choices.
        target: 'export.options',
        say: 'You can choose how to export the report:\n- **PDF** is the fixed layout that you send to the client.\n- **Word** can be edited, which is useful for review rounds.\nCitations and the photo appendix are both optional.',
      },
      {
        // At: The Export button.
        target: 'export.button',
        say: "Once there's nothing left to finish, press **Export**. The file will download, and the assessment will move to the Exported stage.",
        sayAdmin:
          'Only the assigned engineer can export the report, so this button stays greyed out for you.',
      },
    ],
  },
]
