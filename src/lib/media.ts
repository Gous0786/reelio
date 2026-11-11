import {
  ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, AudioBufferSink,
} from 'mediabunny'

export const SAMPLE_RATE = 16000

export function checkSupport(): string | null {
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined' || typeof AudioEncoder === 'undefined')
    return 'This browser has no WebCodecs support. Please use a recent Chrome, Edge or Safari on desktop.'
  return null
}

const openInput = (file: File) => new Input({ source: new BlobSource(file), formats: ALL_FORMATS })

const SLICE_TARGET_S = 90 // slice length; cut at the quietest 0.2 s within the next 15 s
const SLICE_SLACK_S = 15

export interface AudioSlice { audio: Float32Array; offset: number }

/** Open the file's audio (prefers an English-tagged track, else the first) and stream it as ~90 s slices of
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

    async function* slices(): AsyncGenerator<AudioSlice> {
      const buf = new Float32Array((SLICE_TARGET_S + SLICE_SLACK_S + 10) * SAMPLE_RATE)
      let n = 0, offset = 0 // samples buffered; absolute start (in samples) of buf[0]
      let acc = 0, cnt = 0, pos = 0 // box-filter downsampler state
      const cut = () => { // quietest 0.2 s window in [target, n)
        const w = SAMPLE_RATE / 5
        let best = SLICE_TARGET_S * SAMPLE_RATE, bestE = Infinity
        for (let i = best; i + w <= n; i += w) {
          let e = 0
          for (let j = i; j < i + w; j += 8) e += buf[j] * buf[j]
          if (e < bestE) { bestE = e; best = i }
        }
        return best + w / 2
      }
      for await (const { buffer } of new AudioBufferSink(track).buffers()) {
        const ch = buffer.numberOfChannels
        const data = Array.from({ length: ch }, (_, c) => buffer.getChannelData(c))
        const step = SAMPLE_RATE / buffer.sampleRate
        for (let i = 0; i < buffer.length; i++) {
          let v = 0
          for (let c = 0; c < ch; c++) v += data[c][i]
          acc += v / ch; cnt++; pos += step
          if (pos >= 1) { pos -= 1; buf[n++] = acc / cnt; acc = 0; cnt = 0 }
        }
        if (n >= (SLICE_TARGET_S + SLICE_SLACK_S) * SAMPLE_RATE) {
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

/** Render [start, end] of the original file as a 720x1280 center-cropped H.264/AAC MP4. */
export async function exportClip(file: File, start: number, end: number, onProgress: (pct: number) => void): Promise<Blob> {
  const input = openInput(file)
  try {
    const vt = await input.getPrimaryVideoTrack()
    if (!vt) throw new Error('No video track found.')
    const w = vt.displayWidth, h = vt.displayHeight
    const cw = Math.min(w, Math.floor((h * 9) / 16)), ch = Math.min(h, Math.floor((w * 16) / 9))
    const cropW = cw & ~1, cropH = ch & ~1
    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })
    const conv = await Conversion.init({
      input, output,
      trim: { start, end },
      video: {
        codec: 'avc',
        crop: { left: Math.floor((w - cropW) / 2), top: Math.floor((h - cropH) / 2), width: cropW, height: cropH },
        width: 720, height: 1280, fit: 'fill',
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
