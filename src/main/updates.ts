// App updates from GitHub releases (electron-updater): checked at start and every 6 hours, downloaded in the background,
// installed on the next restart (or when the user clicks Restart). apt installs are left to apt.
import { app } from 'electron'
import electronUpdater from 'electron-updater'
import { updateMode } from './update-mode'

export type UpdateState = { mode: string; why?: string; status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'none' | 'error'; version?: string; progress?: number; error?: string }

export function startUpdates(onState: (s: UpdateState) => void, beforeInstall: () => Promise<void> = async () => {}) {
  const m = updateMode({ packaged: app.isPackaged, platform: process.platform, exe: process.execPath, env: process.env })
  let state: UpdateState = { mode: m.mode, why: m.why, status: 'idle' }
  const set = (patch: Partial<UpdateState>) => { state = { ...state, ...patch }; onState(state) }
  set({})
  if (m.mode !== 'self') return { state: () => state, check: async () => state, install: () => {} }

  const { autoUpdater } = electronUpdater
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => set({ status: 'checking' }))
  autoUpdater.on('update-available', i => set({ status: 'downloading', version: i.version, progress: 0 }))
  autoUpdater.on('update-not-available', () => set({ status: 'none' }))
  autoUpdater.on('download-progress', p => set({ status: 'downloading', progress: p.percent / 100 }))
  autoUpdater.on('update-downloaded', i => set({ status: 'ready', version: i.version }))
  autoUpdater.on('error', e => set({ status: 'error', error: e.message }))
  const check = async () => { await autoUpdater.checkForUpdates().catch(e => set({ status: 'error', error: String(e.message || e) })); return state }
  setTimeout(check, 10_000)
  setInterval(check, 6 * 3600_000).unref?.()
  return { state: () => state, check, install: async () => { await beforeInstall(); autoUpdater.quitAndInstall() } }
}
