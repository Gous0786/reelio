# Reelio
Upload a long video, get ranked 9:16 clips. Video work (WebCodecs via mediabunny, Whisper via transformers.js) runs in your browser; only transcript text goes to free OpenRouter LLMs.

- Run: `npm install && npm run dev` (needs a WebCodecs browser, desktop Chrome/Edge recommended)
- Build: `npm run build`
- Deploy: push to Vercel (static Vite build + `api/chat.ts` serverless proxy)
- Env var: `OPENROUTER_API_KEY` (server-side, used by `/api/chat` when the user enters no key in Settings)
- Optional: paste your own OpenRouter key in Settings (stored in localStorage, sent straight to OpenRouter)
- Limits: audio is held in memory as 16 kHz mono (~230 MB/hour); the original file is streamed, never fully loaded
