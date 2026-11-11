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
