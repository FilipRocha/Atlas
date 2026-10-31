import { useEffect, useMemo, useState } from 'react'
import { Package } from 'lucide-react'
import { SOFTWARE_CATALOG } from '@shared/software-catalog'

interface WingetIconProps {
  id: string
  name: string
  /** 'online' = search/catalog results; 'local' = installed list via IPC */
  mode: 'online' | 'local'
  size?: number
  iconSlug?: string
}

const onlineFailedCache = new Set<string>()
const slugOverrides: Record<string, string> = {
  'microsoft.visualstudiocode': 'visualstudiocode',
  'microsoft.teams': 'microsoftteams',
  'microsoft.onedrive': 'microsoftonedrive',
  'microsoft.powertoys': 'powertoys',
  'adobe.acrobat.reader.64-bit': 'adobeacrobatreader',
  'valve.steam': 'steam',
  'epicgames.epicgameslauncher': 'epicgames',
  'riotgames.riotclient': 'riotgames',
  'nvidia.geforceexperience': 'nvidia',
  'guru3d.afterburner': 'msi',
  'whatsapp.whatsapp': 'whatsapp',
  'telegram.telegramdesktop': 'telegram',
  'anydesksoftwaregmbh.anydesk': 'anydesk',
  'teamviewer.teamviewer': 'teamviewer',
  'rufus.rufus': 'rufus',
  'bitwarden.bitwarden': 'bitwarden',
  'git.git': 'git',
  'github.githubdesktop': 'github',
  'openjs.nodejs': 'nodedotjs',
  'python.python.3.11': 'python',
  'oracle.jdk.21': 'openjdk',
  'docker.dockerdesktop': 'docker',
  'postman.postman': 'postman',
  'dbeaver.dbeaver': 'dbeaver',
  'putty.putty': 'putty',
  'electronicarts.eadesktop': 'ea',
  'ubisoft.connect': 'ubisoft',
  'discord.discord': 'discord',
  'obsproject.obsstudio': 'obsstudio',
  'razer.cortex': 'razer',
  'thedocumentfoundation.libreoffice': 'libreoffice',
  'foxit.foxitreader': 'foxit',
  'geeksoftware.pdf24': 'pdf24',
  'google.drive': 'googledrive',
  'dropbox.dropbox': 'dropbox',
  'zoom.zoom': 'zoom',
  'microsoft.skype': 'skype',
  'notion.notion': 'notion',
  'evernote.evernote': 'evernote'
}

function FallbackIcon({ size }: { size: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-lg"
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

function normalizeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .replace(/^microsoft/, 'microsoft')
}

function catalogSlug(id: string): string | undefined {
  return SOFTWARE_CATALOG.find((entry) => entry.wingetId.toLowerCase() === id.toLowerCase())
    ?.iconSlug
}

function getOnlineSources(id: string, name: string, explicitSlug?: string): string[] {
  const normalizedId = id.toLowerCase()
  const candidates = [
    explicitSlug,
    catalogSlug(id),
    slugOverrides[normalizedId],
    normalizeSlug(id),
    normalizeSlug(name)
  ].filter(Boolean) as string[]
  const unique = [...new Set(candidates)]
  const urls = unique.map((slug) => `https://cdn.simpleicons.org/${encodeURIComponent(slug)}`)
  urls.push(`https://api.winget.run/v2/packages/${encodeURIComponent(id)}/icon`)
  return [...new Set(urls)]
}

export function WingetIcon({ id, name, mode, size = 32, iconSlug }: WingetIconProps) {
  // Local installed-app icons are preferred, but registry entries are not
  // available for every package. Keep the catalog/CDN sources as a visual
  // fallback so updater rows do not lose recognizable app branding.
  const sources = useMemo(() => getOnlineSources(id, name, iconSlug), [id, name, iconSlug])
  const [sourceIndex, setSourceIndex] = useState(0)
  const [localSrc, setLocalSrc] = useState<string | null>(null)
  const [localFailed, setLocalFailed] = useState(false)

  useEffect(() => {
    setSourceIndex(0)
    setLocalSrc(null)
    setLocalFailed(false)
  }, [id, name, mode, iconSlug])

  useEffect(() => {
    let cancelled = false
    if (mode !== 'local' || !name) return
    window.atlas
      .wingetGetIcon(id, name)
      .then((res) => {
        if (cancelled) return
        if (res.dataUrl) setLocalSrc(res.dataUrl)
        else setLocalFailed(true)
      })
      .catch(() => {
        if (!cancelled) setLocalFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [id, name, mode])

  if (mode === 'local') {
    if (!localFailed) {
      if (!localSrc) return <FallbackIcon size={size} />
      return (
        <img
          src={localSrc}
          alt=""
          width={size}
          height={size}
          className="shrink-0 rounded-lg object-contain"
          style={{ width: size, height: size, background: 'var(--bg-active)' }}
          onError={() => setLocalFailed(true)}
        />
      )
    }
    // If Windows has no usable local icon for this package, fall through to
    // the same brand-icon sources used by the software catalog.
  }

  if (!id || onlineFailedCache.has(id) || sourceIndex >= sources.length)
    return <FallbackIcon size={size} />
  const src = sources[sourceIndex]
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-lg object-contain"
      style={{ width: size, height: size, background: 'var(--bg-active)' }}
      onError={() => {
        if (sourceIndex < sources.length - 1) setSourceIndex((i) => i + 1)
        else {
          onlineFailedCache.add(id)
          setSourceIndex(sources.length)
        }
      }}
    />
  )
}
