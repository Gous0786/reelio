import type { Segment } from './types'

export type WhisperModel = 'onnx-community/whisper-base' | 'onnx-community/whisper-tiny'
export type Device = 'webgpu' | 'wasm'

/** Starts the Whisper worker and resolves once the model is loaded. `run` transcribes one slice (buffer is
 *  transferred, not copied) and returns segments at absolute times (offset applied). On a slice error the
 *  rejected Error carries the buffer back in `.audio` so it can be retried. */
export function createTranscriber(model: WhisperModel, onDownload: (pct: number) => void) {
  const worker = new Worker(new URL('../workers/whisper.worker.ts', import.meta.url), { type: 'module' })
  let pending: { resolve: (v: any) => void; reject: (e: Error) => void } | null = null
  const fail = (m: string) => { const p = pending; pending = null; p?.reject(new Error(m)) }
  worker.onmessage = e => {
    const m = e.data
    if (m.type === 'download') onDownload(m.pct)
    else if (m.type === 'fatal') fail(m.message)
    else if (m.type === 'error') { const p = pending; pending = null; p?.reject(Object.assign(new Error(m.message), { audio: m.audio })) }
    else { const p = pending; pending = null; p?.resolve(m) }
  }
  worker.onerror = e => fail(e.message || 'Transcription worker crashed')
  const call = <T,>(msg: object, transfer: Transferable[] = []) =>
    new Promise<T>((resolve, reject) => { pending = { resolve, reject }; worker.postMessage(msg, transfer) })

  return call<{ device: Device; gpu: string }>({ type: 'init', model }).then(({ device, gpu }) => ({
    device,
    gpu,
    run: (audio: Float32Array, offset: number) =>
      call<{ segments: Segment[] }>({ type: 'run', audio, offset }, [audio.buffer]).then(r => r.segments),
    close: () => worker.terminate(),
  }))
}

export type Transcriber = Awaited<ReturnType<typeof createTranscriber>>
export const AUTO_WORKERS = 3 // measured on RTX 3050 / WebGPU: tiny 1/2/3 workers = 13.1x / 24.5x / 37.3x realtime

/** A small pool of independent Whisper workers (each holds its own model copy). `want` = 'auto' or an explicit
 *  count. The first worker downloads the model; the rest start from the browser cache. Auto stays at 1 on WASM
 *  and on low-memory / few-core devices. */
export async function createPool(model: WhisperModel, want: 'auto' | number, onDownload: (pct: number) => void) {
  const first = await createTranscriber(model, onDownload)
  let n = want === 'auto' ? AUTO_WORKERS : want
  const mem = (navigator as { deviceMemory?: number }).deviceMemory ?? 8
  if (want === 'auto' && (first.device !== 'webgpu' || mem <= 4 || (navigator.hardwareConcurrency ?? 4) < 4)) n = 1
  const rest = await Promise.all(Array.from({ length: Math.max(0, n - 1) }, () => createTranscriber(model, () => {})))
  const workers = [first, ...rest]
  return { device: first.device, gpu: first.gpu, workers, close: () => workers.forEach(w => w.close()) }
}
