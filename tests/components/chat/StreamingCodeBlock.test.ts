import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { describe, expect, it } from 'vitest'
import StreamingCodeBlock from '@/components/chat/tools/StreamingCodeBlock.vue'
import enUS from '@/i18n/locales/en-US'
import zhCN from '@/i18n/locales/zh-CN'

const i18n = createI18n({
  legacy: false,
  locale: 'en-US',
  messages: { 'en-US': enUS, 'zh-CN': zhCN },
})

function mountBlock(props: { code: string; language?: string }) {
  return mount(StreamingCodeBlock, {
    props,
    global: { plugins: [createPinia(), i18n] },
  })
}

describe('StreamingCodeBlock', () => {
  it('renders text before a newline inside a multi-line hljs span (comments)', () => {
    const wrapper = mountBlock({
      code: ['function foo() {', '  /* this is', '  a comment */', '  return 1', '}'].join('\n'),
      language: 'javascript',
    })

    const text = wrapper.find('.stream-code__body').text()
    expect(text).toContain('/* this is')
    expect(text).toContain('a comment */')
  })

  it('renders text before a newline inside a multi-line string literal', () => {
    const wrapper = mountBlock({
      code: ['const s = `line one', 'line two`;', 'const n = 1;'].join('\n'),
      language: 'javascript',
    })

    const text = wrapper.find('.stream-code__body').text()
    expect(text).toContain('line one')
    expect(text).toContain('line two`')
  })

  it('preserves line numbering and line count for normal code', () => {
    const wrapper = mountBlock({
      code: 'const a = 1\nconst b = 2\nconst c = 3',
      language: 'javascript',
    })

    const lines = wrapper.findAll('.stream-code__line')
    expect(lines).toHaveLength(3)
    expect(wrapper.text()).toContain('const a = 1')
    expect(wrapper.text()).toContain('const c = 3')
  })
})
