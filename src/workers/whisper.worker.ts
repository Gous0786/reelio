/// <reference lib="webworker" />
// Pattern follows xenova/whisper-web: pipeline() in a worker, WebGPU if available else WASM.
// Protocol: {type:'init', model} -> {type:'download', pct} ... {type:'ready', device, gpu}
//           {type:'run', audio, offset} -> {type:'result', segments, words} | {type:'error', message, audio}
// Word timestamps need the '<model>_timestamped' ONNX export (same weights, decoder also outputs cross-attentions).
import { pipeline, env } from '@huggingface/transformers'
import type { Segment, Word } from '../lib/types'

env.allowLocalModels = false
const SR = 16000
let asr: any

// Ask for the discrete GPU. (On Windows, Chrome follows the per-app OS graphics setting.)
async function gpuAdapter(): Promise<any> {
  try { return (await (self.navigator as any).gpu?.requestAdapter({ powerPreference: 'high-performance' })) ?? null } catch { return null }
}
const gpuName = (i: any) => (i ? [i.vendor, i.architecture, i.description].filter(Boolean).join(' ') : '')

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
    pipeline('automatic-speech-recognition', `${model}_timestamped`, {
      device,
      dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
      progress_callback,
    } as any)
  const adapter = await gpuAdapter()
  const ort = (env.backends.onnx as any).webgpu
  if (ort) ort.powerPreference = 'high-performance'
  let device: 'webgpu' | 'wasm' = adapter ? 'webgpu' : 'wasm'
  try { asr = await make(device) } catch (e) {
    if (device === 'wasm') throw e
    device = 'wasm'; asr = await make('wasm')
  }
  let gpu = ''
  if (device === 'webgpu') {
    try { gpu = gpuName((await ort?.device)?.adapterInfo) } catch { /* older ORT: fall back to our adapter */ }
    gpu ||= gpuName(adapter.info)
  }
  self.postMessage({ type: 'ready', device, gpu })
}

// Loop guard (Whisper repeats itself on music/noise and gets slower):
// 1) skip slices with no audible 1 s window, 2) cap tokens per 30 s chunk and forbid repeated 5-grams,
// 3) drop degenerate / third-in-a-row identical segments.
const SILENCE_RMS = 0.003
function silent(a: Float32Array) {
  for (let i = 0; i < a.length; i += SR) {
    let e = 0, n = 0
    for (let j = i; j < Math.min(i + SR, a.length); j += 4, n++) e += a[j] * a[j]
    if (n && Math.sqrt(e / n) >= SILENCE_RMS) return false
  }
  return true
}
const recent: string[] = [] // normalized text of the last kept segments (across slices)
const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim()
function repeated(n: string) {
  if (!n) return true // only music notes / punctuation
  const w = n.split(' ')
  if (w.length >= 8 && new Set(w).size / w.length < 0.3) return true // "the the the the ..."
  const [a, b] = recent.slice(-2)
  return n === a && n === b
}

// Word-level timestamps replace Whisper's own segments, so segments are rebuilt from the words: a new segment
// after sentence-ending punctuation, a pause of 1 s or more, or 15 s of speech. Same Segment shape as before.
const SENTENCE_END = /[.!?…]["')\]]?$/
function toSegments(words: Word[]): { seg: Segment; words: Word[] }[] {
  const out: { seg: Segment; words: Word[] }[] = []
  let cur: Word[] = []
  const flush = () => {
    if (!cur.length) return
    out.push({ seg: { start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map(w => w.text).join(' ') }, words: cur })
    cur = []
  }
  for (const w of words) {
    const p = cur[cur.length - 1]
    if (p && (w.start - p.end >= 1 || w.end - cur[0].start > 15 || SENTENCE_END.test(p.text))) flush()
    cur.push(w)
  }
  flush()
  return out
}

async function run(audio: Float32Array, offset: number) {
  try {
    if (silent(audio)) { self.postMessage({ type: 'result', segments: [], words: [] }); return }
    const out = await asr(audio, {
      return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5, task: 'transcribe',
      max_new_tokens: 224, no_repeat_ngram_size: 5,
    })
    const words: Word[] = []
    let last = 0
    for (const c of (out.chunks ?? []) as { text: string; timestamp: [number, number | null] }[]) {
      const text = c.text.trim()
      if (!text) continue
      const s = Math.max(last, c.timestamp[0] ?? last)
      const e = Math.max(s, c.timestamp[1] ?? s + 0.3)
      words.push({ start: offset + s, end: offset + e, text })
      last = s
    }
    const segments: Segment[] = [], kept: Word[] = []
    for (const g of toSegments(words)) {
      const n = norm(g.seg.text)
      if (repeated(n)) continue
      recent.push(n); if (recent.length > 2) recent.shift()
      segments.push(g.seg); kept.push(...g.words)
    }
    self.postMessage({ type: 'result', segments, words: kept })
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
