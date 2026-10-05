// Types shared by the main process, the preload bridge and the renderer.
import type { Timeline } from './timeline'

/** A box on the frame, in 0–1 fractions of the picture (so it survives any player size). */
export type Box = { x: number; y: number; w: number; h: number }

/** Where a note points: a time or range, optionally a box on the frame. */
export type Anchor = { t0: number; t1?: number; box?: Box; clip?: { id: string; element?: string } }

export type Note = {
  id: string
  anchor: Anchor
  text: string
  /** Project-relative path of the frame still sent to the agent (box drawn on it). */
  still?: string
  status: 'open' | 'resolved'
  /** The agent's one-line answer when it resolved the note. */
  reply?: string
  createdAt: number
}

/** One cut of the film. The first is the imported source; the agent's renders add more. */
export type Version = {
  id: string
  /** Project-relative media path. */
  path: string
  title: string
  createdAt: number
  by: 'import' | 'agent' | 'user'
  /** The timeline this version was rendered from (accepting it makes it the project's timeline). */
  timeline?: Timeline
}

/** A motion clip: agent-made HTML + GSAP in clips/<id>/, rendered frame-exact to clip.mp4. */
export type ClipInfo = { id: string; title: string; duration: number; video: string; poster: string; updatedAt: number; /** transparent, laid over the footage */ overlay?: boolean }

export type MediaInfo = {
  duration: number
  width: number
  height: number
  fps: number
  hasAudio: boolean
  codec: string
  bitrate?: number
  pixfmt?: string
}

export type Project = {
  id: string
  title: string
  dir: string
  createdAt: number
  versions: Version[]
  /** Id of the version on screen. */
  current: string
  /** A version the agent proposed and the user has not accepted or rejected yet. */
  proposal?: string
  notes: Note[]
  media: Record<string, MediaInfo>
  /** What the film is made of (media segments and motion clips); rendering it makes a version. */
  timeline?: Timeline
  /** Motion clips by id. */
  clips?: Record<string, ClipInfo>
  /** media path → its light preview copy (project-relative), for footage too heavy to play smoothly */
  proxies?: Record<string, string>
  /** media path → transcript path (both project-relative) */
  transcripts?: Record<string, string>
  /** The model the user picked for this project (else the best available). */
  model?: { provider: string; modelId: string }
  /** The project's durable agent conversation on screen. */
  conversation?: string
  /** Every conversation in this project (newest last); titles come from the first message. */
  conversations?: { id: string; title: string; createdAt: number }[]
}

export type RecentProject = { id: string; title: string; dir: string; openedAt: number; thumb?: string }

export type KeyInfo = { env: string; label: string; unlocks: string[]; hint: string; set: boolean }

export type ToolStatus = { name: string; version?: string; path?: string; bundled: boolean; ok: boolean }

/** A tool Manul downloads only when it is first needed. */
export type OnDemandTool = {
  id: string
  name: string
  description: string
  /** Approximate download + install size, for the consent card. */
  sizeMB: number
  installed: boolean
  /** Bytes on disk when installed. */
  diskBytes?: number
  version?: string
  /** Other tools it needs (installed first, same consent). */
  needs?: string[]
}

export type Job = {
  id: string
  title: string
  /** Shown once it finished, e.g. "Installed Whisper". */
  doneTitle?: string
  kind: 'download' | 'install' | 'transcribe' | 'render' | 'import'
  project?: string
  status: 'running' | 'done' | 'failed'
  /** 0–1, or null when there is no estimate */
  progress: number | null
  detail?: string
  startedAt: number
  endedAt?: number
}

/** A permission card: the agent (or the app) waits until the user answers. */
export type ConsentRequest = { id: string; project?: string; title: string; body: string; sizeMB?: number; confirm: string }

/**
 * Which speech-to-text engine Manul uses, in order of preference when nothing is set:
 *   system   whisper.cpp already on this computer (whisper-cli + a ggml model): found automatically or set by the user
 *   bundled  Manul's own whisper.cpp, with the base model downloaded on first use
 *   managed  faster-whisper in a Python environment Manul downloads (for platforms without a bundled build)
 * mode "auto" re-detects the system engine when its saved paths disappear; "custom" keeps the user's paths as they are.
 */
export type WhisperConfig = {
  engine: 'system' | 'bundled' | 'managed'
  mode: 'auto' | 'custom'
  binary?: string
  model?: string
}

/** What the Tools dialog shows about speech recognition. */
export type WhisperStatus = {
  config?: WhisperConfig
  /** The engine that would run right now, or null when one must be installed first. */
  active: { engine: 'system' | 'bundled' | 'managed'; binary?: string; model?: string; label: string } | null
  /** whisper.cpp binaries and models found on this computer. */
  found: { binaries: string[]; models: string[] }
  managedInstalled: boolean
  /** Manul ships whisper.cpp for this platform (the model may still need downloading). */
  bundledBinary: boolean
  bundledReady: boolean
}

export type Word = { w: string; s: number; e: number; p?: number }
export type Segment = { s: number; e: number; text: string; words: Word[] }
export type Transcript = { media: string; language: string; model: string; segments: Segment[]; createdAt: number }
