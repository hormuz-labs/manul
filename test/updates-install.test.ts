import { afterEach, expect, it, vi } from 'vitest'

const updater = vi.hoisted(() => ({ on: vi.fn(), checkForUpdates: vi.fn().mockResolvedValue(null), quitAndInstall: vi.fn(), autoDownload: false, autoInstallOnAppQuit: false }))
vi.mock('electron', () => ({ app: { isPackaged: true } }))
vi.mock('electron-updater', () => ({ default: { autoUpdater: updater } }))
vi.mock('../src/main/update-mode', () => ({ updateMode: () => ({ mode: 'self' }) }))
import { startUpdates } from '../src/main/updates'

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })
it('waits for bounded app cleanup before handing control to the update installer', async () => {
  vi.useFakeTimers()
  let cleaned!: () => void
  const cleanup = new Promise<void>(resolve => { cleaned = resolve })
  const updates = startUpdates(() => {}, () => cleanup)
  const installing = updates.install()
  expect(updater.quitAndInstall).not.toHaveBeenCalled()
  cleaned()
  await installing
  expect(updater.quitAndInstall).toHaveBeenCalledOnce()
})
