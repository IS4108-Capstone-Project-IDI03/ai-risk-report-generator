// F-13: the help tips' words, roles and Show me walkthroughs, keyed by id (<Tip id="review.findings" />).
// The words are the approved ones from help-tips.json, never edited here. `label` is the only text
// written for the build: the button's accessible name (plain, sentence case, no new claims).
// Read by Tip.tsx and tips.test.ts. The 7 tips marked EXISTS keep their words on their own screens.
import type { UserRole } from '../accounts/api'

export type TipDef = {
  // Names the (?) button and its popover.
  label: string
  // Who sees the tip; anyone else gets nothing.
  roles: readonly UserRole[]
  // The id of the walkthrough "Show me" plays (features/walkthrough); absent = no link.
  walkthrough?: string
  // A new line starts a paragraph, a line starting "- " is a bullet, **bold** marks key words.
  // Left out for the 7 EXISTS tips: their words stay as markup on their screens.
  text?: string
}

export const TIPS = {
  // 1. Assessments list: Focus button   (EXISTS today)
  'assessments.focus': { label: 'About the Focus list', roles: ['risk_engineer'] },
  // 2. Assessments list: Stage column heading
  'assessments.stage': {
    label: 'About the Stage column',
    roles: ['risk_engineer', 'knowledge_admin'],
    walkthrough: 'overview',
    text: 'This shows the current progress of each assessment. The stage moves forward on its own as you work, through 8 stages: Setup, Prepare, Capture, Ready for generation, Generate, Review, Ready to export and Exported.',
  },
  // 3. New Assessment: Assessment block: type   (EXISTS today)
  'new-assessment.type': {
    label: 'What the assessment types mean',
    roles: ['risk_engineer', 'knowledge_admin'],
  },
  // 4. New Assessment: Site card: Jurisdiction and Facility type
  'new-assessment.site-standards': {
    label: 'About jurisdiction and facility type',
    roles: ['risk_engineer', 'knowledge_admin'],
    text: "These 2 decide which standards are used for this site's checklist and report. If you change them later, the site's drafts will need to be redone.",
  },
  // 5. New Assessment: Upload area   (EXISTS today)
  'new-assessment.save-email': {
    label: 'How to save an email',
    roles: ['risk_engineer', 'knowledge_admin'],
    walkthrough: 'new-docs',
  },
  // 6. New Assessment: Top of a form filled in from documents
  'new-assessment.amber-fields': {
    label: 'About amber fields',
    roles: ['risk_engineer', 'knowledge_admin'],
    text: "An amber field is one that the documents didn't make clear, so it has been left empty for you to fill in. The client's details were hidden before any AI read the files.",
  },
  // 7. Overview: Stages heading in the rail
  'overview.stages': {
    label: 'About the stages',
    roles: ['risk_engineer', 'knowledge_admin'],
    walkthrough: 'overview',
    text: 'The stage moves forward on its own when the work for it is done, or when you answer MarshBot. It never moves back.',
  },
  // 8. Overview: MarshBot cards (Not Covered, Thin)   (EXISTS today)
  'overview.cards': { label: 'About these cards', roles: ['risk_engineer'] },
  // 9. Overview: Details panel: Site Map
  'overview.site-map': {
    label: 'About the site map',
    roles: ['risk_engineer'],
    text: 'If you mark each location on the map, the report can show where things are.',
  },
  // 10. Checklist: "Standards to use" card
  'checklist.standards': {
    label: 'About the standards to use',
    roles: ['risk_engineer', 'knowledge_admin'],
    text: "These are the standards in the knowledge base that match this site's facility type and jurisdiction. If one is missing, you can ask a knowledge admin to add it.",
  },
  // 11. Checklist: Beside the first item's answer buttons
  'checklist.answers': {
    label: 'About the answer buttons',
    roles: ['risk_engineer'],
    walkthrough: 'checklist',
    text: "You can answer an item in 4 ways:\n- **Confirm**: what you saw matches. This saves an observation.\n- **Differs**: what you saw doesn't match. This also saves an observation.\n- **Not seen**: you didn't get to see it.\n- **Not applicable**: it doesn't apply to this site.\nThe last 2 are under ⋯ and save nothing.",
  },
  // 12. Checklist: Regenerate checklist
  'checklist.regenerate': {
    label: 'About regenerating the checklist',
    roles: ['risk_engineer'],
    text: "This writes the checklist again from the standards you chose. Your answers are kept wherever the item is still there, and you'll be told how many were not.",
  },
  // 13. Observations: Status column heading
  'observations.status': {
    label: 'About the Status column',
    roles: ['risk_engineer', 'knowledge_admin'],
    walkthrough: 'observations',
    text: "The mark shows where each observation is:\n- **Transcribing**: a recording or page is being written out.\n- **Reading**: a category and severity are being suggested.\n- **To check**: a suggestion is waiting for you to confirm it.\n- **Complete**: it's ready to be used in the report.",
  },
  // 14. Observations: "To ask the client" panel
  'observations.to-ask': {
    label: 'About the questions to ask the client',
    roles: ['risk_engineer'],
    text: "These are the questions you noted on site with your info request code (IR, unless you changed it). They aren't part of the report.",
  },
  // 15. New Observation: Beside Location   (EXISTS today)
  'new-observation.capture': {
    label: 'How to add an observation',
    roles: ['risk_engineer'],
    walkthrough: 'new-observation',
  },
  // 16. New Observation: Category and Severity
  'new-observation.category-severity': {
    label: 'About category and severity',
    roles: ['risk_engineer'],
    text: "You can leave either one empty, and it will be suggested after you save. An observation with no category is still kept, but it isn't used in the report until you choose one.",
  },
  // 17. New Observation: Split note
  'new-observation.split-note': {
    label: 'About Split note',
    roles: ['risk_engineer'],
    walkthrough: 'split-note',
    text: 'This sorts your note into facts, info requests and recommendations. If a line starts with one of your codes (F, IR or REC), it goes straight to the right group. You can change your codes in **Settings → Note-taking**.',
  },
  // 18. New Observation: Scan
  'new-observation.scan': {
    label: 'About scanning a page',
    roles: ['risk_engineer'],
    text: "You can photograph a handwritten page here. It's written out word for word after you save, and you can correct the text afterwards.",
  },
  // 19. Observation page: Category and Severity pickers
  'observation.suggested': {
    label: 'About suggested values',
    roles: ['risk_engineer'],
    walkthrough: 'observations',
    text: "Amber means this was suggested for you and is waiting for you to confirm or change it. Until you do, the observation isn't used in the report.",
  },
  // 20. Site walk: Recorder header   (EXISTS today)
  'site-walk.recorder': {
    label: 'How to record a site walk',
    roles: ['risk_engineer'],
    walkthrough: 'site-walk',
  },
  // 21. Site walk proposal: Beside Create all   (EXISTS today)
  'site-walk.proposal': {
    label: 'How to review a proposal',
    roles: ['risk_engineer'],
    walkthrough: 'proposal',
  },
  // 22. Generation: Top card
  'generation.start': {
    label: 'About starting a draft',
    roles: ['risk_engineer', 'knowledge_admin'],
    walkthrough: 'generation',
    text: 'Drafting can start once 2 things are true:\n- Each section has at least 1 observation with a category and a severity.\n- No recording is still being transcribed.\nThe last 3 sections also need your Opportunities for Improvement, scores and loss estimates.',
  },
  // 23. Generation: Step 2: Add your input
  'generation.input': {
    label: 'About adding your input',
    roles: ['risk_engineer'],
    text: "You do these 3 tasks in Review. If you open a row, you'll go straight to the right section.",
  },
  // 24. Generation: An "Out of date" mark
  'generation.out-of-date': {
    label: 'About Out of date',
    roles: ['risk_engineer'],
    text: "Something this section was drafted from has changed since then. Redrafting it keeps the findings you've already accepted.",
  },
  // 25. Review: Findings bar
  'review.findings': {
    label: 'How to review the draft',
    roles: ['risk_engineer'],
    walkthrough: 'review',
    text: "For each finding, you can:\n- **Accept**: keep it as drafted.\n- **Edit**: keep it in your own words.\n- **Reject**: take it out of the report. You can restore it later from Review history.\n**Bulk accept** accepts every finding you haven't decided yet.",
  },
  // 26. Review: Regenerate
  'review.regenerate': {
    label: 'About regenerating a section',
    roles: ['risk_engineer'],
    text: "This gets you a new draft of the section. Your current draft stays until you accept the new one, and the findings you've accepted or edited are kept word for word.",
  },
  // 27. Review: An "Unsupported" flag
  'review.unsupported': {
    label: 'About Unsupported',
    roles: ['risk_engineer', 'knowledge_admin'],
    walkthrough: 'review',
    text: "No evidence supports this sentence. That can mean:\n- It has no citation.\n- Its source can't be found.\n- It rests only on a past report.\nAccepting it doesn't clear the flag. You can reject it, or fix it in the document.",
  },
  // 28. Review: Evidence panel heading
  'review.evidence': {
    label: 'About the evidence panel',
    roles: ['risk_engineer', 'knowledge_admin'],
    text: 'This panel has 4 lists:\n- **Reference sources**: the standards and past reports that were used.\n- **Original observations**: what you recorded on site.\n- **Claims**: each finding and what it cites.\n- **Review history**: every decision, with who made it and when.',
  },
  // 29. Review: Section 3: Risk Assessment Matrix
  'review.ofi-matrix': {
    label: 'About the Risk Assessment Matrix',
    roles: ['risk_engineer', 'knowledge_admin'],
    walkthrough: 'review-ofi',
    text: 'The priority of an Opportunity for Improvement comes from its likelihood and its consequence on this matrix. AI never chooses it.',
  },
  // 30. Review: Section 4: "Provisional weights" badge
  'review.provisional-weights': {
    label: 'About provisional weights',
    roles: ['risk_engineer', 'knowledge_admin'],
    text: "Every category counts equally for now. Marsh's own weights will replace these when they arrive.",
  },
  // 31. Review: Section 4 and 5: Propose figures
  'review.propose-figures': {
    label: 'About proposing figures',
    roles: ['risk_engineer'],
    walkthrough: 'review-scores',
    text: 'This suggests figures from your observations and the drafted sections, and shows them in violet. Nothing is calculated until you confirm them.',
  },
  // 32. Review: Section 2: Executive Summary heading
  'review.executive-summary': {
    label: 'About the Executive Summary',
    roles: ['risk_engineer', 'knowledge_admin'],
    text: "This is drafted last, from the other sections. There's nothing to accept here: you can redraft it, or edit it in the document.",
  },
  // 33. Ask: Beside the line that says what is searched
  'ask.searches': {
    label: 'What a question searches',
    roles: ['risk_engineer', 'knowledge_admin'],
    walkthrough: 'ask',
    text: "A question searches 3 places:\n- This assessment's observations.\n- The standards on its checklist.\n- Past reports for similar sites.\nEach question is answered on its own. You can ask 10 a minute and 200 a day.",
  },
  // 34. Ask: Confidence bars on an answer
  'ask.confidence': {
    label: 'About the confidence bars',
    roles: ['risk_engineer', 'knowledge_admin'],
    text: 'The bars show how much evidence supports the answer. They are counted, not guessed.',
  },
  // 35. Ask: Draft text
  'ask.draft-text': {
    label: 'About drafting text',
    roles: ['risk_engineer'],
    text: "This drafts a paragraph for the section you have open, from the observations. It can cite the standards on this assessment's checklist, but never a past report.",
  },
  // 36. Document editor: Save status
  'document.save-status': {
    label: 'About saving',
    roles: ['risk_engineer'],
    walkthrough: 'document',
    text: 'Your changes are saved whenever you pause. Each save is a version you can restore from Version history.',
  },
  // 37. Document editor: Comment tool
  'document.comment': {
    label: 'About comments',
    roles: ['risk_engineer', 'knowledge_admin'],
    text: 'Select some text, and then press **Comment**. Comments sit beside the text, and they are never exported.',
  },
  // 38. Version history: Restore this version
  'versions.restore': {
    label: 'About restoring a version',
    roles: ['risk_engineer'],
    walkthrough: 'versions',
    text: 'Restoring saves the old text as a new version. The text it replaces stays in the history, so nothing is lost.',
  },
  // 39. Export: "Left to finish" card
  'export.left-to-finish': {
    label: 'What is left to finish',
    roles: ['risk_engineer', 'knowledge_admin'],
    walkthrough: 'export',
    text: 'A report can be exported once all of this is true:\n- Every section is written.\n- The scores and loss figures are entered.\n- At least 1 Opportunity for Improvement is accepted.\n- Every finding is decided.\n- Nothing is unsupported, out of date or citing a withdrawn source.',
  },
  // 40. Inbox: Title
  'inbox.title': {
    label: 'About your Inbox',
    roles: ['risk_engineer', 'knowledge_admin'],
    walkthrough: 'inbox',
    text: "Your Inbox is for work that needs you. The bell is for updates that don't need you to do anything.",
  },
  // 41. Client page: Documents: Tag column heading
  'client.documents-tag': {
    label: 'About tags',
    roles: ['risk_engineer', 'knowledge_admin'],
    text: 'A tag shows what a file belongs to: the whole client, one site or one assessment. Files here are stored, not read by AI.',
  },
  // 42. Client page: Insights: Summary card
  'client.insights-summary': {
    label: 'About the summary',
    roles: ['risk_engineer', 'knowledge_admin'],
    walkthrough: 'insights',
    text: "The summary is written by AI, and only when you ask for it. It uses your observations, accepted Opportunities for Improvement and ratings, with the client's details hidden first. Each statement is checked and shows its source, and the summary is never added to a report.",
  },
  // 43. MarshBot chat: A citation marked "!"
  'chat.citation-unverified': {
    label: 'About a citation marked with !',
    roles: ['risk_engineer', 'knowledge_admin'],
    walkthrough: 'chat',
    text: "These exact words weren't found on the page. Please check the source before you rely on the statement.",
  },
  // 44. Usage and Costs: Total estimated cost
  'usage.total-cost': {
    label: 'About the estimated cost',
    roles: ['risk_engineer', 'knowledge_admin'],
    text: 'Each AI call is priced at the rate that applied when it was made. "Calls without cost" are the calls whose price couldn\'t be calculated.',
  },
  // 45. Settings: Walkthroughs: Practice assessment
  'settings.practice': {
    label: 'About the practice assessment',
    roles: ['risk_engineer', 'knowledge_admin'],
    text: "It's a made-up assessment for trying things out, so nothing you do in it touches your real work. Press **Reset** to start it again from the beginning, or **Remove** to take it off your list.",
  },
  // 46. Knowledge base: Status filter
  'knowledge.status': {
    label: 'About document statuses',
    roles: ['risk_engineer', 'knowledge_admin'],
    walkthrough: 'kb-admin',
    text: "A document can have 4 statuses:\n- **Active**: it's used for drafting and chat.\n- **Needs review**: a detail is unconfirmed, or it matches another document.\n- **Withdrawn**: it's kept, but not used.\n- **Draft**: it's a manual entry that isn't finished yet.",
  },
  // 47. Knowledge base: Details: Tier
  'knowledge.tier': {
    label: 'About tiers',
    roles: ['knowledge_admin'],
    text: 'When 2 sources disagree, the one in the higher tier wins. You can set the order in **Settings → Source priority**.',
  },
  // 48. Add documents: Upload panel
  'knowledge-add.upload': {
    label: 'About adding documents',
    roles: ['knowledge_admin'],
    walkthrough: 'kb-add',
    text: "You don't need to fill in anything. The title, edition, country and facility type are read from the file. Anything that can't be confirmed comes back as Unconfirmed for you to fill in.",
  },
  // 49. Add documents: Recent uploads: Status heading
  'knowledge-add.status': {
    label: 'About upload statuses',
    roles: ['knowledge_admin'],
    walkthrough: 'kb-add',
    text: "An upload moves through these statuses:\n- **Queued**: it's waiting its turn.\n- **Parsing**, **Chunking**, **Indexing**: it's being read.\n- **Complete**: it's ready to use.\n- **Type needed**: choose its source type to start.\n- **Failed**: read the reason, and then press **Retry**.",
  },
  // 50. Review document: Decision panel
  'knowledge-review.decision': {
    label: 'About your choices',
    roles: ['knowledge_admin'],
    walkthrough: 'kb-review',
    text: 'You have 4 choices:\n- **Keep both**: both documents stay in use.\n- **Replace stored edition**: the one we have is withdrawn.\n- **Keep as older edition**: this one is withdrawn.\n- **Delete**: the file and its passages are removed for good.',
  },
  // 51. Manual entry: Publish (greyed)
  'knowledge-manual.publish': {
    label: 'About Publish',
    roles: ['knowledge_admin'],
    text: 'Every clause needs to be checked and searchable before you can publish the standard.',
  },
  // 52. View passages: Words | Meaning
  'knowledge-passages.search': {
    label: 'About Words and Meaning',
    roles: ['risk_engineer', 'knowledge_admin'],
    text: 'You can search in 2 ways. **Words** finds the exact text. **Meaning** finds passages about the same thing, and it searches when you press Enter.',
  },
  // 53. User accounts: Role column heading
  'accounts.role': {
    label: 'About roles',
    roles: ['knowledge_admin'],
    walkthrough: 'accounts',
    text: 'There are 2 roles:\n- **Risk engineer**: works on their own assessments and reads the knowledge base.\n- **Knowledge admin**: does all of that, sees every assessment and can reassign them, and manages the knowledge base, accounts and settings for everyone.',
  },
  // 54. Settings: Models: Section heading
  'settings.models': {
    label: 'About models',
    roles: ['knowledge_admin'],
    text: "This chooses the AI model for each task, for everyone. A change applies from the next call. The light shows whether an API key is set, but it doesn't test that the key works.",
  },
} satisfies Record<string, TipDef>

/** The id of any tip, so a misspelt `<Tip id>` fails to compile. */
export type TipId = keyof typeof TIPS
