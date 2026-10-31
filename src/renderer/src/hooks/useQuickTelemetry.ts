import { useEffect, useState } from 'react'
import type { PerfQuickStats } from '@shared/types'

export interface QuickSample {
  at: number
  cpu: number
  memory: number
}

/** A bounded, single-flight sampler. Home never starts expensive process monitoring. */
export function useQuickTelemetry() {
  const [current, setCurrent] = useState<PerfQuickStats | null>(null)
  const [samples, setSamples] = useState<QuickSample[]>([])
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let requestInFlight = false
    const poll = async () => {
      if (cancelled || requestInFlight || document.visibilityState !== 'visible') return
      requestInFlight = true
      try {
        const reading = await window.atlas?.perfQuickStats?.()
        if (!cancelled && reading) {
          setCurrent(reading)
          const cpuPercent = reading.cpuPercent
          if (cpuPercent != null) {
            setSamples((previous) => [
              ...previous.slice(-59),
              { at: Date.now(), cpu: cpuPercent, memory: reading.memPercent }
            ])
          }
        }
      } catch {
        if (!cancelled) setCurrent(null)
      } finally {
        requestInFlight = false
        if (!cancelled && document.visibilityState === 'visible') timer = setTimeout(poll, 5000)
      }
    }
    void poll()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !cancelled) {
        if (timer) clearTimeout(timer)
        timer = null
        void poll()
      }
      if (document.visibilityState === 'hidden' && timer) {
        clearTimeout(timer)
        timer = null
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])
  return { current, samples }
}
