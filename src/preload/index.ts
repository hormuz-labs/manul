// The renderer's only door to the main process. Keys never come back through here: only whether they are set.
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { BaseEvent } from '@ag-ui/core'
import type { Anchor, KeyInfo, Project, RecentProject, ToolStatus } from '../shared/types'

const on = <T extends unknown[]>(ch: string) => (fn: (...args: T) => void) => {
  const h = (_e: unknown, ...args: unknown[]) => fn(...(args as T))
  ipcRenderer.on(ch, h)
  return () => { ipcRenderer.removeListener(ch, h) }
}

const api = {
  info: () => ipcRenderer.invoke('app:info') as Promise<{ version: string; platform: string; projectsRoot: string }>,
  pathForFile: (f: File) => webUtils.getPathForFile(f),
  tools: () => ipcRenderer.invoke('tools:status') as Promise<ToolStatus[]>,
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
