import { useEffect, useState } from 'react'
import { Captions } from 'lucide-react'
import clsx from 'clsx'
import { CAPTION_STYLES, type CaptionStyle } from '../lib/captions'
import Segmented from './Segmented'

export interface CaptionSettings { on: boolean; style: CaptionStyle }

/** Global captions on/off + style, remembered in localStorage. */
export function useCaptionSettings() {
  const [s, setS] = useState<CaptionSettings>(() => {
    const style = localStorage.getItem('reelio_caption_style')
    return {
      on: localStorage.getItem('reelio_captions') !== 'off',
      style: CAPTION_STYLES.some(c => c.value === style) ? (style as CaptionStyle) : 'highlight',
    }
  })
  useEffect(() => {
    localStorage.setItem('reelio_captions', s.on ? 'on' : 'off')
    localStorage.setItem('reelio_caption_style', s.style)
  }, [s])
  return [s, setS] as const
}

export default function CaptionControls({ value, onChange, available, busy = '' }: {
  value: CaptionSettings; onChange: (v: CaptionSettings) => void
  available: boolean // false when the transcript has no word timings (nothing to draw)
  busy?: string // shown while the words of the clips are being timed
}) {
  const on = value.on && available
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className={clsx('inline-flex items-center gap-2.5', available ? 'cursor-pointer' : 'cursor-not-allowed opacity-50')}
        title={available ? 'Burn word-timed captions into the preview and the MP4' : 'This transcript has no word timings: re-transcribe to get captions'}>
        <span className="font-display flex w-24 items-center gap-1.5 text-sm font-bold text-fg"><Captions className="size-4 text-hot" aria-hidden />Captions</span>
        <span className="relative inline-flex items-center">
          <input type="checkbox" role="switch" className="peer sr-only" checked={on} disabled={!available} aria-label="Burn in captions"
            onChange={e => onChange({ ...value, on: e.target.checked })} />
          <span aria-hidden className="h-7 w-13 rounded-full border-2 border-line bg-fg/12 transition peer-checked:border-edge peer-checked:bg-accent peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-zing after:absolute after:top-1 after:left-1 after:size-5 after:rounded-full after:bg-fg after:shadow after:transition peer-checked:after:translate-x-6 peer-checked:after:bg-on-accent" />
        </span>
      </label>
      <Segmented label="Caption style" value={value.style} disabled={!value.on || !available}
        onChange={style => onChange({ ...value, style })}
        options={CAPTION_STYLES.map(c => ({ value: c.value, label: c.label, hint: c.hint }))} />
      {!available && <span className="text-xs text-muted">Re-transcribe to get word timings</span>}
      {available && busy && <span className="text-xs text-muted" role="status">{busy}</span>}
    </div>
  )
}
