export const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
export const fmt1 = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
export const dur = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ` : '') + `${Math.floor((s % 3600) / 60)}m ${Math.round(s % 60)}s`
export const outName = (f: File, rank: number) => `${f.name.replace(/\.[^.]+$/, '')}-clip${rank}.mp4`
export function save(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
}
