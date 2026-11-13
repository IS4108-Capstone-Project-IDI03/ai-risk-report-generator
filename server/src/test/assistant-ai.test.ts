// MarshBot's AI calls (AS-06): the wording AI's program for a turn is kept only
// when it draws every card of the turn once and adds no number or name, and
// the coverage check runs in the background, its failure said once without
// breaking the conversation (AC 7).
// rag-service is faked (assistant-fixtures.ts); nothing leaves the machine.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AiCallModel } from '../models/ai-call.model'
import { settleBackground } from '../services/assistant/background'
import { AssessmentModel } from '../models/assessment.model'
import { AssistantBriefModel } from '../models/assistant-brief.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { onBriefChanged } from '../services/assistant/bus'
import { coverageWhenDue } from '../services/assistant/coverage.service'
import { COVERAGE_FAILED } from '../services/assistant/thread/topics-capture'
import type { AssistantThread, Turn } from '../services/assistant/types'
import { checkedProgram, MARSHBOT_COMPONENTS } from '../services/assistant/wording.service'
import { drainInlineJobs } from '../services/job-queue.service'
import { signedInAs } from './auth-test-helpers'
import {
  assessment,
  checklist,
  observation,
  people,
  rag,
  REF,
  session,
  stubRag,
} from './assistant-fixtures'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

const url = `/api/assessments/${REF}/assistant`
const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const thread = (res: { body: unknown }) => res.body as AssistantThread
const coverageOf = async () =>
  (await AssistantBriefModel.findOne({ reference: REF }).lean())!.coverage

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-14T02:00:00Z'))
  stubRag()
})
afterEach(async () => {
  await drainInlineJobs()
  await settleBackground()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('checking a wording program', () => {
  const turn = {
    id: 's1-2',
    who: 'bot',
    at: '2026-11-14T02:00:00.000Z',
    topic: 'todo',
    mood: 'concerned',
    says: [
      { text: 'There are 2 things I need you to sort out first.', tone: 'normal' },
      { text: "A recording from Loading Bay 2 couldn't be transcribed.", tone: 'normal' },
    ],
    cards: [{ id: 's1-2-todo' }, { id: 's1-2-thin' }],
    program: null,
  } as unknown as Turn
  const program = (words: string, cards = 'b, c') =>
    `root = Reply([a, ${cards}])\na = Say("${words}")\nb = Card("s1-2-todo")\nc = Card("s1-2-thin")`

  it('keeps a program that rewords the turn and draws each card once', () => {
    const ok = program(
      'Loading Bay 2 has a recording that needs another try, and there are 2 things to sort.',
    )
    expect(checkedProgram(ok, turn)).toBe(ok)
    // Two plain says may be worded as one Say, or as three.
    const three = program('There are 2 things to sort.', 'b, c').replace(
      'a = Say(',
      'x = Say("Loading Bay 2.")\ny = Say("Hello.")\na = Say(',
    )
    expect(checkedProgram(three.replace('[a, b, c]', '[a, x, y, b, c]'), turn)).not.toBeNull()
    // Turning a normal turn green is a change of format: dropped.
    const green =
      'root = Reply([a, b, c])\na = Say("Nice work.", "good")\nb = Card("s1-2-todo")\nc = Card("s1-2-thin")'
    expect(checkedProgram(green, turn)).toBeNull()
    // On a turn whose says are good, the same program is kept.
    const goodTurn = { ...turn, says: [{ text: 'Nice work.', tone: 'good' }] } as unknown as Turn
    expect(checkedProgram(green, goodTurn)).toBe(green)
  })

  it('drops a program with an unknown component, root or card, a left-out card, or a card twice', () => {
    expect(checkedProgram('root = Reply([a])\na = Table("x")', turn)).toBeNull()
    expect(checkedProgram('a = Say("Hello")', turn)).toBeNull()
    expect(checkedProgram(program('Hello.', 'b'), turn)).toBeNull()
    expect(checkedProgram(program('Hello.', 'b, b, c'), turn)).toBeNull()
    expect(checkedProgram(program('Hello.').replace('s1-2-thin', 's1-2-x'), turn)).toBeNull()
    // Defined but not reachable from root: OpenUI would never draw it.
    expect(checkedProgram(program('Hello.', 'b') + '\nd = Reply([c])', turn)).toBeNull()
    // A Say's tone may only be "good".
    expect(
      checkedProgram(program('Hello.').replace('Say("Hello.")', 'Say("Hello.", "red")'), turn),
    ).toBeNull()
  })

  it("drops a program with a string JSON can't read, without throwing (#43)", () => {
    expect(checkedProgram(program("It\\'s Loading Bay 2."), turn)).toBeNull()
  })

  it("names the same components as rag-service's prompt", () => {
    const prompt = readFileSync(
      resolve(
        __dirname,
        '../../../microservices/rag-service/app/assistant/marshbot_components.txt',
      ),
      'utf8',
    )
    const signatures = prompt.split('## Component Signatures')[1].split('\n## ')[0]
    expect([...signatures.matchAll(/^([A-Z]\w*)\(/gm)].map((m) => m[1]).sort()).toEqual(
      [...MARSHBOT_COMPONENTS].sort(),
    )
  })

  it("drops a program with a number or a name the turn's words never said (#51)", () => {
    expect(checkedProgram(program('3 recordings from Loading Bay 2 failed.'), turn)).toBeNull()
    const names = ['Fire Protection', 'Loading Bay 2']
    expect(checkedProgram(program('Fire Protection needs 2 things.'), turn, names)).toBeNull()
    const ok = program('Loading Bay 2 needs 2 things from you.')
    expect(checkedProgram(ok, turn, names)).toBe(ok)
    // A name the turn says can't be dropped: a reworded catch-up can't change what it names.
    expect(checkedProgram(program('There are 2 things to sort first.'), turn, names)).toBeNull()
  })

  // The rules pick the form of each piece (lead, ticks, alert, green); the AI only rewords.
  describe('keeping the format the rules picked', () => {
    const kit = (lines: string[]) =>
      [
        `root = Reply([${lines.map((_, n) => `p${n}`).join(', ')}, b, c])`,
        ...lines.map((line, n) => `p${n} = ${line}`),
        'b = Card("s1-2-todo")',
        'c = Card("s1-2-thin")',
      ].join('\n')
    // A turn whose says have the tones lead, normal, tick, tick and alert.
    const formed = {
      ...turn,
      says: [
        { text: '2 things to sort out first.', tone: 'lead' },
        { text: 'A recording from Loading Bay 2 needs another try.', tone: 'normal' },
        { text: 'The walk is sorted', tone: 'tick' },
        { text: 'The recording is sorted', tone: 'tick' },
        { text: 'The report is 3 days overdue.', tone: 'alert' },
      ],
    } as unknown as Turn
    const same = [
      'Lead("2 things to sort out first.")',
      'Say("Loading Bay 2 needs another try.")',
      'Ticks(["The walk is sorted", "The recording is sorted"])',
      'Alert("The report is 3 days overdue.")',
    ]
    const without = (n: number) => same.filter((_, i) => i !== n)

    it('keeps a Lead, Say, Ticks and Alert program on a turn whose says have those tones', () => {
      const ok = kit(same)
      expect(checkedProgram(ok, formed)).toBe(ok)
    })

    it('drops a program that adds a Lead, Ticks or Alert the rules did not write', () => {
      expect(checkedProgram(kit(['Lead("Sort these.")', 'Say("Hello.")']), turn)).toBeNull()
      expect(checkedProgram(kit(['Say("Hello.")', 'Ticks(["The walk"])']), turn)).toBeNull()
      expect(checkedProgram(kit(['Say("Hello.")', 'Alert("Late.")']), turn)).toBeNull()
    })

    it('drops a program that leaves out a Lead, Ticks or Alert the rules wrote', () => {
      expect(checkedProgram(kit(without(0)), formed)).toBeNull()
      expect(checkedProgram(kit(without(2)), formed)).toBeNull()
      expect(checkedProgram(kit(without(3)), formed)).toBeNull()
    })

    it('drops a program that changes the number of ticks, or turns a Say green', () => {
      const oneTick = [...same]
      oneTick[2] = 'Ticks(["The walk is sorted"])'
      expect(checkedProgram(kit(oneTick), formed)).toBeNull()
      const green = [...same]
      green[1] = 'Say("Loading Bay 2 needs another try.", "good")'
      expect(checkedProgram(kit(green), formed)).toBeNull()
    })

    it('drops the components the library no longer has, and a number outside a string', () => {
      expect(checkedProgram(kit(['Say("Sort these.")', 'Note("Keep in mind.")']), turn)).toBeNull()
      expect(checkedProgram(kit(['Say("Sort these.")', 'List(["One"], "dots")']), turn)).toBeNull()
      expect(checkedProgram(kit(['Say("Sort these.")', 'Table("x")']), turn)).toBeNull()
      expect(checkedProgram(kit(['Lead(2)', ...same.slice(1)]), formed)).toBeNull()
    })

    it('puts the cards after the words, unless the turn has an order', () => {
      const first =
        'root = Reply([b, c, a])\na = Say("Hello.")\nb = Card("s1-2-todo")\nc = Card("s1-2-thin")'
      expect(checkedProgram(first, turn)).toBeNull()
    })

    it('checks the digits and names in a Lead, an Alert and every tick', () => {
      expect(
        checkedProgram(kit(['Lead("9 things to sort out first.")', ...same.slice(1)]), formed),
      ).toBeNull()
      expect(
        checkedProgram(kit([...same.slice(0, 3), 'Alert("It is 9 days overdue.")']), formed),
      ).toBeNull()
      const names = ['Fire Protection', 'Loading Bay 2']
      const tick = [...same]
      tick[2] = 'Ticks(["The walk is sorted", "Fire Protection is sorted"])'
      expect(checkedProgram(kit(tick), formed, names)).toBeNull()
      // A name the turn says must be said again.
      const dropped = [...same]
      dropped[1] = 'Say("Another try is needed.")'
      expect(checkedProgram(kit(dropped), formed, names)).toBeNull()
      expect(checkedProgram(kit(same), formed, names)).not.toBeNull()
    })
  })

  // Each reworded part is held to the rule words it rewords (the check's per-part rules).
  describe('checking each part against its rule words', () => {
    // A catch-up: a hello, two ticks and the overdue alert, as the rules write them.
    const catchUp = {
      ...turn,
      cards: [],
      says: [
        { text: 'Good morning, Alex! Since Saturday, these are sorted.', tone: 'normal' },
        { text: 'The Morning walk is sorted', tone: 'tick' },
        { text: '2 recordings and 5 observations from Loading Bay 2 are sorted', tone: 'tick' },
        { text: "The report is 3 days overdue, so let's keep it moving.", tone: 'alert' },
      ],
    } as unknown as Turn
    const names = ['Morning walk', 'Loading Bay 2']
    const prog = (hello: string, ticks: [string, string], alert: string) =>
      `root = Reply([a, b, c])\na = Say(${JSON.stringify(hello)})\n` +
      `b = Ticks([${ticks.map((t) => JSON.stringify(t)).join(', ')}])\nc = Alert(${JSON.stringify(alert)})`
    const hello = 'Good morning, Alex! Since Saturday, these are sorted.'
    const tick1 = 'The Morning walk is sorted'
    const tick2 = '2 recordings and 5 observations from Loading Bay 2 are sorted'
    const alert = "The report is 3 days overdue, so let's keep it moving."

    it('keeps a faithful light rewording', () => {
      const ok = prog(
        'Good morning, Alex! Here is what got sorted since Saturday.',
        [
          'The Morning walk is all sorted',
          'Loading Bay 2 now has 2 recordings and 5 observations sorted',
        ],
        "The report is 3 days overdue, so let's keep it moving.",
      )
      expect(checkedProgram(prog(hello, [tick1, tick2], alert), catchUp, names)).not.toBeNull()
      expect(checkedProgram(ok, catchUp, names)).toBe(ok)
    })

    it('drops facts swapped between a tick and the alert', () => {
      const swapped = prog(hello, [alert, tick2], 'The Morning walk is sorted')
      expect(checkedProgram(swapped, catchUp)).toBeNull()
      expect(checkedProgram(swapped, catchUp, names)).toBeNull()
    })

    it('drops a number that was dropped or composed', () => {
      expect(
        checkedProgram(prog(hello, [tick1, tick2], 'The report is overdue.'), catchUp),
      ).toBeNull()
      const composed = '2.5 observations are sorted'
      expect(checkedProgram(prog(hello, [tick1, composed], alert), catchUp)).toBeNull()
      // A comma reads as a decimal in some places, so "2,5" is no better than "2.5".
      const comma = '2,5 observations are sorted'
      expect(checkedProgram(prog(hello, [tick1, comma], alert), catchUp)).toBeNull()
    })

    it('drops a tick mark or a list typed into plain words', () => {
      const typed =
        'root = Reply([a])\na = Say("✓ Loading Bay is sorted\\n✓ Morning walk is sorted")'
      expect(checkedProgram(typed, catchUp)).toBeNull()
      const inHello = prog(`${hello} ✓ Done`, [tick1, tick2], alert)
      expect(checkedProgram(inHello, catchUp, names)).toBeNull()
      const inTick = prog(hello, ['• The Morning walk is sorted', tick2], alert)
      expect(checkedProgram(inTick, catchUp, names)).toBeNull()
    })

    it('drops a bold line, an unclosed bold or a pictograph the rules did not write', () => {
      const fakeLead = prog(
        "**Good morning, Alex! Here's what has changed since Saturday.**",
        [tick1, tick2],
        alert,
      )
      expect(checkedProgram(fakeLead, catchUp, names)).toBeNull()
      const unclosed = prog(`**${hello}`, [tick1, tick2], alert)
      expect(checkedProgram(unclosed, catchUp, names)).toBeNull()
      const warning = prog(hello, [tick1, tick2], `⚠️ ${alert}`)
      expect(checkedProgram(warning, catchUp, names)).toBeNull()
      const cross = prog(hello, [tick1, `${tick2} ✗`], alert)
      expect(checkedProgram(cross, catchUp, names)).toBeNull()
    })

    it('keeps a name in bold, but only a name the rules wrote in that part', () => {
      const bold = prog(
        hello,
        [
          'The **Morning walk** is sorted',
          '2 recordings and 5 observations from Loading Bay 2 are sorted',
        ],
        alert,
      )
      expect(checkedProgram(bold, catchUp, names)).toBe(bold)
      // A place in no list (a failed recording's row has no link) is still a name the rules
      // wrote: the live measure dropped 5 of 28 turns before this was allowed.
      const place = prog(hello, [tick1, tick2.replace('Loading Bay 2', '**Loading Bay 2**')], alert)
      expect(checkedProgram(place, catchUp, ['Morning walk'])).toBe(place)
      const other = prog(hello, ['The Morning walk is **all done**', tick2], alert)
      expect(checkedProgram(other, catchUp, names)).toBeNull()
    })

    it('reads a stage or a month only with its capital letter', () => {
      const own = {
        ...catchUp,
        says: [{ text: 'There are 2 sections for you to look at.', tone: 'normal' }],
      } as unknown as Turn
      const verbs = 'root = Reply([a])\na = Say("You may want to review 2 sections.")'
      expect(checkedProgram(verbs, own)).toBe(verbs)
      const stage = 'root = Reply([a])\na = Say("There are 2 sections in Review.")'
      expect(checkedProgram(stage, own)).toBeNull()
    })

    it('drops a stage, a weekday or a month swapped for another, and keeps the same one', () => {
      const own = {
        ...catchUp,
        says: [
          { text: 'Good morning! Since Tuesday, there is news.', tone: 'normal' },
          { text: "It's moved on to the Capture stage", tone: 'tick' },
          { text: 'The report went out on 14 Nov', tone: 'tick' },
        ],
      } as unknown as Turn
      const call = (hi: string, one: string, two: string) =>
        `root = Reply([a, b])\na = Say(${JSON.stringify(hi)})\n` +
        `b = Ticks([${JSON.stringify(one)}, ${JSON.stringify(two)}])`
      const hi = 'Good morning! Since Tuesday, there is news.'
      const stage = "It's moved on to the Capture stage"
      const sent = 'The report went out on 14 Nov'
      const ok = call('Hello! News since Tuesday.', "It's now in the Capture stage", sent)
      expect(checkedProgram(ok, own)).toBe(ok)
      const review = call(hi, "It's moved on to the Review stage", sent)
      expect(checkedProgram(review, own)).toBeNull()
      expect(
        checkedProgram(call('Good morning! Since Monday, there is news.', stage, sent), own),
      ).toBeNull()
      expect(checkedProgram(call(hi, stage, 'The report went out on 14 Dec'), own)).toBeNull()
    })

    it('binds a number or a name to its own tick', () => {
      // A name moved from tick 2 to tick 1.
      const name = prog(
        hello,
        [
          'The Morning walk and Loading Bay 2 are sorted',
          '2 recordings and 5 observations are sorted',
        ],
        alert,
      )
      expect(checkedProgram(name, catchUp, names)).toBeNull()
      // A number moved from tick 2 to tick 1.
      const number = prog(
        hello,
        [
          'The Morning walk is sorted, with 5 observations',
          '2 recordings from Loading Bay 2 are sorted',
        ],
        alert,
      )
      expect(checkedProgram(number, catchUp, names)).toBeNull()
    })

    it("drops a greeting that changes the viewer's first name or the site", () => {
      const own = {
        ...catchUp,
        says: [
          { text: 'Good morning, Alex! Pasir Gudang Cold Store is in Capture.', tone: 'normal' },
        ],
      } as unknown as Turn
      const call = (words: string) => `root = Reply([a])\na = Say(${JSON.stringify(words)})`
      const who = ['Alex', 'Pasir Gudang Cold Store']
      expect(
        checkedProgram(
          call('Good morning, Sarah! Pasir Gudang Cold Store is in Capture.'),
          own,
          who,
        ),
      ).toBeNull()
      expect(
        checkedProgram(call('Good morning, Alex! Northgate Depot is in Capture.'), own, who),
      ).toBeNull()
      const ok = call('Hi Alex! Pasir Gudang Cold Store is in Capture now.')
      expect(checkedProgram(ok, own, who)).toBe(ok)
      // A missing name is skipped, not matched as an empty word.
      expect(checkedProgram(ok, own, ['', ...who])).toBe(ok)
    })
  })

  it('keeps a bubble that sits between two cards there (round 7, item 24)', () => {
    const between = { ...turn, order: ['say', 'card', 'say', 'card'] as ('say' | 'card')[] }
    const kept = program('There are 2 things to sort.', 'b, d, c') + '\nd = Say("Loading Bay 2.")'
    expect(checkedProgram(kept, between)).toBe(kept)
    // All the words first, then both cards: the second card loses its lead-in.
    const moved = program('There are 2 things to sort.', 'd, b, c') + '\nd = Say("Loading Bay 2.")'
    expect(checkedProgram(moved, between)).toBeNull()
    // The same shape with the two cards swapped puts each card under the other's lead-in (review #7).
    const swapped =
      program('There are 2 things to sort.', 'c, d, b') + '\nd = Say("Loading Bay 2.")'
    expect(checkedProgram(swapped, between)).toBeNull()
    const inline =
      'root = Reply([a, Card("s1-2-todo"), d, Card("s1-2-thin")])\na = Say("There are 2 things to sort.")\nd = Say("Loading Bay 2.")'
    expect(checkedProgram(inline, between)).toBe(inline)
  })
})

describe('wording a turn', () => {
  it('keeps the programs that pass, set once and never changed', async () => {
    const { engineer } = await people()
    const a = await assessment(engineer._id)
    await observation(a._id, (await session(a._id))._id, { failed: true })
    rag.wording = () => {
      const call = rag.calls.filter((c) => c.path === '/assistant/wording').at(-1)!.body as {
        messages: { id: string; parts: { type: string; id?: string }[] }[]
      }
      const [greeting, todo] = call.messages
      const card = todo.parts.find((p) => p.type === 'card')!.id
      return json({
        programs: {
          [greeting.id]: 'root = Reply([a])\na = Say("Good morning, Alex! 99 things.")',
          [todo.id]: `root = Reply([a, b, c])\na = Lead("There is 1 thing to sort out first.")\nb = Say("A recording from Loading Bay 2 needs another try.")\nc = Card("${card}")`,
        },
        usage: [
          {
            feature: 'assistant-wording',
            billed_service: 'anthropic',
            model: 'claude-sonnet-5-5',
            input_tokens: 10,
            output_tokens: 5,
          },
        ],
      })
    }
    const api = signedInAs(app, engineer)

    await api.get(url)
    await settleBackground()
    const t = thread(await api.get(url))
    const [greeting, todo] = t.session.turns
    // 99 was never said: the greeting keeps its template words.
    expect(greeting.program).toBeNull()
    expect(todo.program).toMatch(/^root = Reply\(\[a, b, c\]\)/)
    const sent = rag.calls.find((c) => c.path === '/assistant/wording')!.body as {
      messages: { parts: { type: string }[] }[]
    }
    expect(sent.messages[1].parts.map((p) => p.type)).toEqual(['say', 'say', 'card'])
    // A card goes as its id and kind only, with no title.
    expect(sent.messages[1].parts[2]).toEqual({
      type: 'card',
      id: expect.stringMatching(/-todo$/),
      card: 'tasks',
    })
    expect(await AiCallModel.countDocuments({ feature: 'assistant-wording', reportId: REF })).toBe(
      1,
    )
    // The same turns aren't worded twice.
    await api.get(url)
    await settleBackground()
    expect(rag.calls.filter((c) => c.path === '/assistant/wording')).toHaveLength(1)
  })
})

describe('when the wording fails', () => {
  it('shows the turns in their template words and still pushes (ledger #6)', async () => {
    const { engineer } = await people()
    await assessment(engineer._id)
    rag.wording = () => json({ detail: 'down' }, 502)
    const pushes: string[] = []
    const stop = onBriefChanged(REF, (at) => pushes.push(at))
    const api = signedInAs(app, engineer)
    expect(thread(await api.get(url)).thinking).toBe(true)
    await settleBackground()
    stop()
    // The re-check's push, the new turns' push, and the push once the wording attempt
    // ended, so the open Overview reads again and the dots go.
    expect(pushes.length).toBeGreaterThanOrEqual(3)
    const t = thread(await api.get(url))
    expect(t.thinking).toBe(false)
    expect(t.session.turns.map((x) => [x.topic, x.program])).toEqual([
      ['greeting', null],
      ['setup', null],
      ['question', null],
    ])
  })
})

describe('who pays for wording', () => {
  const wordingCalls = () => rag.calls.filter((c) => c.path === '/assistant/wording')

  it("asks for none when an admin opens someone else's assessment (#16)", async () => {
    const { engineer, admin } = await people()
    await assessment(engineer._id)
    expect((await signedInAs(app, admin).get(url)).status).toBe(200)
    await settleBackground()
    expect(wordingCalls()).toHaveLength(0)
  })

  it('asks once when the engineer opens it twice at the same moment (#44)', async () => {
    const { engineer } = await people()
    await assessment(engineer._id)
    const api = signedInAs(app, engineer)
    await Promise.all([api.get(url), api.get(url)])
    await settleBackground()
    expect(wordingCalls()).toHaveLength(1)
  })
})

describe('the coverage check (AC 7)', () => {
  async function capturing() {
    const { engineer } = await people()
    const a = await assessment(engineer._id)
    const list = await checklist(a._id, engineer._id)
    await observation(a._id, (await session(a._id))._id)
    return { api: signedInAs(app, engineer), itemId: String(list.items[0]._id) }
  }

  it('runs after the conversation is sent, and its failure is said once without breaking it', async () => {
    const { api } = await capturing()
    const first = await api.get(url)
    expect(first.status).toBe(200)
    await settleBackground()
    expect((await coverageOf()).status).toBe('failed')

    const asked = await api.post(`${url}/replies`).send({ replyId: 'what-else' })
    expect(asked.status).toBe(200)
    await settleBackground()
    const t = thread(await api.get(url))
    const failed = t.session.turns.filter((x) => x.says.some((s) => s.text === COVERAGE_FAILED))
    expect(failed).toHaveLength(1)
    expect(t.replies).toEqual([])
    // Not retried within five minutes.
    expect(rag.calls.filter((c) => c.path === '/assistant/coverage')).toHaveLength(1)
  })

  it('runs once the 5 minutes are up when evidence changed in between, while the Overview is open (#5)', async () => {
    const { api } = await capturing()
    await api.get(url)
    await settleBackground()
    const coverageCalls = () => rag.calls.filter((c) => c.path === '/assistant/coverage')
    expect(coverageCalls()).toHaveLength(1)

    // A minute later the evidence changes: held back by the interval, not run.
    vi.setSystemTime(new Date('2026-11-14T02:01:00Z'))
    const [a] = await AssessmentModel.find()
    const [s] = await CaptureSessionModel.find()
    await observation(a._id, s._id)
    await api.get(url)
    await drainInlineJobs()
    await settleBackground()
    expect(coverageCalls()).toHaveLength(1)
    expect(await coverageWhenDue(REF)).toBe(false)

    // The delayed job, once the interval is over, runs it and saves the result.
    vi.setSystemTime(new Date('2026-11-14T02:05:30Z'))
    rag.coverage = () => json({ uncovered: [], thin: [], usage: [] })
    expect(await coverageWhenDue(REF)).toBe(true)
    expect(coverageCalls()).toHaveLength(2)
    expect((await coverageOf()).status).toBe('done')
  })

  it('raises the uncovered checklist items, after the checklist', async () => {
    const { api, itemId } = await capturing()
    rag.coverage = () => json({ uncovered: [itemId, 'not-an-item'], thin: [], usage: [] })
    await api.get(url)
    await settleBackground()

    expect((await coverageOf()).status).toBe('done')
    const items = (await AssistantBriefModel.findOne({ reference: REF }).lean())!.items
    expect(items.find((i) => i.id === 'coverage.uncovered:9')).toMatchObject({
      title: 'Fire Protection',
      detail: '1 checklist item no observation covers',
    })
    await api.post(`${url}/replies`).send({ replyId: 'what-else' })
    await settleBackground()
    const gaps = thread(await api.get(url)).session.turns.at(-1)!
    expect(gaps.topic).toBe('gaps')
    expect(gaps.cards[0]).toMatchObject({
      title: 'Not Covered',
      rows: [{ title: 'Check the sprinkler valves are open.', detail: 'Fire Protection' }],
    })
    const sent = rag.calls.find((c) => c.path === '/assistant/coverage')!.body as {
      observations: unknown[]
      checklist: unknown[]
    }
    expect(sent.checklist).toEqual([
      { id: itemId, area: 'Fire Protection', text: 'Check the sprinkler valves are open.' },
    ])
    expect(sent.observations).toHaveLength(1)
  })
})
