/// <reference lib="webworker" />
// Pattern follows xenova/whisper-web: pipeline() in a worker, WebGPU if available else WASM.
// Protocol: {type:'init', repo} -> {type:'download', pct} ... {type:'ready', device, gpu, fallback}
//           {type:'run', audio, offset} -> {type:'result', segments, tokens, stats} | {type:'error', message, audio}
//           {type:'align', audio, offset, tokens} -> {type:'result', words} | {type:'error', message, audio}
// 'run' transcribes with Whisper's own segment timestamps (plain export, fast) and returns the generated token ids,
// kept so words can be timed later. 'align' times those tokens' words with the '<model>_timestamped' export (same
// weights; its decoder also outputs cross-attentions): one decoder pass over the known tokens, then the same DTW
// that Whisper word timestamps use. Generating with word timestamps instead costs ~2x per token, plus the DTW.
import { pipeline, env, Tensor } from '@huggingface/transformers'
import type { Segment, Word } from '../lib/types'

env.allowLocalModels = false
const SR = 16000
let asr: any

// Ask for the discrete GPU. (On Windows, Chrome follows the per-app OS graphics setting.)
async function gpuAdapter(): Promise<any> {
  try { return (await (self.navigator as any).gpu?.requestAdapter({ powerPreference: 'high-performance' })) ?? null } catch { return null }
}
const gpuName = (i: any) => (i ? [i.vendor, i.architecture, i.description].filter(Boolean).join(' ') : '')

let steps = 0 // decoder calls in the current run (the worker-count tuner measures time per step)
let lastTokens: number[] | null = null // token ids of the last generate() call
let fetchOnly: string[] | null = null // set during align(): the decoder returns only these outputs (no logits)
function instrument() {
  for (const [k, sess] of Object.entries(asr.model.sessions as Record<string, any>)) {
    if (k === 'model') continue // encoder
    const run = sess.run.bind(sess)
    sess.run = (f: any, ...rest: any[]) => { steps++; return run(f, ...(fetchOnly ? [fetchOnly] : rest)) }
  }
  const generate = asr.model.generate.bind(asr.model)
  asr.model.generate = async (a: any) => {
    const out = await generate(a)
    lastTokens = out instanceof Tensor ? (out.tolist() as bigint[][])[0].map(Number) : null
    return out
  }
}

async function init(repo: string) {
  const files: Record<string, { loaded: number; total: number }> = {}
  const progress_callback = (p: any) => {
    if (p.status !== 'progress' || !p.total) return
    files[p.file] = { loaded: p.loaded, total: p.total }
    const all = Object.values(files)
    const pct = Math.round((all.reduce((a, f) => a + f.loaded, 0) / all.reduce((a, f) => a + f.total, 0)) * 100)
    self.postMessage({ type: 'download', pct })
  }
  const make = (device: 'webgpu' | 'wasm') =>
    pipeline('automatic-speech-recognition', repo, {
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
  instrument()
  let gpu = ''
  if (device === 'webgpu') {
    try { gpu = gpuName((await ort?.device)?.adapterInfo) } catch { /* older ORT: fall back to our adapter */ }
    gpu ||= gpuName(adapter.info)
  }
  self.postMessage({ type: 'ready', device, gpu, fallback: !!adapter?.info?.isFallbackAdapter || !!adapter?.isFallbackAdapter })
}

// Loop guard (Whisper repeats itself on music/noise and gets slower):
// 1) skip slices with no audible 1 s window, 2) cap tokens per 30 s window and forbid repeated 5-grams,
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
const keep = (n: string) => { if (repeated(n)) return false; recent.push(n); if (recent.length > 2) recent.shift(); return true }

type Chunk = { text: string; timestamp: [number, number | null] }

async function run(audio: Float32Array, offset: number) {
  try {
    steps = 0; lastTokens = null
    if (silent(audio)) { self.postMessage({ type: 'result', segments: [], tokens: null, stats: { ms: 0, decN: 0 } }); return }
    const t0 = performance.now()
    // Slices are cut at quiet points to fit one 30 s window, so no overlapping chunks are needed (the overlap cost
    // ~35% more decoding and its merge duplicated text at the seams). Longer input falls back to chunking.
    const long = audio.length > 30 * SR
    const out = await asr(audio, {
      return_timestamps: true, chunk_length_s: long ? 30 : 0, stride_length_s: long ? 5 : undefined, task: 'transcribe',
      max_new_tokens: 224, no_repeat_ngram_size: 5,
    })
    const segments: Segment[] = []
    for (const c of (out.chunks ?? []) as Chunk[]) {
      const text = c.text.trim()
      if (!keep(norm(text))) continue
      const s = c.timestamp[0] ?? 0
      const e = c.timestamp[1] ?? Math.min(audio.length / SR, s + 5)
      segments.push({ start: offset + s, end: offset + e, text })
    }
    self.postMessage({ type: 'result', segments, tokens: long ? null : lastTokens, stats: { ms: performance.now() - t0, decN: steps } })
  } catch (err) {
    // hand the buffer back so the caller can retry this slice without re-decoding
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err), audio }, [audio.buffer])
  }
}

/** Per-token times from cross-attentions: the same steps as transformers.js' _extract_token_timestamps (normalize
 *  each alignment head per frame over the tokens, median filter along time, average the heads, DTW) on flat typed
 *  arrays; the library's generic tensor ops took ~10 ms per token. Verified identical on 929 words. `layers[l]` has
 *  dims [1, heads, T, frames]. */
function tokenTimes(layers: any[], heads: [number, number][], prefix: number, nTokens: number, width: number): number[] {
  const [, , T, F] = layers[0].dims as number[]
  const H = heads.length, half = width >> 1
  const w = new Float32Array(H * T * F)
  heads.forEach(([l, h], k) => {
    const t = layers[l].type === 'float32' ? layers[l] : layers[l].to('float32')
    w.set((t.data as Float32Array).subarray(h * T * F, (h + 1) * T * F), k * T * F)
  })
  const buf = new Float32Array(width), row = new Float32Array(F)
  for (let k = 0; k < H; k++) {
    const base = k * T * F
    for (let f = 0; f < F; f++) { // per frame: population mean / std over the tokens
      let sum = 0
      for (let t = 0; t < T; t++) sum += w[base + t * F + f]
      const mean = Math.fround(sum / T)
      let v = 0
      for (let t = 0; t < T; t++) { const d = w[base + t * F + f] - mean; v += d * d }
      const std = Math.fround(Math.sqrt(v / T))
      for (let t = 0; t < T; t++) w[base + t * F + f] = (w[base + t * F + f] - mean) / std
    }
    for (let t = 0; t < T; t++) { // median filter along time, reflected edges
      const o = base + t * F
      row.set(w.subarray(o, o + F))
      for (let f = 0; f < F; f++) {
        for (let q = -half, n = 0; q <= half; q++, n++) { // insertion sort of the window (typed-array sort() is slow here)
          let x = f + q; if (x < 0) x = -x; else if (x >= F) x = 2 * (F - 1) - x
          const v = row[x]; let i = n - 1
          while (i >= 0 && buf[i] > v) { buf[i + 1] = buf[i]; i-- }
          buf[i + 1] = v
        }
        w[o + f] = buf[half]
      }
    }
  }
  const R = T - prefix // text rows
  const m = new Float32Array(R * F) // -mean over heads
  for (let t = 0; t < R; t++) for (let f = 0; f < F; f++) {
    let a = 0
    for (let k = 0; k < H; k++) a += w[k * T * F + (t + prefix) * F + f]
    m[t * F + f] = -Math.fround(a / H)
  }
  // DTW, same tie-breaking as transformers.js
  const W = F + 1
  const cost = new Float64Array((R + 1) * W).fill(Infinity), trace = new Int8Array((R + 1) * W).fill(-1)
  cost[0] = 0
  for (let j = 1; j <= F; j++) for (let i = 1; i <= R; i++) {
    const c0 = cost[(i - 1) * W + j - 1], c1 = cost[(i - 1) * W + j], c2 = cost[i * W + j - 1]
    let c, tr
    if (c0 < c1 && c0 < c2) { c = c0; tr = 0 } else if (c1 < c0 && c1 < c2) { c = c1; tr = 1 } else { c = c2; tr = 2 }
    cost[i * W + j] = m[(i - 1) * F + j - 1] + c; trace[i * W + j] = tr
  }
  for (let j = 0; j <= F; j++) trace[j] = 2
  for (let i = 0; i <= R; i++) trace[i * W] = 1
  const ti: number[] = [], tj: number[] = []
  for (let i = R, j = F; i > 0 || j > 0;) {
    ti.push(i - 1); tj.push(j - 1)
    const tr = trace[i * W + j]
    if (tr === 0) { i--; j-- } else if (tr === 1) i--; else j--
  }
  ti.reverse(); tj.reverse()
  const jumps: number[] = []
  for (let k = 0; k < ti.length; k++) if (k === 0 || ti[k] !== ti[k - 1]) jumps.push(tj[k] * 0.02)
  const out = new Array(prefix).fill(0).concat(jumps)
  if (jumps.length) out.push(jumps[jumps.length - 1])
  while (out.length < nTokens) out.push(0)
  return out.slice(0, nTokens).map(x => Math.fround(x))
}

/** Word times for a slice whose tokens are known (from 'run' on the same audio). */
async function align(audio: Float32Array, offset: number, tokens: number[]) {
  try {
    const tb = asr.tokenizer.timestamp_begin as number
    const prefix = Math.max(0, tokens.findIndex(t => t >= tb)) // <|startoftranscript|><|en|><|transcribe|>
    const fed = tokens.slice(0, -1) // as in generation: the last token (end of text) is never fed back
    const { input_features } = await asr.processor(audio)
    fetchOnly = (asr.model.sessions.decoder_model_merged.outputNames as string[]).filter(n => n.startsWith('cross_attentions'))
    let out: any
    try { out = await asr.model({ input_features, decoder_input_ids: new Tensor('int64', BigInt64Array.from(fed.map(BigInt)), [1, fed.length]) }) } finally { fetchOnly = null }
    const layers = Object.keys(out).filter(k => k.startsWith('cross_attentions')).sort((a, b) => +a.split('.')[1] - +b.split('.')[1]).map(k => out[k])
    const times = tokenTimes(layers, asr.model.generation_config.alignment_heads, prefix, tokens.length, asr.model.config.median_filter_width ?? 7)
    for (const t of Object.values(out) as any[]) if (t?.location === 'gpu-buffer') t.dispose()
    const chunk = { tokens: tokens.slice(prefix).map(BigInt), token_timestamps: times.slice(prefix).map(x => Math.round(x * 100) / 100), stride: [audio.length / SR, 0, 0] }
    const [, opt] = asr.tokenizer._decode_asr([chunk], { time_precision: 0.02, return_timestamps: 'word', force_full_sequences: false })
    const words: Word[] = []
    let last = 0
    for (const c of (opt?.chunks ?? []) as Chunk[]) {
      const text = c.text.trim()
      if (!text) continue
      const s = Math.max(last, c.timestamp[0] ?? last)
      const e = Math.max(s, c.timestamp[1] ?? s + 0.3)
      words.push({ start: offset + s, end: offset + e, text })
      last = s
    }
    self.postMessage({ type: 'result', words })
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err), audio }, [audio.buffer])
  }
}

self.onmessage = async (e: MessageEvent) => {
  const m = e.data
  if (m.type === 'init') {
    try { await init(m.repo) } catch (err) { self.postMessage({ type: 'fatal', message: err instanceof Error ? err.message : String(err) }) }
  } else if (m.type === 'run') await run(m.audio, m.offset)
  else if (m.type === 'align') await align(m.audio, m.offset, m.tokens)
}
