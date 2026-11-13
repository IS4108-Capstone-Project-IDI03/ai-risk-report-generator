// A MarshBot turn as an OpenUI 1.1.0 library (AS-06), under the npm alias openui-lang-v1 so the
// knowledge chatbot can stay on 0.4.1. The rules set the FORM of a turn (which line leads, which
// items are ticked, which message stands out); the wording AI rewords each piece as the same
// kind of component (Lead, Say, Ticks, Alert) and places each card (Card). The gateway checks
// every number and name in the words; each card is drawn once, by id, from the turn (context.ts).
// Rendered by components/thread/TurnBody.tsx.
// The rag-service's prompt copy, microservices/rag-service/app/assistant/marshbot_components.txt,
// is made from this file (library.test.ts): rename or reorder an argument and it must change too.
// The component names and choices must match server/src/services/assistant/wording.service.ts.
import { createLibrary, createParser, defineComponent, type ElementNode } from 'openui-lang-v1'
import { z } from 'zod'
import { Alert as AlertBubble } from './components/thread/Alert'
import { LeadLine, TickList, Words } from './components/thread/Bubble'
import { CardById } from './components/thread/CardView'
import { Flow, type PieceKind } from './components/thread/Flow'
import type { Turn } from './types'

// Descriptions are written "use when …", the way the model reads them best (spec, OpenUI notes).
const Lead = defineComponent({
  name: 'Lead',
  description:
    'The bold first line of the message: the one thing the engineer must not miss. Use only for words you were given as the lead line, and keep it to one sentence.',
  props: z.object({ text: z.string() }),
  component: ({ props }) => <LeadLine text={props.text} />,
})

const Say = defineComponent({
  name: 'Say',
  description:
    'MarshBot\'s words: a friendly sentence or two. Words that follow each other share one speech bubble. Wrap a name in **…** to show it bold. Pass "good" as the tone only for words you were told are good news.',
  props: z.object({ text: z.string(), tone: z.enum(['normal', 'good']).optional() }),
  component: ({ props }) => <Words text={props.text} />,
})

const Ticks = defineComponent({
  name: 'Ticks',
  description:
    'A list of things already sorted, each drawn with a tick. Use only for the ticked items you were given: one item each, in the same order.',
  props: z.object({ items: z.array(z.string()) }),
  component: ({ props }) => <TickList items={props.items} />,
})

const Alert = defineComponent({
  name: 'Alert',
  description:
    'A message that stands out, for something urgent such as a report past its due date. Use only for words you were given as a stand-out message.',
  props: z.object({ text: z.string() }),
  component: ({ props }) => <AlertBubble text={props.text} />,
})

const Card = defineComponent({
  name: 'Card',
  description:
    'One of the cards you were given, by its id. Use once for every card id, after the words that introduce it.',
  props: z.object({ id: z.string() }),
  component: ({ props }) => <CardById id={props.id} />,
})

// Lead, plain Say and Ticks share one white bubble (green for good news); an alert has its own
// bubble and a card stands alone.
const kindOf = (node: ElementNode): PieceKind =>
  node.typeName === 'Card'
    ? 'alone'
    : node.typeName === 'Alert'
      ? 'alert'
      : node.typeName === 'Say' && node.props.tone === 'good'
        ? 'good'
        : 'normal'

const Reply = defineComponent({
  name: 'Reply',
  description: "The whole turn: MarshBot's words and cards in order, one per line.",
  props: z.object({
    children: z.array(z.union([Lead.ref, Say.ref, Ticks.ref, Alert.ref, Card.ref])),
  }),
  // Its own column: OpenUI wraps the whole program in a plain div (thread.css .mbt-flow).
  component: ({ props, renderNode }) => (
    <Flow pieces={props.children as ElementNode[]} kindOf={kindOf} draw={(n) => renderNode(n)} />
  ),
})

/** The MarshBot turn library: Reply, Lead, Say, Ticks, Alert and Card. */
export const marshbotLibrary = createLibrary({
  components: [Reply, Lead, Say, Ticks, Alert, Card],
  root: 'Reply',
})

/** Returns the components prompt the wording model sees (rag-service marshbot_components.txt). */
export function marshbotPrompt() {
  return marshbotLibrary.prompt({
    preamble:
      "You write one of MarshBot's turns in OpenUI Lang. MarshBot is a friendly assistant inside a risk engineer's assessment. The form of the turn is already set: you only reword what you are given, piece for piece.",
    additionalRules: [
      'Write `root = Reply([...])` first, then one component per line.',
      'Write one component for each piece you were given, of the same kind and in the same order. Never add, drop, merge or split a piece.',
      'Draw every card id you were given exactly once with Card("<card id>"), and no other.',
      'Never write a number, name, date or status that is not in the words you were given.',
      'Keep each Say under 60 words; use digits for numbers.',
    ],
    examples: [
      'root = Reply([s1])\ns1 = Say("Good morning, Alex! **Pasir Gudang Cold Store** is in the Capture stage, and you already have 18 observations in. Just so you know, the report is due in 5 days.")',
      'root = Reply([l1, s1, c1])\nl1 = Lead("Before we look at the report, there are 2 things I need you to sort out first.")\ns1 = Say("Your morning walk is ready to review, and a recording from **Loading Bay 2** needs another try.")\nc1 = Card("todo")',
      'root = Reply([s1])\ns1 = Say("Nice work, Alex! Both are sorted.", "good")',
      'root = Reply([s1, t1, a1])\ns1 = Say("Good morning, Alex! Here is what has changed since yesterday.")\nt1 = Ticks(["The morning walk is sorted", "The **Loading Bay 2** recording is sorted", "You added 3 more observations"])\na1 = Alert("The report is 2 days overdue, so let\'s keep it moving.")',
    ],
  })
}

const parser = createParser(marshbotLibrary.toJSONSchema(), 'Reply')

/** Returns the ids of the cards the turn's program draws, in order, when it parses cleanly and
    names no card twice; else null (the turn then draws its says, then its cards). */
export function programCards(turn: Turn): string[] | null {
  if (!turn.program) return null
  let result
  try {
    result = parser.parse(turn.program)
  } catch {
    return null
  }
  const root = result.root
  if (!root || root.typeName !== 'Reply' || result.meta.errors.length) return null
  if (result.meta.unresolved.length) return null
  const children = root.props.children
  if (!Array.isArray(children) || !children.length) return null
  const drawn = (children as ElementNode[])
    .filter((n) => n.typeName === 'Card')
    .map((n) => String(n.props.id))
  // A card named twice would double its rows.
  return new Set(drawn).size === drawn.length ? drawn : null
}
