/**
 * vClickOutside directive
 *
 * Calls the bound callback when clicking outside the element.
 * Extracted from ChatInput.vue for reusability.
 */
import type { Directive } from 'vue'

export const vClickOutside: Directive = {
  mounted(el: HTMLElement, binding: any) {
    const clickHandler = (event: Event) => {
      if (!(el === event.target || el.contains(event.target as Node))) {
        binding.value()
      }
    }
    ;(el as any).__clickOutside__ = clickHandler
    document.addEventListener('click', clickHandler, true)
  },
  unmounted(el: HTMLElement) {
    const clickHandler = (el as any).__clickOutside__
    if (clickHandler) {
      document.removeEventListener('click', clickHandler, true)
    }
  }
}
