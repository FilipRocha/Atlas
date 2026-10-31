import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  Wand2,
  Palette,
  Zap,
  Globe,
  HardDrive,
  CheckCircle2,
  AlertTriangle,
  Loader2
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { cn } from '@/lib/utils'
import { usePlatform } from '@/hooks/usePlatform'
import { useDismissibleSafetyNotice } from '@/hooks/useDismissibleSafetyNotice'
import { useTweaksStore } from '@/stores/tweaks-store'
import type { SystemTweakSetting } from '@shared/types'
import type { LucideIcon } from 'lucide-react'

interface CategoryDef {
  id: SystemTweakSetting['category']
  labelKey: string
  descriptionKey: string
  icon: LucideIcon
  color: string
  bg: string
  border: string
}

// Same palette family used across Atlas's other hardening pages (Privacy
// Shield, Debloater) — one accent color per category, at low opacity for
// backgrounds so it stays readable in both light and dark themes.
const categories: CategoryDef[] = [
  {
    id: 'personalization',
    labelKey: 'tweaksCategories.personalizationLabel',
    descriptionKey: 'tweaksCategories.personalizationDescription',
    icon: Palette,
    color: '#8b5cf6',
    bg: 'rgba(139,92,246,0.08)',
    border: 'rgba(139,92,246,0.15)'
  },
  {
    id: 'power',
    labelKey: 'tweaksCategories.powerLabel',
    descriptionKey: 'tweaksCategories.powerDescription',
    icon: Zap,
    color: '#f59e0b',
    bg: 'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.15)'
  },
  {
    id: 'network',
    labelKey: 'tweaksCategories.networkLabel',
    descriptionKey: 'tweaksCategories.networkDescription',
    icon: Globe,
    color: '#06b6d4',
    bg: 'rgba(6,182,212,0.08)',
    border: 'rgba(6,182,212,0.15)'
  },
  {
    id: 'system',
    labelKey: 'tweaksCategories.systemLabel',
    descriptionKey: 'tweaksCategories.systemDescription',
    icon: HardDrive,
    color: '#ef4444',
    bg: 'rgba(239,68,68,0.08)',
    border: 'rgba(239,68,68,0.15)'
  }
]

export function SystemTweaksPage({ embedded }: { embedded?: boolean }) {
  const { t } = useTranslation('hardening')
  const navigate = useNavigate()
  const isWindows = usePlatform().platform === 'win32'
  const state = useTweaksStore((s) => s.state)
  const status = useTweaksStore((s) => s.status)
  const applyResult = useTweaksStore((s) => s.applyResult)
  const expandedCategories = useTweaksStore((s) => s.expandedCategories)
  const progress = useTweaksStore((s) => s.progress)
  const safetyNotice = useDismissibleSafetyNotice('atlas:safety-notice:system-tweaks')
  const progressCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => {
      progressCleanupRef.current?.()
    }
  }, [])

  useEffect(() => {
    const store = useTweaksStore.getState()
    if (store.status === 'idle' && !store.state) {
      handleScan()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleScan = useCallback(async () => {
    const store = useTweaksStore.getState()
    store.setStatus('scanning')
    store.setApplyResult(null)
    store.setProgress(null)

    progressCleanupRef.current?.()
    progressCleanupRef.current =
      window.atlas.onTweaksProgress?.((data) => {
        useTweaksStore.getState().setProgress(data)
      }) ?? null

    try {
      const result = await window.atlas.tweaksScan()
      useTweaksStore.getState().setState(result)
      // Auto-expand categories that have at least one tweak not yet applied
      const notApplied = new Set<string>()
      for (const s of result.settings) {
        if (!s.enabled) notApplied.add(s.category)
      }
      useTweaksStore.getState().setExpandedCategories(notApplied)
      useTweaksStore.getState().setStatus('done')
    } catch (err) {
      console.error('Tweaks scan failed:', err)
      toast.error(t('tweaks.scanFailed'))
      useTweaksStore.getState().setStatus('idle')
    } finally {
      progressCleanupRef.current?.()
      progressCleanupRef.current = null
      useTweaksStore.getState().setProgress(null)
    }
  }, [t])

  const handleApplyCategory = useCallback(
    async (categoryId: string) => {
      const store = useTweaksStore.getState()
      if (!store.state) return
      const ids = store.state.settings
        .filter((s) => s.category === categoryId && !s.enabled)
        .map((s) => s.id)
      if (ids.length === 0) return

      store.setStatus('applying')
      store.setApplyResult(null)
      try {
        const result = await window.atlas.tweaksApply(ids)
        useTweaksStore.getState().setApplyResult(result)
        const updated = await window.atlas.tweaksScan()
        useTweaksStore.getState().setState(updated)
        useTweaksStore.getState().setStatus('done')
        if (result.succeeded > 0)
          toast.success(
            t(result.succeeded > 1 ? 'tweaks.appliedToastPlural' : 'tweaks.appliedToast', {
              count: result.succeeded
            })
          )
        if (result.failed > 0)
          toast.error(
            t(result.failed > 1 ? 'tweaks.failedToastPlural' : 'tweaks.failedToast', {
              count: result.failed
            })
          )
      } catch (err) {
        console.error('Tweaks apply failed:', err)
        toast.error(t('tweaks.applyFailed'), { description: t('tweaks.applyFailedDescription') })
        useTweaksStore.getState().setApplyResult({
          succeeded: 0,
          failed: ids.length,
          errors: [{ id: '', label: categoryId, reason: t('tweaks.ipcCallFailed') }]
        })
        useTweaksStore.getState().setStatus('done')
      }
    },
    [t]
  )

  const handleToggleSingle = useCallback(
    async (settingId: string) => {
      const store = useTweaksStore.getState()
      if (!store.state) return
      const setting = store.state.settings.find((s) => s.id === settingId)
      if (!setting) return
      const settingLabel = t(`tweaks.settings.${setting.id}.label`, { defaultValue: setting.label })

      const wasEnabled = setting.enabled
      const isEnabling = !wasEnabled
      store.setStatus('applying')
      try {
        const result = isEnabling
          ? await window.atlas.tweaksApply([settingId])
          : await window.atlas.tweaksRevert([settingId])
        const updated = await window.atlas.tweaksScan()
        useTweaksStore.getState().setState(updated)
        useTweaksStore.getState().setStatus('done')

        const newSetting = updated.settings.find((s) => s.id === settingId)
        const actuallyChanged = newSetting != null && newSetting.enabled !== wasEnabled

        if (result.failed > 0) {
          const reason = result.errors[0]?.reason || t('tweaks.unknownError')
          toast.error(
            t(isEnabling ? 'tweaks.applySettingFailed' : 'tweaks.revertSettingFailed', {
              label: settingLabel
            }),
            { description: reason }
          )
        } else if (!actuallyChanged) {
          toast.error(
            t(isEnabling ? 'tweaks.applySettingFailed' : 'tweaks.revertSettingFailed', {
              label: settingLabel
            }),
            { description: t(isWindows ? 'tweaks.adminRequired' : 'tweaks.settingNotApplied') }
          )
        } else {
          toast.success(
            t(newSetting.enabled ? 'tweaks.settingApplied' : 'tweaks.settingReverted', {
              label: settingLabel
            })
          )
        }
      } catch {
        toast.error(
          t(isEnabling ? 'tweaks.applySettingFailedGeneric' : 'tweaks.revertSettingFailedGeneric')
        )
        useTweaksStore.getState().setStatus('done')
      }
    },
    [t, isWindows]
  )

  const isScanning = status === 'scanning'
  const isApplying = status === 'applying'
  const busy = isScanning || isApplying
  const notAppliedCount = state ? state.total - state.applied : 0

  const headerAction = (
    <div className="flex items-center gap-2.5">
      <button
        onClick={handleScan}
        disabled={busy}
        className="pulse-primary-action pulse-scan-action flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium text-zinc-300 transition-all disabled:opacity-40"
        style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)' }}
      >
        <Wand2 className="h-4 w-4" strokeWidth={1.8} />
        {t('tweaks.scanButton')}
      </button>
    </div>
  )

  return (
    <div className={embedded ? '' : 'animate-fade-in'}>
      {!embedded && (
        <PageHeader
          title={t('tweaks.pageTitle')}
          description={t('tweaks.pageDescription')}
          action={headerAction}
        />
      )}
      {embedded && <div className="mb-5 flex justify-end">{headerAction}</div>}

      {!isWindows && (
        <div
          className="mb-4 flex items-start gap-3 rounded-2xl px-5 py-3"
          style={{
            background: 'rgba(245,158,11,0.04)',
            border: '1px solid var(--accent-muted-bg)'
          }}
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" strokeWidth={1.8} />
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {t('tweaks.windowsOnlyWarning')}
          </p>
        </div>
      )}

      {/* Scan progress */}
      {isScanning && (
        <div
          className="mb-4 flex items-center gap-3 rounded-2xl px-5 py-4"
          style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}
        >
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" style={{ color: 'var(--accent)' }} />
          <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            {progress
              ? t('tweaks.scanProgressChecking', {
                  label: t(`tweaks.settings.${progress.currentId}.label`, {
                    defaultValue: progress.currentLabel
                  })
                })
              : t('tweaks.scanProgressPreparing')}
          </p>
        </div>
      )}

      {/* Apply summary */}
      {applyResult && !isScanning && (
        <div
          className="mb-4 rounded-2xl px-5 py-4"
          style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" strokeWidth={2} />
            <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {applyResult.succeeded > 0 &&
                t(applyResult.succeeded > 1 ? 'tweaks.appliedToastPlural' : 'tweaks.appliedToast', {
                  count: applyResult.succeeded
                })}
              {applyResult.failed > 0 &&
                ` — ${t(
                  applyResult.failed > 1 ? 'tweaks.failedToastPlural' : 'tweaks.failedToast',
                  { count: applyResult.failed }
                )}`}
            </p>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!state && !isScanning && (
        <EmptyState
          icon={Wand2}
          title={t('tweaks.emptyStateTitle')}
          description={t('tweaks.emptyStateDescription')}
        />
      )}

      {/* Category cards */}
      {state && !isScanning && (
        <div className="space-y-3">
          {categories.map((cat) => {
            const catSettings = state.settings.filter((s) => s.category === cat.id)
            if (catSettings.length === 0) return null

            const appliedInCat = catSettings.filter((s) => s.enabled).length
            const allApplied = appliedInCat === catSettings.length
            const isExpanded = expandedCategories.has(cat.id)
            const notAppliedInCat = catSettings.length - appliedInCat
            const CatIcon = cat.icon

            return (
              <div
                key={cat.id}
                className="overflow-hidden rounded-2xl"
                style={{
                  border: `1px solid ${allApplied ? 'rgba(34,197,94,0.15)' : cat.border}`,
                  opacity: isApplying ? 0.5 : 1,
                  pointerEvents: isApplying ? 'none' : 'auto'
                }}
              >
                <button
                  onClick={() => useTweaksStore.getState().toggleCategory(cat.id)}
                  className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors"
                  style={{ background: allApplied ? 'rgba(34,197,94,0.03)' : 'var(--bg-subtle)' }}
                >
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                    style={{ background: allApplied ? 'rgba(34,197,94,0.1)' : cat.bg }}
                  >
                    <CatIcon
                      className="h-5 w-5"
                      style={{ color: allApplied ? '#22c55e' : cat.color }}
                      strokeWidth={1.8}
                    />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5">
                      <span className="text-[14px] font-semibold text-zinc-200">
                        {t(cat.labelKey)}
                      </span>
                      {allApplied ? (
                        <span
                          className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}
                        >
                          {t('tweaks.allAppliedBadge')}
                        </span>
                      ) : (
                        <span
                          className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={{ background: cat.bg, color: cat.color }}
                        >
                          {t('tweaks.notAppliedBadge', { count: notAppliedInCat })}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-dim)' }}>
                      {t(cat.descriptionKey)}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {!allApplied && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleApplyCategory(cat.id)
                        }}
                        disabled={busy}
                        className="rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-40"
                        style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}
                      >
                        {t('tweaks.applyAllCategoryButton')}
                      </button>
                    )}
                    {allApplied && (
                      <div
                        className="flex h-8 w-8 items-center justify-center rounded-full"
                        style={{ background: 'rgba(34,197,94,0.1)' }}
                      >
                        <CheckCircle2 className="h-4 w-4 text-green-500" strokeWidth={2.5} />
                      </div>
                    )}
                    <div
                      className={cn(
                        'h-5 w-5 transition-transform',
                        isExpanded ? 'rotate-180' : 'rotate-0'
                      )}
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor">
                        <path
                          fillRule="evenodd"
                          d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                  </div>
                </button>

                {/* Expanded settings — each with its own description, per tweak */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    {catSettings.map((setting, i) => {
                      const toggleDisabled = busy || (setting.enabled && !setting.reversible)

                      return (
                        <div
                          key={setting.id}
                          className="flex items-center gap-4 px-5 py-3.5"
                          style={{
                            borderBottom:
                              i < catSettings.length - 1 ? '1px solid var(--bg-subtle)' : 'none'
                          }}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-medium text-zinc-300">
                                {t(`tweaks.settings.${setting.id}.label`, {
                                  defaultValue: setting.label
                                })}
                              </span>
                              {setting.requiresAdmin && (
                                <span
                                  className="rounded px-1 py-0.5 text-[9px] font-semibold uppercase"
                                  style={{
                                    background: 'var(--accent-muted-bg)',
                                    color: 'var(--accent)'
                                  }}
                                >
                                  {t('tweaks.adminBadge')}
                                </span>
                              )}
                              {setting.enabled && !setting.reversible && (
                                <span
                                  className="rounded px-1 py-0.5 text-[9px] font-semibold uppercase"
                                  style={{
                                    background: 'var(--bg-active)',
                                    color: 'var(--text-muted)'
                                  }}
                                >
                                  {t('tweaks.permanentBadge')}
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-dim)' }}>
                              {t(`tweaks.settings.${setting.id}.description`, {
                                defaultValue: setting.description
                              })}
                            </p>
                          </div>

                          <button
                            onClick={() => handleToggleSingle(setting.id)}
                            disabled={toggleDisabled}
                            className="toggle-switch relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60"
                            style={{ background: setting.enabled ? '#22c55e' : 'var(--bg-active)' }}
                          >
                            <div
                              className="absolute top-0.5 h-5 w-5 rounded-full transition-all"
                              style={{
                                left: setting.enabled ? '22px' : '2px',
                                background: setting.enabled ? '#fff' : 'var(--text-muted)'
                              }}
                            />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {isWindows && state && notAppliedCount > 0 && (
        <div
          className="mt-4 flex items-start gap-3 rounded-2xl px-5 py-3"
          style={{
            background: 'rgba(245,158,11,0.04)',
            border: '1px solid var(--accent-muted-bg)'
          }}
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" strokeWidth={1.8} />
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {t('tweaks.adminWarning')}
          </p>
        </div>
      )}

      <ConfirmDialog
        open={safetyNotice.open}
        onConfirm={safetyNotice.dismiss}
        onCancel={() => {
          safetyNotice.dismiss()
          navigate('/')
        }}
        title={t('tweaks.safetyWarningTitle')}
        description={t('tweaks.safetyWarningDescription')}
        variant="warning"
        cancelLabel={t('tweaks.safetyWarningClose')}
        confirmLabel={t('tweaks.safetyWarningContinue')}
        dontShowAgainLabel={t('safetyWarningDontShowAgain')}
        dontShowAgainChecked={safetyNotice.dontShowAgain}
        onDontShowAgainChange={safetyNotice.setDontShowAgain}
      />
    </div>
  )
}
