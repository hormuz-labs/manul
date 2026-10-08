// Crash reports (Sentry), only when the user said yes. Imported first by index.ts: Sentry must start before the app is
// ready to catch native crashes and to register its protocol for the renderer. It starts whenever the build has a DSN,
// but its transport sends nothing unless the user agreed, so saying yes or no takes effect at once, and crashes from
// before a yes are never sent later. Local variables, console output, URLs and file paths are kept out of reports.
import * as Sentry from '@sentry/electron/main'
import { keepCrumb, scrubCrumb, scrubEvent } from '../shared/telemetry'
import { getConfig } from './config'

declare const __MANUL_SENTRY_DSN__: string
export const CRASH_DSN = typeof __MANUL_SENTRY_DSN__ === 'string' ? __MANUL_SENTRY_DSN__ : ''

export const crashReportsOn = () => !!CRASH_DSN && !!getConfig().telemetry?.crashes

// Integrations that could carry the user's data: local variable values, console lines, request URLs (some providers
// put keys in the query), and window screenshots.
const DROPPED = new Set(['LocalVariables', 'Console', 'NodeFetch', 'ElectronNet', 'Screenshots', 'Http'])

if (CRASH_DSN) {
  Sentry.init({
    dsn: CRASH_DSN,
    dataCollection: { userInfo: false },
    integrations: defaults => defaults.filter(i => !DROPPED.has(i.name)),
    beforeSend: event => scrubEvent(event),
    beforeBreadcrumb: b => (keepCrumb(b) ? scrubCrumb(b) : null),
    transport: options => {
      const inner = Sentry.makeElectronTransport(options) // not the offline one: its disk queue retries on its own, even after a no
      // Without the user's yes nothing leaves the machine, not even a session ping.
      return { ...inner, send: envelope => (crashReportsOn() ? inner.send(envelope) : Promise.resolve({})) }
    },
  })
}
