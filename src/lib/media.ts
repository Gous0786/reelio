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

/** Decode the primary audio track to 16 kHz mono Float32 (box-filter downsample), streaming from the file. */
export async function extractAudio(file: File, onProgress: (pct: number) => void): Promise<Float32Array> {
  const input = openInput(file)
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track) throw new Error('This video has no audio track, so there is nothing to transcribe.')
    if (!(await track.canDecode())) throw new Error('This audio codec cannot be decoded by your browser.')
    const duration = await input.computeDuration()
    const out = new Float32Array(Math.ceil(duration * SAMPLE_RATE) + SAMPLE_RATE)
    let n = 0 // output samples written
    let acc = 0, cnt = 0 // box-filter accumulator
    let pos = 0 // input position in output-sample units
    for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers()) {
      const ch = buffer.numberOfChannels
      const data = Array.from({ length: ch }, (_, c) => buffer.getChannelData(c))
      const ratio = buffer.sampleRate / SAMPLE_RATE
      for (let i = 0; i < buffer.length; i++) {
        let s = 0
        for (let c = 0; c < ch; c++) s += data[c][i]
        acc += s / ch; cnt++; pos += 1 / ratio
        if (pos >= n + 1 && n < out.length) { out[n++] = acc / cnt; acc = 0; cnt = 0 }
      }
      onProgress(Math.min(100, Math.round((timestamp / duration) * 100)))
    }
    return out.subarray(0, n)
  } finally {
    input.dispose?.()
  }
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
