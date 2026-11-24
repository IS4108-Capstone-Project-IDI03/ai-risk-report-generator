// The "A quick look around" (Welcome) and "Your assessments list" walkthroughs (F-12).
// The Welcome is the one walkthrough that starts by itself. Tags: nav.* (design-system SideNav),
// shell.bell (notifications/NotificationBell) and assessments.* (screens/Dashboard and its rows).
// Read by features/walkthrough/registry.ts. Plays on the Assessments list.
import type { WalkthroughDef } from '../walkthrough/types'

export const WALKTHROUGHS: WalkthroughDef[] = [
  {
    // Starts when: First sign-in on any device. Plays once by itself. The only walkthrough that starts without being asked.
    // Note: Stays on the home screen and only points at the sidebar, so it never changes screen. On a phone the navigation drawer opens for steps 2 to 5.
    // After: The first button opens that screen and plays its walkthrough straight away. After that, each screen is offered the first time it is opened.
    id: 'welcome',
    name: 'A quick look around',
    group: 'Getting started',
    roles: ['risk_engineer', 'knowledge_admin'],
    kind: 'tell',
    // Starts by itself on whichever home screen first reports ready; a replay opens the Assessments list.
    screen: 'assessments',
    place: { path: '/assessments' },
    steps: [
      {
        card: true,
        mood: 'pleased',
        say: "Hi {name}, welcome! I'm **MarshBot**, and I'll be helping you around the app. Let me start by showing you where everything is. It won't take long, and you can skip it at any time.",
        answers: [
          { label: 'Show me around', then: 'next' },
          { label: 'Skip for now', then: 'skip' },
        ],
      },
      {
        target: 'nav.group.work',
        nav: true,
        say: "Let's start with your work. Everything you're working on lives in these 3 tabs:\n- **Assessments** lists every assessment you're working on.\n- **Calendar** shows your survey dates and report due dates.\n- **Clients** keeps each client's sites and documents together.",
        sayAdmin:
          "Let's start with the team's work, which lives in these 3 tabs:\n- **Assessments** lists every assessment across the team, not only your own.\n- **Calendar** shows everyone's survey dates and report due dates.\n- **Clients** keeps each client's sites and documents together.",
      },
      {
        target: 'nav.inbox',
        nav: true,
        say: "Next is your **Inbox**. Anything that needs your attention shows up here, like a new assessment or a site walk that's ready for you to review. Once you open an item, it moves to Done.",
        sayAdmin:
          'Next is your **Inbox**. Anything that needs your attention shows up here, like a question from an engineer or a document that needs reviewing. Once you open an item, it moves to Done.',
      },
      {
        target: 'shell.bell',
        say: "The **bell** is a little different. It's for updates that are good to know but don't need you to do anything, like a report draft that has finished.",
      },
      {
        target: 'nav.group.tools',
        nav: true,
        // From its end: on a phone, under MarshBot's whole sheet at the top, every tool shows.
        show: 'end',
        say: 'And these are your tools:\n- **MarshBot** is where you can ask me about standards and past reports.\n- **Knowledge base** holds every standard and past report I draw on.\n- **Usage and Costs** shows what the AI has cost on your assessments.\n- **Settings** is where you change your password and preferences.',
        sayAdmin:
          'And these are your tools:\n- **MarshBot** is where you can ask me about standards and past reports.\n- **Knowledge base** is yours to manage: you add, review and withdraw documents.\n- **Usage and Costs** shows what the AI has cost across the team.\n- **User accounts** is where you add people and set their roles.\n- **Settings** is where you choose the AI models for everyone.',
      },
      {
        card: true,
        mood: 'pleased',
        say: "And that's the whole sidebar! I've also set up a **practice assessment** for you, so you can try things out without touching real work. Whenever you open something new, I'll offer to show you how it works, and you can replay any walkthrough from **Settings**.\n\nWhere would you like to go next?",
        answers: [
          {
            label: 'Go to Assessments',
            labelAdmin: 'Go to Knowledge base',
            then: { play: 'assessments' },
            thenAdmin: { play: 'kb-admin' },
          },
          { label: "I'll explore", then: 'end' },
        ],
      },
    ],
  },
  {
    // Starts when: First time the Assessments list opens (offered), or straight from the Welcome.
    // After: "Open it" opens the practice assessment, where the next walkthrough is offered.
    id: 'assessments',
    name: 'Your assessments list',
    group: 'Setting up an assessment',
    roles: ['risk_engineer', 'knowledge_admin'],
    kind: 'tell',
    screen: 'assessments',
    place: { path: '/assessments' },
    offer:
      "Hi, I see it's your first time in the Assessments tab.\n\nWould you like me to show you around?",
    steps: [
      {
        // The column headings and the first client group with its rows (the practice assessment's, when there is one).
        target: ['assessments.head', 'assessments.first'],
        say: 'This is your list of assessments, grouped by client and site. There are 2 columns worth keeping an eye on:\n- **Stage** shows the current progress of each assessment.\n- **Report due** turns amber, and then red, as the due date gets close.',
        sayAdmin:
          'This is the list of every assessment across the team, grouped by client and site. The **Engineer** column shows who each one belongs to, and **Stage** shows the current progress of each assessment.',
      },
      {
        target: [
          'assessments.search',
          'assessments.filter-stage',
          'assessments.filter-due',
          'assessments.filter-type',
        ],
        say: 'You can search here by site, client or report ID. You can also narrow the list down by **Stage**, **Report due** or **Type**.',
      },
      {
        // Skipped when nothing is urgent: the button is hidden then.
        target: 'assessments.focus',
        only: 'risk_engineer',
        optional: true,
        say: 'The **Focus** button shows the 3 most urgent assessments for you to work on first, so you always know where to start.',
      },
      {
        // The first row that has the button (an engineer's Archive, an admin's Reassign). The row's
        // buttons show on hover only, so Dashboard shows them while this step highlights one.
        // Skipped when no row has one (only the practice assessment, which has neither).
        target: 'assessments.row-action',
        optional: true,
        say: "When you point to a row, an **Archive** button appears. Archiving doesn't delete anything: you can always find the assessment again under **Stage → Archived**.",
        sayAdmin:
          "When you point to a row, a **Reassign** button appears. You can use it to hand the assessment to another engineer. They'll get it in their Inbox, and the engineer who had it will be told.",
      },
      {
        target: 'new-assessment.button',
        say: "And when you're ready to start a new assessment, press **New assessment**. You can fill in the form yourself, or give me the client's documents and I'll fill it in for you.",
      },
      {
        card: true,
        mood: 'pleased',
        say: "And that's your Assessments list! Your **practice assessment** is ready whenever you'd like to try things out.\n\nWould you like to open it now?",
        answers: [
          { label: 'Open it', then: { play: 'overview' } },
          { label: 'Not now', then: 'end' },
        ],
      },
    ],
  },
]
