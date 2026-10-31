import { useEffect, useState } from 'react'
import { Package } from 'lucide-react'

interface ProgramIconProps {
  name: string
  publisher?: string
  displayIcon?: string
  installLocation?: string
  size?: number
  className?: string
}

export function ProgramIcon({
  name,
  publisher = '',
  displayIcon = '',
  installLocation = '',
  size = 32,
  className = ''
}: ProgramIconProps) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setSrc(null)
    setFailed(false)
    window.atlas
      .programGetIcon(name, publisher, displayIcon, installLocation)
      .then((value) => {
        if (!cancelled) setSrc(value)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [name, publisher, displayIcon, installLocation])

  if (!failed && src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className={`shrink-0 object-contain ${className}`}
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-lg ${className}`}
      style={{ width: size, height: size, background: 'var(--bg-active)' }}
    >
      <Package
        className="h-[55%] w-[55%]"
        style={{ color: 'var(--text-muted)' }}
        strokeWidth={1.6}
      />
    </div>
  )
}
