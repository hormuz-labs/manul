// Folds the AG-UI event stream from the main process into what the agent panel draws, per project.
import { useEffect, useSyncExternalStore } from 'react'
import { EventType, type BaseEvent, type Message } from '@ag-ui/core'

export type AgentState = {
  messages: Message[]
  /** Assistant text still streaming. */
  streaming: { id: string; text: string } | null
  /** Tool calls whose arguments are still streaming: id → name + partial JSON. */
  pending: Record<string, { name: string; args: string }>
  /** Tool calls executing now. */
  running: string[]
  busy: boolean
  error: string | null
  cost: number
}

const empty = (): AgentState => ({ messages: [], streaming: null, pending: {}, running: [], busy: false, error: null, cost: 0 })

type Ev = BaseEvent & Record<string, any>

export function reduce(s: AgentState, e: Ev): AgentState {
  switch (e.type) {
    case EventType.RUN_STARTED: return { ...s, busy: true, error: null }
    case EventType.RUN_FINISHED: return { ...s, busy: false, streaming: null, pending: {}, running: [] }
    case EventType.RUN_ERROR: return { ...s, error: e.message }
    case EventType.TEXT_MESSAGE_START: return { ...s, streaming: { id: e.messageId, text: '' } }
    case EventType.TEXT_MESSAGE_CONTENT: return { ...s, streaming: { id: e.messageId, text: (s.streaming && s.streaming.id === e.messageId ? s.streaming.text : '') + e.delta } }
    case EventType.TEXT_MESSAGE_END: return { ...s, streaming: null }
    case EventType.TOOL_CALL_START: return { ...s, pending: { ...s.pending, [e.toolCallId]: { name: e.toolCallName, args: '' } } }
    case EventType.TOOL_CALL_ARGS: {
      const p = s.pending[e.toolCallId]
      return p ? { ...s, pending: { ...s.pending, [e.toolCallId]: { ...p, args: p.args + e.delta } } } : s
    }
    case EventType.TOOL_CALL_END: { const { [e.toolCallId]: _, ...rest } = s.pending; return { ...s, pending: rest } }
    case EventType.ACTIVITY_SNAPSHOT: return e.activityType === 'tools' ? { ...s, running: e.content?.running || [] } : s
    case EventType.MESSAGES_SNAPSHOT: return { ...s, messages: e.messages }
    case EventType.CUSTOM: return e.name === 'manul.usage' ? { ...s, cost: e.value?.cost || 0 } : s
    default: return s
  }
}

// one store for every open project; events arrive tagged with the project's folder
const states = new Map<string, AgentState>()
const listeners = new Set<() => void>()
let wired = false
function wire() {
  if (wired) return
  wired = true
  window.manul.agent.onEvent((dir, e) => {
    states.set(dir, reduce(states.get(dir) || empty(), e as Ev))
    listeners.forEach(l => l())
  })
}

export function useAgent(dir: string | null): AgentState {
  useEffect(() => { wire(); if (dir) window.manul.agent.attach(dir) }, [dir])
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb) },
    () => (dir && states.get(dir)) || EMPTY,
  )
}
const EMPTY = empty()

/** Tool results by call id, from the committed messages. */
export function resultsOf(messages: Message[]) {
  const out: Record<string, { content: string; error?: boolean }> = {}
  for (const m of messages) if (m.role === 'tool') out[m.toolCallId] = { content: String(m.content ?? ''), error: !!(m as { error?: string }).error }
  return out
}
