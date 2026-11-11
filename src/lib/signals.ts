import type { Loud, Segment } from './types'

// Measured audio/transcript signals used by the reranker. Everything is derived from a per-second loudness
// timeline (RMS + clipped-sample fraction) collected while the audio streams through transcription, plus the transcript.
const SR = 16000
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const round4 = (x: number) => Math.round(x * 1e4) / 1e4

/** Accumulates per-second RMS and clipped fraction from 16 kHz mono slices (call once per slice, before it is transferred). */
export class LoudnessMeter {
  private ss: number[] = []
  private n: number[] = []
  private cl: number[] = []
  add(audio: Float32Array, offset: number) {
    for (let i = 0; i < audio.length; i++) {
      const b = Math.floor(offset + i / SR)
      while (this.ss.length <= b) { this.ss.push(0); this.n.push(0); this.cl.push(0) }
      const x = audio[i]
      this.ss[b] += x * x
      this.n[b]++
      if (x >= 0.95 || x <= -0.95) this.cl[b]++
    }
  }
  finish(): Loud {
    return {
      rms: this.ss.map((v, i) => (this.n[i] ? round4(Math.sqrt(v / this.n[i])) : 0)),
      clip: this.cl.map((v, i) => (this.n[i] ? round4(v / this.n[i]) : 0)),
    }
  }
}

export interface Baseline { median: number; wps: number } // median RMS of non-silent seconds; words/second over the whole video

export function baseline(loud: Loud, segs: Segment[]): Baseline {
  const live = loud.rms.filter(v => v > 0.002).sort((a, b) => a - b)
  const words = segs.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0)
  return { median: live[Math.floor(live.length / 2)] || 0.01, wps: words / Math.max(1, loud.rms.length) }
}

const speechSecs = (segs: Segment[], s: number, e: number) => { // per-second "speech present" flags for [s, e)
  const out: boolean[] = []
  for (let t = Math.floor(s); t < Math.ceil(e); t++) {
    let ov = 0
    for (const g of segs) ov += Math.max(0, Math.min(g.end, t + 1) - Math.max(g.start, t))
    out.push(ov >= 0.5)
  }
  return out
}

export interface Facts {
  dur: number
  speechCoverage: number // fraction of seconds with transcript speech
  wordsPerSec: number
  loudVsBaseline: number // p90 per-second RMS inside the clip / video median
  hookSpeech: number // fraction of the first 3 s with speech
  hookLevel: number // mean RMS of the first 3 s / video median
  deadAir: number // fraction of seconds with no speech and quieter than the stream's typical level
  clippedPct: number // % of samples at full scale (approximate: after downsampling)
}
export type Measured = { hook: number; pacing: number; clarity: number; reaction: number } // each 0-10

/** Measured facts and the four signal-backed dimension scores for [s, e]. */
export function measure(s: number, e: number, segs: Segment[], loud: Loud, base: Baseline): { facts: Facts; scores: Measured } {
  const sp = speechSecs(segs, s, e)
  const i0 = Math.floor(s)
  const rms = sp.map((_, i) => loud.rms[i0 + i] ?? 0)
  const clip = sp.map((_, i) => loud.clip[i0 + i] ?? 0)
  const n = Math.max(1, sp.length)
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)
  const sorted = [...rms].sort((a, b) => a - b)
  const words = segs.filter(g => g.end > s && g.start < e).reduce((c, g) => c + g.text.split(/\s+/).filter(Boolean).length, 0)
  const facts: Facts = {
    dur: e - s,
    speechCoverage: sp.filter(Boolean).length / n,
    wordsPerSec: words / Math.max(1, e - s),
    loudVsBaseline: (sorted[Math.floor(0.9 * (n - 1))] || 0) / base.median,
    hookSpeech: sp.slice(0, 3).filter(Boolean).length / Math.max(1, Math.min(3, n)),
    hookLevel: mean(rms.slice(0, 3)) / base.median,
    deadAir: sp.filter((v, i) => !v && rms[i] < base.median).length / n,
    clippedPct: mean(clip) * 100,
  }
  const hook = 10 * (0.5 * facts.hookSpeech + 0.5 * clamp01(facts.hookLevel / 1.5))
  // Thresholds calibrated on real stream audio, where speech is dense and loudness steady: 25%+ dead air = 0 pacing;
  // clarity needs speech nearly throughout and a level above the stream's typical one; clipping only subtracts.
  const pacing = 10 * (1 - clamp01(facts.deadAir / 0.25))
  const level = clamp01((mean(rms) / base.median - 0.6) / 0.8)
  const clarity = mean(rms) < 0.003 ? 0 : 10 * (0.5 * clamp01(facts.speechCoverage / 0.9) + 0.5 * level) * (1 - 0.5 * clamp01(facts.clippedPct / 2))
  const reaction = 10 * (0.6 * clamp01((facts.loudVsBaseline - 1) / 2) + 0.4 * clamp01(facts.wordsPerSec / Math.max(0.01, base.wps) - 1))
  return { facts, scores: { hook, pacing, clarity, reaction } }
}

/** Windows [start, end] around the strongest loudness peaks (3 s smoothed, >= 1.5x the median, 45 s apart). */
export function loudWindows(loud: Loud, base: Baseline, count = 6, before = 12, after = 13): [number, number][] {
  const n = loud.rms.length
  const sm = loud.rms.map((_, i) => { let a = 0, c = 0; for (let j = i - 1; j <= i + 1; j++) if (j >= 0 && j < n) { a += loud.rms[j]; c++ } return a / c })
  const order = sm.map((v, i) => i).filter(i => sm[i] >= 1.5 * base.median).sort((a, b) => sm[b] - sm[a])
  const picked: number[] = []
  for (const i of order) { if (picked.length >= count) break; if (picked.every(p => Math.abs(p - i) >= 45)) picked.push(i) }
  return picked.map(p => [Math.max(0, p - before), Math.min(n, p + after)] as [number, number]).filter(([a, b]) => b - a >= 12)
}

const SENT_END = /[.!?…]["')\]]?\s*$/
const nearest = (xs: number[], t: number, within: number) => {
  let best: number | undefined
  for (const x of xs) if (Math.abs(x - t) <= within && (best === undefined || Math.abs(x - t) < Math.abs(best - t))) best = x
  return best
}

/** Trim dead air at the head, then snap start/end to sentence edges (within 4 s). Keeps 12-90 s. */
export function refineBounds(start: number, end: number, segs: Segment[], loud: Loud, base: Baseline): [number, number] {
  let s = start, e = end
  const sp = speechSecs(segs, s, e)
  const alive = sp.findIndex((v, i) => v || (loud.rms[Math.floor(s) + i] ?? 0) >= 0.6 * base.median)
  if (alive >= 2 && alive <= 0.4 * (e - s)) s = Math.max(s, Math.floor(s) + alive - 0.3)
  const sorted = [...segs].sort((a, b) => a.start - b.start)
  const starts = sorted.filter((g, i) => i === 0 || SENT_END.test(sorted[i - 1].text)).map(g => g.start)
  const ends = sorted.filter(g => SENT_END.test(g.text)).map(g => g.end)
  const ns = nearest(starts, s, 4), ne = nearest(ends, e, 4)
  if (ns !== undefined && ((ne ?? e) - ns) >= 12) s = ns
  if (ne !== undefined && (ne - s) >= 12 && (ne - s) <= 90) e = ne
  return [Math.round(s * 10) / 10, Math.round(e * 10) / 10]
}
