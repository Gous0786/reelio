export interface Segment { start: number; end: number; text: string }
export interface Clip { start: number; end: number; title: string; hook: string; reason: string; score: number; caption?: string; hashtags?: string[] }
export interface FindClipsOptions {
  apiKey?: string // OpenRouter
  geminiKey?: string // Google Gemini, tried first when set
  force?: boolean // bypass the cached clip result
  maxClips?: number
  onProgress?: (msg: string) => void
  onAnswered?: (by: string) => void // which provider/model produced (or cached) the result
}
