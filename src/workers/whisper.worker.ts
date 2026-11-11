/// <reference lib="webworker" />
// Pattern follows xenova/whisper-web: pipeline() in a worker, WebGPU if available else WASM.
// Protocol: {type:'init', model} -> {type:'download', pct} ... {type:'ready', device}
//           {type:'run', audio, offset} -> {type:'result', segments} | {type:'error', message, audio}
import { pipeline, env } from '@huggingface/transformers'
import type { Segment } from '../lib/types'

env.allowLocalModels = false
const SR = 16000
let asr: any

async function hasWebGPU() {
  try { return !!(await (self.navigator as any).gpu?.requestAdapter()) } catch { return false }
}

async function init(model: string) {
  const files: Record<string, { loaded: number; total: number }> = {}
  const progress_callback = (p: any) => {
    if (p.status !== 'progress' || !p.total) return
    files[p.file] = { loaded: p.loaded, total: p.total }
    const all = Object.values(files)
    const pct = Math.round((all.reduce((a, f) => a + f.loaded, 0) / all.reduce((a, f) => a + f.total, 0)) * 100)
    self.postMessage({ type: 'download', pct })
  }
  const make = (device: 'webgpu' | 'wasm') =>
    pipeline('automatic-speech-recognition', model, {
      device,
      dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
      progress_callback,
    } as any)
  let device: 'webgpu' | 'wasm' = (await hasWebGPU()) ? 'webgpu' : 'wasm'
  try { asr = await make(device) } catch (e) {
    if (device === 'wasm') throw e
    device = 'wasm'; asr = await make('wasm')
  }
  self.postMessage({ type: 'ready', device })
}

async function run(audio: Float32Array, offset: number) {
  try {
    const out = await asr(audio, { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5, task: 'transcribe' })
    const segments: Segment[] = []
    for (const c of (out.chunks ?? []) as { text: string; timestamp: [number, number | null] }[]) {
      const text = c.text.trim()
      if (!text) continue
      const s = c.timestamp[0] ?? 0
      const e = c.timestamp[1] ?? Math.min(audio.length / SR, s + 5)
      segments.push({ start: offset + s, end: offset + e, text })
    }
    self.postMessage({ type: 'result', segments })
  } catch (err) {
    // hand the buffer back so the caller can retry this slice without re-decoding
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err), audio }, [audio.buffer])
  }
}

self.onmessage = async (e: MessageEvent) => {
  const m = e.data
  if (m.type === 'init') {
    try { await init(m.model) } catch (err) { self.postMessage({ type: 'fatal', message: err instanceof Error ? err.message : String(err) }) }
  } else if (m.type === 'run') await run(m.audio, m.offset)
}
