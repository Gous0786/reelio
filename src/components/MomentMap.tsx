import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { Download } from 'lucide-react'
import clsx from 'clsx'
import type { Clip } from '../lib/types'
import { fmt } from '../lib/format'
import { Anim } from './Illustrations'
import BorderBeam from './vengeance/BorderBeam'
import { Button } from './ui'

const BARS = Array.from({ length: 120 }, (_, i) => 0.15 + 0.85 * Math.abs(Math.sin(i * 0.53) * Math.cos(i * 0.131) * Math.sin(i * 0.07 + 2)))

/** Overview of where the clips sit in the source, with each window jumping to its card. */
export default function MomentMap({ clips, url, children }: { clips: Clip[]; url: string; children?: ReactNode }) {
  const [total, setTotal] = useState(0)
  useEffect(() => { // source length from metadata only
    const v = document.createElement('video')
    v.preload = 'metadata'; v.muted = true
    v.onloadedmetadata = () => setTotal(v.duration)
    v.src = url
    return () => { v.removeAttribute('src'); v.load() }
  }, [url])
  const known = Number.isFinite(total) && total > 0
  const len = known ? total : Math.max(1, ...clips.map(c => c.end)) * 1.05 // estimate until metadata loads
  const go = (i: number) => {
    const el = document.getElementById(`clip-${i + 1}`)
    el?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
    el?.focus({ preventScroll: true })
  }

  return (
    <section className="slab p-5 sm:p-6" aria-label="Clip map">
      <div className="flex items-center gap-4">
        <Anim name="scissors" className="size-12 sm:size-14" />
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Clip map</p>
          <h2 className="font-display text-2xl leading-tight font-bold text-fg uppercase sm:text-3xl">
            {clips.length} moment{clips.length === 1 ? '' : 's'} found
          </h2>
        </div>
        {known && <p className="hidden text-right text-xs text-muted sm:block">Source<br /><span className="font-display text-base font-bold text-fg tabular-nums">{fmt(len)}</span></p>}
      </div>

      <div className="relative mt-5">
        <div aria-hidden className="inset flex h-16 items-center gap-[2px] overflow-hidden px-2">
          {BARS.map((h, i) => <span key={i} className="w-full rounded-full bg-fg/20" style={{ height: `${h * 75}%` }} />)}
        </div>
        <ol className="absolute inset-0">
          {clips.map((c, i) => {
            const left = (c.start / len) * 100, width = Math.max(1.2, ((c.end - c.start) / len) * 100)
            return (
              <li key={i} className="absolute inset-y-1" style={{ left: `${left}%`, width: `${width}%` }}>
                <button type="button" onClick={() => go(i)} title={`Clip ${i + 1}: ${c.title}`}
                  aria-label={`Jump to clip ${i + 1}, ${fmt(c.start)} to ${fmt(c.end)}: ${c.title}`}
                  className="group grid size-full min-w-6 place-items-start rounded-lg border-2 border-accent bg-accent/25 transition hover:bg-accent/45 focus-visible:bg-accent/45">
                  <span className="font-display -mt-3 -ml-1 grid size-6 place-items-center rounded-full border-2 border-edge bg-accent text-[11px] font-bold text-on-accent transition group-hover:scale-110">{i + 1}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted tabular-nums" aria-hidden><span>0:00</span><span>{known ? fmt(len) : ""}</span></div>

      {children && <div className="mt-5 border-t border-line pt-5">{children}</div>}
    </section>
  )
}

/** Download-all control: idle, rendering (per-clip pips + overall bar) and a short celebration when done. */
export function DownloadAll({ n, all, pct, done, disabled, onClick }: {
  n: number; all: { i: number; n: number; p: number } | null; pct: number; done: boolean; disabled: boolean; onClick: () => void
}) {
  return (
    <div className="relative flex min-w-0 flex-col gap-3 rounded-3xl sm:w-80">
      <AnimatePresence mode="wait" initial={false}>
        {all ? (
          <m.div key="busy" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className="relative flex items-center gap-3 rounded-3xl border-2 border-accent bg-accent/10 p-3">
            <BorderBeam size={120} duration={3} />
            <Anim name="rocket" className="size-11" />
            <div className="min-w-0 flex-1">
              <p className="flex justify-between text-xs font-semibold text-fg tabular-nums"><span>Clip {all.i + 1} of {all.n} · {all.p}%</span><span className="text-accent">{pct}%</span></p>
              <div className="mt-1.5 flex gap-1" role="progressbar" aria-label="Rendering all clips" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                {Array.from({ length: all.n }, (_, k) => (
                  <span key={k} className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-fg/12">
                    <span className={clsx('absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-300')} style={{ width: `${k < all.i ? 100 : k === all.i ? all.p : 0}%` }} />
                  </span>
                ))}
              </div>
            </div>
          </m.div>
        ) : done ? (
          <m.div key="done" role="status" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            className="flex items-center gap-3 rounded-3xl border-2 border-good/50 bg-good/10 p-3">
            <Anim name="party" className="size-11" loop={false} />
            <p className="text-sm font-bold text-fg">All {n} clips saved<span className="block text-xs font-medium text-muted">Check your downloads folder</span></p>
          </m.div>
        ) : (
          <m.div key="idle" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="flex items-center gap-3">
            <Anim name="box" className="size-11" />
            <Button variant="primary" size="lg" className="flex-1" disabled={disabled} onClick={onClick} icon={<Download className="size-5" />}>
              Download all ({n})
            </Button>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}
