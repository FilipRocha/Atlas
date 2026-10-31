import { lazy, Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { RTL_LANGUAGES } from './lib/languages'
import { useScheduledScan } from './hooks/useScheduledScan'
import { AppShell } from './components/layout/AppShell'
import { WingetStartupPrompt } from './components/winget/WingetStartupPrompt'
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage }))
)
const CleanerPage = lazy(() =>
  import('./pages/CleanerPage').then((m) => ({ default: m.CleanerPage }))
)
const RegistryPage = lazy(() =>
  import('./pages/RegistryPage').then((m) => ({ default: m.RegistryPage }))
)
const ContextMenuCleanerPage = lazy(() =>
  import('./pages/ContextMenuCleanerPage').then((m) => ({ default: m.ContextMenuCleanerPage }))
)
const StartupPage = lazy(() =>
  import('./pages/StartupPage').then((m) => ({ default: m.StartupPage }))
)
const StorageHistoryPage = lazy(() =>
  import('./pages/StorageHistoryPage').then((m) => ({ default: m.StorageHistoryPage }))
)
const DiskAnalyzerPage = lazy(() =>
  import('./pages/DiskAnalyzerPage').then((m) => ({ default: m.DiskAnalyzerPage }))
)
const DuplicateFinderPage = lazy(() =>
  import('./pages/DuplicateFinderPage').then((m) => ({ default: m.DuplicateFinderPage }))
)
const LargeFileFinderPage = lazy(() =>
  import('./pages/LargeFileFinderPage').then((m) => ({ default: m.LargeFileFinderPage }))
)
const EmptyFolderCleanerPage = lazy(() =>
  import('./pages/EmptyFolderCleanerPage').then((m) => ({ default: m.EmptyFolderCleanerPage }))
)
const FileShredderPage = lazy(() =>
  import('./pages/FileShredderPage').then((m) => ({ default: m.FileShredderPage }))
)
const DiskRepairPage = lazy(() =>
  import('./pages/DiskRepairPage').then((m) => ({ default: m.DiskRepairPage }))
)
const DiskMaintenancePage = lazy(() =>
  import('./pages/DiskMaintenancePage').then((m) => ({ default: m.DiskMaintenancePage }))
)
const NetworkCleanupPage = lazy(() =>
  import('./pages/NetworkCleanupPage').then((m) => ({ default: m.NetworkCleanupPage }))
)
const MalwareScannerPage = lazy(() =>
  import('./pages/MalwareScannerPage').then((m) => ({ default: m.MalwareScannerPage }))
)
const GameModePage = lazy(() =>
  import('./pages/GameModePage').then((m) => ({ default: m.GameModePage }))
)
const ToolsHubPage = lazy(() =>
  import('./pages/ToolsHubPage').then((m) => ({ default: m.ToolsHubPage }))
)
const PerformanceMonitorPage = lazy(() =>
  import('./pages/PerformanceMonitorPage').then((m) => ({ default: m.PerformanceMonitorPage }))
)
const UninstallerPage = lazy(() =>
  import('./pages/UninstallerPage').then((m) => ({ default: m.UninstallerPage }))
)
const HistoryPage = lazy(() =>
  import('./pages/HistoryPage').then((m) => ({ default: m.HistoryPage }))
)
const RecoveryPage = lazy(() =>
  import('./pages/RecoveryPage').then((m) => ({ default: m.RecoveryPage }))
)
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage }))
)
const PrivacyShieldPage = lazy(() =>
  import('./pages/PrivacyShieldPage').then((m) => ({ default: m.PrivacyShieldPage }))
)
const SystemTweaksPage = lazy(() =>
  import('./pages/SystemTweaksPage').then((m) => ({ default: m.SystemTweaksPage }))
)
const WingetSearchPage = lazy(() =>
  import('./pages/WingetSearchPage').then((m) => ({ default: m.WingetSearchPage }))
)
const ServiceManagerPage = lazy(() =>
  import('./pages/ServiceManagerPage').then((m) => ({ default: m.ServiceManagerPage }))
)
const FirewallAuditPage = lazy(() =>
  import('./pages/FirewallAuditPage').then((m) => ({ default: m.FirewallAuditPage }))
)
const DebloaterPage = lazy(() =>
  import('./pages/DebloaterPage').then((m) => ({ default: m.DebloaterPage }))
)
const SoftwareUpdaterPage = lazy(() =>
  import('./pages/SoftwareUpdaterPage').then((m) => ({ default: m.SoftwareUpdaterPage }))
)
const SchedulesPage = lazy(() =>
  import('./pages/SchedulesPage').then((m) => ({ default: m.SchedulesPage }))
)
const DriverManagerPage = lazy(() =>
  import('./pages/DriverManagerPage').then((m) => ({ default: m.DriverManagerPage }))
)
const PerformanceOverlayPage = lazy(() =>
  import('./pages/PerformanceOverlayPage').then((m) => ({ default: m.PerformanceOverlayPage }))
)
import { sidebarPageTitleKeys } from './lib/sidebar-page-titles'
const Onboarding = lazy(() =>
  import('./components/Onboarding').then((m) => ({ default: m.Onboarding }))
)
import { useStatsStore } from './stores/stats-store'
import { useHistoryStore } from './stores/history-store'
import { useAppUpdateStore } from './stores/app-update-store'
import { useBackgroundScans } from './hooks/useBackgroundScans'
import { usePlatformLoader, PlatformContext } from './hooks/usePlatform'
import { initGameModeStore } from './stores/game-mode-store'
import { useSettingsStore } from './stores/settings-store'

export function App() {
  const { i18n } = useTranslation()
  const loadHistory = useHistoryStore((s) => s.load)
  const historyLoaded = useHistoryStore((s) => s.loaded)
  const recomputeStats = useStatsStore((s) => s.recompute)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingChecked, setOnboardingChecked] = useState(false)
  const theme = useSettingsStore((s) => s.settings.theme)

  // Apply theme class to <html> element
  useEffect(() => {
    const root = document.documentElement
    const apply = (mode: 'dark' | 'light') => {
      root.classList.remove('dark', 'light')
      root.classList.add(mode)
      window.atlas?.windowSetChromeTheme?.(mode)
    }
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      apply(mq.matches ? 'dark' : 'light')
      const handler = (e: MediaQueryListEvent) => apply(e.matches ? 'dark' : 'light')
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    } else {
      apply(theme ?? 'dark')
    }
  }, [theme])

  // Sync RTL direction based on current language
  useEffect(() => {
    document.documentElement.dir = RTL_LANGUAGES.includes(i18n.language) ? 'rtl' : 'ltr'
  }, [i18n.language])

  useEffect(() => {
    const p = window.atlas?.onboardingGet?.()
    if (p) {
      p.then((done) => {
        setShowOnboarding(!done)
        setOnboardingChecked(true)
      }).catch((err) => {
        // Fail open — a broken check must not lock the user out of the app —
        // but say so, since it also means onboarding is skipped silently.
        console.error('[onboarding] could not read completion state:', err)
        setOnboardingChecked(true)
      })
    } else {
      setOnboardingChecked(true)
    }
  }, [])

  const handleOnboardingComplete = async () => {
    setShowOnboarding(false)
    try {
      await window.atlas?.onboardingSet?.(true)
    } catch (err) {
      // Swallowing this is what let the wizard come back on every launch with
      // nothing to go on (issue #269). The main process forwards renderer
      // console errors into atlas.log.
      console.error('[onboarding] failed to persist completion:', err)
    }
  }

  useEffect(() => {
    if (!historyLoaded) loadHistory()
  }, [historyLoaded, loadHistory])

  useEffect(() => {
    if (historyLoaded) recomputeStats()
  }, [historyLoaded, recomputeStats])

  const platformInfo = usePlatformLoader()

  useScheduledScan()

  // Run software-update & driver-update scans silently in the background
  useBackgroundScans()

  // Initialize app update checker on mount
  const initAppUpdate = useAppUpdateStore((s) => s.init)
  useEffect(() => {
    const cleanup = initAppUpdate()
    return cleanup
  }, [initAppUpdate])

  // Hydrate Game Mode status so the sidebar badge works on all pages
  useEffect(() => {
    initGameModeStore()
  }, [])

  if (!onboardingChecked) {
    return (
      <div
        className="flex h-screen w-screen items-center justify-center"
        style={{ background: '#09090b' }}
      >
        <div className="flex flex-col items-center gap-4">
          <div className="h-16 w-16 rounded-2xl" aria-hidden="true" />
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-amber-500" />
        </div>
      </div>
    )
  }

  return (
    <PlatformContext value={platformInfo}>
      <HashRouter>
        <PageTitleUpdater />
        {!showOnboarding && <WingetStartupPrompt />}
        <Suspense
          fallback={
            <div
              className="flex h-screen w-screen items-center justify-center"
              style={{ background: '#09090b' }}
            >
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-amber-500" />
            </div>
          }
        >
          {showOnboarding && <Onboarding onComplete={handleOnboardingComplete} />}
          <Routes>
            <Route path="/performance-overlay" element={<PerformanceOverlayPage />} />
            <Route
              path="*"
              element={
                <AppShell>
                  <Routes>
                    <Route path="/" element={<DashboardPage />} />
                    <Route path="/cleaner" element={<CleanerPage />} />
                    <Route path="/registry" element={<RegistryPage />} />
                    <Route path="/context-menu" element={<ContextMenuCleanerPage />} />
                    <Route path="/startup" element={<StartupPage />} />
                    <Route path="/storage-history" element={<StorageHistoryPage />} />
                    <Route path="/disk" element={<DiskAnalyzerPage />} />
                    <Route path="/duplicates" element={<DuplicateFinderPage />} />
                    <Route path="/large-files" element={<LargeFileFinderPage />} />
                    <Route path="/empty-folders" element={<EmptyFolderCleanerPage />} />
                    <Route path="/file-shredder" element={<FileShredderPage />} />
                    <Route path="/disk-repair" element={<DiskRepairPage />} />
                    <Route path="/disk-maintenance" element={<DiskMaintenancePage />} />
                    <Route path="/network" element={<NetworkCleanupPage />} />
                    <Route path="/malware" element={<MalwareScannerPage />} />
                    <Route path="/game-mode" element={<GameModePage />} />
                    <Route path="/tools" element={<ToolsHubPage />} />
                    <Route path="/performance" element={<PerformanceMonitorPage />} />
                    <Route path="/uninstaller" element={<UninstallerPage />} />
                    <Route path="/history" element={<HistoryPage />} />
                    <Route path="/recovery" element={<RecoveryPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    {/* Standalone pages */}
                    <Route path="/privacy" element={<PrivacyShieldPage />} />
                    <Route path="/tweaks" element={<SystemTweaksPage />} />
                    <Route path="/winget-search" element={<WingetSearchPage />} />
                    <Route path="/services" element={<ServiceManagerPage />} />
                    <Route path="/firewall" element={<FirewallAuditPage />} />
                    <Route path="/debloater" element={<DebloaterPage />} />
                    <Route path="/updates" element={<SoftwareUpdaterPage />} />
                    <Route path="/schedules" element={<SchedulesPage />} />
                    {/* Legacy redirect */}
                    <Route path="/hardening" element={<Navigate to="/privacy" replace />} />
                    <Route path="/updater" element={<Navigate to="/updates" replace />} />
                    <Route path="/winget-updates" element={<Navigate to="/updates" replace />} />
                    <Route
                      path="/winget-installed"
                      element={<Navigate to="/uninstaller" replace />}
                    />
                    <Route path="/drivers" element={<DriverManagerPage />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </AppShell>
              }
            />
          </Routes>
        </Suspense>
        <Toaster
          position="bottom-right"
          theme={theme === 'system' ? 'system' : theme}
          toastOptions={{
            style: {
              background: 'var(--toast-bg)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              border: '1px solid var(--border-strong)',
              color: 'var(--toast-text)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 var(--glass-inset)'
            }
          }}
        />
      </HashRouter>
    </PlatformContext>
  )
}

// Maps routes to page titles for the window/tab title.
// Every route title is sourced from the same translations as its page or nav item.
const ROUTE_TITLES: Record<string, { key: string }> = {
  '/': { key: 'dashboard' },
  '/cleaner': { key: 'cleaner:pageTitle' },
  '/registry': { key: 'registry:pageTitle' },
  '/context-menu': { key: 'contextMenu:pageTitle' },
  '/startup': { key: 'startup:pageTitle' },
  '/storage-history': { key: 'disk:storage.title' },
  '/disk': { key: 'disk:pageTitle' },
  '/duplicates': { key: 'duplicates:pageTitle' },
  '/large-files': { key: 'largeFiles:pageTitle' },
  '/empty-folders': { key: 'emptyFolders:pageTitle' },
  '/file-shredder': { key: 'fileShredder:pageTitle' },
  '/disk-repair': { key: 'disk:repairTitle' },
  '/disk-maintenance': { key: 'disk:maintenanceTitle' },
  '/network': { key: 'network:pageTitle' },
  '/malware': { key: 'malware:pageTitle' },
  '/game-mode': { key: 'gameMode:pageTitle' },
  '/tools': { key: 'tools:pageTitle' },
  '/performance': { key: 'performance:pageTitle' },
  '/uninstaller': { key: 'uninstaller:pageTitle' },
  '/history': { key: 'history:pageTitle' },
  '/recovery': { key: 'history:recovery.title' },
  '/settings': { key: 'settings:pageTitle' },
  '/privacy': { key: 'hardening:privacy.pageTitle' },
  '/tweaks': { key: 'hardening:tweaks.pageTitle' },
  '/services': { key: 'hardening:serviceManager.pageTitle' },
  '/firewall': { key: 'firewallAudit' },
  '/debloater': { key: 'hardening:debloater.pageTitle' },
  '/updates': { key: 'updates:softwareUpdater.pageTitle' },
  '/schedules': { key: 'schedules:pageTitle' },
  '/drivers': { key: 'updates:driverManager.pageTitle' },
  '/winget-search': { key: 'winget:search.pageTitle' }
}

function PageTitleUpdater() {
  const location = useLocation()
  const { t } = useTranslation('sidebar')
  useEffect(() => {
    const entry = ROUTE_TITLES[location.pathname]
    let name: string | null = null
    const sidebarTitleKey = sidebarPageTitleKeys[location.pathname]
    if (sidebarTitleKey) {
      name = t(sidebarTitleKey)
    } else if (entry) {
      name = t(entry.key)
    }
    document.title = name ? `${name} - Atlas` : 'Atlas'
  }, [location.pathname, t])
  return null
}
