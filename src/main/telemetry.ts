// Optional, anonymous usage reporting. Only a random installation ID and foreground/active seconds leave the app.
// The queue is kept on disk and event IDs make retries safe when an acknowledgement is lost.
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

type Event = { id: string; seconds: number }
type State = { installationId: string; pending: Event[]; activeSeconds: number }

export class UsageTelemetry {
  private state: State
  private lastTick: number
  private sending = false
  private request: AbortController | undefined
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(private opts: {
    file: string
    endpoint: string
    enabled: () => boolean
    focused: () => boolean
    idleSeconds: () => number
    now?: () => number
    post?: typeof fetch
  }) {
    try {
      const saved = JSON.parse(readFileSync(opts.file, 'utf8')) as State
      this.state = saved.installationId && Array.isArray(saved.pending) && Number.isFinite(saved.activeSeconds) ? saved : this.empty()
    } catch { this.state = this.empty() }
    this.lastTick = this.now()
  }

  private empty(): State { return { installationId: randomUUID(), pending: [], activeSeconds: 0 } }
  private now() { return (this.opts.now || performance.now)() }
  private save() { writeFileSync(this.opts.file, JSON.stringify(this.state)) }

  start() {
    if (!this.opts.endpoint) return
    this.timer = setInterval(() => { this.tick(); void this.flush() }, 15_000)
    this.timer.unref?.()
    void this.flush() // retry events from a previous run
  }

  tick() {
    const now = this.now()
    // A suspended computer must not turn a single timer tick into hours of "use".
    const seconds = Math.min(15, Math.max(0, (now - this.lastTick) / 1000))
    this.lastTick = now
    if (!this.opts.endpoint || !this.opts.enabled() || !this.opts.focused() || this.opts.idleSeconds() >= 60) return
    this.state.activeSeconds += seconds
    this.save()
  }

  async flush() {
    if (!this.opts.endpoint || !this.opts.enabled() || this.sending) return
    if (this.state.activeSeconds >= 60) {
      const seconds = Math.min(3600, Math.floor(this.state.activeSeconds))
      this.state.pending.push({ id: randomUUID(), seconds })
      this.state.activeSeconds -= seconds
      this.save()
    }
    const event = this.state.pending[0]
    if (!event) return
    this.sending = true
    const request = new AbortController()
    this.request = request
    try {
      const timeout = setTimeout(() => request.abort(), 5000)
      try {
        const res = await (this.opts.post || fetch)(`${this.opts.endpoint.replace(/\/$/, '')}/v1/usage`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ installationId: this.state.installationId, eventId: event.id, activeSeconds: event.seconds }),
          signal: request.signal,
        })
        if (!res.ok) throw new Error(`Telemetry HTTP ${res.status}`)
        if (this.opts.enabled()) {
          this.state.pending = this.state.pending.filter(p => p.id !== event.id)
          this.save()
        }
      } finally { clearTimeout(timeout) }
    } catch { /* Offline: keep the same event ID for the next attempt. */ }
    finally { this.request = undefined; this.sending = false }
  }

  setEnabled(enabled: boolean) {
    this.lastTick = this.now()
    if (enabled) { void this.flush(); return }
    // Stop reporting and discard unsent activity when the user opts out.
    this.request?.abort()
    this.state = this.empty()
    this.save()
  }

  stop() { if (this.timer) clearInterval(this.timer); this.tick() }
}
