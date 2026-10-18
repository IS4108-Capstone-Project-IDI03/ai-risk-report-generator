// A detail page's usage at the rates charged (EV-04): one table per way of
// billing, so every column applies to every row in it. Each quantity carries
// the rate stored with its calls when they were made, never today's price.
// Used by screens/AssessmentUsageDetail.tsx and screens/DocumentUsageDetail.tsx.
import type { RatePart, RateCell, RateRow } from '../api'
import { DASH, FEATURE_LABELS, formatDuration, formatMoney, formatRate } from '../format'

type Billing = { title: string; services: string[]; parts: [RatePart, string][] }

const TOKENS: [RatePart, string][] = [
  ['input', 'Input tokens'],
  ['output', 'Output tokens'],
]
// In table order. A service in none of them is shown with input and output tokens.
const BILLINGS: Billing[] = [
  {
    title: 'Claude and OpenAI',
    services: ['anthropic', 'openai'],
    parts: [...TOKENS, ['cached input', 'Cached input tokens']],
  },
  {
    title: 'Gemini, labelling and self-hosted models',
    services: ['gemini-vision', 'gemini-ocr', 'openai-label', 'typesafe-jev', 'self-hosted-ocr'],
    parts: TOKENS,
  },
  { title: 'Cohere embeddings', services: ['cohere-embed'], parts: [['input', 'Input tokens']] },
  { title: 'Cohere rerank', services: ['cohere-rerank'], parts: [['searches', 'Searches']] },
  { title: 'OpenAI Whisper', services: ['openai-whisper'], parts: [['audio', 'Audio minutes']] },
]
const billingOf = (service: string) =>
  BILLINGS.find((b) => b.services.includes(service)) ?? BILLINGS[1]

function Quantity({ cell }: { cell: RateCell | undefined }) {
  if (!cell) return <>{DASH}</>
  const amount =
    cell.unit === 'minutes'
      ? cell.quantity.toFixed(1)
      : Math.round(cell.quantity).toLocaleString('en-US')
  return (
    <>
      {amount}
      {cell.usdPer !== null && (
        <span className="uc-rate">@ {formatRate(cell.usdPer, cell.per, cell.unit)}</span>
      )}
      {cell.note && <span className="uc-note">{cell.note}</span>}
    </>
  )
}

function RateTable({
  billing,
  rows,
  showTime,
}: {
  billing: Billing
  rows: RateRow[]
  showTime: boolean
}) {
  const subtotal = rows.reduce((t, r) => t + (r.costUsd ?? 0), 0)
  // Feature, Model, Calls, the quantities and Cost, with Time per call if shown.
  const width = 4 + billing.parts.length + (showTime ? 1 : 0)
  return (
    <div className="uc-table-wrap">
      <table className="uc-table uc-rates">
        <caption>{`${billing.title}: usage and rates`}</caption>
        <thead>
          <tr>
            <th scope="col">Feature</th>
            <th scope="col">Model</th>
            <th scope="col" data-numeric>
              Calls
            </th>
            {billing.parts.map(([part, header]) => (
              <th key={part} scope="col" data-numeric>
                {header}
              </th>
            ))}
            {showTime && (
              <th scope="col" data-numeric>
                Time per call
              </th>
            )}
            <th scope="col" data-numeric>
              Cost
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <th scope="row">{FEATURE_LABELS[r.feature] ?? r.feature}</th>
              <td>
                {r.model}
                {r.note && <span className="uc-note">{r.note}</span>}
              </td>
              <td data-numeric>{r.calls.toLocaleString('en-US')}</td>
              {billing.parts.map(([part]) => (
                <td key={part} data-numeric>
                  <Quantity cell={r.cells[part]} />
                </td>
              ))}
              {showTime && <td data-numeric>{formatDuration(r.avgMsPerCall)}</td>}
              <td data-numeric>{r.costUsd === null ? DASH : formatMoney(r.costUsd)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={width - 1}>
              Subtotal
            </th>
            <td data-numeric>{formatMoney(subtotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

export function RateTables({ rows, showTime = false }: { rows: RateRow[]; showTime?: boolean }) {
  return (
    <>
      {BILLINGS.map((billing) => {
        const own = rows.filter((r) => billingOf(r.service) === billing)
        return own.length ? (
          <RateTable key={billing.title} billing={billing} rows={own} showTime={showTime} />
        ) : null
      })}
    </>
  )
}
