export interface Segment { start: number; end: number; text: string }
export interface Clip { start: number; end: number; title: string; hook: string; reason: string; score: number; caption?: string; hashtags?: string[]; rank?: RankInfo }
export interface FindClipsOptions {
  apiKey?: string // OpenRouter
  geminiKey?: string // Google Gemini, tried first when set
  force?: boolean // bypass the cached clip result
  maxClips?: number
  onProgress?: (msg: string) => void
  onAnswered?: (by: string) => void // which provider/model produced (or cached) the result
}

/** Per-second loudness collected during transcription: RMS and fraction of clipped samples. */
export interface Loud { rms: number[]; clip: number[] }

// Reranker output (see rank.ts for the rubric and weights)
export type Dim = 'arc' | 'hook' | 'context' | 'reaction' | 'novelty' | 'pacing' | 'clarity' | 'discussion'
export interface DimScore { score: number; model?: number; measured?: number; evidence: string } // all 0-10
export interface RankInfo { total: number; dims: Record<Dim, DimScore>; capped?: boolean; stage1: number; peak?: boolean }
