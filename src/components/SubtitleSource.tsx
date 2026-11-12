import { Captions } from 'lucide-react'
import { trackLabel, type SubTrack } from '../lib/subtitles'
import { Chip } from './ui'

/** Chip saying the transcript came from subtitles, with a track switcher when the file has several text tracks. */
export default function SubtitleSource({ label, tracks, trackId, onPick, disabled }: {
  label: string; tracks: SubTrack[]; trackId: string; onPick: (id: string) => void; disabled: boolean
}) {
  const text = tracks.filter(t => t.text)
  return (
    <>
      <Chip tone="good"><Captions className="size-3" aria-hidden />Subtitles: {label}</Chip>
      {text.length > 1 && (
        <select aria-label="Subtitle track" value={trackId} disabled={disabled} onChange={e => onPick(e.target.value)}
          className="max-w-48 rounded-full border border-line bg-raised px-2.5 py-0.5 text-xs font-semibold text-fg">
          {text.map(t => <option key={t.id} value={t.id}>{trackLabel(t)}</option>)}
        </select>
      )}
    </>
  )
}
