import { useEffect, useRef } from 'react'
import { useUpdaterStore } from '@/stores/updater-store'
import { refreshSettings, useSettingsStore } from '@/stores/settings-store'

/**
 * Runs the optional software-update check silently after startup settles.
 */
export function useBackgroundScans(): void {
  const scansStarted = useRef(false)
  const ignoredLoaded = useRef(false)
  const settingsLoaded = useSettingsStore((s) => s.loaded)
  const ignoredSoftwareUpdates = useSettingsStore((s) => s.settings.ignoredSoftwareUpdates)

  // The software check waits on hydrated settings; retry once if the eager
  // hydration in settings-store lost its IPC, so a transient failure doesn't
  // defer that check for the whole session.
  useEffect(() => {
    if (settingsLoaded) return
    const id = setTimeout(refreshSettings, 2000)
    return () => clearTimeout(id)
  }, [settingsLoaded])

  // Load ignored IDs first so setApps() can partition correctly. This runs even
  // when reminders are off, since manual checks on the updater page still need it.
  useEffect(() => {
    if (!settingsLoaded || ignoredLoaded.current) return
    ignoredLoaded.current = true
    if (ignoredSoftwareUpdates?.length) {
      useUpdaterStore.getState().loadIgnoredIds(ignoredSoftwareUpdates)
    }
  }, [settingsLoaded, ignoredSoftwareUpdates])

  // Package-manager checks can be expensive. Delay the optional check until
  // the main window has settled so it does not compete with startup work.
  useEffect(() => {
    if (!settingsLoaded || scansStarted.current) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (cancelled || scansStarted.current) return
      scansStarted.current = true

      void (async () => {
        const settings = useSettingsStore.getState().settings
        const updater = useUpdaterStore.getState()
        if (
          settings.softwareUpdaterNotifications !== false &&
          !updater.hasChecked &&
          !updater.loading
        ) {
          updater.setLoading(true)
          try {
            const result = await window.atlas.softwareUpdateCheck()
            const store = useUpdaterStore.getState()
            store.setApps(result.apps)
            store.setUpToDate(result.upToDate)
            store.setPackageManagerAvailable(result.packageManagerAvailable)
            store.setPackageManagerName(result.packageManagerName)
            store.setManagers(result.managers)
            store.setHasChecked(true)
          } catch {
            // Silent — don't set error so the page still shows its initial state.
          } finally {
            useUpdaterStore.getState().setLoading(false)
          }
        }
      })()
    }, 20_000)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [settingsLoaded])
}
