import { useEffect, useRef, useState } from 'react'
import type { Clip, Segment } from './lib/types'
import { findClips } from './lib/llm'
import { checkSupport, exportClip, openAudio } from './lib/media'
import { createTranscriber, type WhisperModel } from './lib/transcribe'

type Stage = 'idle' | 'model' | 'transcribe' | 'clips' | 'done' | 'error'
const STAGES: [Stage, string][] = [['model', 'Loading speech model'], ['transcribe', 'Extracting audio & transcribing'], ['clips', 'Finding clips']]
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const dur = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ` : '') + `${Math.floor((s % 3600) / 60)}m ${Math.round(s % 60)}s`

export default function App() {
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState('')
  const [stage, setStage] = useState<Stage>('idle')
  const [status, setStatus] = useState('')
  const [error, setError] = useState<{ msg: string; retry: boolean } | null>(null)
  const [clips, setClips] = useState<Clip[]>([])
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('openrouter_key') ?? '')
  const [model, setModel] = useState<WhisperModel>('onnx-community/whisper-base')
  const [warn, setWarn] = useState('')
  const segments = useRef<Segment[] | null>(null) // cached transcript for LLM retry
  const unsupported = checkSupport()

  useEffect(() => { localStorage.setItem('openrouter_key', apiKey) }, [apiKey])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  const runClips = async (segs: Segment[]) => {
    setStage('clips'); setError(null); setStatus('Asking the LLM for the best moments…')
    try {
      setClips(await findClips(segs, { apiKey: apiKey.trim() || undefined, maxClips: 8, onProgress: setStatus }))
      setStage('done')
    } catch (e) {
      setError({ msg: `Finding clips failed: ${e instanceof Error ? e.message : e}`, retry: true }); setStage('error')
    }
  }

  const start = async (f: File) => {
    setFile(f); setUrl(URL.createObjectURL(f)); setClips([]); setError(null); setWarn(''); segments.current = null
    let audio: Awaited<ReturnType<typeof openAudio>> | null = null
    let tr: Awaited<ReturnType<typeof createTranscriber>> | null = null
    try {
      setStage('model'); setStatus('Opening file…')
      audio = await openAudio(f)
      setStatus('Downloading speech model… 0%')
      tr = await createTranscriber(model, p => setStatus(`Downloading speech model… ${p}%`))
      const device = tr.device === 'webgpu' ? 'WebGPU' : 'WASM (CPU, slower)'
      setStage('transcribe')
      const segs: Segment[] = []
      const t0 = Date.now()
      let done = 0, skipped = 0
      const report = () => {
        const el = (Date.now() - t0) / 1000
        const left = done > 0 ? ((audio!.duration - done) * el) / done : 0
        setStatus(`Transcribing… ${Math.min(100, Math.round((done / audio!.duration) * 100))}% · ${dur(el)} elapsed${done > 0 ? ` · ~${dur(left)} left · ${(done / el).toFixed(1)}× realtime` : ''} · ${device}`)
      }
      report()
      try {
        for await (const sl of audio.slices()) {
          const len = sl.audio.length / 16000
          let buf = sl.audio
          for (let attempt = 0; ; attempt++) { // one retry per slice, then skip it
            try { segs.push(...(await tr.run(buf, sl.offset))); break } catch (e) {
              const back = (e as { audio?: Float32Array }).audio
              if (!back) throw e // worker died: cannot continue
              if (attempt === 1) { skipped++; break }
              buf = back
            }
          }
          done = sl.offset + len; report()
        }
      } catch (e) {
        if (!segs.length) throw e
        setWarn(`Transcription stopped at ${fmt(done)} (${e instanceof Error ? e.message : e}); clips use the partial transcript.`)
      }
      if (skipped) setWarn(w => w || `${skipped} audio slice(s) failed and were skipped.`)
      if (!segs.length) throw new Error('No speech was detected in this video.')
      segments.current = segs
      await runClips(segs)
    } catch (e) {
      setError({ msg: e instanceof Error ? e.message : String(e), retry: false }); setStage('error')
    } finally { tr?.close(); audio?.close() }
  }

  const reset = () => { setWarn(''); setFile(null); setUrl(''); setStage('idle'); setClips([]); setError(null); segments.current = null }
  const busy = stage === 'model' || stage === 'transcribe' || stage === 'clips'
  const onFiles = (fl: FileList | null) => { const f = fl?.[0]; if (f && !busy) start(f) }

  return (
    <main>
      <header>
        <h1>Reelio</h1>
        <p>Drop a long video, get ranked vertical clips. Everything runs in your browser.</p>
      </header>

      {unsupported && <div className="error">{unsupported}</div>}

      {stage === 'idle' && !unsupported && (
        <>
          <label className="drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); onFiles(e.dataTransfer.files) }}>
            <input type="file" accept="video/*,audio/*" hidden onChange={e => onFiles(e.target.files)} />
            <strong>Drop a video here</strong>
            <span>or click to choose a file</span>
          </label>
          <details>
            <summary>Settings</summary>
            <label>OpenRouter API key (optional)
              <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-or-… (empty = use /api/chat proxy)" />
            </label>
            <label>Speech model
              <select value={model} onChange={e => setModel(e.target.value as WhisperModel)}>
                <option value="onnx-community/whisper-base">whisper-base (better)</option>
                <option value="onnx-community/whisper-tiny">whisper-tiny (faster)</option>
              </select>
            </label>
          </details>
        </>
      )}

      {file && stage !== 'idle' && (
        <div className="bar">
          <span className="name">{file.name}</span>
          <button className="ghost" onClick={reset}>New video</button>
        </div>
      )}

      {busy && (
        <ol className="stages">
          {STAGES.map(([s, label], i) => {
            const cur = STAGES.findIndex(x => x[0] === stage)
            return <li key={s} className={i < cur ? 'done' : i === cur ? 'active' : ''}>{label}{i === cur && <small>{status}</small>}</li>
          })}
        </ol>
      )}

      {warn && <div className="error">{warn}</div>}

      {error && (
        <div className="error">
          <p>{error.msg}</p>
          {error.retry && segments.current && <button onClick={() => runClips(segments.current!)}>Retry (transcript is cached)</button>}
          {!error.retry && <button onClick={reset}>Try another video</button>}
        </div>
      )}

      {stage === 'done' && (
        <section className="grid">
          {clips.length === 0 && <p>No clips were found. Try a video with more spoken content.</p>}
          {clips.map((c, i) => <ClipCard key={i} rank={i + 1} clip={c} file={file!} url={url} />)}
        </section>
      )}
    </main>
  )
}

function ClipCard({ rank, clip, file, url }: { rank: number; clip: Clip; file: File; url: string }) {
  const vid = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [pct, setPct] = useState<number | null>(null)
  const [err, setErr] = useState('')

  const toggle = () => {
    const v = vid.current!
    if (!v.paused) return v.pause()
    if (v.currentTime < clip.start || v.currentTime >= clip.end - 0.1) v.currentTime = clip.start
    v.play()
  }
  const download = async () => {
    setErr(''); setPct(0)
    try {
      const blob = await exportClip(file, clip.start, clip.end, setPct)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${file.name.replace(/\.[^.]+$/, '')}-clip${rank}.mp4`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10000)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    setPct(null)
  }

  return (
    <article className="card">
      <div className="phone" onClick={toggle}>
        <video ref={vid} src={`${url}#t=${clip.start}`} preload="metadata" playsInline
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
          onTimeUpdate={e => { if (e.currentTarget.currentTime >= clip.end) { e.currentTarget.pause(); e.currentTarget.currentTime = clip.start } }} />
        {!playing && <span className="play">▶</span>}
      </div>
      <div className="info">
        <div className="top"><span className="score">{Math.round(clip.score)}</span><span className="dur">#{rank} · {fmt(clip.start)}–{fmt(clip.end)} · {Math.round(clip.end - clip.start)}s</span></div>
        <h3>{clip.title}</h3>
        <p className="hook">“{clip.hook}”</p>
        <p className="reason">{clip.reason}</p>
        <button disabled={pct !== null} onClick={download}>{pct === null ? 'Download MP4' : `Rendering… ${pct}%`}</button>
        {err && <p className="err">{err}</p>}
      </div>
    </article>
  )
}
