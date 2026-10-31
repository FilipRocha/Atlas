import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { useDismissibleSafetyNotice } from '@/hooks/useDismissibleSafetyNotice'

const NOTICE_KEY = 'atlas:winget-startup-notice'

export function WingetStartupPrompt() {
  const { t } = useTranslation('winget')
  const notice = useDismissibleSafetyNotice(NOTICE_KEY)
  const [shouldShow, setShouldShow] = useState(false)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    if (!notice.open) return
    let cancelled = false

    void (async () => {
      try {
        const platform = await window.atlas.platformInfo()
        if (platform.platform !== 'win32') return

        const prereqs = await window.atlas.wingetPrereqs()
        if (!cancelled && !prereqs.wingetAvailable) setShouldShow(true)
      } catch (error) {
        console.warn('[winget] startup availability check failed:', error)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [notice.open])

  const handleCancel = () => {
    if (!installing) notice.dismiss()
  }

  const handleInstall = async () => {
    if (installing) return
    setInstalling(true)
    try {
      const result = await window.atlas.wingetInstallAppInstaller()
      if (!result.success) {
        toast.error(t('startupPrompt.installFailed'), {
          description: result.error || undefined
        })
        return
      }

      await new Promise((resolve) => setTimeout(resolve, 1000))
      const prereqs = await window.atlas.wingetPrereqs()
      if (prereqs.wingetAvailable) {
        toast.success(t('startupPrompt.installSuccess'), {
          description: t('startupPrompt.installSuccessDescription')
        })
      } else {
        toast.info(t('startupPrompt.installNeedsRestart'), {
          description: t('startupPrompt.installNeedsRestartDescription')
        })
      }
      notice.dismiss()
    } catch (error) {
      toast.error(t('startupPrompt.installFailed'), { description: String(error) })
    } finally {
      setInstalling(false)
    }
  }

  if (!notice.open || !shouldShow) return null

  return (
    <ConfirmDialog
      open
      onConfirm={() => void handleInstall()}
      onCancel={handleCancel}
      title={t('startupPrompt.title')}
      description={t('startupPrompt.description')}
      secondaryDescription={t('startupPrompt.details')}
      detailsStyle="description"
      confirmLabel={installing ? t('startupPrompt.installing') : t('startupPrompt.installNow')}
      cancelLabel={t('startupPrompt.notNow')}
      dontShowAgainLabel={t('startupPrompt.dontShowAgain')}
      dontShowAgainChecked={notice.dontShowAgain}
      onDontShowAgainChange={notice.setDontShowAgain}
    />
  )
}
