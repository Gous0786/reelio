import { useEffect, useRef, useState } from 'react'
import type { FacecamSetting, Rect } from '../lib/facecam'
import './facecam.css'

type Handle = 'move' | 'tl' | 'tr' | 'bl' | 'br'
const MIN = 0.04
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const DEFAULT_RECT: Rect = { x: 0.76, y: 0.04, w: 0.22, h: 0.22 }

/** Frame preview with the facecam rectangle as a draggable, resizable box, plus the on/off toggle. */
export default function FacecamPanel({ url, setting, detecting, onChange }: {
  url: string; setting: FacecamSetting | null; detecting: boolean; onChange: (s: FacecamSetting) => void
}) {
  const vid = useRef<HTMLVideoElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [dur, setDur] = useState(0)
  const [t, setT] = useState(0)
  const [draft, setDraft] = useState<Rect | null>(null) // rectangle while dragging; committed on release
  useEffect(() => { if (vid.current && dur) vid.current.currentTime = t }, [t, dur])

  const s = setting ?? { rect: null, enabled: false, confidence: 0, detected: false }
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
  return (
    <section className="fcp">
      <div className="fcp-head">
        <label title="Facecam on top, gameplay below">
          <input type="checkbox" checked={s.enabled && !!s.rect} disabled={!s.rect}
            onChange={e => onChange({ ...s, enabled: e.target.checked })} />
          Use facecam layout
        </label>
        <small>{status}</small>
        {!s.rect && !detecting && <button className="ghost" onClick={() => onChange({ ...s, rect: DEFAULT_RECT, enabled: true })}>Add box manually</button>}
        {s.rect && <button className="ghost" onClick={() => commit(null)}>Remove box</button>}
      </div>
      {(s.rect || !detecting) && (
        <>
          <div className="fcp-stage" ref={stage}>
            <video ref={vid} src={url} muted preload="metadata" playsInline
              onLoadedMetadata={e => { setDur(e.currentTarget.duration); setT(e.currentTarget.duration / 2) }} />
            {rect && (
              <div className={`fcp-box${s.enabled ? '' : ' off'}`} onPointerDown={drag('move')}
                style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}>
                {(['tl', 'tr', 'bl', 'br'] as const).map(h => <i key={h} className={h} onPointerDown={drag(h)} />)}
              </div>
            )}
          </div>
          {dur > 0 && <input className="fcp-scrub" type="range" min={0} max={dur} step={0.5} value={t} onChange={e => setT(Number(e.target.value))} title="Pick another frame" />}
        </>
      )}
    </section>
  )
}
