// MarshBot's message parts as an OpenUI 1.1.0 library (AS-06), under the npm alias
// openui-lang-v1 so the knowledge chatbot can stay on 0.4.1. The wording AI writes a message as
// OpenUI Lang with these parts; props carry only wording and ids, and each part looks its data
// up in the brief (context.ts). Rendered by components/MessageBody.tsx. The rag-service's prompt
// copy, microservices/rag-service/app/assistant/marshbot_components.txt, is made from this file
// (library.test.ts): rename or reorder a part's arguments and that file must change with it.
import { createLibrary, createParser, defineComponent, type ElementNode } from 'openui-lang-v1'
import { z } from 'zod'
import { ActionRow as ActionRowView } from './components/ActionRow'
import { ExportFile as ExportFileView } from './components/ExportFile'
import { HealthBars as HealthBarsView } from './components/HealthBars'
import { PartList } from './components/PartList'
import { LinkButton as LinkButtonView, QuickReplyButton } from './components/QuickReplies'
import { ReportOutline as ReportOutlineView } from './components/ReportOutline'
import { StageTime as StageTimeView } from './components/StageTime'
import { StatusLanes as StatusLanesView } from './components/StatusLanes'
import { Words } from './components/Words'
import type { BriefMessage } from './types'

// Descriptions are written "use when …", the way the model reads them best (spec, OpenUI notes).
const Say = defineComponent({
  name: 'Say',
  description:
    "A paragraph of MarshBot's words. Use for the friendly sentences between parts. Wrap a name in **…** to show it bold.",
  props: z.object({ text: z.string() }),
  component: ({ props }) => <Words text={props.text} />,
})

const ActionRow = defineComponent({
  name: 'ActionRow',
  description:
    'One item as a row with its icon, details and action. Use when the message points at an item. The id is an item id you were given.',
  props: z.object({ id: z.string() }),
  component: ({ props }) => <ActionRowView id={props.id} />,
})

const HealthBars = defineComponent({
  name: 'HealthBars',
  description:
    'Checklist coverage bars for the listed areas, or every area when none are given. Use when the message is about what the observations cover.',
  props: z.object({ areas: z.array(z.string()).optional() }),
  component: ({ props }) => <HealthBarsView areas={props.areas} />,
})

const ReportOutline = defineComponent({
  name: 'ReportOutline',
  description:
    "The report's sections with their review state. Use when the message is about the report's progress.",
  props: z.object({}),
  component: () => <ReportOutlineView />,
})

const StatusLanes = defineComponent({
  name: 'StatusLanes',
  description: "The report's sections in lanes by review state. Use for an admin's overview.",
  props: z.object({}),
  component: () => <StatusLanesView />,
})

const StageTime = defineComponent({
  name: 'StageTime',
  description: 'The days spent in each stage so far. Use for an admin overview.',
  props: z.object({}),
  component: () => <StageTimeView />,
})

const ExportFile = defineComponent({
  name: 'ExportFile',
  description: 'The exported report file with its date. Use after an export.',
  props: z.object({}),
  component: () => <ExportFileView />,
})

const QuickReply = defineComponent({
  name: 'QuickReply',
  description:
    'A button the engineer presses to answer MarshBot. Use for each reply you were given. The id is a reply id you were given.',
  props: z.object({ id: z.string() }),
  component: ({ props }) => <QuickReplyButton id={props.id} />,
})

const LinkButton = defineComponent({
  name: 'LinkButton',
  description:
    'A button that opens a place in the workspace. Use for each link you were given. The id is a link key you were given ("link-0").',
  props: z.object({ label: z.string(), id: z.string() }),
  component: ({ props }) => <LinkButtonView label={props.label} id={props.id} />,
})

const PARTS = [
  Say,
  ActionRow,
  HealthBars,
  ReportOutline,
  StatusLanes,
  StageTime,
  ExportFile,
  QuickReply,
  LinkButton,
]

const Reply = defineComponent({
  name: 'Reply',
  description: 'The whole message: its parts in order, one per line.',
  props: z.object({
    children: z.array(
      z.union([
        Say.ref,
        ActionRow.ref,
        HealthBars.ref,
        ReportOutline.ref,
        StatusLanes.ref,
        StageTime.ref,
        ExportFile.ref,
        QuickReply.ref,
        LinkButton.ref,
      ]),
    ),
  }),
  component: ({ props, renderNode }) => (
    <PartList
      parts={(props.children as ElementNode[]).map((node, i) => ({
        type: node.typeName,
        key: String(i),
        view: renderNode(node),
      }))}
    />
  ),
})

/** The MarshBot message library: Reply and its parts. */
export const marshbotLibrary = createLibrary({ components: [Reply, ...PARTS], root: 'Reply' })

/** Returns the components prompt the wording model sees (rag-service marshbot_components.txt). */
export function marshbotPrompt() {
  return marshbotLibrary.prompt({
    preamble:
      "You write MarshBot's messages in OpenUI Lang. MarshBot is a friendly assistant inside a risk engineer's assessment. You only reword and order what you are given.",
    additionalRules: [
      'Write `root = Reply([...])` first, then one part per line.',
      'Refer to items, replies and links only by the ids you were given.',
      'Never write a number, name, date or status that is not in the text you were given.',
      'Use at most 8 parts and keep each Say under 60 words.',
      'Vary which part leads; never repeat the same part type twice in a row except ActionRow, QuickReply and LinkButton.',
    ],
    examples: [
      'root = Reply([s1, a1, a2, s2, q1])\ns1 = Say("Your morning walk is ready, and one recording from **Loading Bay 2** didn\'t come through.")\na1 = ActionRow("capture.walk-ready:w1")\na2 = ActionRow("capture.failed-transcription:o1:r1")\ns2 = Say("A retry usually sorts that out.")\nq1 = LinkButton("Add observation", "link-2")',
      'root = Reply([h1, s1, l1])\nh1 = HealthBars(["Fire Protection"])\ns1 = Say("**Fire Protection** is still thin, so cover it before you leave if you can.")\nl1 = LinkButton("Open the checklist", "link-1")',
      'root = Reply([s1, f1, s2, r1, r2])\ns1 = Say("Nice work. The report went out on **9 Dec 2026**.")\nf1 = ExportFile()\ns2 = Say("You changed a section since then. Want to export the newer one?")\nr1 = QuickReply("export-again")\nr2 = QuickReply("not-now")',
    ],
  })
}

const parser = createParser(marshbotLibrary.toJSONSchema(), 'Reply')

/** Returns the program's top-level parts, or null when it is missing or doesn't parse cleanly.
    The gateway already refused programs with unknown ids or missing controls
    (server/src/services/assistant/wording.service.ts); a part whose id is unknown here draws nothing. */
export function programParts(message: BriefMessage): ElementNode[] | null {
  if (!message.program) return null
  let result
  try {
    result = parser.parse(message.program)
  } catch {
    return null
  }
  const root = result.root
  if (
    !root ||
    root.typeName !== 'Reply' ||
    result.meta.errors.length ||
    result.meta.unresolved.length
  )
    return null
  const children = root.props.children
  if (!Array.isArray(children) || !children.length) return null
  return children as ElementNode[]
}
