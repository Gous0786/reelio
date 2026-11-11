import type { RankInfo } from './lib/types'
import { DIMS, LABELS, WEIGHTS } from './lib/rank'

/** Compact per-dimension breakdown of a reranked clip (0-10 each; weight in the label; evidence text from the model). */
export function RankBreakdown({ rank }: { rank: RankInfo }) {
  return (
    <details className="rank">
      <summary>Score {Math.round(rank.total)}{rank.capped ? ' (capped: weak arc)' : ''}{rank.peak ? ' · loudness peak' : ''} · breakdown</summary>
      {DIMS.map(d => {
        const x = rank.dims[d]
        return (
          <p key={d}>
            <b>{LABELS[d]} {x.score.toFixed(1)}</b> <small>×{WEIGHTS[d]}{x.measured !== undefined && x.model !== undefined ? ` · model ${x.model} / measured ${x.measured}` : ''}</small>
            {x.evidence && <span> {x.evidence}</span>}
          </p>
        )
      })}
    </details>
  )
}
