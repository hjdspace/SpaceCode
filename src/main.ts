import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { i18n, getSavedLanguage } from './i18n'
import './styles/global.scss'
import './styles/design.scss'
import './styles/mobile.scss'
import { isH5Mode } from './services/h5ApiClient'
import { fetchDesktopConfig } from './services/h5Bootstrap'
import { installRandomUUIDFallback } from './utils/uuid'
import { useTurnStore } from '@/stores/turn'

installRandomUUIDFallback()

// Set locale from saved preference
const savedLocale = getSavedLanguage()
i18n.global.locale.value = savedLocale

const app = createApp(App)
app.use(createPinia())
app.use(i18n)

// ADR-0003: 在 app.mount 前显式实例化 turn store，确保事件订阅
// （onStreamEvent/onAssistant/onToolUse 等）在 WebSocket 连接前注册完成。
// 必须在 createPinia() 之后调用，否则 store 无法解析。
useTurnStore()

// H5 模式：在 mount 前拉取桌面端配置并注入 localStorage
// 这样 settingsStore.loadFromGuiSettingsFile() 能读到配置
if (isH5Mode()) {
  fetchDesktopConfig().finally(() => {
    app.mount('#app')
  })
} else {
  app.mount('#app')
}
