import { ChevronDown } from 'lucide-react'
import clsx from 'clsx'
import type { RankInfo } from '../lib/types'
import { DIMS, LABELS, WEIGHTS } from '../lib/rank'

const band = (s: number) => (s >= 7 ? 'bg-accent' : s >= 4 ? 'bg-zing' : 'bg-hot')

/** Compact per-dimension breakdown of a reranked clip (0-10 each; weight shown; evidence text from the model).
 *  Collapsed, it shows a mini equaliser of the eight scores. */
export function RankBreakdown({ rank }: { rank: RankInfo }) {
  return (
    <details className="group inset text-[13px]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-[1.1rem] px-3.5 py-2.5 marker:hidden [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="font-display font-bold text-fg">Score breakdown</span>
          <span className="block truncate text-xs text-muted">
            {DIMS.length} signals{rank.capped ? ' · capped (weak arc)' : ''}{rank.peak ? ' · loudness peak' : ''}
          </span>
        </span>
        <span className="flex items-center gap-3">
          <span aria-hidden className="flex h-7 items-end gap-[3px]">
            {DIMS.map(d => <span key={d} className={clsx('w-1.5 rounded-sm', band(rank.dims[d].score))} style={{ height: `${Math.max(12, rank.dims[d].score * 10)}%` }} />)}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted transition group-open:rotate-180" aria-hidden />
        </span>
      </summary>
      <ul className="flex flex-col gap-3 px-3.5 pb-3.5">
        {DIMS.map(d => {
          const x = rank.dims[d]
          return (
            <li key={d}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-fg">{LABELS[d]}</span>
                <span className="text-xs text-muted tabular-nums">
                  <span className="font-display text-sm font-bold text-fg">{x.score.toFixed(1)}</span>/10 · ×{WEIGHTS[d]}
                  {x.measured !== undefined && x.model !== undefined ? ` · model ${x.model} / measured ${x.measured}` : ''}
                </span>
              </div>
              <div role="meter" aria-label={LABELS[d]} aria-valuemin={0} aria-valuemax={10} aria-valuenow={x.score}
                className="mt-1 h-2 overflow-hidden rounded-full bg-fg/10">
                <div className={clsx('h-full rounded-full', band(x.score))} style={{ width: `${Math.max(0, Math.min(10, x.score)) * 10}%` }} />
              </div>
              {x.evidence && <p className="mt-1 text-xs leading-relaxed text-muted">{x.evidence}</p>}
            </li>
          )
        })}
      </ul>
    </details>
  )
}
