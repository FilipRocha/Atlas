import { create } from 'zustand'
import type {
  WingetSearchResult,
  WingetListResult,
  WingetUpgradeCheckResult,
  WingetOperationProgress,
  WingetPrereqState
} from '@shared/winget'

type Status = 'idle' | 'loading' | 'working' | 'done'

interface WingetStoreState {
  prereqs: WingetPrereqState | null

  searchQuery: string
  searchResult: WingetSearchResult | null
  searchStatus: Status

  installedResult: WingetListResult | null
  installedStatus: Status
  iconCache: Record<string, string | null>

  upgradeResult: WingetUpgradeCheckResult | null
  upgradeStatus: Status
  upgradeProgress: WingetOperationProgress | null

  setPrereqs: (p: WingetPrereqState | null) => void
  setSearchQuery: (q: string) => void
  setSearchResult: (r: WingetSearchResult | null) => void
  setSearchStatus: (s: Status) => void
  setInstalledResult: (r: WingetListResult | null) => void
  setInstalledStatus: (s: Status) => void
  setIcon: (id: string, dataUrl: string | null) => void
  setUpgradeResult: (r: WingetUpgradeCheckResult | null) => void
  setUpgradeStatus: (s: Status) => void
  setUpgradeProgress: (p: WingetOperationProgress | null) => void
}

export const useWingetStore = create<WingetStoreState>((set) => ({
  prereqs: null,

  searchQuery: '',
  searchResult: null,
  searchStatus: 'idle',

  installedResult: null,
  installedStatus: 'idle',
  iconCache: {},

  upgradeResult: null,
  upgradeStatus: 'idle',
  upgradeProgress: null,

  setPrereqs: (prereqs) => set({ prereqs }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSearchResult: (searchResult) => set({ searchResult }),
  setSearchStatus: (searchStatus) => set({ searchStatus }),
  setInstalledResult: (installedResult) => set({ installedResult }),
  setInstalledStatus: (installedStatus) => set({ installedStatus }),
  setIcon: (id, dataUrl) => set((s) => ({ iconCache: { ...s.iconCache, [id]: dataUrl } })),
  setUpgradeResult: (upgradeResult) => set({ upgradeResult }),
  setUpgradeStatus: (upgradeStatus) => set({ upgradeStatus }),
  setUpgradeProgress: (upgradeProgress) => set({ upgradeProgress })
}))
