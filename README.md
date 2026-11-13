# Reelio

**Turn a long video into ready-to-post vertical shorts, for free, right in your browser.**

Live at **https://reelio.page** · If it's useful, a star on GitHub helps a lot.

Drop in a long video (a stream recording, podcast, lecture, gameplay). Reelio finds the strongest moments, ranks them, and exports 9:16 MP4 clips with captions. The heavy work happens on your device.

## Core features

- **Finds and ranks the best moments.** An LLM proposes clips, then each one is scored on hook, story arc, context, reaction, novelty, pacing, clarity and discussion, combined with loudness signals measured from your own audio.
- **Local transcription.** Whisper runs in your browser on WebGPU (CPU fallback). If the video already has subtitles, or you drop a `.srt` / `.vtt` / `.ass` file with it, transcription is skipped.
- **Burned-in captions.** Word-timed, in three styles: highlight, clean and pop.
- **Smart framing.** Centre crop, fit + blur, or a stacked layout with the facecam on top (detected automatically, adjustable).
- **Edit before you export.** Preview, scrub, and trim with a slider or nudge buttons.
- **One-click export.** 720×1280 H.264/AAC MP4, one clip or all of them at once.
- **Remembers your work.** Transcripts and clip results are cached per video, so reopening a file is instant.

## How to use it

1. Get a free API key from [Google AI Studio](https://aistudio.google.com/apikey) (Gemini) and/or [OpenRouter](https://openrouter.ai/keys). One key is enough.
2. Open **Settings** and paste the key. (The in-app **How to** walks through this.)
3. Drop a video onto the page. Desktop Chrome or Edge is recommended. Add a subtitle file with it if you have one.
4. Wait for transcription (progress and speed are shown), then press **Find clips**.
5. Review the ranked clips, trim them, pick a framing and caption style.
6. Download one clip, or **Download all**.

## How it works

```
video → audio decoded in the browser (WebCodecs) → Whisper on WebGPU, or your subtitles
      → transcript + loudness timeline
      → LLM picks candidate clips (Gemini first, OpenRouter as fallback) → reranker scores them
      → you preview and trim
      → the chosen range is re-encoded to 9:16 MP4 in the browser, captions drawn on every frame
```

Built with React, Vite and Tailwind, [transformers.js](https://github.com/huggingface/transformers.js) for Whisper and [mediabunny](https://github.com/Vanilagy/mediabunny) for decoding and encoding. There is no backend.

## Free, local and open source

- **Free.** No account, no subscription, no server costs. You bring your own free LLM key.
- **Local.** Your video and audio never leave your device. Only the transcript text is sent to the LLM provider you choose. Your keys stay in your browser's local storage and go only to their own provider. The Whisper model downloads once from Hugging Face and is cached by the browser.
- **Open source.** The whole app is in this repository, a static site you can read, run and host yourself.

## Run it yourself

```bash
npm install
npm run dev      # development server
npm run build    # static site in dist/ (no server code, no environment variables)
```

Host `dist/` on any static host (for example Vercel with the Vite preset). Needs a browser with WebCodecs; WebGPU makes transcription much faster. Audio is held in memory as 16 kHz mono (about 230 MB per hour of video); the original file is streamed, never fully loaded.

Page metadata and the sitemap are hand-written; `node scripts/brand-assets.mjs` regenerates icons and share images (needs Chrome).

## Licences

Bundled third-party work and its licences are listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
