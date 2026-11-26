import { PartBar } from './PartBar'

// The draft editor's frame for a part of the report that is not one of
// sections 3-12 (GN-07): Sections 1 and 2, and Appendix A. Same bar and
// heading as DraftEditor, so moving between parts feels the same, with
// Version history (RV-06) at its end.
export function ReportPart({
  title,
  position,
  onPrevious,
  onNext,
  onHistory,
  action,
  documentAction,
  help,
  children,
}: {
  title: string
  // e.g. "1 of 11": this part among all of the report's.
  position: string
  onPrevious?: () => void
  onNext?: () => void
  onHistory?: () => void
  // Sits at the right of the heading, e.g. Redraft on Section 2 (GN-13).
  action?: React.ReactNode
  // Edit document or Open document, at the bar's right end.
  documentAction?: React.ReactNode
  // A help tip beside the heading (F-13), e.g. on Section 2.
  help?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section aria-label="Draft editor" className="om-scroll rv-editor">
      <div className="rv-editor-inner">
        <PartBar
          title={title}
          position={position}
          onPrevious={onPrevious}
          onNext={onNext}
          onHistory={onHistory}
          help={help}
          action={action}
          documentAction={documentAction}
        />
        {children}
      </div>
    </section>
  )
}
