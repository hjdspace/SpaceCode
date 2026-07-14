import { describe, it, expect } from 'vitest'
import { ImageBlockWatcher } from '@electron/im/adapters/common/attachment/image-block-watcher'

describe('ImageBlockWatcher', () => {
  it('should detect image blocks in a single chunk', () => {
    const watcher = new ImageBlockWatcher()
    const results = watcher.feed('Here is an image: ![alt](https://example.com/img.png)')
    expect(results).toHaveLength(1)
    expect(results[0].target).toBe('https://example.com/img.png')
    expect(results[0].kind).toBe('url')
    expect(results[0].alt).toBe('alt')
  })

  it('should detect multiple images in one chunk', () => {
    const watcher = new ImageBlockWatcher()
    const results = watcher.feed('![a](url1.png) and ![b](url2.png)')
    expect(results).toHaveLength(2)
  })

  it('should deduplicate identical images', () => {
    const watcher = new ImageBlockWatcher()
    watcher.feed('![a](url1.png)')
    const results = watcher.feed('![a](url1.png)')
    expect(results).toHaveLength(0) // already seen
  })

  it('should handle image blocks spanning feed boundaries', () => {
    const watcher = new ImageBlockWatcher()
    // Split the image markdown across two feeds
    const results1 = watcher.feed('Some text ![alt](htt')
    expect(results1).toHaveLength(0)

    const results2 = watcher.feed('ps://example.com/img.png) more text')
    expect(results2).toHaveLength(1)
    expect(results2[0].target).toBe('https://example.com/img.png')
  })

  it('should classify path targets correctly', () => {
    const watcher = new ImageBlockWatcher()
    const results = watcher.feed('![local](/path/to/image.png)')
    expect(results).toHaveLength(1)
    expect(results[0].kind).toBe('path')
  })

  it('should prevent buffer overflow', () => {
    const watcher = new ImageBlockWatcher()
    // Feed a very long chunk without any image markdown
    const longChunk = 'a'.repeat(5000)
    watcher.feed(longChunk)
    // Buffer should be trimmed (internal state, but no crash)
    const results = watcher.feed('![test](url.png)')
    expect(results).toHaveLength(1)
  })

  it('reset() should clear state', () => {
    const watcher = new ImageBlockWatcher()
    watcher.feed('![a](url1.png)')
    watcher.reset()
    const results = watcher.feed('![a](url1.png)')
    expect(results).toHaveLength(1) // should detect again after reset
  })
})
