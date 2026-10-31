// Keep locale JSON out of the renderer's startup bundle. Only English and the
// selected language are loaded; other languages are imported when selected.
const modules = import.meta.glob<{ default: Record<string, unknown> }>('./*/*.json')

export const namespaces = Object.keys(modules)
  .filter((path) => path.startsWith('./en/'))
  .map((path) => path.split('/')[2].replace('.json', ''))

const loadedBundles = new Map<string, Promise<Record<string, Record<string, unknown>>>>()

export function loadLocaleResources(
  language: string
): Promise<Record<string, Record<string, unknown>>> {
  const cached = loadedBundles.get(language)
  if (cached) return cached

  const pending = Promise.all(
    Object.entries(modules)
      .filter(([path]) => path.startsWith(`./${language}/`))
      .map(async ([path, load]) => {
        const namespace = path.split('/')[2].replace('.json', '')
        const module = await load()
        return [namespace, module.default] as const
      })
  ).then((entries) => Object.fromEntries(entries))

  loadedBundles.set(language, pending)
  return pending
}
