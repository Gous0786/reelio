import { useEffect, useState } from 'react'
import { Captions } from 'lucide-react'
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

export default function CaptionControls({ value, onChange, available }: {
  value: CaptionSettings; onChange: (v: CaptionSettings) => void
  available: boolean // false when the transcript has no word timings (nothing to draw)
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-zinc-200" title={available ? 'Burn word-timed captions into the preview and the MP4' : 'This transcript has no word timings: re-transcribe to get captions'}>
        <Captions className="size-4" aria-hidden />
        Captions
        <input type="checkbox" role="switch" className="size-4 accent-violet-500" checked={value.on && available} disabled={!available}
          onChange={e => onChange({ ...value, on: e.target.checked })} />
      </label>
      <Segmented label="Caption style" value={value.style} disabled={!value.on || !available}
        onChange={style => onChange({ ...value, style })}
        options={CAPTION_STYLES.map(c => ({ value: c.value, label: c.label, hint: c.hint }))} />
    </div>
  )
}
