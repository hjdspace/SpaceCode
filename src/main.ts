import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { createI18nInstance, getSavedLanguage } from './i18n'
import './styles/global.scss'

const i18n = createI18nInstance(getSavedLanguage())

const app = createApp(App)
app.config.compilerOptions.isCustomElement = (tag) => tag === 'webview'
app.use(createPinia())
app.use(i18n)
app.mount('#app')
