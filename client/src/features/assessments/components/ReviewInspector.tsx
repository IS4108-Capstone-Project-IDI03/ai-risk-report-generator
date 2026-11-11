import { Button, Dialog, Tabs } from '../../../design-system'
import { AskPanel } from '../ask/AskPanel'
import type { AskItem, AskWorkflow } from '../ask/useAsk'
import { useCompact } from '../useCompact'

export type InspectorTab = 'evidence' | 'ask'

// The Ask tab's part of the inspector (AS-01): the workflow (null without the
// gateway, AC7), why it is unavailable, and what selecting a citation does.
export type InspectorAsk = {
  ask: AskWorkflow | null
  unavailable?: string
  current: string | null
  onCite: (ref: string, item: AskItem) => void
  tab: InspectorTab
  onTab: (tab: InspectorTab) => void
  // The bottom sheet on phones, open or not.
  sheetOpen: boolean
  onSheet: (open: boolean) => void
}

// The review workspace's right inspector: the evidence panel and, beside it,
// the Ask tab (AS-01 AC1). From 760px the two are tabs at the top of the panel,
// which stacks below the draft under 1080px (the workspace's layout); below
// 760px the evidence stays in the panel and Ask opens as a bottom sheet
// (`ds-dialog-sheet`). Without `ask`, it is the evidence panel alone.
export function ReviewInspector({
  label,
  style,
  ask,
  children,
}: {
  label: string
  style: React.CSSProperties
  ask?: InspectorAsk
  children: React.ReactNode
}) {
  const phone = useCompact(759)
  if (!ask)
    return (
      <aside aria-label={label} className="om-scroll" style={style}>
        {children}
      </aside>
    )
  const answers = ask.ask?.items.length ?? 0
  const panel = (sheet: boolean) => (
    <AskPanel
      ask={ask.ask}
      unavailable={ask.unavailable}
      current={ask.current}
      onCite={ask.onCite}
      autoFocus={sheet}
    />
  )
  if (phone)
    return (
      <aside aria-label={label} className="om-scroll" style={style}>
        <div className="rv-inspector-ask">
          <Button
            variant="secondary"
            size="sm"
            iconLeft="message-circle-question"
            fullWidth
            onClick={() => ask.onSheet(true)}
          >
            Ask about this assessment
          </Button>
        </div>
        {children}
        {ask.sheetOpen && (
          <Dialog
            className="ds-dialog-sheet ask-sheet"
            title="Ask about this assessment"
            width={560}
            onClose={() => ask.onSheet(false)}
          >
            {panel(true)}
          </Dialog>
        )}
      </aside>
    )
  return (
    <aside aria-label={label} className="om-scroll" style={style}>
      <div className="rv-inspector-tabs">
        <Tabs
          items={[
            { value: 'evidence', label: 'Evidence', icon: 'book-marked' },
            {
              value: 'ask',
              label: 'Ask',
              icon: 'message-circle-question',
              ...(answers ? { count: answers } : {}),
            },
          ]}
          value={ask.tab}
          onChange={(value) => ask.onTab(value as InspectorTab)}
        />
      </div>
      <div role="tabpanel" aria-label={ask.tab === 'ask' ? 'Ask' : 'Evidence'}>
        {ask.tab === 'ask' ? panel(false) : children}
      </div>
    </aside>
  )
}
