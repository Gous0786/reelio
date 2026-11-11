/// <reference lib="webworker" />
// Pattern follows xenova/whisper-web: pipeline() in a worker, WebGPU if available else WASM.
import { pipeline, env } from '@huggingface/transformers'
import type { Segment } from '../lib/types'

env.allowLocalModels = false

const SR = 16000
const SLICE_S = 300 // transcribe in 5-minute slices so we can report real percent progress
let cached: { model: string; asr: any } | null = null

async function load(model: string) {
  if (cached?.model === model) return cached.asr
  const gpu = !!(self.navigator as any).gpu
  const progress_callback = (p: any) => {
    if (p.status === 'progress') self.postMessage({ type: 'download', pct: Math.round(p.progress ?? 0), file: p.file })
  }
  const make = (device: 'webgpu' | 'wasm') =>
    pipeline('automatic-speech-recognition', model, {
      device,
      dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
      progress_callback,
    } as any)
  let asr: any
  try { asr = await make(gpu ? 'webgpu' : 'wasm') } catch (e) {
    if (!gpu) throw e
    asr = await make('wasm')
  }
  cached = { model, asr }
  return asr
}

self.onmessage = async (e: MessageEvent<{ audio: Float32Array; model: string }>) => {
  try {
    const { audio, model } = e.data
    self.postMessage({ type: 'loading' })
    const asr = await load(model)
    const segments: Segment[] = []
    const step = SLICE_S * SR
    for (let i = 0; i < audio.length; i += step) {
      const slice = audio.subarray(i, i + step)
      const offset = i / SR
      const out = await asr(slice, { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5, language: null, task: 'transcribe' })
      for (const c of (out.chunks ?? []) as { text: string; timestamp: [number, number | null] }[]) {
        const text = c.text.trim()
        if (!text) continue
        const start = offset + (c.timestamp[0] ?? 0)
        const end = offset + (c.timestamp[1] ?? Math.min(slice.length / SR, (c.timestamp[0] ?? 0) + 5))
        segments.push({ start, end, text })
      }
      self.postMessage({ type: 'progress', pct: Math.min(100, Math.round(((i + step) / audio.length) * 100)) })
    }
    self.postMessage({ type: 'done', segments })
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
