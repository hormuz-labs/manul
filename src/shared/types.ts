// Types shared by the main process, the preload bridge and the renderer.

/** A box on the frame, in 0–1 fractions of the picture (so it survives any player size). */
export type Box = { x: number; y: number; w: number; h: number }

/** Where a note points: a time or range, optionally a box on the frame. */
export type Anchor = { t0: number; t1?: number; box?: Box }

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
}

export type MediaInfo = {
  duration: number
  width: number
  height: number
  fps: number
  hasAudio: boolean
  codec: string
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
  /** The project's durable agent conversation. */
  conversation?: string
}

export type RecentProject = { id: string; title: string; dir: string; openedAt: number; thumb?: string }

export type KeyInfo = { env: string; label: string; unlocks: string[]; hint: string; set: boolean }

export type ToolStatus = { name: string; version?: string; path?: string; bundled: boolean; ok: boolean }
