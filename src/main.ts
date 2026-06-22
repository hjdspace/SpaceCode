import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { i18n, getSavedLanguage } from './i18n'
import './styles/global.scss'

// Set locale from saved preference
const savedLocale = getSavedLanguage()
i18n.global.locale.value = savedLocale

const app = createApp(App)
app.use(createPinia())
app.use(i18n)
app.mount('#app')
