// The New assessment walkthroughs (F-12): the menu's two ways, the form filled in by hand, and the
// client-documents try-it that reads a sample email. Tags: new-assessment.* (components/NewAssessmentButton,
// the form's cards, UploadArea, FoundSoFar, Field), plus the "other way" offers after a real Create.
// Read by features/walkthrough/registry.ts. Plays on the New assessment screen.
import type { WalkthroughDef } from '../walkthrough/types'

export const WALKTHROUGHS: WalkthroughDef[] = [
  {
    // Starts when: First time the New assessment menu is opened. One bubble beside the open menu, no dimming.
    id: 'new-choice',
    name: '2 ways to start an assessment',
    group: 'Setting up an assessment',
    roles: ['risk_engineer', 'knowledge_admin'],
    kind: 'tell',
    bare: true,
    // Offered by the menu itself the first time it opens (components/NewAssessmentButton.tsx).
    screen: 'new-choice',
    place: { path: '/assessments', open: ['new-assessment.button'] },
    steps: [
      {
        target: 'new-assessment.menu',
        say: "You have 2 ways to start a new assessment:\n- **Fill in the form** if you already know the client, sites and dates.\n- **Start from client documents** if you have the client's emails or letters. I'll read them and fill in the form for you.",
      },
    ],
  },
  {
    // Starts when: First time the form opens through "Fill in the form" (offered).
    // Note: Tell only: this is the real form, so the walkthrough never creates anything. The user can type while it runs.
    id: 'new-form',
    name: 'Fill in the New Assessment form',
    group: 'Setting up an assessment',
    roles: ['risk_engineer', 'knowledge_admin'],
    kind: 'tell',
    screen: 'new-form',
    place: { path: '/assessments', open: ['new-assessment.button', 'new-assessment.start-form'] },
    offer:
      "I see it's your first time filling in this form.\n\nWould you like me to walk you through it?",
    // Other way offer. When: After the user's first real Create on this path, once.
    otherWay: {
      after: 'assessment-created-by-form',
      id: 'new-docs',
      mood: 'pleased',
      say: "The assessment has been created! In future, you can also **start from client documents**. Give me the client's emails, letters and contracts, and I'll fill in the form for you.\n\nWould you like to see how it works with a sample email?",
      answers: [
        { label: 'Show me', then: { play: 'new-docs' } },
        { label: 'Not now', then: 'end' },
      ],
    },
    steps: [
      {
        target: ['new-assessment.client-mode', 'new-assessment.client-card'],
        say: "Let's start with the client. You can choose one you already have, or type in a new one. If the name looks like a client we already have, I'll check with you so you don't end up with the same client twice.",
      },
      {
        // The site's name, jurisdiction and facility type row, and its address. Optional: choosing
        // Existing client (while this plays) takes the site card away until a client is picked.
        target: ['new-assessment.site-row', 'new-assessment.site-address'],
        optional: true,
        say: 'Next is the site. Each one needs a name, an address, a **jurisdiction** and a **facility type**. Please take a moment over those last 2, because they decide which standards I use for this site.',
      },
      {
        // The type control and the dates (an admin's assigned engineer is the fourth date column).
        target: ['new-assessment.type', 'new-assessment.dates'],
        optional: true,
        say: 'Now choose the type of assessment and its dates. I set **Report due** to 14 days after the survey starts, and you can change it if you need to.',
        sayAdmin:
          'Now choose the type of assessment and its dates, and then the **assigned engineer**. It starts as you, and whoever you choose will get the assessment in their Inbox.',
      },
      {
        // "Add site" is there for a new client only, so this step goes when Existing client is chosen.
        target: ['new-assessment.add-assessment', 'new-assessment.add-site'],
        optional: true,
        say: 'If the client has more than one site, or a site needs more than one assessment, you can add them here and create everything in one go.',
      },
      {
        target: 'new-assessment.documents',
        optional: true,
        say: 'You can also attach any documents the client has sent you, so they stay with the assessment.',
      },
      {
        // Highlighted, never pressed: this is the real form.
        target: 'new-assessment.create',
        say: 'When everything looks right, press **Create**. Each assessment gets its own report ID and starts in the Setup stage.',
      },
    ],
  },
  {
    // Starts when: First time "Start from client documents" is chosen (offered), or the offer after a first manual Create.
    // Note: Uses a sample email that ships with the app, from a made-up client. Nothing is created: leaving the screen discards it, which is how the screen already behaves.
    // AI: Reads one sample email: the text is taken out, client details are hidden, and one AI call fills the form. The screen's code expects about 20 seconds.
    // Quick check covers: Reading documents, hiding client details and the AI that fills the form.
    id: 'new-docs',
    name: "Start from the client's documents",
    group: 'Setting up an assessment',
    roles: ['risk_engineer', 'knowledge_admin'],
    kind: 'ai',
    screen: 'new-docs',
    place: {
      path: '/assessments',
      open: ['new-assessment.button', 'new-assessment.start-documents'],
    },
    offer:
      "I see it's your first time starting from client documents.\n\nWould you like to try it with a sample email first?",
    // Failure lines, in the plan's words (take the quoted sentences exactly): If the check fails on a first-time offer, no offer is shown, and MarshBot says in the corner: "I'm sorry, I can't read documents right now, so I'll skip this walkthrough for now. You can still fill in the form yourself." From Settings: "I'm sorry, I can't read documents right now. Please try this walkthrough again a little later." If the read fails part-way, the screen's own "Not read" message shows and MarshBot adds: "I'm sorry, that didn't work this time. You can replay this walkthrough from **Settings** whenever you like."
    fail: {
      offer:
        "I'm sorry, I can't read documents right now, so I'll skip this walkthrough for now. You can still fill in the form yourself.",
      replay:
        "I'm sorry, I can't read documents right now. Please try this walkthrough again a little later.",
      partway:
        "I'm sorry, that didn't work this time. You can replay this walkthrough from **Settings** whenever you like.",
    },
    // Other way offer. When: After the user's first real Create on this path, once.
    otherWay: {
      after: 'assessment-created-from-documents',
      id: 'new-form',
      mood: 'pleased',
      say: "The assessment has been created! If you don't have any documents next time, you can also **fill in the form** yourself.\n\nWould you like me to show you how?",
      answers: [
        { label: 'Show me', then: { play: 'new-form' } },
        { label: 'Not now', then: 'end' },
      ],
    },
    steps: [
      {
        target: 'new-assessment.upload',
        say: "This is where you add whatever the client has sent you. Emails, letters, PDFs and Word files all work. If you're not sure how to save an email as a file, the **(?)** here shows you how.",
      },
      {
        // The button is in MarshBot's bubble: its answer fires the signal UploadArea listens for,
        // and the sample goes down the same path as a chosen file.
        target: 'new-assessment.upload',
        mood: 'idle',
        say: "Let's try it together. I have a **sample email** from a made-up client. Go ahead and press **Use the sample email**, and watch what happens.",
        answers: [{ label: 'Use the sample email', then: { emit: 'sample-email-wanted' } }],
      },
      {
        // Waits for the reading to finish and the form to open (screens/NewAssessment.tsx raises the signal).
        target: 'new-assessment.found',
        mood: 'thinking',
        say: "I'm reading the email now. Before any AI sees it, I hide the client's details to keep them private. You'll see the client, sites and dates appear as I find them.",
        wait: 'documents-form-opened',
      },
      {
        // Every amber field carries the tag; the highlight goes round the first one on the page.
        target: 'new-assessment.amber-field',
        mood: 'pleased',
        say: "And there we go, the form has been filled in from the email! If you see an **amber field**, it means I wasn't sure about it, so I've left it empty for you to fill in.",
      },
      {
        // Highlighted, never pressed: nothing is created.
        target: 'new-assessment.create',
        say: "With a real client, you'd check each field and then press **Create**. This one was just for practice, so nothing has been saved.",
      },
    ],
  },
]
