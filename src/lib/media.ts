import {
  ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, AudioBufferSink, type VideoSample,
} from 'mediabunny'
import type { Rect } from './facecam'
import { facecamComposer } from './facecamLayout'
import { buildTrack, drawCaptions, loadCaptionFont, type CaptionConfig, type CaptionLayout } from './captions'

export const SAMPLE_RATE = 16000

export function checkSupport(): string | null {
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined' || typeof AudioEncoder === 'undefined')
    return 'This browser has no WebCodecs support. Please use a recent Chrome, Edge or Safari on desktop.'
  return null
}

const openInput = (file: File) => new Input({ source: new BlobSource(file), formats: ALL_FORMATS })

// Slice length: one Whisper window (30 s) each, cut at the quietest 0.2 s between 24 and 30 s, so Whisper needs no
// overlapping chunks and short slices keep every worker busy until the end.
const SLICE_TARGET_S = 24
const SLICE_SLACK_S = 6

export interface AudioSlice { audio: Float32Array; offset: number }

/** Open the file's audio (prefers an English-tagged track, else the first) and stream it as 24-30 s slices of
 *  16 kHz mono Float32, cut near silence. Memory stays bounded: only one slice (+ a small buffer) exists at a time. */
export async function openAudio(file: File) {
  const input = openInput(file)
  const close = () => input.dispose?.()
  try {
    const tracks = await input.getAudioTracks()
    const track = tracks.find(t => t.languageCode === 'eng') ?? tracks[0]
    if (!track) throw new Error('This video has no audio track, so there is nothing to transcribe.')
    if (!(await track.canDecode())) throw new Error('This audio codec cannot be decoded by your browser.')
    const duration = await input.computeDuration()

    /** `from`/`to` (seconds) limit the stream to part of the file; offsets stay absolute. */
    async function* slices(from = 0, to = Infinity, target = SLICE_TARGET_S, slack = SLICE_SLACK_S): AsyncGenerator<AudioSlice> {
      const buf = new Float32Array((target + slack + 10) * SAMPLE_RATE)
      let n = 0, offset = Math.round(from * SAMPLE_RATE) // samples buffered; absolute start (in samples) of buf[0]
      let acc = 0, cnt = 0, pos = 0 // box-filter downsampler state
      const cut = () => { // quietest 0.2 s window in [target, min(n, target + slack))
        const w = SAMPLE_RATE / 5
        let best = target * SAMPLE_RATE, bestE = Infinity
        for (let i = best; i + w <= Math.min(n, (target + slack) * SAMPLE_RATE); i += w) {
          let e = 0
          for (let j = i; j < i + w; j += 8) e += buf[j] * buf[j]
          if (e < bestE) { bestE = e; best = i }
        }
        return best + w / 2
      }
      for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers(from, to)) {
        const ch = buffer.numberOfChannels
        const data = Array.from({ length: ch }, (_, c) => buffer.getChannelData(c))
        const step = SAMPLE_RATE / buffer.sampleRate
        const i0 = from > 0 ? Math.max(0, Math.ceil((from - timestamp) * buffer.sampleRate)) : 0 // the first buffer may start early
        const i1 = Math.min(buffer.length, Math.ceil((to - timestamp) * buffer.sampleRate))
        for (let i = i0; i < i1; i++) {
          let v = 0
          for (let c = 0; c < ch; c++) v += data[c][i]
          acc += v / ch; cnt++; pos += step
          if (pos >= 1) { pos -= 1; buf[n++] = acc / cnt; acc = 0; cnt = 0 }
        }
        if (n >= (target + slack) * SAMPLE_RATE) {
          const c = Math.min(cut(), n)
          yield { audio: buf.slice(0, c), offset: offset / SAMPLE_RATE }
          buf.copyWithin(0, c, n); n -= c; offset += c
        }
      }
      if (n > SAMPLE_RATE / 2) yield { audio: buf.slice(0, n), offset: offset / SAMPLE_RATE }
    }
    return { duration, slices, close }
  } catch (e) { close(); throw e }
}

export type Fit = 'cover' | 'blur'
const OW = 720, OH = 1280

/** Per-frame compositor for 'blur': whole frame scaled to width over a blurred, zoomed (cover) copy of itself.
 *  The blur is cheap: draw the frame into a tiny canvas (with a small blur) and upscale it. */
function blurComposer() {
  const out = new OffscreenCanvas(OW, OH), ctx = out.getContext('2d')!
  const tiny = new OffscreenCanvas(90, 160), tctx = tiny.getContext('2d')!
  tctx.filter = 'blur(2px)'
  ctx.imageSmoothingQuality = 'high'
  return (s: VideoSample) => {
    const sw = s.displayWidth, sh = s.displayHeight
    const k = Math.max(tiny.width / sw, tiny.height / sh)
    s.draw(tctx, (tiny.width - sw * k) / 2, (tiny.height - sh * k) / 2, sw * k, sh * k)
    ctx.drawImage(tiny, 0, 0, OW, OH)
    const fh = (sh * OW) / sw
    s.draw(ctx, 0, (OH - fh) / 2, OW, fh)
    return out
  }
}

type Compose = (s: VideoSample) => OffscreenCanvas

/** Centre crop as a per-frame compositor (only used when captions are on: the plain 'crop' option is used otherwise). */
function coverComposer(sx: number, sy: number, sw: number, sh: number): Compose {
  const out = new OffscreenCanvas(OW, OH), ctx = out.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  return s => { s.draw(ctx, sx, sy, sw, sh, 0, 0, OW, OH); return out }
}

/** Wraps any compositor so the captions are drawn on top of each composed frame. The sample timestamp is
 *  relative to the trim start, so source time = start + timestamp. */
function withCaptions(compose: Compose, cap: CaptionConfig, start: number, end: number, layout: CaptionLayout): Compose {
  const track = buildTrack(cap.words, cap.style, start, end)
  return s => {
    const out = compose(s)
    drawCaptions(out.getContext('2d')!, track, start + s.timestamp, layout)
    return out
  }
}

/** Render [start, end] of the original file as a 720x1280 H.264/AAC MP4: centre-cropped ('cover') or
 *  whole frame over a blurred copy of itself ('blur'), or the facecam layout when a facecam rectangle is given.
 *  `captions` burns word-timed captions into every mode. */
export async function exportClip(file: File, start: number, end: number, fit: Fit, onProgress: (pct: number) => void, facecam?: Rect | null, captions?: CaptionConfig | null): Promise<Blob> {
  if (captions) await loadCaptionFont() // the MP4 must use the same font as the preview
  const input = openInput(file)
  try {
    const vt = await input.getPrimaryVideoTrack()
    if (!vt) throw new Error('No video track found.')
    const w = vt.displayWidth, h = vt.displayHeight
    const cw = Math.min(w, Math.floor((h * 9) / 16)), ch = Math.min(h, Math.floor((w * 16) / 9))
    const cropW = cw & ~1, cropH = ch & ~1
    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })
    const crop = { left: Math.floor((w - cropW) / 2), top: Math.floor((h - cropH) / 2), width: cropW, height: cropH }
    const composed = (compose: Compose, layout: CaptionLayout) => ({
      codec: 'avc' as const, process: captions ? withCaptions(compose, captions, start, end, layout) : compose, processedWidth: OW, processedHeight: OH,
    })
    const conv = await Conversion.init({
      input, output,
      trim: { start, end },
      video: facecam ? composed(facecamComposer(facecam), 'facecam')
        : fit === 'blur' ? composed(blurComposer(), 'blur')
        : captions ? composed(coverComposer(crop.left, crop.top, crop.width, crop.height), 'cover')
        : {
          codec: 'avc',
          crop,
          width: OW, height: OH, fit: 'fill',
        },
      audio: { codec: 'aac' },
    })
    if (!conv.isValid) throw new Error('This video cannot be exported in your browser (unsupported codec).')
    conv.onProgress = p => onProgress(Math.round(p * 100))
    await conv.execute()
    return new Blob([output.target.buffer!], { type: 'video/mp4' })
  } finally {
    input.dispose?.()
  }
}
