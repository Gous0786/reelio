import type { Segment } from './types'

export type WhisperModel = 'onnx-community/whisper-base' | 'onnx-community/whisper-tiny'

export function transcribe(audio: Float32Array, model: WhisperModel, onStatus: (msg: string) => void): Promise<Segment[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/whisper.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = e => {
      const m = e.data
      if (m.type === 'download') onStatus(`Downloading speech model… ${m.pct}%`)
      else if (m.type === 'loading') onStatus('Loading speech model…')
      else if (m.type === 'progress') onStatus(`Transcribing… ${m.pct}%`)
      else if (m.type === 'done') { worker.terminate(); resolve(m.segments) }
      else if (m.type === 'error') { worker.terminate(); reject(new Error(m.message)) }
    }
    worker.onerror = e => { worker.terminate(); reject(new Error(e.message || 'Transcription worker crashed')) }
    onStatus('Transcribing… 0%')
    worker.postMessage({ audio, model }, [audio.buffer]) // transfer; caller must not reuse
  })
}
