import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, LazyMotion, MotionConfig, domAnimation } from 'motion/react'
import * as m from 'motion/react-m'
import { CircleHelp, Crop, Database, KeyRound, Maximize2, FilePlus2, FileVideo, Play, RefreshCw, ScanText, Sparkles } from 'lucide-react'
import type { Clip, Loud, Segment, Word } from './lib/types'
import { findClips } from './lib/llm'
import { findRankedClips } from './lib/rank'
import { LoudnessMeter } from './lib/signals'
import { checkSupport, exportClip, openAudio, type Fit } from './lib/media'
import { cacheKey, delTranscript, getTranscript, putTranscript } from './lib/cache'
import { createPool, type WhisperModel } from './lib/transcribe'
import { cleanCues, cuesToTranscript, parseSidecar, pickTrack, scanSubtitles, trackLabel, usable, type SubScan, type SubTrack } from './lib/subtitles'
import { detectFacecam, type FacecamSetting } from './lib/facecam'
import type { CaptionConfig } from './lib/captions'
import { facecamKey, getFacecam, putFacecam } from './lib/facecamStore'
import { dur, fmt, outName, save } from './lib/format'
import FluidMorphBg from './components/vengeance/FluidMorphBg'
import CaptionControls, { useCaptionSettings } from './components/CaptionControls'
import ClipCard from './components/ClipCard'
import FacecamPanel from './components/FacecamPanel'
import DropZone from './components/DropZone'
import { Anim } from './components/Illustrations'
import MomentMap, { DownloadAll } from './components/MomentMap'
import ThemeSwitcher from './components/ThemeSwitcher'
import { useTheme } from './lib/theme'
import ProgressView, { NO_INFO, type RunInfo, type Stage } from './components/ProgressView'
import Segmented from './components/Segmented'
import SettingsDrawer from './components/SettingsDrawer'
import { HowToDialog, HowToSection } from './components/HowTo'
import SubtitleSource from './components/SubtitleSource'
import { Alert, Button, Chip } from './components/ui'

export default function App() {
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState('')
  const [stage, setStage] = useState<Stage>('idle')
  const [status, setStatus] = useState('')
  const [info, setInfo] = useState<RunInfo>(NO_INFO)
  const [error, setError] = useState<{ msg: string; retry: boolean } | null>(null)
  const [clips, setClips] = useState<Clip[]>([])
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('openrouter_key') ?? '')
  const [geminiKey, setGeminiKey] = useState(() => localStorage.getItem('gemini_key') ?? '')
  const [answeredBy, setAnsweredBy] = useState('')
  const [modelPref, setModelPref] = useState<'auto' | WhisperModel>('auto')
  const [workerPref, setWorkerPref] = useState<'auto' | '1' | '2' | '3'>('auto')
  const [warn, setWarn] = useState('')
  const [fit, setFit] = useState<Fit>(() => (localStorage.getItem('reelio_fit') === 'blur' ? 'blur' : 'cover'))
  const [cached, setCached] = useState(false)
  const [all, setAll] = useState<{ i: number; n: number; p: number } | null>(null) // "download all" progress
  const [allErr, setAllErr] = useState('')
  const [renders, setRenders] = useState(0) // single-clip exports in flight
  const [needKey, setNeedKey] = useState(false) // transcript is ready but no LLM key is set yet
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [howTo, setHowTo] = useState(false)
  const [allDone, setAllDone] = useState(false) // brief 'all saved' state (presentation only)
  const [theme, setTheme] = useTheme()
  const loud = useRef<Loud | null>(null) // per-second loudness (from transcription) for the reranker
  const segments = useRef<Segment[] | null>(null) // cached transcript for LLM retry
  const [words, setWords] = useState<Word[]>([]) // word timings for the captions
  // set when the transcript comes from subtitles instead of Whisper
  const [subs, setSubs] = useState<{ tracks: SubTrack[]; trackId: string; label: string } | null>(null)
  const scan = useRef<SubScan | null>(null) // raw cues of every text track (switching track needs no new scan)
  const side = useRef<File | null>(null) // sidecar .srt/.vtt dropped with the video
  const [fc, setFc] = useState<FacecamSetting | null>(null) // facecam setting for the current video
  const [fcBusy, setFcBusy] = useState(false)
  const fcAbort = useRef<AbortController | null>(null)
  const fcRect = fc?.enabled ? fc.rect : null // set = the stacked facecam layout is on
  const [capSet, setCapSet] = useCaptionSettings()
  const captions: CaptionConfig | null = capSet.on && words.length ? { words, style: capSet.style } : null
  const unsupported = checkSupport()
  const hasKey = !!(apiKey.trim() || geminiKey.trim())

  useEffect(() => { localStorage.setItem('openrouter_key', apiKey) }, [apiKey])
  useEffect(() => { localStorage.setItem('gemini_key', geminiKey) }, [geminiKey])
  useEffect(() => { localStorage.setItem('reelio_fit', fit) }, [fit])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  const runClips = async (segs: Segment[], force = false) => {
    if (!hasKey) { // no key: ask for one instead of sending a request that can only fail
      setNeedKey(true); setClips([]); setError(null); setAnsweredBy(''); setStage('done'); return
    }
    setNeedKey(false)
    setStage('clips'); setError(null); setAnsweredBy(''); setStatus('Asking the LLM for the best moments…')
    try {
      const o = {
        apiKey: apiKey.trim() || undefined, geminiKey: geminiKey.trim() || undefined, force, maxClips: 8,
        onProgress: setStatus, onAnswered: setAnsweredBy,
      }
      setClips(await (loud.current ? findRankedClips(segs, loud.current, o) : findClips(segs, o)))
      setStage('done')
    } catch (e) {
      setError({ msg: `Finding clips failed: ${e instanceof Error ? e.message : e}`, retry: true }); setStage('error')
    }
  }

  // Facecam: restore the saved setting, else detect (runs beside transcription; failure just means "none").
  const runFacecam = async (f: File) => {
    fcAbort.current?.abort()
    const ctl = fcAbort.current = new AbortController()
    setFc(null); setFcBusy(true)
    const key = facecamKey(f)
    let s = await getFacecam(key)
    if (!s) {
      const r = await detectFacecam(f, ctl.signal)
      s = { rect: r?.rect ?? null, enabled: !!r, confidence: r?.confidence ?? 0, detected: !!r }
      if (r !== undefined && !ctl.signal.aborted) putFacecam(key, s)
    }
    if (ctl.signal.aborted) return
    setFc(s); setFcBusy(false)
  }
  const setFacecam = (s: FacecamSetting) => { setFc(s); if (file) putFacecam(facecamKey(file), s) }

  const subsKey = (f: File) => {
    const sc = side.current
    return cacheKey(f, sc ? `subs:${sc.name}:${sc.size}:${sc.lastModified}` : 'subs') // the key records the source
  }
  /** Subtitle path: use embedded text subtitles (or the sidecar file) as the transcript, with only a fast audio pass for
   *  the loudness timeline. Returns false (after saying why) when there are none / they look unusable: Whisper then runs. */
  const fromSubtitles = async (f: File, audio: Awaited<ReturnType<typeof openAudio>>, force: boolean): Promise<boolean> => {
    const key = subsKey(f)
    setInfo(i => ({ ...i, model: 'Subtitles', device: 'Audio pass only, no speech model', subs: '' }))
    setStage('model'); setStatus('Looking for subtitles…')
    const hit = force ? undefined : await getTranscript(key)
    if (hit?.subs && hit.segs.length) {
      scan.current = { tracks: hit.subs.tracks, cues: hit.subs.cues }
      const t = hit.subs.tracks.find(x => x.id === hit.subs!.trackId)!
      segments.current = hit.segs; loud.current = hit.loud; setWords(hit.words); setCached(true)
      const label = `${trackLabel(t)} · ${hit.segs.length.toLocaleString()} cues`
      setSubs({ tracks: hit.subs.tracks, trackId: t.id, label }); setInfo(i => ({ ...i, subs: label }))
      await runClips(hit.segs); return true
    }
    const sc = side.current
    const found = sc ? await parseSidecar(sc) : await scanSubtitles(f, p => { setInfo(i => ({ ...i, download: Math.round(p * 100) })); setStatus(`Looking for subtitles… ${Math.round(p * 100)}%`) })
    const track = pickTrack(found.tracks)
    const bitmap = found.tracks.length > 0 && !track
    const tr = track && cuesToTranscript(cleanCues(found.cues[track.id] ?? [], track.codec))
    const why = !tr ? (bitmap ? 'only image subtitles were found, which cannot be read' : '') : usable(tr.segs, audio.duration)
    if (!track || !tr || why) {
      setInfo(i => ({ ...i, subs: null, model: null, device: null, download: null }))
      if (why) setWarn(`Subtitles were found but look unusable (${why}), so Whisper is transcribing instead.`)
      return false
    }
    scan.current = found
    const label = `${trackLabel(track)} · ${tr.segs.length.toLocaleString()} cues`
    setSubs({ tracks: found.tracks, trackId: track.id, label }); setInfo(i => ({ ...i, subs: label, download: null }))
    // Loudness only: stream the audio through the meter (no speech model).
    setStage('transcribe')
    const meter = new LoudnessMeter(), t0 = Date.now()
    let done = 0
    for await (const sl of audio.slices()) {
      meter.add(sl.audio, sl.offset); done += sl.audio.length / 16000
      const el = (Date.now() - t0) / 1000, left = ((audio.duration - done) * el) / done
      setStatus(`Using subtitles (${label}). Measuring loudness… ${Math.min(100, Math.round((done / audio.duration) * 100))}% · ${dur(el)} elapsed`)
      setInfo(i => ({ ...i, pct: Math.min(100, Math.round((done / audio.duration) * 100)), elapsed: el, left, speed: done / el }))
    }
    console.info(`[reelio] subtitles: ${tr.segs.length} cues, loudness pass ${((Date.now() - t0) / 1000).toFixed(1)}s for ${Math.round(audio.duration)}s of audio`)
    segments.current = tr.segs; loud.current = meter.finish(); setWords(tr.words)
    await putTranscript(key, { segs: tr.segs, loud: loud.current, words: tr.words, subs: { tracks: found.tracks, cues: found.cues, trackId: track.id } })
    await runClips(tr.segs, force)
    return true
  }
  const switchTrack = async (id: string) => {
    const f = file, sc = scan.current, t = sc?.tracks.find(x => x.id === id)
    if (!f || !sc || !t || !loud.current) return
    const tr = cuesToTranscript(cleanCues(sc.cues[id] ?? [], t.codec))
    const why = usable(tr.segs, loud.current.rms.length)
    if (why) { setWarn(`That subtitle track looks unusable (${why}).`); return }
    setWarn(''); setCached(false)
    const label = `${trackLabel(t)} · ${tr.segs.length.toLocaleString()} cues`
    setSubs({ tracks: sc.tracks, trackId: id, label }); setInfo(i => ({ ...i, subs: label }))
    segments.current = tr.segs; setWords(tr.words)
    void putTranscript(subsKey(f), { segs: tr.segs, loud: loud.current, words: tr.words, subs: { tracks: sc.tracks, cues: sc.cues, trackId: id } })
    await runClips(tr.segs)
  }

  const start = async (f: File, force = false, whisper = false) => {
    void runFacecam(f)
    setSubs(null); scan.current = null; setNeedKey(false)
    setFile(f); setUrl(URL.createObjectURL(f)); setClips([]); setError(null); setWarn(''); setCached(false); setAllErr(''); setAnsweredBy(''); segments.current = null; setWords([]); loud.current = null; setInfo(NO_INFO)
    let audio: Awaited<ReturnType<typeof openAudio>> | null = null
    let tr: Awaited<ReturnType<typeof createPool>> | null = null
    try {
      setStage('model'); setStatus('Opening file…')
      audio = await openAudio(f)
      if (!whisper && await fromSubtitles(f, audio, force)) return
      const model: WhisperModel = modelPref !== 'auto' ? modelPref : 'onnx-community/whisper-tiny'
      const mname = model.split('/')[1]
      setInfo(i => ({ ...i, model: mname }))
      const key = cacheKey(f, model)
      if (force) await delTranscript(key)
      else {
        const hit = await getTranscript(key)
        if (hit?.segs.length) { segments.current = hit.segs; loud.current = hit.loud; setWords(hit.words ?? []); setCached(true); await runClips(hit.segs); return }
      }
      setStatus(`Downloading ${mname}… 0%`)
      tr = await createPool(model, workerPref === 'auto' ? 'auto' : Number(workerPref), p => { setStatus(`Downloading ${mname}… ${p}%`); setInfo(i => ({ ...i, download: p })) })
      const pool = tr.workers
      const device = `${mname}${pool.length > 1 ? ` × ${pool.length} workers` : ''} · ` + (tr.device === 'webgpu' ? `WebGPU${tr.gpu ? ` (${tr.gpu})` : ''}` : 'WASM (CPU, slower)')
      setInfo(i => ({ ...i, workers: pool.length, device: tr!.device === 'webgpu' ? 'WebGPU' : 'WASM (CPU, slower)', gpu: tr!.gpu || null }))
      if (tr.device === 'webgpu' && /intel/i.test(tr.gpu))
        setWarn('Running on the Intel iGPU. For the NVIDIA GPU: Windows Settings › Display › Graphics › Chrome › High performance, then restart Chrome.')
      setStage('transcribe')
      const segs: Segment[] = [], wds: Word[] = []
      const meter = new LoudnessMeter()
      const t0 = Date.now()
      let done = 0, skipped = 0, partial = false
      const report = () => {
        const el = (Date.now() - t0) / 1000
        const left = done > 0 ? ((audio!.duration - done) * el) / done : 0
        setStatus(`Transcribing… ${Math.min(100, Math.round((done / audio!.duration) * 100))}% · ${dur(el)} elapsed${done > 0 ? ` · ~${dur(left)} left · ${(done / el).toFixed(1)}× realtime` : ''} · ${device}`)
        setInfo(i => ({ ...i, pct: Math.min(100, Math.round((done / audio!.duration) * 100)), elapsed: el, left: done > 0 ? left : null, speed: done > 0 ? done / el : null }))
      }
      report()
      // One lane per worker. Lanes pull the next slice only when their worker is idle, so at most one slice per
      // worker (plus the generator's own buffer) is in memory. Segments arrive out of order; sorted below.
      const it = audio.slices()
      let fatal: unknown = null
      const lane = async (w: (typeof pool)[number]) => {
        for (;;) {
          const { value: sl, done: end } = await it.next()
          if (end) return
          const len = sl.audio.length / 16000
          meter.add(sl.audio, sl.offset) // before the buffer is handed to the worker
          let buf = sl.audio
          try {
            for (let attempt = 0; ; attempt++) { // one retry per slice, then skip it
              try { const r = await w.run(buf, sl.offset); segs.push(...r.segments); wds.push(...r.words); break } catch (e) {
                const back = (e as { audio?: Float32Array }).audio
                if (!back) throw e // worker died: this lane stops
                if (attempt === 1) { skipped++; break }
                buf = back
              }
            }
          } catch (e) { fatal ??= e; return }
          done += len; report()
        }
      }
      await Promise.all(pool.map(lane))
      segs.sort((x, y) => x.start - y.start); wds.sort((x, y) => x.start - y.start)
      if (fatal) {
        if (!segs.length) throw fatal
        partial = true
        setWarn(`A transcription worker stopped (${fatal instanceof Error ? fatal.message : fatal}) after ${fmt(done)} of audio; clips use the partial transcript.`)
      }
      if (skipped) setWarn(w => w || `${skipped} audio slice(s) failed and were skipped.`)
      if (!segs.length) throw new Error('No speech was detected in this video.')
      segments.current = segs; setWords(wds)
      loud.current = meter.finish()
      if (!partial && !skipped) await putTranscript(key, { segs, loud: loud.current, words: wds })
      await runClips(segs, force)
    } catch (e) {
      setError({ msg: e instanceof Error ? e.message : String(e), retry: false }); setStage('error')
    } finally { tr?.close(); audio?.close() }
  }

  const reset = () => { fcAbort.current?.abort(); setFc(null); setFcBusy(false); setWarn(''); setCached(false); setAnsweredBy(''); setAllErr(''); setFile(null); setUrl(''); setStage('idle'); setClips([]); setError(null); setInfo(NO_INFO); segments.current = null; setWords([]); loud.current = null; setSubs(null); scan.current = null; side.current = null; setNeedKey(false) }
  const busy = stage === 'model' || stage === 'transcribe' || stage === 'clips'
  const trim = (i: number, t: { start: number; end: number }) => setClips(cs => cs.map((c, j) => (j === i ? { ...c, ...t } : c)))
  const downloadAll = async () => {
    setAllErr(''); setAllDone(false)
    let ok = true
    for (let i = 0; i < clips.length; i++) {
      try {
        const blob = await exportClip(file!, clips[i].start, clips[i].end, fit, p => setAll({ i, n: clips.length, p }), fcRect, captions)
        save(blob, outName(file!, i + 1))
      } catch (e) { setAllErr(`Clip ${i + 1}: ${e instanceof Error ? e.message : e}`); ok = false; break }
    }
    setAll(null)
    if (ok) { setAllDone(true); setTimeout(() => setAllDone(false), 4000) }
  }
  const onFiles = (f: File, sidecar?: File) => { if (!busy) { side.current = sidecar ?? null; start(f) } }
  const gpuBusy = busy || all !== null || renders > 0
  const allPct = all ? Math.round(((all.i + all.p / 100) / all.n) * 100) : 0

  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domAnimation} strict>
        <FluidMorphBg paused={gpuBusy} />
        <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-3 pt-3 pb-12 sm:px-6 sm:pt-5">
          <header className="slab mb-5 flex items-center justify-between gap-3 rounded-full py-2 pr-2 pl-2.5 sm:mb-6">
            <button type="button" onClick={() => !busy && reset()} className="group flex items-center gap-2.5 rounded-full pr-2" aria-label="Reelio home">
              <span className="relative grid h-10 w-7 place-items-center rounded-lg border-2 border-edge bg-accent text-on-accent transition group-hover:-rotate-6">
                <Play className="size-3.5 translate-x-px" fill="currentColor" aria-hidden />
              </span>
              <span className="text-left">
                <span className="font-display block text-xl leading-none font-bold tracking-tight text-fg">reelio</span>
                <span className="hidden text-[11px] text-muted sm:block">Long video to ranked shorts</span>
              </span>
            </button>
            <div className="flex items-center gap-2">
              <ThemeSwitcher value={theme} onChange={setTheme} />
              <Button variant="secondary" size="sm" icon={<CircleHelp className="size-4" />} aria-label="How to use Reelio" onClick={() => setHowTo(true)}>
                <span className="hidden sm:inline">How to</span>
              </Button>
              <SettingsDrawer {...{ geminiKey, apiKey, modelPref, workerPref, fit, setGeminiKey, setApiKey, setModelPref, setWorkerPref, setFit, theme, setTheme }}
                open={settingsOpen} onOpenChange={setSettingsOpen} onHowTo={() => { setSettingsOpen(false); setHowTo(true) }} />
            </div>
          </header>

          <main className="flex flex-1 flex-col gap-5">
            {unsupported && <Alert tone="error" title="This browser can't run Reelio">{unsupported}</Alert>}

            <AnimatePresence mode="wait" initial={false}>
              {stage === 'idle' && !unsupported && (
                <m.div key="idle" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
                  <DropZone onFile={onFiles} />
                  <div className="mt-5"><HowToSection onSettings={() => setSettingsOpen(true)} /></div>
                </m.div>
              )}
            </AnimatePresence>

            {file && stage !== 'idle' && (
              <m.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="slab flex flex-wrap items-center justify-between gap-3 p-3.5 sm:p-4" aria-label="Current video">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-12 shrink-0 place-items-center rounded-2xl border-2 border-edge bg-accent text-on-accent"><FileVideo className="size-6" aria-hidden /></span>
                  <div className="min-w-0">
                    <p className="font-display truncate text-base font-bold text-fg" title={file.name}>{file.name}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Chip>{(file.size / 1048576).toFixed(file.size > 1e9 ? 0 : 1)} MB</Chip>
                      {stage === 'done' && !needKey && <Chip tone="accent"><Sparkles className="size-3" aria-hidden />{clips.length} clip{clips.length === 1 ? '' : 's'}</Chip>}
                      {subs && stage === 'done' && <SubtitleSource label={subs.label} tracks={subs.tracks} trackId={subs.trackId} onPick={switchTrack} disabled={busy} />}
                      {cached && stage !== 'model' && <Chip tone="good"><Database className="size-3" aria-hidden />Transcript from cache</Chip>}
                      {answeredBy && stage === 'done' && <Chip className="max-w-full"><span className="truncate" title={answeredBy}>via {answeredBy}</span></Chip>}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!busy && segments.current && !needKey && (
                    <Button size="sm" title="Ask the LLM again, ignoring the cached clip result" icon={<RefreshCw className="size-3.5" />} onClick={() => runClips(segments.current!, true)}>Find clips again</Button>
                  )}
                  {!busy && (
                    <Button size="sm" title={subs ? 'Ignore the subtitles and transcribe the audio with Whisper' : 'Ignore the cached transcript and transcribe again'} icon={<ScanText className="size-3.5" />} onClick={() => start(file, true, true)}>{subs ? 'Transcribe with Whisper instead' : 'Re-transcribe'}</Button>
                  )}
                  <Button size="sm" variant="ghost" icon={<FilePlus2 className="size-3.5" />} onClick={reset}>New video</Button>
                </div>
              </m.section>
            )}

            {file && stage !== 'idle' && <FacecamPanel url={url} setting={fc} detecting={fcBusy} onChange={setFacecam} />}

            {busy && (
              <m.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <ProgressView stage={stage} status={status} info={info} />
              </m.div>
            )}

            {warn && <Alert tone="warn" title="Heads up">{warn}</Alert>}

            {error && (
              <Alert
                tone="error" title={error.retry ? 'Could not find clips' : 'Something went wrong'}
                actions={<>
                  {error.retry && segments.current && <Button variant="primary" size="sm" icon={<RefreshCw className="size-3.5" />} onClick={() => runClips(segments.current!, true)}>Retry (transcript is cached)</Button>}
                  {!error.retry && <Button variant="primary" size="sm" icon={<FilePlus2 className="size-3.5" />} onClick={reset}>Try another video</Button>}
                </>}
              >{error.msg}</Alert>
            )}

            {stage === 'clips' && (
              <div className="grid gap-5 lg:grid-cols-2" aria-hidden>
                {[0, 1].map(i => (
                  <div key={i} className="slab flex gap-5 p-5">
                    <div className="aspect-9/16 w-[40%] max-w-52 rounded-[1.9rem] border-[7px] border-bezel bg-bezel">
                      <div className="animate-shimmer size-full rounded-[1.35rem] bg-[linear-gradient(90deg,var(--raised),color-mix(in_oklab,var(--accent)_22%,var(--raised)),var(--raised))] bg-[length:200%_100%]" />
                    </div>
                    <div className="flex flex-1 flex-col gap-3 pt-2">
                      <div className="size-12 rounded-full bg-fg/10" />
                      {[70, 95, 80, 45].map((w, j) => <div key={j} className="h-3 rounded-full bg-fg/10" style={{ width: `${w}%` }} />)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {stage === 'done' && (
              <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-5">
                {clips.length > 0 && (
                  <MomentMap clips={clips} url={url}>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between" aria-label="Export options" role="group">
                      <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-center gap-3">
                        <span className="font-display w-24 text-sm font-bold text-fg">Framing</span>
                        <Segmented label="Framing" value={fcRect ? 'cover' : fit} onChange={setFit} disabled={!!fcRect} options={[
                          { value: 'cover', label: <><Crop className="size-3.5" />Centre crop</>, hint: 'Fill the 9:16 frame' },
                          { value: 'blur', label: <><Maximize2 className="size-3.5" />Fit + blur</>, hint: 'Whole picture over a blurred background' },
                        ]} />
                        {fcRect && <Chip tone="hot">Facecam layout is on</Chip>}
                        </div>
                        <CaptionControls value={capSet} onChange={setCapSet} available={words.length > 0} />
                      </div>
                      <DownloadAll n={clips.length} all={all} pct={allPct} done={allDone} disabled={all !== null || renders > 0} onClick={downloadAll} />
                    </div>
                  </MomentMap>
                )}
                {allErr && <Alert tone="error">{allErr}</Alert>}

                {clips.length === 0 && needKey && (
                  <div className="slab flex flex-col items-center gap-3 px-6 py-12 text-center" role="status">
                    <Anim name="sparkles" className="size-24" />
                    <p className="eyebrow">One more step</p>
                    <h2 className="font-display text-3xl font-bold text-fg uppercase">Add a free key to find clips</h2>
                    <p className="max-w-md text-sm text-muted">Your video is transcribed. Picking the best moments needs one free API key, from Gemini or OpenRouter. Paste it in Settings, then press Find clips.</p>
                    <div className="mt-2 flex flex-wrap justify-center gap-2">
                      <Button variant={hasKey ? 'secondary' : 'primary'} size="lg" icon={<KeyRound className="size-4" />} onClick={() => setSettingsOpen(true)}>Open Settings</Button>
                      <Button size="lg" icon={<CircleHelp className="size-4" />} onClick={() => setHowTo(true)}>How to get a key</Button>
                      <Button variant={hasKey ? 'primary' : 'secondary'} size="lg" disabled={!hasKey || !segments.current} icon={<Sparkles className="size-4" />} onClick={() => runClips(segments.current!)}>Find clips</Button>
                    </div>
                  </div>
                )}
                {clips.length === 0 && !needKey && (
                  <div className="slab flex flex-col items-center gap-3 px-6 py-12 text-center">
                    <Anim name="search" className="size-24" />
                    <p className="eyebrow">Nothing picked</p>
                    <h2 className="font-display text-3xl font-bold text-fg uppercase">No clips found</h2>
                    <p className="max-w-sm text-sm text-muted">The model did not pick any moments. Try a video with more spoken content, or ask again.</p>
                    {segments.current && <Button variant="primary" size="lg" className="mt-2" icon={<RefreshCw className="size-4" />} onClick={() => runClips(segments.current!, true)}>Find clips again</Button>}
                  </div>
                )}

                <section className="grid gap-5 lg:grid-cols-2" aria-label="Clips">
                  {clips.map((c, i) => (
                    <m.div key={i} initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: Math.min(i, 5) * 0.06, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
                      <ClipCard rank={i + 1} clip={c} file={file!} url={url} fit={fcRect ? 'cover' : fit} fc={fcRect} captions={captions} locked={all !== null}
                        onTrim={t => trim(i, t)} onRendering={a => setRenders(n => Math.max(0, n + (a ? 1 : -1)))} />
                    </m.div>
                  ))}
                </section>
              </m.div>
            )}
          </main>

          <footer className="slab mx-auto mt-10 flex max-w-3xl flex-col items-center gap-1 rounded-3xl px-5 py-3 text-center text-xs text-muted">
            <p className="font-semibold text-fg">Video and audio stay on your device. Only the transcript text is sent to the LLM.</p>
          </footer>
          <HowToDialog open={howTo} onOpenChange={setHowTo} onSettings={() => { setHowTo(false); setSettingsOpen(true) }} />
        </div>
      </LazyMotion>
    </MotionConfig>
  )
}
