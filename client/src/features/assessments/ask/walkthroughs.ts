// The "Ask about an assessment" walkthrough (F-12): a try-it with live AI. It asks one question of the
// practice assessment, waits for the checked answer, then points at it (and at Draft text, for an engineer).
// Read by features/walkthrough/registry.ts. Tags are in ask/AskPanel.tsx and components/ReviewInspector.tsx.
import type { WalkthroughDef } from '../../walkthrough/types'

export const WALKTHROUGHS: WalkthroughDef[] = [
  {
    // Starts when: First time the Ask tab opens in Review (offered).
    // AI: One question about the practice assessment, answered line by line. Time not measured yet.
    // Quick check covers: Searching, hiding client details, and the AI that answers.
    id: 'ask',
    name: 'Ask about an assessment',
    group: 'Writing the report',
    roles: ['risk_engineer', 'knowledge_admin'],
    kind: 'ai',
    screen: 'ask',
    // The Ask tab is pressed for the person (on a phone, the button that opens its sheet).
    place: { path: '/assessment?ref={practice}&tab=review', open: ['review.ask-tab'] },
    offer: "I see it's your first time opening Ask.\n\nWould you like to try asking me a question?",
    fail: {
      offer:
        "I'm sorry, I can't answer questions right now, so I'll skip this walkthrough for now. You can play it from **Settings** a little later.",
      replay:
        "I'm sorry, I can't answer questions right now. Please try this walkthrough again a little later.",
      // No partway line: the card shows its own "The answer stopped" with Ask again, and the engine adds its standard line.
    },
    steps: [
      {
        // At: The line that says what a question searches.
        target: 'ask.scope',
        say: "You can ask me anything about **this assessment**. I'll look through its observations, its standards, and past reports for similar sites to find the answer.",
      },
      {
        // At: Question box, filled in, and the Ask button (the whole question form). AskPanel types the question in
        // when this step shows. Hands-on: the question is sent.
        target: 'ask.composer',
        mood: 'idle',
        say: 'I\'ve typed in a question to get you started: "Which observations concern fire protection?" Go ahead and press **Ask**.',
        // Then the walkthrough steps aside until the checked answer has arrived (`until`).
        do: [{ signal: 'ask-question-sent', at: 'ask.composer' }],
        until: 'ask-answer-finished',
      },
      {
        // At: The answer card (the newest answer).
        target: 'ask.answer',
        mood: 'pleased',
        say: "Here's my answer. Each line shows **where it came from**, and the bars show how strong the evidence is. If I can't back something up, I'll tell you with \"Evidence missing\".",
      },
      {
        // At: Draft text button.
        target: 'ask.draft-text',
        only: 'risk_engineer',
        say: "If you press **Draft text**, I'll draft a paragraph for the section you have open. It stays marked as an AI draft until you've checked and accepted it.",
      },
    ],
  },
]
