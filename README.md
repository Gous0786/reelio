# Reelio
Upload a long video, get ranked 9:16 clips. Video work (WebCodecs via mediabunny, Whisper via transformers.js) runs in your browser; only transcript text goes to the LLM you choose (Gemini or OpenRouter, with your own free key).

- Run: `npm install && npm run dev` (needs a WebCodecs browser, desktop Chrome/Edge recommended)
- Build: `npm run build` (a purely static site in `dist/`, no server code or environment variables)
- Deploy: any static host (for example Vercel: Vite preset, build `npm run build`, output `dist`)
- Keys: paste a free Gemini key and/or OpenRouter key in Settings (the in-app "How to" explains where to get them). They are stored in localStorage and sent only to their own provider. Gemini is tried first, OpenRouter is the fallback; one key is enough. Without a key the video is still transcribed, clip finding waits for a key.
- Subtitles: a video with embedded text subtitles, or a `.srt`/`.vtt` file dropped with it, skips transcription
- Limits: audio is held in memory as 16 kHz mono (~230 MB/hour); the original file is streamed, never fully loaded
- Licences of bundled third-party work: see `THIRD_PARTY_NOTICES.md`
