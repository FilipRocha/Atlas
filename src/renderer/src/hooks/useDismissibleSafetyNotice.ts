import { useCallback, useState } from 'react'

export function useDismissibleSafetyNotice(storageKey: string) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(storageKey) !== 'true'
    } catch {
      return true
    }
  })
  const [dontShowAgain, setDontShowAgain] = useState(false)

  const dismiss = useCallback(() => {
    if (dontShowAgain) {
      try {
        localStorage.setItem(storageKey, 'true')
      } catch {
        // The notice still closes when browser storage is unavailable.
      }
    }
    setOpen(false)
  }, [dontShowAgain, storageKey])

  return { open, dontShowAgain, setDontShowAgain, dismiss }
}
