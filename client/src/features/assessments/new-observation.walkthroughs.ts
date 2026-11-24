// The "Add an observation" and "Use note codes and Split note" walkthroughs (F-12): try-its on the New
// Observation form. Tags are data-walk attributes in screens/SiteObservation.tsx and components/Capture*,
// LocationSheet, SplitNotePanel; the Observations list's tags are in components/ObservationRow.tsx.
// Read by features/walkthrough/registry.ts. Plays on the practice assessment (screen newObservationWalk.ts drives).
import type { WalkthroughDef } from '../walkthrough/types'

// MarshBot's line when the microphone cannot be used (said by newObservationWalk.ts). Kept here so
// every word a walkthrough says lives in a definitions file.
export const NO_MICROPHONE =
  "I'm sorry, it looks like I can't use your microphone. That's alright: I've typed the sentence into a **Note** for you instead."

export const WALKTHROUGHS: WalkthroughDef[] = [
  {
    // Starts when: First time New Observation opens (offered), or from Settings and the (?) beside Location.
    // Runs on the practice assessment. AI: the recording is written out, then a category and severity are suggested.
    id: 'new-observation',
    name: 'Add an observation',
    group: 'Capturing on site',
    roles: ['risk_engineer', 'knowledge_admin'],
    kind: 'ai',
    screen: 'new-observation',
    place: { path: '/site-observation?ref={practice}' },
    offer:
      "I see it's your first time adding an observation.\n\nWould you like to try one together?",
    // No microphone: newObservationWalk.ts says the line, types the sentence into the Note tab, and goes on.
    fail: {
      offer:
        "I'm sorry, I can't write out recordings right now, so I'll skip this walkthrough for now. You can still add observations as usual.",
      partway:
        "I'm sorry, that didn't work this time. You can press **Retry** on the row, or replay this walkthrough from **Settings** later.",
    },
    // Other way offer: after the 2nd observation saved by hand on a real assessment, once.
    otherWay: {
      after: 'observation-saved-by-hand',
      count: 2,
      id: 'site-walk',
      mood: 'idle',
      say: "I see you're adding a few observations in a row. Next time, you could also **record a site walk**: you talk as you walk, and I turn it into observations for you.\n\nWould you like to try it?",
      answers: [
        { label: 'Show me', then: { play: 'site-walk' } },
        { label: 'Not now', then: 'end' },
      ],
    },
    steps: [
      {
        // The open picker (the form opens it for this step): the loading bay is pressed in it.
        target: 'new-observation.location-menu',
        say: "Let's add an observation together. First, tell me **where you are**. Go ahead and pick the loading bay.",
        do: [{ signal: 'observation-location-chosen' }],
      },
      {
        // The result: the Location field, which now shows the loading bay (the picker has closed).
        target: 'new-observation.location',
        mood: 'pleased',
        say: "Great, you're in the **loading bay**. It will stay chosen for your next observation too, so you won't have to pick it again.",
      },
      {
        target: 'new-observation.modes',
        say: 'You can record what you saw in whichever way suits you:\n- **Note**: type it in.\n- **Voice**: say it out loud.\n- **Photo**: take or choose photos.\n- **Scan**: photograph a handwritten page.\nYou can also combine them in one observation.',
      },
      {
        // Opens the Voice tab first. The same button starts and stops; the signal is a kept recording.
        open: ['new-observation.mode-voice'],
        target: 'new-observation.record',
        mood: 'idle',
        say: 'Let\'s try your voice. Press **Start recording** and say something you might see on site, for example: "Pallets are stored in front of the fire hose reel." When you\'re done, press **Stop recording**.',
        do: [{ press: 'new-observation.record' }, { signal: 'observation-recording-stopped' }],
      },
      {
        // The result: the kept recording ("On this device" until Save). newObservationWalk.ts steps
        // past this one when there is no microphone (the sentence is typed into Note, so no recording).
        target: 'new-observation.recordings',
        mood: 'pleased',
        say: "And there's your recording, added to this observation. You don't need to type anything: I'll write out what you said once you save.",
      },
      {
        target: ['new-observation.categories', 'new-observation.severity'],
        say: "You can leave **category** and **severity** empty this time. I'll suggest them for you once you save.",
      },
      {
        // The person's part ends once the gateway has the observation, not on the press, so a refused
        // Save leaves this step showing. Then the walkthrough steps aside: a second later it presses
        // the next step's Back, and waits for the row's reading (ObservationRow.tsx raises `until`).
        target: 'new-observation.save',
        say: "Now go ahead and press **Save observation**. I'll take you to the Observations tab, so you can watch me write out what you said and suggest its category and severity.\n\nOn a real visit, you'd stay on this form and carry on with the next one.",
        do: [{ signal: 'observation-saved' }],
        until: 'observation-reading-finished',
      },
      {
        // Back to the Observations list (the header's Back; a phone's top bar ←, as its form has no
        // tab row), which lands on the saved one's location, newest first: its first row.
        open: ['new-observation.back'],
        target: 'observations.row-1',
        mood: 'pleased',
        // Reworded from the approved line ("If you agree with them, open the row and press Confirm"):
        // Confirm only shows on a value I was not sure of, and a clear sentence comes back Complete.
        say: "And here it is! This is **what you said**, written out, with a category and severity suggested. If one is marked amber, I wasn't sure about it: open the row and press **Confirm category** or **Confirm severity** if you agree.",
      },
    ],
  },
  {
    // Starts when: never offered by itself; from Settings and the (?) beside Split note. The form types the sample note.
    id: 'split-note',
    name: 'Use note codes and Split note',
    group: 'Capturing on site',
    roles: ['risk_engineer', 'knowledge_admin'],
    kind: 'ai',
    screen: 'new-observation',
    place: { path: '/site-observation?ref={practice}' },
    fail: {
      replay:
        "I'm sorry, I can't split notes right now. Please try this walkthrough again a little later.",
    },
    steps: [
      {
        target: 'new-observation.note',
        say: "You can write your notes in your own way. If you start a line with one of your **codes**, I'll know exactly what it is:\n- **F** for a fact.\n- **IR** for something to ask the client.\n- **REC** for a recommendation.",
      },
      {
        // After the press the button shows it is working; the step lands when the three groups show.
        target: 'new-observation.split',
        say: "I've typed in a sample note for you. Go ahead and press **Split note**.",
        do: [{ press: 'new-observation.split' }],
        until: 'note-split-opened',
      },
      {
        // The three group headings, one by one: the groups themselves are taller than the window.
        target: [
          'new-observation.split-facts',
          'new-observation.split-info-requests',
          'new-observation.split-recommendations',
        ],
        apart: true,
        mood: 'pleased',
        say: 'I\'ve sorted your note into 3 groups:\n- **Facts** go into the report.\n- **Info requests** go to "To ask the client".\n- **Recommendations** become Opportunities for Improvement.',
      },
      {
        // The whole panel: the parts to correct, and Confirm all parts (at its end, so `show: 'end'`).
        target: 'new-observation.split-panel',
        show: 'end',
        say: "If I've got anything wrong, you can correct it here, and then press **Confirm all parts**. You can also change your codes any time in **Settings → Note-Taking**.",
      },
    ],
  },
]
