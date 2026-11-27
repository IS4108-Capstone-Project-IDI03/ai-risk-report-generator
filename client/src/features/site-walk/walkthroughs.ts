// The "Record a site walk" and "Review a site walk" walkthroughs (F-12). Tags are data-walk attributes in
// components/RecordPanel, NoteComposer, WalkNameDialog, ProposalNavigator, ProposalList, ProposalRow,
// ProposalHeader and screens/Recording.tsx. Signals come from useRecordingWalk.ts and screens/Review.tsx.
// Read by features/walkthrough/registry.ts. Both play on the practice assessment.
import type { WalkthroughDef } from '../walkthrough/types'

// MarshBot's line when there is no microphone (said by useRecordingWalk.ts). Kept here so every
// word a walkthrough says lives in a definitions file.
export const NO_MICROPHONE_WALK =
  "I'm sorry, it looks like I can't use your microphone. That's alright, you can type the sentence in the note box and press **Add note** instead."

export const WALKTHROUGHS: WalkthroughDef[] = [
  {
    // Starts when: First time the recorder opens (offered), or the offer after a 2nd manual observation.
    // AI: the recording is written out, then read into a location and an observation. "Review my walk"
    // plays `proposal` on the newest ready walk. Opening the recorder makes an empty walk: only ever the practice one's.
    id: 'site-walk',
    name: 'Record a site walk',
    group: 'Capturing on site',
    roles: ['risk_engineer', 'knowledge_admin'],
    kind: 'ai',
    screen: 'site-walk',
    place: { path: '/assessment?ref={practice}&tab=observations&walk=record' },
    offer:
      "I see it's your first time recording a site walk.\n\nWould you like to try a short one together?",
    // No microphone: useRecordingWalk.ts says the line, types the sentence into the note box, and goes on.
    // `slow`: reading usually takes well under a minute. A practice walk makes no Inbox item, so the
    // line names where the walk will be instead (the button's own label).
    fail: {
      offer:
        "I'm sorry, I can't read site walks right now, so I'll skip this walkthrough for now. You can still add observations one at a time with **Add observation manually**.",
      slow: {
        afterMs: 90_000,
        say: "This is taking a little longer than usual. You can carry on, and you'll find it in **Observations → Site walk proposals** when it's ready.",
      },
    },
    steps: [
      {
        target: 'site-walk.record-panel',
        say: "A site walk lets you **talk as you walk**. You tell me where you are and what you see, and I'll turn the recording into observations for you to check afterwards.",
      },
      {
        // The whole record panel is lit, so the bubble sits beside it and never over Save recording,
        // which comes where Upload was once recording starts (the bubble stays put while they record).
        // The first signal is the microphone opening (a permission prompt can take longer than the settle time).
        target: 'site-walk.record-panel',
        mood: 'idle',
        say: 'Let\'s try a short one. Press **Start recording** and say: "Block A, Level 1, loading bay. Pallets are stored in the fire lane." When you\'re done, press **Save recording**.',
        do: [
          { signal: 'site-walk-recording-started', at: 'site-walk.record-panel' },
          { signal: 'site-walk-recording-saved' },
        ],
      },
      {
        // The result: the saved recording in the walk's list. useRecordingWalk.ts steps past this one
        // when there is no microphone (a typed note was added instead, so there is no recording).
        target: 'site-walk.list',
        mood: 'pleased',
        say: "Your first recording is saved, and you can see it listed here. On a real walk, you'd press **Save recording** at each stop and then start the next one, so one walk can hold several recordings.",
      },
      {
        target: 'site-walk.camera',
        say: "On a real walk, you can take **photos** as you go, and I'll match each one to what you were saying at the time.",
      },
      {
        target: 'site-walk.notes',
        say: "You can also type a **note** here, for anything that's easier to write than to say.",
      },
      {
        // The press opens the naming dialog (named "Practice walk" for this walkthrough). Both presses
        // are the person's part: the spotlight goes at the first and the bubble stays until the walk
        // is finished in the box. Then the walkthrough steps aside until the walk is read (`until`).
        target: 'site-walk.finish',
        say: "That's enough for a first walk. Go ahead and press **Finish walk**. I've already given the walk a name, so just press **Finish walk** again in the box that opens.",
        do: [{ press: 'site-walk.finish' }, { signal: 'site-walk-finished' }],
        until: 'site-walk-proposal-ready',
      },
      {
        // The result: the "Walk finished" block (screens/Recording.tsx), lit with the bubble beside it.
        target: 'site-walk.finished',
        mood: 'pleased',
        say: "Your walk is ready! On a real walk, you can carry on working while I read it, and I'll let you know in your **Inbox** when it's done.\n\nShall we take a look at what I heard?",
        answers: [
          { label: 'Review my walk', then: { play: 'proposal' } },
          { label: 'Later', then: 'end' },
        ],
      },
    ],
  },
  {
    // Starts when: straight after the site walk try-it, or the first time a proposal opens (offered).
    // Replays open the Site Walk Proposals list and press its first (newest) ready walk.
    id: 'proposal',
    name: 'Review a site walk',
    group: 'Capturing on site',
    roles: ['risk_engineer', 'knowledge_admin'],
    kind: 'hands',
    screen: 'proposal',
    place: {
      path: '/assessment?ref={practice}&tab=observations&walk=list',
      open: ['site-walk.first-open'],
    },
    offer:
      "I see it's your first time reviewing a site walk.\n\nWould you like me to walk you through it?",
    steps: [
      {
        // The location line, the headings (a phone's list has none) and the rows, the red-marked one too when there is one.
        target: [
          'site-walk.location',
          'site-walk.proposal-head?',
          'site-walk.row-1',
          'site-walk.row-red?',
        ],
        say: 'This is what I heard from your walk: the **locations** you were at, and the **observations** you made there, each with its category and severity. If you see a red mark, it means something is still missing.',
      },
      {
        target: 'site-walk.row-1',
        say: "You're free to change anything I got wrong, add anything I missed, and delete what you don't need. Your changes are saved as you make them.",
      },
      {
        // Lands when the gateway has created everything, not on the press.
        target: 'site-walk.create',
        mood: 'idle',
        say: "One important thing: **none of this is on the assessment yet**. When you're happy with it, press **Create all** to add it.",
        do: [{ signal: 'proposal-created' }],
      },
      {
        // The Observations tab after Create all: the first row that came from a site walk (it wears the badge).
        target: 'site-walk.new-row',
        mood: 'pleased',
        say: "And it's done! What you said is now on the assessment as observations. This small badge shows that they came from a site walk.",
      },
    ],
  },
]
