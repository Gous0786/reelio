import { useEffect, useRef, useState } from 'react'
import * as Slider from '@radix-ui/react-slider'
import { ChevronDown, Loader2, Plus, ScanFace, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import type { FacecamSetting, Rect } from '../lib/facecam'
import { fmt } from '../lib/format'
import { Button, Chip, card } from './ui'

type Handle = 'move' | 'tl' | 'tr' | 'bl' | 'br'
const MIN = 0.04
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const DEFAULT_RECT: Rect = { x: 0.76, y: 0.04, w: 0.22, h: 0.22 }
const CORNER: Record<Exclude<Handle, 'move'>, string> = {
  tl: '-left-2 -top-2 cursor-nwse-resize', br: '-right-2 -bottom-2 cursor-nwse-resize',
  tr: '-right-2 -top-2 cursor-nesw-resize', bl: '-left-2 -bottom-2 cursor-nesw-resize',
}

/** Frame preview with the facecam rectangle as a draggable, resizable box, plus the on/off toggle. */
export default function FacecamPanel({ url, setting, detecting, onChange }: {
  url: string; setting: FacecamSetting | null; detecting: boolean; onChange: (s: FacecamSetting) => void
}) {
  const vid = useRef<HTMLVideoElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [dur, setDur] = useState(0)
  const [t, setT] = useState(0)
  const [draft, setDraft] = useState<Rect | null>(null) // rectangle while dragging; committed on release
  const [open, setOpen] = useState(false) // preview collapsed until there is a box to adjust
  useEffect(() => { if (vid.current && dur) vid.current.currentTime = t }, [t, dur])

  const s = setting ?? { rect: null, enabled: false, confidence: 0, detected: false }
  useEffect(() => { if (s.rect) setOpen(true) }, [!!s.rect]) // eslint-disable-line react-hooks/exhaustive-deps
  const rect = draft ?? s.rect
  const commit = (r: Rect | null) => onChange({ ...s, rect: r, enabled: r ? s.enabled : false })

  const drag = (h: Handle) => (e: React.PointerEvent) => {
    if (!s.rect || !stage.current) return
    e.preventDefault(); e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const b = stage.current.getBoundingClientRect(), r0 = s.rect, x0 = e.clientX, y0 = e.clientY
    let cur = r0
    const move = (m: PointerEvent) => {
      const dx = (m.clientX - x0) / b.width, dy = (m.clientY - y0) / b.height
      if (h === 'move') cur = { ...r0, x: clamp(r0.x + dx, 0, 1 - r0.w), y: clamp(r0.y + dy, 0, 1 - r0.h) }
      else {
        const l = h === 'tl' || h === 'bl' ? clamp(r0.x + dx, 0, r0.x + r0.w - MIN) : r0.x
        const r = h === 'tr' || h === 'br' ? clamp(r0.x + r0.w + dx, r0.x + MIN, 1) : r0.x + r0.w
        const tp = h === 'tl' || h === 'tr' ? clamp(r0.y + dy, 0, r0.y + r0.h - MIN) : r0.y
        const bt = h === 'bl' || h === 'br' ? clamp(r0.y + r0.h + dy, r0.y + MIN, 1) : r0.y + r0.h
        cur = { x: l, y: tp, w: r - l, h: bt - tp }
      }
      setDraft(cur)
    }
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up)
      setDraft(null); commit(cur)
    }
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up)
  }

  const status = detecting ? 'Looking for a facecam…'
    : s.rect ? (s.detected ? `Detected (confidence ${Math.round(s.confidence * 100)}%), drag to adjust` : 'Drag to adjust')
      : 'No facecam detected'
  const on = s.enabled && !!s.rect
  return (
    <section className={clsx(card, 'p-4 sm:p-5')} aria-label="Facecam layout">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/8 text-violet-200">
            {detecting ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <ScanFace className="size-5" aria-hidden />}
          </span>
          <div>
            <h2 className="font-display text-sm font-semibold text-white">Facecam layout</h2>
            <p className="text-xs text-zinc-400" role="status">{status}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {on ? <Chip tone="good">On: facecam on top</Chip> : <Chip>Off</Chip>}
          <label className={clsx('relative inline-flex cursor-pointer items-center', !s.rect && 'cursor-not-allowed opacity-50')} title="Facecam on top, gameplay below">
            <input type="checkbox" role="switch" className="peer sr-only" checked={on} disabled={!s.rect}
              onChange={e => onChange({ ...s, enabled: e.target.checked })} aria-label="Use facecam layout" />
            <span className="h-6 w-11 rounded-full bg-white/15 transition peer-checked:bg-violet-500 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-violet-300 after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5" />
          </label>
          {!s.rect && !detecting && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => onChange({ ...s, rect: DEFAULT_RECT, enabled: true })}>Add box manually</Button>}
          {s.rect && <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => commit(null)}>Remove box</Button>}
          <Button size="sm" variant="ghost" aria-expanded={open} aria-controls="facecam-preview" onClick={() => setOpen(o => !o)}
            icon={<ChevronDown className={clsx('size-3.5 transition', open && 'rotate-180')} />}>{open ? 'Hide preview' : 'Preview'}</Button>
        </div>
      </div>

      {open && (s.rect || !detecting) && (
        <div id="facecam-preview" className="mt-4 max-w-md">
          <div className="relative touch-none leading-[0] select-none" ref={stage}>
            <video ref={vid} src={url} muted preload="metadata" playsInline className="block w-full rounded-xl bg-black ring-1 ring-white/10"
              onLoadedMetadata={e => { setDur(e.currentTarget.duration); setT(e.currentTarget.duration / 2) }} />
            {rect && (
              <div
                className={clsx('absolute cursor-move border-2 leading-[0]', s.enabled ? 'border-emerald-400 bg-emerald-400/15' : 'border-zinc-400 bg-zinc-400/15')}
                onPointerDown={drag('move')}
                style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}
              >
                {(['tl', 'tr', 'bl', 'br'] as const).map(h => (
                  <i key={h} onPointerDown={drag(h)} className={clsx('absolute size-3.5 rounded-sm', s.enabled ? 'bg-emerald-400' : 'bg-zinc-400', CORNER[h])} />
                ))}
              </div>
            )}
          </div>
          {dur > 0 && (
            <div className="mt-3 flex items-center gap-3">
              <span className="text-xs whitespace-nowrap text-zinc-400 tabular-nums">Frame {fmt(t)}</span>
              <Slider.Root className="relative flex h-5 grow touch-none items-center select-none" min={0} max={dur} step={0.5} value={[t]} onValueChange={([v]) => setT(v)}>
                <Slider.Track className="relative h-1.5 grow rounded-full bg-white/12"><Slider.Range className="absolute h-full rounded-full bg-violet-400/70" /></Slider.Track>
                <Slider.Thumb aria-label="Pick another frame" className="block size-4 rounded-full bg-white shadow ring-2 ring-violet-500 focus-visible:ring-4 focus-visible:ring-violet-300" />
              </Slider.Root>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
