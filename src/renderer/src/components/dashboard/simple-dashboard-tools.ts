import type { PlatformInfo } from '@shared/types'

export type DashboardGoal = 'space' | 'speed' | 'protection'
interface GoalTool {
  path: string
  titleKey: string
  feature?: keyof PlatformInfo['features']
  windowsOnly?: boolean
}

const tools: Record<DashboardGoal, GoalTool[]> = {
  space: [
    { path: '/cleaner', titleKey: 'sidebar:cleaner' },
    { path: '/large-files', titleKey: 'largeFiles:pageTitle' },
    { path: '/duplicates', titleKey: 'duplicates:pageTitle' },
    { path: '/disk', titleKey: 'disk:pageTitle' },
    { path: '/storage-history', titleKey: 'disk:storage.title' },
    { path: '/empty-folders', titleKey: 'emptyFolders:pageTitle' },
    { path: '/file-shredder', titleKey: 'fileShredder:pageTitle' }
  ],
  speed: [
    { path: '/performance', titleKey: 'performance:pageTitle' },
    { path: '/startup', titleKey: 'startup:pageTitle' },
    { path: '/services', titleKey: 'hardening:serviceManager.pageTitle' },
    { path: '/network', titleKey: 'network:pageTitle' },
    { path: '/disk-repair', titleKey: 'disk:repairTitle', windowsOnly: true },
    { path: '/disk-maintenance', titleKey: 'disk:maintenanceTitle' },
    { path: '/game-mode', titleKey: 'gameMode:pageTitle', feature: 'gameMode' }
  ],
  protection: [
    { path: '/malware', titleKey: 'malware:pageTitle' },
    { path: '/privacy', titleKey: 'hardening:privacy.pageTitle' },
    { path: '/firewall', titleKey: 'sidebar:firewallAudit', feature: 'firewallAudit' }
  ]
}

export function getGoalTools(goal: DashboardGoal, info: PlatformInfo): GoalTool[] {
  return tools[goal].filter(
    (tool) =>
      (!tool.feature || info.features[tool.feature]) &&
      (!tool.windowsOnly || info.platform === 'win32')
  )
}
