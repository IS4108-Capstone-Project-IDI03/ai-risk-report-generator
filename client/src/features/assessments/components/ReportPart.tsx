import { Button } from '../../../design-system'

// The draft editor's frame for a part of the report that is not one of
// sections 3-12 (GN-07): Sections 1 and 2, and Appendix A. Same bar and
// heading as DraftEditor, so moving between parts feels the same.
export function ReportPart({
  title,
  onPrevious,
  onNext,
  children,
}: {
  title: string
  onPrevious?: () => void
  onNext?: () => void
  children: React.ReactNode
}) {
  return (
    <section aria-label="Draft editor" className="om-scroll rv-editor">
      <div className="rv-editor-inner">
        <div className="rv-editor-bar">
          <p className="rv-label">Draft editor</p>
          <Button
            variant="ghost"
            size="sm"
            iconLeft="chevron-left"
            disabled={!onPrevious}
            onClick={onPrevious}
          >
            Previous
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconRight="chevron-right"
            disabled={!onNext}
            onClick={onNext}
          >
            Next
          </Button>
        </div>
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  )
}
