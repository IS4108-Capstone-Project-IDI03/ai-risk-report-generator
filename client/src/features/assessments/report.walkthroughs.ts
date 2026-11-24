// The "Draft the report", "Review the draft", "Accept Opportunities for Improvement" and "Enter
// scores and loss estimates" walkthroughs (F-12). Tags: generation.* (screens/DraftingSteps.tsx),
// review.* (the Review workspace: section rail, findings, Section 3's OFIs, Section 4's scores) and
// shell.bell (notifications/NotificationBell). Read by features/walkthrough/registry.ts.
// Hands-on steps run on the practice assessment; they wait on the signals finding-accepted,
// ofi-accepted and figures-confirmed (features/walkthrough/signals.ts).
import type { WalkthroughDef } from '../walkthrough/types'

export const WALKTHROUGHS: WalkthroughDef[] = [
  {
    // Offered the first time the Generation tab opens. Tell only: nothing is drafted or spent.
    id: 'generation',
    name: 'Draft the report',
    group: 'Writing the report',
    roles: ['risk_engineer', 'knowledge_admin'],
    kind: 'tell',
    screen: 'generation',
    place: { path: '/assessment?ref={practice}&tab=generate' },
    offer:
      'I see this is your first time on the Generation tab.\n\nWould you like me to explain how drafting works?',
    steps: [
      {
        target: 'generation.card',
        say: "This card always tells you **what happens next**, and what's holding things up if anything is. The bar underneath counts the 11 sections I draft for you.",
        sayAdmin:
          'This card shows how far the drafting has got. Where you see **View only**, it means only the assigned engineer can start it.',
      },
      {
        target: 'generation.step-1',
        say: 'Drafting happens in 3 steps. First, I draft **Section 3 and Sections 6 to 12** from your observations. Each of those sections needs at least 1 observation.',
      },
      {
        target: 'generation.step-2',
        say: "Next, I need 3 things from you, and you'll do all of them in **Review**:\n- Accept at least 1 Opportunity for Improvement.\n- Enter the risk quality scores.\n- Enter the loss estimates.",
      },
      {
        target: 'generation.step-3',
        say: 'Once I have those, I draft **Sections 4 and 5**. I leave the Executive Summary for last, because it sums up all the other sections.',
      },
      {
        target: 'shell.bell',
        say: "Drafting can take a while, so there's no need to wait here. You can leave this page, and the **bell** will let you know when it's done.",
      },
    ],
  },
  {
    // Offered the first time the Review tab opens with drafted sections. Two steps are hands-on.
    // Steps 2 to 7 need Section 7 (4 undecided findings), so step 2 opens it. Admins get steps 1 to 4.
    id: 'review',
    name: 'Review the draft',
    group: 'Writing the report',
    roles: ['risk_engineer', 'knowledge_admin'],
    kind: 'hands',
    screen: 'review',
    place: { path: '/assessment?ref={practice}&tab=review' },
    offer:
      "I see this is your first time on the Review tab.\n\nIt's an important one, so would you like me to walk you through it?",
    steps: [
      {
        // Rows 7 to 9 show every badge the practice report has (AI draft, Reviewed, Needs review);
        // three rows fit above MarshBot's whole sheet on a phone, where four (6 to 9) did not.
        target: ['review.rail.section-7', 'review.rail.section-9'],
        say: "This is your report, section by section. The badge beside each section shows where it stands:\n- **AI draft** means you haven't started on it.\n- **In review** means you've decided some of it.\n- **Reviewed** means you've decided all of it.\n- **Needs review** means something has changed and it needs another look.",
      },
      {
        open: ['review.rail.section-7'],
        target: 'review.finding-1',
        say: "Each sentence I've drafted is called a **finding**. The small numbers beside it show where it came from.",
      },
      {
        target: 'review.finding-1.cite',
        mood: 'idle',
        say: "Let's check one together. Go ahead and press the **number**.",
        do: [{ press: 'review.finding-1.cite' }],
      },
      {
        target: 'review.evidence.source',
        mood: 'pleased',
        say: 'This is the exact passage or observation I used for that finding. If I can\'t find **real evidence** for a sentence, I mark it as "Unsupported", and the report can\'t be exported until you reject it or fix it.',
      },
      {
        // Accept, Edit and Reject are highlighted together; review.css lets only Accept be pressed.
        target: 'review.finding-1.decisions',
        only: 'risk_engineer',
        say: "Now it's your turn to decide. For each finding, you can:\n- **Accept** it as it is.\n- **Edit** it into your own words.\n- **Reject** it, which takes it out of the report.\nNothing I draft is final until you decide. Go ahead and press **Accept** on this one.",
        do: [{ signal: 'finding-accepted', at: 'review.finding-1.decisions' }],
      },
      {
        // The result: the whole finding, whose bar now holds the Accepted badge and who decided (Edit and Reject stay).
        target: 'review.finding-1.card',
        only: 'risk_engineer',
        mood: 'pleased',
        say: 'That finding is now **accepted**, and you can see your decision marked on it. If you change your mind later, you can still edit or reject it.',
      },
      {
        target: 'review.actions',
        only: 'risk_engineer',
        say: "There are 2 more buttons that will save you time. **Bulk accept** accepts every finding you haven't decided yet, and **Regenerate** gets you a fresh draft, which you can then keep or discard.",
      },
    ],
  },
  {
    // Offered the first time Section 3 opens in Review. Accepts the practice report's first suggestion.
    id: 'review-ofi',
    name: 'Accept Opportunities for Improvement',
    group: 'Writing the report',
    roles: ['risk_engineer'],
    kind: 'hands',
    screen: 'review-ofi',
    place: { path: '/assessment?ref={practice}&tab=review', open: ['review.rail.section-3'] },
    offer:
      "I see it's your first time in Section 3.\n\nWould you like me to explain how Opportunities for Improvement work?",
    steps: [
      {
        open: ['review.rail.section-3'],
        // The note above the suggestions and the first suggestion's card (as tall as the screen: its top shows).
        target: ['review.ofi.head', 'review.ofi.first'],
        say: "These are the **Opportunities for Improvement**, or OFIs, that I'm suggesting for this site. An OFI only goes into the report once you accept it.",
      },
      {
        target: 'review.ofi.accept',
        mood: 'idle',
        say: "Let's accept one together. Go ahead and press **Accept** on the first one.",
        do: [{ signal: 'ofi-accepted', at: 'review.ofi.accept' }],
      },
      {
        // The heading bar down to the first "To be completed" row (else the Priority row).
        target: ['review.ofi.accepted.head', 'review.ofi.accepted.row'],
        mood: 'pleased',
        say: 'That OFI is in the report now. Its **priority** comes from Marsh\'s risk matrix, not from me. And any cell marked "To be completed" is left for you and the client to fill in.',
      },
    ],
  },
  {
    // Offered once, the first time Section 4 or Section 5 opens in Review. Confirms the practice report's proposed scores.
    id: 'review-scores',
    name: 'Enter scores and loss estimates',
    group: 'Writing the report',
    roles: ['risk_engineer'],
    kind: 'hands',
    screen: 'review-scores',
    place: { path: '/assessment?ref={practice}&tab=review', open: ['review.rail.section-4'] },
    offer:
      "I see it's your first time entering scores.\n\nWould you like me to show you how it works?",
    steps: [
      {
        open: ['review.rail.section-4'],
        // The headings and the first row: the whole table is taller than the screen.
        target: ['review.scores.head', 'review.scores.row-1'],
        say: "Before I can draft this section, I need your **risk quality scores**. You can enter each one from 0 to 10 yourself, or press **Propose figures** and I'll suggest them for you.",
      },
      {
        // The headings and the first row, which holds violet figures: not the note above them, whose box is wider and takes in the Rating Legend beside the table.
        target: ['review.scores.head', 'review.scores.row-1'],
        say: "The figures in **violet** are the ones I've proposed. I tend to score on the low side, so please compare each one with your own judgement.",
      },
      {
        target: 'review.scores.confirm',
        mood: 'idle',
        say: 'When the figures look right to you, press **Confirm figures**. Nothing is calculated until you do.',
        do: [{ signal: 'figures-confirmed', at: 'review.scores.confirm' }],
      },
      {
        // The result: the Location Risk Quality Rating row, filled in now (before, "Not entered"). The figures lose their violet too.
        target: 'review.scores.rating',
        mood: 'pleased',
        say: "Your figures are confirmed, so they're no longer violet. I've now worked out the **Location Risk Quality Rating** from them, which you can see here.",
      },
      {
        target: 'review.rail.section-5',
        say: '**Section 5** works in the same way, for the loss estimates. Just keep in mind that every figure needs to be entered before you can export the report.',
      },
    ],
  },
]
