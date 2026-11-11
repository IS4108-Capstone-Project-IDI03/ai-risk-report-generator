// One MarshBot message's content (AS-06): the wording AI's OpenUI program drawn by OpenUI 1.1.0's
// Renderer with MarshBot's library, or, when there is no program, it doesn't parse, or a part
// throws, the plain words the rules wrote with the same rows and buttons
// (board 18). Called by MessageBubble.tsx. Calls library.tsx and plan.ts.
import { useState } from 'react'
import { Renderer } from 'openui-lang-v1'
import { CursorContext, FailContext, MessageContext, type Cursor } from '../context'
import { marshbotLibrary, programParts } from '../library'
import { plainParts, type PlainPart } from '../plan'
import type { BriefMessage } from '../types'
import { ActionRow } from './ActionRow'
import { ExportFile } from './ExportFile'
import { HealthBars } from './HealthBars'
import { PartList } from './PartList'
import { LinkButton, QuickReplyButton } from './QuickReplies'
import { ReportOutline } from './ReportOutline'
import { StageTime } from './StageTime'
import { StatusLanes } from './StatusLanes'
import { Words } from './Words'

// A plain part as the same view the library's part draws.
function view(p: PlainPart) {
  switch (p.type) {
    case 'Say':
      return <Words text={p.text} />
    case 'ActionRow':
      return <ActionRow id={p.id} />
    case 'QuickReply':
      return <QuickReplyButton id={p.id} />
    case 'LinkButton':
      return <LinkButton label={p.label} id={p.id} />
    case 'HealthBars':
      return <HealthBars areas={p.areas} />
    case 'ReportOutline':
      return <ReportOutline />
    case 'StatusLanes':
      return <StatusLanes />
    case 'StageTime':
      return <StageTime />
    case 'ExportFile':
      return <ExportFile />
  }
}

/** Returns the message's parts, revealed as far as `cursor`. */
export function MessageBody({ message, cursor }: { message: BriefMessage; cursor: Cursor }) {
  // Set once a part throws or OpenUI reports an error: the plain words take over for good.
  const [failed, setFailed] = useState(false)
  const program = !failed && programParts(message) ? message.program : null
  return (
    <MessageContext.Provider value={message}>
      <CursorContext.Provider value={cursor}>
        <FailContext.Provider value={() => setFailed(true)}>
          {program ? (
            <Renderer
              response={program}
              library={marshbotLibrary}
              isStreaming={false}
              onError={(errors) => {
                if (errors.some((e) => e.severity !== 'warning')) {
                  console.warn('MarshBot message fell back to its plain words', errors)
                  setFailed(true)
                }
              }}
            />
          ) : (
            <PartList
              parts={plainParts(message).map((p, i) => ({
                type: p.type,
                key: String(i),
                view: view(p),
              }))}
            />
          )}
        </FailContext.Provider>
      </CursorContext.Provider>
    </MessageContext.Provider>
  )
}
