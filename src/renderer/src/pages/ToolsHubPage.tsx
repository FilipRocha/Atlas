import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Check, Download, ExternalLink, Search, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { usePlatform } from '@/hooks/usePlatform'
import { EXTERNAL_TOOLS, POST_FORMAT_CHECKLIST } from '@shared/external-tools'

const CHECKLIST_KEY = 'atlas:post-format-checklist:v1'

function readChecklist(): boolean[] {
  try {
    const stored = JSON.parse(localStorage.getItem(CHECKLIST_KEY) ?? '[]')
    return POST_FORMAT_CHECKLIST.map((_, index) => stored[index] === true)
  } catch {
    return POST_FORMAT_CHECKLIST.map(() => false)
  }
}

export function ToolsHubPage() {
  const { t } = useTranslation('tools')
  const { platform } = usePlatform()
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [checklist, setChecklist] = useState(readChecklist)

  const filteredTools = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return EXTERNAL_TOOLS
    return EXTERNAL_TOOLS.filter((tool) =>
      `${tool.name} ${tool.description} ${t(`categories.${tool.category}`)}`
        .toLocaleLowerCase()
        .includes(normalized)
    )
  }, [query, t])

  const toggleChecklist = (index: number) => {
    setChecklist((previous) => {
      const next = previous.map((checked, itemIndex) => (itemIndex === index ? !checked : checked))
      try {
        localStorage.setItem(CHECKLIST_KEY, JSON.stringify(next))
      } catch {
        toast.error(t('checklist.saveError'))
      }
      return next
    })
  }

  const openSite = async (toolId: string) => {
    try {
      await window.atlas.externalToolOpenSite(toolId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('siteError'))
    }
  }

  const downloadTool = async (toolId: string) => {
    setBusyId(toolId)
    try {
      const result = await window.atlas.externalToolDownload(toolId)
      toast.success(t('downloadSuccess', { path: result.path }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('downloadError'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <PageHeader title={t('pageTitle')} description={t('pageDescription')} />

      <section className="glass-card rounded-2xl p-5" aria-labelledby="post-format-title">
        <div className="mb-4 flex items-start gap-3">
          <span
            className="rounded-xl p-2"
            style={{ background: 'var(--bg-subtle)', color: 'var(--accent)' }}
          >
            <Check size={18} />
          </span>
          <div>
            <h2
              id="post-format-title"
              className="text-[15px] font-semibold"
              style={{ color: 'var(--text-primary)' }}
            >
              {t('checklist.title')}
            </h2>
            <p className="mt-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {t('checklist.description')}
            </p>
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {POST_FORMAT_CHECKLIST.map((_, index) => (
            <label
              key={index}
              className="flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/[0.03]"
              style={{ border: '1px solid var(--border-subtle)' }}
            >
              <input
                type="checkbox"
                checked={checklist[index]}
                onChange={() => toggleChecklist(index)}
                className="mt-0.5 accent-amber-500"
              />
              <span className="text-[12px] leading-5" style={{ color: 'var(--text-secondary)' }}>
                {t(`checklist.items.${index}`)}
              </span>
            </label>
          ))}
        </div>
      </section>

      <section aria-labelledby="tools-list-title">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2
              id="tools-list-title"
              className="text-[16px] font-semibold"
              style={{ color: 'var(--text-primary)' }}
            >
              {t('catalogTitle')}
            </h2>
            <p className="mt-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {t('catalogDescription')}
            </p>
          </div>
          <label
            className="flex min-w-[220px] items-center gap-2 rounded-xl px-3 py-2"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
          >
            <Search size={15} style={{ color: 'var(--text-muted)' }} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('searchPlaceholder')}
              className="w-full bg-transparent text-[12px] outline-none"
              style={{ color: 'var(--text-primary)' }}
              aria-label={t('searchPlaceholder')}
            />
          </label>
        </div>

        {filteredTools.length === 0 ? (
          <div
            className="glass-card rounded-2xl p-8 text-center text-[13px]"
            style={{ color: 'var(--text-muted)' }}
          >
            {t('noResults')}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filteredTools.map((tool) => {
              const isBusy = busyId === tool.id
              return (
                <article
                  key={tool.id}
                  className="glass-card flex min-h-[205px] flex-col rounded-2xl p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className="rounded-xl p-2"
                        style={{ background: 'var(--bg-subtle)', color: 'var(--accent)' }}
                      >
                        <Wrench size={17} />
                      </span>
                      <div className="min-w-0">
                        <h3
                          className="truncate text-[13px] font-semibold"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {tool.name}
                        </h3>
                        <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                          {t(`categories.${tool.category}`)}
                        </span>
                      </div>
                    </div>
                    {tool.windowsOnly && (
                      <span
                        className="shrink-0 rounded-md px-2 py-1 text-[9px]"
                        style={{ background: 'var(--bg-subtle)', color: 'var(--text-muted)' }}
                      >
                        Windows
                      </span>
                    )}
                  </div>
                  <p
                    className="mt-3 flex-1 text-[11px] leading-5"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {tool.description}
                  </p>
                  {tool.caution && (
                    <div
                      className="mb-3 flex items-start gap-1.5 text-[10px] leading-4"
                      style={{ color: 'var(--warning, #d99a2b)' }}
                    >
                      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                      <span>{tool.caution}</span>
                    </div>
                  )}
                  <div
                    className="flex flex-wrap items-center gap-2 border-t pt-3"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <button
                      type="button"
                      onClick={() => void downloadTool(tool.id)}
                      disabled={
                        !tool.releaseRepo || platform !== 'win32' || isBusy || busyId !== null
                      }
                      title={
                        !tool.releaseRepo
                          ? t('downloadUnavailable')
                          : platform !== 'win32'
                            ? t('windowsOnlyDownload')
                            : undefined
                      }
                      className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                      style={{ background: 'var(--nav-active-bg)', color: 'var(--nav-active-fg)' }}
                    >
                      <Download size={13} />
                      {isBusy ? t('downloading') : t('downloadDirect')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void openSite(tool.id)}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-medium transition-colors hover:bg-white/[0.04]"
                      style={{
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border-subtle)'
                      }}
                    >
                      <ExternalLink size={13} />
                      {t(tool.releaseRepo ? 'openGithub' : 'openOfficialSite')}
                    </button>
                  </div>
                  {!tool.releaseRepo && (
                    <p className="mt-2 text-[10px]" style={{ color: 'var(--text-faint)' }}>
                      {t('downloadUnavailable')}
                    </p>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </section>

      <p
        className="rounded-xl px-4 py-3 text-[11px] leading-5"
        style={{ background: 'var(--bg-subtle)', color: 'var(--text-muted)' }}
      >
        {t('safetyNote')}
      </p>
    </div>
  )
}
