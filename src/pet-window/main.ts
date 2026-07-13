// src/pet-window/main.ts
import { createApp } from 'vue'
import { initPetWindowI18n } from './i18n'
import PetWindowApp from './PetWindowApp.vue'

async function bootstrap() {
  const app = createApp(PetWindowApp)

  const locale = await window.petWindowAPI.getLocale()
  const i18n = await initPetWindowI18n(locale)
  app.use(i18n)

  app.mount('#pet-window-root')
}

bootstrap()
