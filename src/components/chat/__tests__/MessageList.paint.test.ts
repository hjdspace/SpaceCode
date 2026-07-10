import { describe, expect, it } from 'vitest'
import messageListSource from '../MessageList.vue?raw'

describe('MessageList paint stability', () => {
  it('does not let Chromium skip message or empty-state painting', () => {
    expect(messageListSource).not.toMatch(/content-visibility\s*:\s*auto/)
    expect(messageListSource).not.toMatch(/contain-intrinsic-size\s*:/)
  })
})
