// The "Find your way around an assessment" and "Open another engineer's assessment" walkthroughs (F-12).
// Tags: assessment.* (the workspace header, useAssessmentWorkflow.tsx, AssessmentActions.tsx) and overview.*
// (the MarshBot rail and thread). Read by features/walkthrough/registry.ts. Play on an assessment's Overview.
import type { WalkthroughDef } from '../walkthrough/types'

export const WALKTHROUGHS: WalkthroughDef[] = [
  {
    // Starts when: First time any assessment you own opens (offered); plays on the practice assessment.
    id: 'overview',
    name: 'Find your way around an assessment',
    group: 'Setting up an assessment',
    roles: ['risk_engineer', 'knowledge_admin'],
    kind: 'hands',
    screen: 'overview',
    place: { path: '/assessment?ref={practice}&tab=overview' },
    offer:
      "Hi, I see it's your first time opening an assessment.\n\nWould you like me to show you around?",
    steps: [
      {
        // The first and last tab frame the row, so the highlight is the six tabs and no blank space.
        target: ['assessment.tab.overview', 'assessment.tab.export'],
        say: "Welcome! This is where you'll work on an assessment. It moves from left to right through these 6 tabs, from **Overview** all the way to **Export**. The first time you open each one, I'll offer to show you around.",
      },
      {
        // The stage list (a phone's stage bar: its "Stage 5 of 8" line and eight segments).
        target: ['overview.stages', 'overview.stage-label?'],
        say: "These **8 stages** show the current progress of the assessment. You don't need to move it along yourself: the stage moves forward on its own as you get the work done.",
      },
      {
        // MarshBot's newest turn: its message and cards, not the buttons under them.
        target: 'overview.latest',
        say: "This is where I keep you up to date on this assessment. I'll bring up **one thing at a time**, so you always know what to do next.",
      },
      {
        // The practice assessment's one reply, Skip for now (decision made in Build: "What else?" is
        // not offered on that data). Optional: once it has been pressed, a replay skips this step.
        // Lands once MarshBot's answer is all shown, not on the press: until then the newest
        // message is still the old one, or an empty one (a phone has nothing to light then).
        target: 'overview.reply.skip',
        optional: true,
        mood: 'idle',
        say: 'You can answer me with the buttons under my latest message. Go ahead and press **Skip for now**, and watch how I reply.',
        do: [
          { press: 'overview.reply.skip' },
          { signal: 'marshbot-turn-shown', at: 'overview.latest' },
        ],
      },
      {
        // The result of the press: the reply just sent, MarshBot's answer to it ("No problem") and its
        // newest turn (the next topic), lit as one box, so "your answer" in the words is inside it.
        // Marked optional like the press step, but its target is always there, so a replay after
        // Skip was already used still shows it.
        target: ['overview.answer?', 'overview.latest'],
        optional: true,
        mood: 'pleased',
        say: "There you go! Your answer is now in our conversation, and I've moved on to the next thing I'd like you to look at.",
      },
      {
        // The rail's At a Glance and client card (a phone's stage bar stands for both). Optional: a short window hides At a Glance.
        target: ['overview.glance', 'overview.client'],
        optional: true,
        say: "**At a Glance** keeps the key facts for this stage in one place. And if you press the client card below it, you'll open **Details**, where you'll find the dates, site contacts, client documents and the site map.",
      },
      {
        target: 'assessment.actions',
        say: "Lastly, these 3 buttons stay with you on every tab:\n- **History** opens the report's version history.\n- **Details** opens the assessment's details.\n- **Archive** moves the assessment off your list.",
      },
    ],
  },
  {
    // Starts when: First time an admin opens an assessment assigned to another engineer (offered).
    // Replay: an assessment of another engineer has no fixed address, so a replay from Settings opens the
    // Assessments list and ends with the "can't find that" line; it plays where the admin already is.
    id: 'admin-view',
    name: "Open another engineer's assessment",
    group: 'Admin tasks',
    roles: ['knowledge_admin'],
    kind: 'tell',
    screen: 'admin-view',
    // No fixed address: a replay opens the first assessment on the list that is someone else's.
    place: { path: '/assessments', open: ['assessments.other'] },
    offer:
      'I see this assessment belongs to another engineer.\n\nWould you like me to explain what you can do here?',
    steps: [
      {
        // MarshBot's summary turn: the message, the Sections card and Time in Each Stage.
        target: 'overview.latest',
        say: "This assessment belongs to **{engineer}**, so I've put together a summary for you. It shows which stage it's in, how many sections have been reviewed, and how long each stage has taken.",
      },
      {
        target: ['assessment.tab.overview', 'assessment.tab.export'],
        say: "You're welcome to open every tab and read everything. You can also **comment** on the report and **ask me** questions about it in Review.",
      },
      {
        target: 'assessment.tab.generation',
        say: 'Only {engineer} can add observations, draft, review and export, which is why some buttons are greyed out or say **View only**. If the assessment needs to go to someone else, you can press **Reassign** on the Assessments list.',
      },
    ],
  },
]
