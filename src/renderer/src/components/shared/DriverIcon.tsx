import { useState } from 'react'
import { Cpu } from 'lucide-react'

interface DriverIconProps {
  provider?: string
  className?: string
}

const slugs: Record<string, string> = {
  nvidia: 'nvidia',
  amd: 'amd',
  intel: 'intel',
  realtek: 'realtek',
  qualcomm: 'qualcomm',
  mediatek: 'mediatek',
  broadcom: 'broadcom',
  microsoft: 'microsoft',
  asus: 'asus',
  lenovo: 'lenovo',
  dell: 'dell',
  hp: 'hp',
  logitech: 'logitech',
  razer: 'razer',
  synaptics: 'synaptics'
}

export function DriverIcon({ provider, className = '' }: DriverIconProps) {
  const [failed, setFailed] = useState(false)
  const key = Object.keys(slugs).find((name) => (provider || '').toLowerCase().includes(name))
  const slug = key ? slugs[key] : null
  if (!slug || failed)
    return <Cpu className={className} style={{ color: 'var(--accent)' }} strokeWidth={1.8} />
  return (
    <img
      src={`https://cdn.simpleicons.org/${slug}`}
      alt=""
      className={`object-contain ${className}`}
      onError={() => setFailed(true)}
    />
  )
}
