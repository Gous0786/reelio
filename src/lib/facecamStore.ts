import type { FacecamSetting } from './facecam'

// One facecam setting per video, in its own tiny IndexedDB (keyed by file identity, like the transcript cache but
// independent of the whisper model). Fails soft: the setting just isn't remembered.
const open = () => new Promise<IDBDatabase>((res, rej) => {
  const r = indexedDB.open('reelio-facecam', 1)
  r.onupgradeneeded = () => r.result.createObjectStore('facecam')
  r.onsuccess = () => res(r.result)
  r.onerror = () => rej(r.error)
})
const run = async <T,>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) => {
  const db = await open()
  return new Promise<T | undefined>(res => {
    const r = f(db.transaction('facecam', mode).objectStore('facecam'))
    r.onsuccess = () => res(r.result)
    r.onerror = () => res(undefined)
  }).finally(() => db.close())
}
export const facecamKey = (f: File) => `${f.name}|${f.size}|${f.lastModified}`
export const getFacecam = (key: string) => run<FacecamSetting>('readonly', s => s.get(key)).catch(() => undefined)
export const putFacecam = (key: string, v: FacecamSetting) => run('readwrite', s => s.put(v, key)).catch(() => undefined)
