import type { Loud, Segment, Word } from './types'
import type { Cue, SubTrack } from './subtitles'
import type { Piece } from './transcribe'

// IndexedDB caches. All calls fail soft (the cache is optional; also absent outside a browser).
//  transcripts: finished transcripts keyed by file identity + whisper model
//  clips: clip-finding results keyed by transcript hash + prompt version (re-running the same video costs no request)
const TRANSCRIPTS = 'transcripts'
const CLIPS = 'clips'
const open = () => new Promise<IDBDatabase>((res, rej) => {
  const r = indexedDB.open('reelio', 2)
  r.onupgradeneeded = () => { for (const s of [TRANSCRIPTS, CLIPS]) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s) }
  r.onsuccess = () => res(r.result)
  r.onerror = () => rej(r.error)
})
const tx = async <T,>(store: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) => {
  const db = await open()
  return new Promise<T | undefined>(res => {
    const r = f(db.transaction(store, mode).objectStore(store))
    r.onsuccess = () => res(r.result)
    r.onerror = () => res(undefined)
  }).finally(() => db.close())
}

// v3: the cached transcript also carries word timings (older entries are ignored and re-transcribed)
export const cacheKey = (f: File, model: string) => `v3|${f.name}|${f.size}|${f.lastModified}|${model}`
// `subs` is set when the transcript came from subtitles (key records the source): raw cues of every text track are
// kept so switching track needs no new scan.
// Whisper entries: `pieces` = token ids per slice, so words can be timed per clip on demand; `covered` = ranges whose
// words are timed so far. Entries without `pieces` (subtitles, or Whisper entries from before) hold every word.
export interface TranscriptEntry { segs: Segment[]; loud: Loud; words: Word[]; covered?: [number, number][]; pieces?: Piece[]; subs?: { tracks: SubTrack[]; cues: Record<string, Cue[]>; trackId: string } }
export const getTranscript = (key: string) => tx<TranscriptEntry>(TRANSCRIPTS, 'readonly', s => s.get(key)).catch(() => undefined)
export const putTranscript = (key: string, v: TranscriptEntry) => tx(TRANSCRIPTS, 'readwrite', s => s.put(v, key)).catch(() => undefined)
export const delTranscript = (key: string) => tx(TRANSCRIPTS, 'readwrite', s => s.delete(key)).catch(() => undefined)

export interface ClipsEntry { clips: unknown[]; by: string }
export const getClips = (key: string) => tx<ClipsEntry>(CLIPS, 'readonly', s => s.get(key)).catch(() => undefined)
export const putClips = (key: string, v: ClipsEntry) => tx(CLIPS, 'readwrite', s => s.put(v, key)).catch(() => undefined)
