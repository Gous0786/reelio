import type { Segment } from './types'

// Finished transcripts in IndexedDB, keyed by file identity + whisper model. All calls fail soft (cache is optional).
const STORE = 'transcripts'
const open = () => new Promise<IDBDatabase>((res, rej) => {
  const r = indexedDB.open('reelio', 1)
  r.onupgradeneeded = () => r.result.createObjectStore(STORE)
  r.onsuccess = () => res(r.result)
  r.onerror = () => rej(r.error)
})
const tx = async <T,>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) => {
  const db = await open()
  return new Promise<T | undefined>(res => {
    const r = f(db.transaction(STORE, mode).objectStore(STORE))
    r.onsuccess = () => res(r.result)
    r.onerror = () => res(undefined)
  }).finally(() => db.close())
}

export const cacheKey = (f: File, model: string) => `${f.name}|${f.size}|${f.lastModified}|${model}`
export const getTranscript = (key: string) => tx<Segment[]>('readonly', s => s.get(key)).catch(() => undefined)
export const putTranscript = (key: string, segs: Segment[]) => tx('readwrite', s => s.put(segs, key)).catch(() => undefined)
export const delTranscript = (key: string) => tx('readwrite', s => s.delete(key)).catch(() => undefined)
