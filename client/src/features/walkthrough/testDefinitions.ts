// Test-only walkthroughs for the engine tests (F-12, seam 3). Kept apart from testKit.tsx and free of
// engine imports, because the tests' registry mock loads it (an engine import there would wait on itself).
import type { UserRole } from '../accounts/api'
import type { WalkthroughDef } from './types'

const BOTH: UserRole[] = ['risk_engineer', 'knowledge_admin']

export const TEST_DEFS: WalkthroughDef[] = [
  {
    id: 'welcome',
    name: 'A quick look around',
    group: 'Getting started',
    roles: BOTH,
    kind: 'tell',
    screen: 'home',
    place: { path: '/' },
    steps: [
      {
        card: true,
        say: 'Hi {name}, welcome!',
        answers: [
          { label: 'Show me around', then: 'next' },
          { label: 'Skip for now', then: 'skip' },
        ],
      },
      { target: 't.search', say: 'Your work lives here.', nav: true },
      {
        card: true,
        say: 'Where would you like to go next?',
        answers: [
          { label: 'Go to Assessments', labelAdmin: 'Go to Knowledge base', then: 'end' },
          { label: "I'll explore", then: 'end' },
        ],
      },
    ],
  },
  {
    id: 'clients',
    name: 'Find a client',
    group: 'Day to day',
    roles: BOTH,
    kind: 'tell',
    screen: 'clients',
    place: { path: '/' },
    offer:
      "Hi, I see it's your first time in the Clients tab.\n\nWould you like me to show you around?",
    steps: [
      { target: 't.search', say: 'Search here.' },
      { target: 't.gone', say: 'Something optional.', optional: true },
      { target: 't.admin', say: 'Only for admins.', only: 'knowledge_admin' },
      { target: ['t.head', 't.row-1'], say: 'The table.', sayAdmin: "The team's table." },
    ],
  },
  {
    id: 'accounts',
    name: 'Manage user accounts',
    group: 'Admin tasks',
    roles: ['knowledge_admin'],
    kind: 'tell',
    screen: 'clients',
    place: { path: '/' },
    offer: 'Admin offer.',
    steps: [{ target: 't.search', say: 'Accounts.' }],
  },
  {
    id: 'observations',
    name: 'Check your observations',
    group: 'Capturing on site',
    roles: BOTH,
    kind: 'hands',
    screen: 'observations',
    place: { path: '/assessment?ref={practice}&tab=observations' },
    offer: 'Hands offer.',
    fail: { slow: { afterMs: 1500, say: 'Taking longer.' } },
    steps: [
      {
        target: 't.button',
        say: 'Press the button.',
        do: [{ press: 't.button' }],
        until: 'answered',
      },
      { target: 't.search', say: 'All done.' },
      { target: 't.search', say: 'Last one.' },
    ],
  },
  {
    id: 'chat',
    name: 'Ask MarshBot about standards',
    group: 'Day to day',
    roles: BOTH,
    kind: 'ai',
    screen: 'chat',
    place: { path: '/' },
    offer: 'Try asking?',
    fail: {
      offer: "I'm sorry, I can't answer questions right now.",
      replay: 'Please try again later.',
    },
    steps: [{ target: 't.search', say: 'Ask here.' }],
  },
  {
    id: 'lost',
    name: 'A lost one',
    group: 'Day to day',
    roles: BOTH,
    kind: 'tell',
    screen: 'clients',
    place: { path: '/' },
    steps: [{ target: 't.nowhere', say: 'Never seen.' }],
  },
  {
    id: 'new-form',
    name: 'Fill in the New Assessment form',
    group: 'Setting up an assessment',
    roles: BOTH,
    kind: 'tell',
    screen: 'form',
    place: { path: '/' },
    otherWay: {
      after: 'assessment-created',
      id: 'clients',
      mood: 'pleased',
      say: 'Created! Would you like to see the other way?',
      answers: [
        { label: 'Show me', then: { play: 'clients' } },
        { label: 'Not now', then: 'end' },
      ],
    },
    steps: [
      {
        target: 't.search',
        say: 'Want a sample?',
        answers: [{ label: 'Use the sample email', then: { emit: 'sample-chosen' } }],
      },
      { target: 't.search', say: 'The form.' },
    ],
  },
  {
    id: 'client-page',
    name: "Look around a client's page",
    group: 'Day to day',
    roles: BOTH,
    kind: 'tell',
    screen: 'client-page',
    place: { path: '/clients', open: ['t.button'] },
    steps: [{ target: 't.search', say: 'A client.' }],
  },
  {
    id: 'new-choice',
    name: 'Two ways to start an assessment',
    group: 'Setting up an assessment',
    roles: BOTH,
    kind: 'tell',
    screen: 'menu',
    place: { path: '/' },
    bare: true,
    steps: [{ target: 't.button', say: 'Two ways to start.' }],
  },
  {
    id: 'checklist',
    name: 'Use the checklist',
    group: 'Capturing on site',
    roles: BOTH,
    kind: 'tell',
    screen: 'checklist',
    place: { path: '/assessment?ref={practice}&tab=checklist' },
    offer: 'Checklist offer.',
    steps: [{ target: 't.search', say: 'The checklist.' }],
  },
  {
    // Reached by a press from a list that has the same URL (the Site Walk Proposals list).
    id: 'proposal',
    name: 'Review a site walk',
    group: 'Capturing on site',
    roles: BOTH,
    kind: 'hands',
    screen: 'proposal',
    place: { path: '/assessment?ref={practice}&tab=observations', open: ['t.button'] },
    // "t.phone-missing?" is never on the screen: the step shows without it.
    steps: [{ target: ['t.phone-missing?', 't.search'], say: 'A proposal.' }],
  },
  {
    // Its target is never on the screen: what a used-up practice assessment looks like.
    id: 'used-up',
    name: 'A used-up practice assessment',
    group: 'Capturing on site',
    roles: BOTH,
    kind: 'hands',
    screen: 'observations',
    place: { path: '/assessment?ref={practice}&tab=observations' },
    steps: [{ target: 't.gone', say: 'Confirm it.', do: [{ press: 't.gone' }] }],
  },
  {
    id: 'slow',
    name: 'A slow screen',
    group: 'Day to day',
    roles: BOTH,
    kind: 'hands',
    screen: 'slow',
    place: { path: '/' },
    steps: [
      { target: 't.search', say: 'Press it.', do: [{ press: 't.button' }, { press: 't.late' }] },
      { target: 't.later', say: 'Late one.' },
    ],
  },
  {
    // A signal step (pick, type, record), then a press on another control.
    id: 'pick',
    name: 'Pick something',
    group: 'Day to day',
    roles: BOTH,
    kind: 'hands',
    screen: 'clients',
    place: { path: '/' },
    steps: [
      { target: 't.search', say: 'Pick one.', do: [{ signal: 'picked' }, { press: 't.button' }] },
      { target: 't.search', say: 'Picked.' },
    ],
  },
  {
    // A step whose `open` press changes the screen (observation.back): t.late appears on the press.
    id: 'reopen',
    name: 'Back to the list',
    group: 'Day to day',
    roles: BOTH,
    kind: 'tell',
    screen: 'clients',
    place: { path: '/' },
    steps: [
      { target: 't.search', say: 'First.' },
      { open: ['t.button'], target: 't.late', say: 'Second.' },
    ],
  },
  {
    // The person's own save landing is their action (Confirm category): a refused save leaves the step.
    id: 'confirm',
    name: 'Confirm and save',
    group: 'Day to day',
    roles: BOTH,
    kind: 'hands',
    screen: 'clients',
    place: { path: '/' },
    steps: [
      { target: 't.head', say: 'Confirm it.', do: [{ signal: 'confirm-saved', at: 't.head' }] },
      { target: 't.head', say: 'Confirmed.' },
    ],
  },
  {
    // A press whose result is on another screen: its `open` is pressed during the quiet time.
    id: 'elsewhere',
    name: 'Result on another screen',
    group: 'Day to day',
    roles: BOTH,
    kind: 'hands',
    screen: 'clients',
    place: { path: '/' },
    steps: [
      { target: 't.button', say: 'Save it.', do: [{ press: 't.button' }], until: 'read' },
      { open: ['t.search'], target: 't.late', say: 'Here it is.' },
    ],
  },
  {
    // An answer button that sets the app working (Use the sample email).
    id: 'sample',
    name: 'Use a sample',
    group: 'Day to day',
    roles: BOTH,
    kind: 'hands',
    screen: 'clients',
    place: { path: '/' },
    steps: [
      {
        target: 't.search',
        say: 'Want a sample?',
        answers: [{ label: 'Use the sample', then: { emit: 'sample-chosen' } }],
        until: 'sample-read',
      },
      { target: 't.search', say: 'Read.' },
    ],
  },
]
