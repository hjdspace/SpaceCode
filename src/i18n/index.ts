import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN/index'

export type Locale = 'zh-CN' | 'en-US'

export const defaultLocale: Locale = 'zh-CN'

/** 入口只同步打包默认语言；另一语言在首次切换（或启动时检测为 en-US）才动态拉取。 */
const loadedLocales = new Set<Locale>([defaultLocale])

const initialMessages: Partial<Record<Locale, typeof zhCN>> = {
  'zh-CN': zhCN,
}

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
    messages: initialMessages,
    globalInjection: true,
  })
}

/** Global i18n instance for use outside Vue components */
export const i18n = createI18nInstance()

/** 按需加载语言包并注册到 i18n（已加载的语言为 no-op）。 */
export async function loadLocale(locale: Locale): Promise<void> {
  if (loadedLocales.has(locale)) return
  if (locale === 'en-US') {
    const { default: enUS } = await import('./locales/en-US/index')
    // 测试里常见只 mock `t` 的轻量 i18n stub，没有 setLocaleMessage；此时保持默认语言即可。
    if (typeof i18n.global.setLocaleMessage !== 'function') return
    i18n.global.setLocaleMessage('en-US', enUS)
  }
  loadedLocales.add(locale)
}

/** Apply a locale to the running app: messages + <html lang>. */
export async function applyLocale(locale: Locale): Promise<void> {
  await loadLocale(locale)
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
