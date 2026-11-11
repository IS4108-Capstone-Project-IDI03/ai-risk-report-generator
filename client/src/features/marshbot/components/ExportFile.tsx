// The report as it went out (AS-06 board 03): file tile, name, when and how many pages, and a
// download icon. The export isn't stored, so download opens the Export tab, which makes the
// file again. Rendered by the ExportFile part (library.tsx).
import { FileTile, IconButton } from '../../../design-system'
import { formatDayYearTime } from '../../assessments/format'
import { useMarshBot } from '../context'

/** Returns the exported file's row; nothing before the first export. */
export function ExportFile() {
  const bot = useMarshBot()
  const file = bot.brief.export
  if (!file) return null
  const when = formatDayYearTime(new Date(file.exportedAt))
  return (
    <div className="mb-panel mb-panel--white">
      <div className="mb-row-inner">
        <FileTile name={file.fileName} />
        <span className="mb-row-text">
          <span className="mb-row-title">{file.fileName}</span>
          <span className="mb-row-detail">
            {`Exported ${when}${file.pages ? ` · ${file.pages} pages` : ''}`}
          </span>
        </span>
        <IconButton
          icon="download"
          label={`Download ${file.fileName} from Export`}
          tooltip="Download"
          size="lg"
          className="mb-row-icon"
          onClick={() => bot.openLink({ tab: 'export' })}
        />
      </div>
    </div>
  )
}
