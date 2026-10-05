// The renderer's only door to the main process. Keys never come back through here: only whether they are set.
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { BaseEvent } from '@ag-ui/core'
import type { Anchor, ConsentRequest, Job, KeyInfo, OnDemandTool, Project, RecentProject, ToolStatus, Transcript, WhisperConfig, WhisperStatus } from '../shared/types'

const on = <T extends unknown[]>(ch: string) => (fn: (...args: T) => void) => {
  const h = (_e: unknown, ...args: unknown[]) => fn(...(args as T))
  ipcRenderer.on(ch, h)
  return () => { ipcRenderer.removeListener(ch, h) }
}

const api = {
  info: () => ipcRenderer.invoke('app:info') as Promise<{ version: string; platform: string; projectsRoot: string }>,
  pathForFile: (f: File) => webUtils.getPathForFile(f),
  tools: {
    bundled: () => ipcRenderer.invoke('tools:status') as Promise<ToolStatus[]>,
    list: () => ipcRenderer.invoke('tools:list') as Promise<OnDemandTool[]>,
    install: (id: string) => ipcRenderer.invoke('tools:install', id) as Promise<void>,
    remove: (id: string) => ipcRenderer.invoke('tools:remove', id) as Promise<void>,
  },
  whisper: {
    status: () => ipcRenderer.invoke('whisper:status') as Promise<WhisperStatus>,
    set: (c: Partial<WhisperConfig> & { mode: WhisperConfig['mode'] }) => ipcRenderer.invoke('whisper:set', c) as Promise<WhisperStatus>,
    pick: (what: 'binary' | 'model') => ipcRenderer.invoke('whisper:pick', what) as Promise<string | null>,
  },
  clips: {
    save: (dir: string, id: string, title: string, html: string, dur: number) => ipcRenderer.invoke('clip:save', dir, id, title, html, dur) as Promise<{ id: string; duration: number; video: string; poster: string; frames: number }>,
    insert: (dir: string, id: string, at: number, title: string) => ipcRenderer.invoke('clip:insert', dir, id, at, title) as Promise<string>,
    move: (dir: string, id: string, element: string, dx: number, dy: number) => ipcRenderer.invoke('clip:move', dir, id, element, dx, dy) as Promise<Project>,
    render: (dir: string, id: string) => ipcRenderer.invoke('clip:render', dir, id) as Promise<{ video: string; poster: string; frames: number; duration: number; width: number; height: number; fps: number }>,
  },
  transcript: (dir: string, mediaRel: string, make = false) => ipcRenderer.invoke('transcript:get', dir, mediaRel, make) as Promise<Transcript | null>,
  jobs: { list: () => ipcRenderer.invoke('jobs:list') as Promise<Job[]>, onChange: on<[Job[]]>('jobs') },
  consent: {
    list: () => ipcRenderer.invoke('consent:list') as Promise<ConsentRequest[]>,
    answer: (id: string, ok: boolean) => ipcRenderer.invoke('consent:answer', id, ok),
    onChange: on<[ConsentRequest[]]>('consent'),
  },
  keys: {
    list: () => ipcRenderer.invoke('keys:list') as Promise<KeyInfo[]>,
    set: (name: string, value: string) => ipcRenderer.invoke('keys:set', name, value) as Promise<KeyInfo[]>,
  },
  project: {
    recent: () => ipcRenderer.invoke('project:recent') as Promise<RecentProject[]>,
    pick: () => ipcRenderer.invoke('project:pick') as Promise<string | null>,
    create: (file: string) => ipcRenderer.invoke('project:create', file) as Promise<Project>,
    open: (dir: string) => ipcRenderer.invoke('project:open', dir) as Promise<Project>,
    close: (dir: string) => ipcRenderer.invoke('project:close', dir),
    reveal: (dir: string) => ipcRenderer.invoke('project:reveal', dir),
    import: (dir: string, file: string) => ipcRenderer.invoke('project:import', dir, file) as Promise<string>,
    decide: (dir: string, accept: boolean) => ipcRenderer.invoke('project:decide', dir, accept) as Promise<Project>,
    setCurrent: (dir: string, id: string) => ipcRenderer.invoke('project:current', dir, id) as Promise<Project>,
    onChange: on<[Project]>('project'),
  },
  agent: {
    ready: () => ipcRenderer.invoke('agent:ready') as Promise<boolean>,
    attach: (dir: string) => ipcRenderer.invoke('agent:attach', dir),
    send: (dir: string, msg: { text: string; anchor?: Anchor; still?: string }) => ipcRenderer.invoke('agent:send', dir, msg),
    stop: (dir: string) => ipcRenderer.invoke('agent:stop', dir),
    onEvent: on<[string, BaseEvent]>('agui'),
    onReady: on<[]>('agent:ready'),
  },
  onSeek: on<[string, number]>('seek'),
  onNotice: on<[string]>('notice'),
}

export type ManulApi = typeof api
contextBridge.exposeInMainWorld('manul', api)
