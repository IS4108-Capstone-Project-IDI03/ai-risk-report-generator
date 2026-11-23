// The "Ask MarshBot about standards" walkthrough (F-12): a try-it with live AI. The person presses the
// first starter question, the answer arrives, they press a citation number, then see its source.
// Read by features/walkthrough/registry.ts. Tags are in features/chat; api.ts sends x-walkthrough while it runs.
import type { WalkthroughDef } from '../walkthrough/types'

export const WALKTHROUGHS: WalkthroughDef[] = [
  {
    // Starts when: First time the MarshBot screen opens (offered).
    // AI: One question to the knowledge base. The project docs measured about 1.4 seconds to the first words and 4.8 seconds to the full answer.
    // Quick check covers: Searching the knowledge base, and the AI that answers.
    id: 'chat',
    name: 'Ask MarshBot about standards',
    group: 'Day to day',
    roles: ['risk_engineer', 'knowledge_admin'],
    kind: 'ai',
    screen: 'chat',
    place: { path: '/ask' },
    offer:
      "Hi, I see it's your first time in the MarshBot tab.\n\nWould you like to try asking me a question?",
    // A failed check gives no first-time offer. A failure part-way is covered by the chat's own friendly reply.
    fail: {
      offer:
        "I'm sorry, I can't answer questions right now, so I'll skip this walkthrough for now. You can play it from **Settings** a little later.",
    },
    steps: [
      {
        // At: The welcome card.
        target: 'chat.welcome',
        say: "This is where you can ask me about the **standards** and about Marsh's **past reports**. I only answer from what's in the knowledge base, so you can always check where an answer came from.",
      },
      {
        // At: The first starter question. Hands-on: the person presses it.
        target: 'chat.starter-1',
        mood: 'idle',
        say: "Let's try one together. Go ahead and press the first question.",
        do: [{ press: 'chat.starter-1' }],
      },
      {
        // At: Their sent question. The step holds here until the answer is written, so the next step
        // shows with its citation in place (a step that has to find its target gives up after 4 s, and
        // the answer takes longer).
        target: 'chat.question',
        mood: 'thinking',
        say: "I'm looking through the knowledge base now. You'll see my answer appear here as I write it.",
        wait: 'chat-answer-finished',
      },
      {
        // At: The first citation number, which shows once its statement has been written. Hands-on: the person presses it.
        target: 'chat.citation-1',
        mood: 'pleased',
        say: "Here's my answer. Every statement has a small **number** beside it. If you press one, I'll show you the page it came from.",
        do: [{ press: 'chat.citation-1' }],
      },
      {
        // At: The source panel beside the chat.
        target: 'chat.source',
        mood: 'pleased',
        say: "This is the passage I used, with the words I quoted highlighted. If you press **PDF**, you'll see the original document. And if I can't find a quote on the page, I'll mark its number with **!** so you know to double-check it.",
      },
      {
        // At: The composer's photo, PDF and voice buttons.
        // The source panel is closed first: on a phone it covers the chat, and its Back button is pressed for the person.
        open: ['chat.source-close'],
        target: ['chat.attach-photo', 'chat.attach-pdf', 'chat.attach-voice'],
        say: "You can also add a **photo** or a **PDF** to your question, or ask me by **voice**. And if the knowledge base doesn't have an answer, you can ask an admin to add the document.",
        sayAdmin:
          "You can also add a photo or a PDF to your question, or ask me by voice. And if the knowledge base doesn't have an answer, I'll take you straight to **Add documents**.",
      },
    ],
  },
]
