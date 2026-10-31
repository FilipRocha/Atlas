import { create } from 'zustand'
import type {
  SystemTweaksState,
  SystemTweaksApplyResult,
  SystemTweaksScanProgress
} from '@shared/types'

interface TweaksStoreState {
  state: SystemTweaksState | null
  status: 'idle' | 'scanning' | 'applying' | 'done'
  applyResult: SystemTweaksApplyResult | null
  expandedCategories: Set<string>
  progress: SystemTweaksScanProgress | null

  setState: (state: SystemTweaksState | null) => void
  setStatus: (status: 'idle' | 'scanning' | 'applying' | 'done') => void
  setApplyResult: (result: SystemTweaksApplyResult | null) => void
  setExpandedCategories: (categories: Set<string>) => void
  toggleCategory: (id: string) => void
  setProgress: (progress: SystemTweaksScanProgress | null) => void
  reset: () => void
}

export const useTweaksStore = create<TweaksStoreState>((set) => ({
  state: null,
  status: 'idle',
  applyResult: null,
  expandedCategories: new Set<string>(),
  progress: null,

  setState: (state) => set({ state }),
  setStatus: (status) => set({ status }),
  setApplyResult: (applyResult) => set({ applyResult }),
  setExpandedCategories: (expandedCategories) => set({ expandedCategories }),
  toggleCategory: (id) =>
    set((s) => {
      const next = new Set(s.expandedCategories)
      next.has(id) ? next.delete(id) : next.add(id)
      return { expandedCategories: next }
    }),
  setProgress: (progress) => set({ progress }),
  reset: () =>
    set({
      state: null,
      status: 'idle',
      applyResult: null,
      expandedCategories: new Set<string>(),
      progress: null
    })
}))
