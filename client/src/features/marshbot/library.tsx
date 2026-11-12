// A MarshBot turn as an OpenUI 1.1.0 library (AS-06), under the npm alias openui-lang-v1 so the
// knowledge chatbot can stay on 0.4.1. The wording AI may write a bot turn as OpenUI Lang with
// exactly three components: Reply, Say and Card. Only the words are its own; every card of the
// turn is drawn once, by id, from the turn (context.ts). Rendered by components/thread/TurnBody.tsx.
// The rag-service's prompt copy, microservices/rag-service/app/assistant/marshbot_components.txt,
// is made from this file (library.test.ts): rename or reorder an argument and it must change too.
import { createLibrary, createParser, defineComponent, type ElementNode } from 'openui-lang-v1'
import { z } from 'zod'
import { Bubble } from './components/thread/Bubble'
import { CardById } from './components/thread/CardView'
import { SlotContext } from './context'
import type { Turn } from './types'

// Descriptions are written "use when …", the way the model reads them best (spec, OpenUI notes).
const Say = defineComponent({
  name: 'Say',
  description:
    'One speech bubble of MarshBot\'s words. Use for each friendly sentence or two. Wrap a name in **…** to show it bold. Pass "good" as the tone only for a bubble you were told is good news.',
  props: z.object({ text: z.string(), tone: z.enum(['normal', 'good']).optional() }),
  component: ({ props }) => <Bubble text={props.text} tone={props.tone ?? 'normal'} />,
})

const Card = defineComponent({
  name: 'Card',
  description:
    'One of the cards you were given, by its id. Use once for every card id, after the words that introduce it.',
  props: z.object({ id: z.string() }),
  component: ({ props }) => <CardById id={props.id} />,
})

const Reply = defineComponent({
  name: 'Reply',
  description: "The whole turn: MarshBot's bubbles and cards in order, one per line.",
  props: z.object({ children: z.array(z.union([Say.ref, Card.ref])) }),
  component: ({ props, renderNode }) => {
    const children = props.children as ElementNode[]
    const tail = children.findIndex((n) => n.typeName === 'Say')
    // Its own column: OpenUI wraps the whole program in a plain div (thread.css .mbt-flow).
    return (
      <div className="mbt-flow">
        {children.map((node, i) => (
          <SlotContext.Provider key={i} value={{ index: i, tail: i === tail }}>
            {renderNode(node)}
          </SlotContext.Provider>
        ))}
      </div>
    )
  },
})

/** The MarshBot turn library: Reply, Say and Card. */
export const marshbotLibrary = createLibrary({ components: [Reply, Say, Card], root: 'Reply' })

/** Returns the components prompt the wording model sees (rag-service marshbot_components.txt). */
export function marshbotPrompt() {
  return marshbotLibrary.prompt({
    preamble:
      "You write one of MarshBot's turns in OpenUI Lang. MarshBot is a friendly assistant inside a risk engineer's assessment. You only reword and order what you are given.",
    additionalRules: [
      'Write `root = Reply([...])` first, then one Say or Card per line.',
      'Draw every card id you were given exactly once with Card("<card id>"), and no other.',
      'Never write a number, name, date or status that is not in the words you were given.',
      'Keep each Say under 60 words; use digits for numbers.',
    ],
    examples: [
      'root = Reply([s1, s2, c1])\ns1 = Say("Good morning, Alex! Pasir Gudang is in the Capture stage, and you already have 18 observations in.")\ns2 = Say("Before we look at the report, there are 2 things I need you to sort out first.")\nc1 = Card("todo")',
      'root = Reply([s1, s2, c1])\ns1 = Say("Nice work, Alex! Both are sorted.", "good")\ns2 = Say("Only **Fire Protection** still needs more before you leave.")\nc1 = Card("checklist")',
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
