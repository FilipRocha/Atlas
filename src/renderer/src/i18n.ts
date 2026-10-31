import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { loadLocaleResources, namespaces } from './locales'
import { matchLocaleToLanguage } from '@shared/languages'

// First paint happens before the settings round-trip below resolves, so seed
// the language from the browser locale (which Electron derives from the OS).
// A persisted choice still wins a moment later; this only avoids a flash of
// English for users whose system language we already ship.
const initialLanguage = matchLocaleToLanguage(
  typeof navigator !== 'undefined' ? navigator.language : 'en'
)

const loadedLanguages = new Set<string>()

async function initializeI18n(): Promise<void> {
  const [english, selected] = await Promise.all([
    loadLocaleResources('en'),
    initialLanguage === 'en' ? Promise.resolve(null) : loadLocaleResources(initialLanguage)
  ])
  const resources: Record<string, Record<string, Record<string, unknown>>> = { en: english }
  if (selected) resources[initialLanguage] = selected

  await i18n.use(initReactI18next).init({
    resources,
    lng: initialLanguage,
    fallbackLng: 'en',
    ns: namespaces,
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    react: { useSuspense: false }
  })
  loadedLanguages.add('en')
  loadedLanguages.add(initialLanguage)
}

const initialized = initializeI18n()

export async function changeAppLanguage(language: string): Promise<void> {
  await initialized
  if (!loadedLanguages.has(language)) {
    const resources = await loadLocaleResources(language)
    for (const [namespace, bundle] of Object.entries(resources)) {
      i18n.addResourceBundle(language, namespace, bundle, true, true)
    }
    loadedLanguages.add(language)
  }
  await i18n.changeLanguage(language)
}

export const i18nReady = initialized.then(async () => {
  try {
    const settings = await window.atlas?.settingsGet?.()
    if (settings?.language && settings.language !== i18n.language) {
      await changeAppLanguage(settings.language)
    }
  } catch {
    // Keep the operating-system language if saved settings cannot be read.
  }
})

export default i18n
