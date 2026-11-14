import type { Segment, Word } from './types'
import type { AudioSlice } from './media'

export type WhisperModel = 'onnx-community/whisper-base' | 'onnx-community/whisper-tiny'
export type Device = 'webgpu' | 'wasm'
/** Per-run counters from the worker: decoder steps and time in ms. */
interface RunStats { ms: number; decN: number }
/** One transcribed slice: where it is and the token ids Whisper produced for it (for timing its words later). */
export interface Piece { offset: number; len: number; tokens: number[] }

/** Starts one Whisper worker and resolves once the model is loaded. `run` transcribes one slice (the buffer is
 *  transferred) and returns segments at absolute times plus the slice's token ids; `align` times the words of known
 *  tokens. On a slice error the rejected Error carries the buffer back in `.audio`; when the worker itself dies the
 *  Error has `.fatal` set. */
export function createTranscriber(repo: string, onDownload: (pct: number) => void) {
  const worker = new Worker(new URL('../workers/whisper.worker.ts', import.meta.url), { type: 'module' })
  let pending: { resolve: (v: any) => void; reject: (e: Error) => void } | null = null
  const fail = (m: string) => { const p = pending; pending = null; p?.reject(Object.assign(new Error(m), { fatal: true })) }
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

  return call<{ device: Device; gpu: string; fallback: boolean }>({ type: 'init', repo })
    .catch(e => { worker.terminate(); throw e })
    .then(({ device, gpu, fallback }) => ({
      device,
      gpu,
      fallback,
      run: (audio: Float32Array, offset: number) =>
        call<{ segments: Segment[]; tokens: number[] | null; stats: RunStats }>({ type: 'run', audio, offset }, [audio.buffer]),
      align: (audio: Float32Array, offset: number, tokens: number[]) =>
        call<{ words: Word[] }>({ type: 'align', audio, offset, tokens }, [audio.buffer]),
      close: () => worker.terminate(),
    }))
}
export type Transcriber = Awaited<ReturnType<typeof createTranscriber>>

// ---- Worker count -------------------------------------------------------------------------------------------
// Whisper decoding on WebGPU is bound by per-token latency (a GPU round trip and JS work per step), not by GPU
// compute, so several workers overlap that latency until something shared saturates. Measured on an RTX 3050 laptop
// in Chrome (x realtime on game audio / dense speech):
//   whisper-tiny 1/2/3/4/6 workers = 27/57/62/60/58x / 13/26/26/27/24x, ~0.5 GB GPU + 1.5-2 GB RAM per worker
//   whisper-base 1/2/3/4 workers   = 22/39/38/35x / 11/20/20/20x,       ~0.8 GB GPU + 1.5-3 GB RAM per worker
// so past 2 workers more is not better.
// Auto mode: start from a guess (or the count remembered for this GPU + model), add one worker at a time while the
// aggregate decoding rate improves by >= 15%, and back off on a drop or an error. The result is remembered.
export const MAX_WORKERS = 6 // manual setting
const AUTO_MAX = 4
const GAIN = 1.15 // a worker costs 0.5-0.8 GB GPU + 1.5-3 GB RAM, and run-to-run noise on the step rate is ~10%
const STEP_EQ = 15 // one slice's fixed cost (mel features + encoder) in decoder-step equivalents
const TUNE_KEY = 'reelio_workers_v1'
interface Tuned { n: number; worse?: number } // best count; the count that measured worse (not probed again)
const tuneId = (gpu: string, device: Device, model: string) => `${device}|${gpu || '?'}|${model}`
function loadTunes(): Record<string, Tuned> { try { return JSON.parse(localStorage.getItem(TUNE_KEY) ?? '{}') } catch { return {} } }
function saveTune(id: string, t: Tuned) { try { localStorage.setItem(TUNE_KEY, JSON.stringify({ ...loadTunes(), [id]: t })) } catch { /* private mode */ } }

/** Upper bound from what the browser exposes (device memory, cores). Each worker holds its own model copy. */
function workerCap(device: Device, fallback: boolean, model: string) {
  if (device !== 'webgpu' || fallback) return 1 // WASM already uses all cores; a software GPU gains nothing
  const mem = (navigator as { deviceMemory?: number }).deviceMemory ?? 4 // Chrome reports at most 8; others nothing
  const cores = navigator.hardwareConcurrency ?? 4
  const byMem = /base/.test(model)
    ? (mem <= 4 ? 1 : mem < 8 ? 2 : 3) // base gained nothing past 2 workers and needs more memory per worker
    : (mem <= 2 ? 1 : mem <= 4 ? 2 : mem < 8 ? 3 : AUTO_MAX)
  return Math.max(1, Math.min(AUTO_MAX, byMem, cores >= 4 ? cores - 2 : 1))
}
/** First guess before anything is measured. The browser exposes too little to tell a fast GPU from a slow one
 *  (vendor and architecture only), so start at 2, best or near-best on every audio type measured, and probe up. */
const startGuess = (cap: number) => Math.min(cap, 2)

export interface TranscribeResult {
  segs: Segment[]; pieces: Piece[]; done: number; skipped: number
  fatal: unknown // set when every worker died (the transcript is partial)
  device: Device; gpu: string; workers: number; tuneLog: string[]
}
export interface TranscribeOptions {
  model: WhisperModel
  want: 'auto' | number
  slices: AsyncIterable<AudioSlice>
  onDownload: (pct: number) => void
  onReady?: (p: { device: Device; gpu: string; workers: number }) => void
  onSlice?: (sl: AudioSlice) => void // called in stream order before the slice is handed to a worker (loudness meter)
  onProgress?: (doneSeconds: number, workers: number) => void
}

/** Transcribes a stream of slices with a self-tuning pool of workers. Audio is decoded ahead into a small queue so
 *  no worker waits on the decoder. A failed slice is retried once (on another worker when there is one); a worker
 *  that errors is retired while others remain. Segments come back sorted. */
export async function transcribe(o: TranscribeOptions): Promise<TranscribeResult> {
  const first = await createTranscriber(o.model, o.onDownload)
  const cap = o.want === 'auto' ? workerCap(first.device, first.fallback, o.model) : Math.min(MAX_WORKERS, o.want)
  const id = tuneId(first.gpu, first.device, o.model)
  const stored = o.want === 'auto' ? loadTunes()[id] : undefined
  let target = o.want === 'auto' ? Math.min(cap, stored?.n ?? startGuess(cap)) : cap
  let tuning = o.want === 'auto' && target < cap && stored?.worse !== target + 1
  const tuneLog: string[] = [`cap ${cap}, start ${target}${stored ? ` (remembered ${stored.n})` : ''}`]

  // ---- decode-ahead queue
  type Job = { sl: AudioSlice; tries: number }
  const queue: Job[] = []
  let ended = false, stopped = false, wake: (() => void) | null = null, room: (() => void) | null = null
  const notify = () => { const w = wake; wake = null; w?.() }
  const depth = () => Math.max(4, 2 * target)
  const producer = (async () => {
    for await (const sl of o.slices) {
      if (stopped) break
      o.onSlice?.(sl)
      queue.push({ sl, tries: 0 }); notify()
      while (queue.length >= depth() && !stopped) await new Promise<void>(r => { room = r })
    }
  })().finally(() => { ended = true; notify() })
  const take = async (): Promise<Job | null> => {
    for (;;) {
      const j = queue.shift()
      if (j) { const r = room; room = null; r?.(); return j }
      if (ended) return null
      await new Promise<void>(r => { wake = r })
    }
  }

  // ---- pool
  const segs: Segment[] = [], pieces: Piece[] = []
  let done = 0, skipped = 0, lastErr: unknown = null
  type Lane = { tr: Transcriber; runs: number; retire: boolean }
  const lanes: Lane[] = []
  const running: Promise<void>[] = []
  let peak = 0, spawning = false
  const alive = () => lanes.filter(l => !l.retire).length
  // measurements: per finished (non-first, non-silent) slice, with the pool size it ran under
  const recs: { n: number; ms: number; work: number; t: number }[] = []
  let since = 0 // only slices started after the last pool change count
  let best: { n: number; rate: number } | null = null

  const finishTuning = (n: number, worse?: number) => {
    tuning = false
    tuneLog.push(`settled on ${n}${worse ? ` (${worse} was worse)` : ''}`)
    if (o.want === 'auto') saveTune(id, { n, worse })
  }
  const grow = () => {
    target++
    tuneLog.push(`trying ${target}`)
    spawning = true
    void spawn().then(ok => { spawning = false; if (!ok) { target--; finishTuning(target, target + 1) } })
  }
  const shrinkTo = (n: number) => { // retire the newest lanes; each stops after its current slice
    target = n
    for (const l of [...lanes].reverse()) if (alive() > n && !l.retire) l.retire = true
  }
  const measure = () => {
    if (!tuning || spawning) return
    const n = alive()
    const rs = recs.filter(r => r.t >= since && r.n === n)
    if (rs.length < Math.max(3, 2 * n)) return
    const rate = n * rs.reduce((a, r) => a + r.work, 0) / rs.reduce((a, r) => a + r.ms, 0) // steps per ms, all lanes
    tuneLog.push(`${n} workers: ${(rate * 1000).toFixed(0)} steps/s`)
    if (!best || rate >= best.rate * GAIN) {
      best = { n, rate }
      if (n < cap) grow(); else finishTuning(n)
    } else { shrinkTo(best.n); finishTuning(best.n, n) }
  }

  const lane = async (l: Lane) => {
    for (;;) {
      if (l.retire) break
      const j = await take()
      if (!j) break
      const t = performance.now(), n = alive()
      try {
        const r = await l.tr.run(j.sl.audio.slice(), j.sl.offset) // a copy: the original stays for a retry
        const len = j.sl.audio.length / 16000
        segs.push(...r.segments)
        if (r.tokens?.length) pieces.push({ offset: j.sl.offset, len, tokens: r.tokens })
        done += len
        // tuner sample: decoder steps (+ the slice's fixed cost) per ms; each worker's first slice is a warm-up
        if (l.runs++ > 0 && r.stats.decN > 0) recs.push({ n, ms: performance.now() - t, work: r.stats.decN + STEP_EQ, t })
        o.onProgress?.(done, alive())
        measure()
      } catch (e) {
        lastErr = e
        if (++j.tries >= 2) skipped++
        else { queue.unshift(j); notify() } // another lane (or this one) takes it next
        const isFatal = !!(e as { fatal?: boolean }).fatal
        if (isFatal || alive() > 1) { // drop this worker; remember that this many did not work
          l.retire = true
          if (o.want === 'auto') finishTuning(Math.max(1, alive()), alive() + 1)
          target = Math.max(1, alive())
          break
        }
      }
    }
    l.tr.close()
  }
  const spawn = async (tr?: Transcriber): Promise<boolean> => {
    try {
      tr ??= await createTranscriber(o.model, () => {})
      const l: Lane = { tr, runs: 0, retire: false }
      lanes.push(l)
      peak = Math.max(peak, alive())
      since = performance.now()
      running.push(lane(l))
      return true
    } catch (e) { tuneLog.push(`a worker failed to start: ${e instanceof Error ? e.message : e}`); return false }
  }

  await spawn(first) // transcription starts now; the other workers load from the browser cache meanwhile
  o.onReady?.({ device: first.device, gpu: first.gpu, workers: target })
  if (target > 1) {
    spawning = true
    const extra = await Promise.all(Array.from({ length: target - 1 }, () => spawn()))
    spawning = false
    if (extra.some(ok => !ok)) { target = alive(); tuning = false; tuneLog.push(`only ${target} worker(s) could start`) }
  }
  // lanes can be added while running, so wait until every lane (including late ones) has finished
  for (let k = 0; k < running.length; k++) await running[k]
  const allDied = !alive() && (queue.length > 0 || !ended)
  stopped = true; (room as (() => void) | null)?.() // release the producer if it waits for queue space
  skipped += queue.length
  await producer.catch(e => { lastErr = e })
  if (tuning && best) finishTuning((best as { n: number }).n) // the video ended mid-probe: keep what was measured
  segs.sort((x, y) => x.start - y.start); pieces.sort((x, y) => x.offset - y.offset)
  const fatal = allDied ? lastErr : null
  if (fatal && !segs.length) throw fatal
  return { segs, pieces, done, skipped, fatal, device: first.device, gpu: first.gpu, workers: peak, tuneLog }
}

// ---- Word timestamps on demand --------------------------------------------------------------------------------
/** One worker with the '<model>_timestamped' export, started on first use (or `warm()`). `words` times the words of
 *  the given transcribed pieces (one decoder pass each, see align() in the worker) at absolute times. `read` must
 *  return a piece's audio decoded as in the main pass. Jobs run one after another. */
export function createWordTimer(model: WhisperModel, onDownload: (pct: number) => void = () => {}) {
  let tr: Promise<Transcriber> | null = null
  let chain: Promise<unknown> = Promise.resolve()
  const get = () => (tr ??= createTranscriber(`${model}_timestamped`, onDownload).catch(e => { tr = null; throw e }))
  return {
    warm: () => { void get().catch(() => {}) },
    words(pieces: Piece[], read: (p: Piece) => Promise<Float32Array>): Promise<Word[]> {
      const job = chain.then(async () => {
        const t = await get(), out: Word[] = []
        for (const p of pieces) {
          let buf = await read(p)
          for (let attempt = 0; ; attempt++) {
            try { out.push(...(await t.align(buf, p.offset, p.tokens)).words); break } catch (e) {
              const back = (e as { audio?: Float32Array }).audio
              if (!back || attempt === 1) throw e
              buf = back
            }
          }
        }
        return out
      })
      chain = job.catch(() => {})
      return job
    },
    close: () => { void tr?.then(t => t.close(), () => {}); tr = null },
  }
}
export type WordTimer = ReturnType<typeof createWordTimer>

/** Words inside segments that were kept (the loop guard drops some segments; their words go too). */
export function keepWordsInSegments(words: Word[], segs: Segment[]): Word[] {
  let k = 0
  return words.filter(w => {
    const mid = (w.start + w.end) / 2
    while (k < segs.length && segs[k].end + 0.5 < mid) k++
    for (let i = k; i < segs.length && segs[i].start - 0.5 <= mid; i++) if (mid <= segs[i].end + 0.5) return true
    return false
  })
}
