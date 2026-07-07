import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { i18n, getSavedLanguage } from './i18n'
import './styles/global.scss'
import './styles/design.scss'
import './styles/mobile.scss'
import { isH5Mode } from './services/h5ApiClient'
import { fetchDesktopConfig } from './services/h5Bootstrap'

// Set locale from saved preference
const savedLocale = getSavedLanguage()
i18n.global.locale.value = savedLocale

const app = createApp(App)
app.use(createPinia())
app.use(i18n)

// H5 模式：在 mount 前拉取桌面端配置并注入 localStorage
// 这样 settingsStore.loadFromGuiSettingsFile() 能读到配置
if (isH5Mode()) {
  fetchDesktopConfig().finally(() => {
    app.mount('#app')
  })
} else {
  app.mount('#app')
}
