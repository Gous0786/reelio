import { ChevronDown } from 'lucide-react'
import type { RankInfo } from '../lib/types'
import { DIMS, LABELS, WEIGHTS } from '../lib/rank'

/** Compact per-dimension breakdown of a reranked clip (0-10 each; weight shown; evidence text from the model). */
export function RankBreakdown({ rank }: { rank: RankInfo }) {
  return (
    <details className="group rounded-2xl border border-white/10 bg-white/4 text-[13px]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-2xl px-3 py-2 text-zinc-200 marker:hidden [&::-webkit-details-marker]:hidden">
        <span>
          <span className="font-medium text-white">Score breakdown</span>
          <span className="text-zinc-400">
            {rank.capped ? ' · capped (weak arc)' : ''}{rank.peak ? ' · loudness peak' : ''}
          </span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-zinc-400 transition group-open:rotate-180" aria-hidden />
      </summary>
      <ul className="flex flex-col gap-2.5 px-3 pb-3">
        {DIMS.map(d => {
          const x = rank.dims[d]
          return (
            <li key={d}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-zinc-100">{LABELS[d]}</span>
                <span className="text-xs text-zinc-400 tabular-nums">
                  <span className="font-semibold text-zinc-100">{x.score.toFixed(1)}</span>/10 · ×{WEIGHTS[d]}
                  {x.measured !== undefined && x.model !== undefined ? ` · model ${x.model} / measured ${x.measured}` : ''}
                </span>
              </div>
              <div role="meter" aria-label={LABELS[d]} aria-valuemin={0} aria-valuemax={10} aria-valuenow={x.score}
                className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-linear-to-r from-violet-500 to-fuchsia-400" style={{ width: `${Math.max(0, Math.min(10, x.score)) * 10}%` }} />
              </div>
              {x.evidence && <p className="mt-1 text-xs leading-relaxed text-zinc-400">{x.evidence}</p>}
            </li>
          )
        })}
      </ul>
    </details>
  )
}
