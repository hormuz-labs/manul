// The native menu. Items send a command id to the window; the renderer runs the same command the ⌘K palette runs.
import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

export function buildMenu(win: () => BrowserWindow | null) {
  const cmd = (id: string, label: string, accelerator?: string): MenuItemConstructorOptions =>
    ({ label, accelerator, click: () => win()?.webContents.send('menu', id) })
  const mac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ label: 'Manul', submenu: [
      { role: 'about' }, { type: 'separator' },
      cmd('settings', 'Settings…', 'CmdOrCtrl+,'), cmd('settings.tools', 'Tools…'), { type: 'separator' },
      { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
    ] } as MenuItemConstructorOptions] : []),
    { label: 'File', submenu: [
      cmd('home', 'New Project', 'CmdOrCtrl+N'),
      cmd('media', 'Add Media…', 'CmdOrCtrl+I'),
      cmd('export', 'Export…', 'CmdOrCtrl+E'),
      { type: 'separator' },
      cmd('reveal', 'Show Project in Finder'),
      ...(mac ? [] : [{ type: 'separator' } as MenuItemConstructorOptions, cmd('settings', 'Settings…', 'CmdOrCtrl+,'), { role: 'quit' } as MenuItemConstructorOptions]),
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [
      cmd('palette', 'Command Palette…', 'CmdOrCtrl+K'),
      cmd('transcript', 'Transcript', 'CmdOrCtrl+Shift+T'),
      cmd('history', 'History', 'CmdOrCtrl+Shift+H'),
      { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
      ...(app.isPackaged ? [] : [{ type: 'separator' } as MenuItemConstructorOptions, { role: 'reload' } as MenuItemConstructorOptions, { role: 'toggleDevTools' } as MenuItemConstructorOptions]),
    ] },
    { label: 'Agent', submenu: [
      cmd('agent.new', 'New Conversation', 'CmdOrCtrl+Shift+N'),
      cmd('agent.focus', 'Ask Manul', 'CmdOrCtrl+L'),
      cmd('agent.stop', 'Stop', 'CmdOrCtrl+.'),
      { type: 'separator' },
      cmd('settings.skills', 'Skills…'), cmd('settings.memory', 'Memory…'), cmd('settings.keys', 'Keys…'),
    ] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [
      { label: 'Roadmap', click: () => shell.openExternal('https://github.com/hormuz-labs/manul/blob/main/ROADMAP.md') },
      { label: 'Report a Problem', click: () => shell.openExternal('https://github.com/hormuz-labs/manul/issues/new') },
    ] },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
