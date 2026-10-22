import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN/index'
import enUS from './locales/en-US/index'

export type Locale = 'zh-CN' | 'en-US'

export const messages = {
  'zh-CN': zhCN,
  'en-US': enUS,
}

export const defaultLocale: Locale = 'zh-CN'

export function detectSystemLanguage(): Locale {
  const lang = navigator.language.toLowerCase()
  if (lang.startsWith('zh')) {
    return 'zh-CN'
  }
  return 'en-US'
}

export function createI18nInstance(locale: Locale = defaultLocale) {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'en-US',
    messages,
    globalInjection: true,
  })
}

/** Global i18n instance for use outside Vue components */
export const i18n = createI18nInstance()

/** Apply a locale to the running app: messages + <html lang>. */
export function applyLocale(locale: Locale): void {
  i18n.global.locale.value = locale
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale
  }
}

export function getSavedLanguage(): Locale {
  try {
    const saved = localStorage.getItem('claude_desktop_settings')
    if (saved) {
      const parsed = JSON.parse(saved)
      if (parsed.language) {
        return parsed.language
      }
    }
  } catch (e) {
    console.error('[i18n] Failed to load saved language')
  }
  return detectSystemLanguage()
}
