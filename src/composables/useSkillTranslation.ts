import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { sendMessage, isLLMConfigured, initLLMService } from '@/services/llm'

const TRANSLATION_SYSTEM_PROMPT =
  'You are a professional translator. Translate the following markdown content to Chinese. Preserve all markdown formatting, code blocks, and front matter (YAML between --- markers). Only translate the natural language text. Output the translated markdown directly without any explanation.'

const TRANSLATION_TIMEOUT_MS = 180000
const TRANSLATION_MAX_TOKENS = 8192

export function useSkillTranslation(getContent: () => string) {
  const { t } = useI18n()

  const translatedContent = ref<string | null>(null)
  const isTranslating = ref(false)
  const isTranslated = computed(() => translatedContent.value !== null)

  const displayContent = computed(() => translatedContent.value ?? getContent())

  function resetTranslation() {
    translatedContent.value = null
  }

  async function toggleTranslation() {
    if (translatedContent.value !== null) {
      translatedContent.value = null
      return
    }

    await initLLMService()

    if (!isLLMConfigured()) {
      alert(t('skills.llmNotConfigured') || 'Please configure LLM API key in Settings first.')
      return
    }

    const content = getContent()
    if (!content) return

    isTranslating.value = true
    try {
      const result = await sendMessage(
        [
          { role: 'system', content: TRANSLATION_SYSTEM_PROMPT },
          { role: 'user', content },
        ],
        { maxTokens: TRANSLATION_MAX_TOKENS, timeoutMs: TRANSLATION_TIMEOUT_MS },
      )
      translatedContent.value = result
    } catch (err) {
      console.error('Failed to translate skill content:', err)
      const message = err instanceof Error ? err.message : String(err)
      alert(`${t('skills.translationFailed') || 'Translation failed'}: ${message}`)
    } finally {
      isTranslating.value = false
    }
  }

  return {
    translatedContent,
    isTranslating,
    isTranslated,
    displayContent,
    resetTranslation,
    toggleTranslation,
  }
}
