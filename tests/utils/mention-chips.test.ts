import { describe, it, expect } from 'vitest'
import {
  escapeHtml,
  pathBasename,
  replaceMentionChipMarkers,
  renderMentionChipsToHtml,
  replaceCommandChipMarkers,
  renderCommandChipsToHtml,
  renderContentWithAttachments,
  buildContentWithMarkers,
} from '@/utils/mention-chips'
import type { ImageAttachment } from '@/types'

describe('mention-chips — escapeHtml', () => {
  it('转义所有 HTML 特殊字符', () => {
    expect(escapeHtml(`<a href="x">&'y'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;y&#39;&lt;/a&gt;',
    )
  })

  it('空字符串原样返回', () => {
    expect(escapeHtml('')).toBe('')
  })

  it('无特殊字符时不变', () => {
    expect(escapeHtml('plain text 123')).toBe('plain text 123')
  })
})

describe('mention-chips — pathBasename', () => {
  it('取正斜杠路径的尾段', () => {
    expect(pathBasename('/home/user/file.ts')).toBe('file.ts')
  })

  it('取反斜杠（Windows）路径的尾段', () => {
    expect(pathBasename('D:\\AI\\SpaceCode\\electron')).toBe('electron')
  })

  it('混合分隔符取最后一个', () => {
    expect(pathBasename('D:\\AI/SpaceCode\\src')).toBe('src')
  })

  it('剥离尾部连续分隔符', () => {
    expect(pathBasename('/home/user/folder/')).toBe('folder')
    expect(pathBasename('C:\\dir\\\\')).toBe('dir')
  })

  it('无分隔符时返回整段', () => {
    expect(pathBasename('file.ts')).toBe('file.ts')
  })

  it('空字符串返回空', () => {
    expect(pathBasename('')).toBe('')
  })

  it('仅剩分隔符时返回空', () => {
    expect(pathBasename('///')).toBe('')
  })
})

describe('mention-chips — replaceMentionChipMarkers', () => {
  it('替换 @file 标记为 chip，label 为路径尾段', () => {
    const out = replaceMentionChipMarkers('看 @file:"src/a/b.ts" 这个')
    expect(out).toContain('class="mention-chip"')
    expect(out).toContain('data-path="src/a/b.ts"')
    expect(out).toContain('data-is-folder="false"')
    expect(out).toContain('>b.ts</span>')
    expect(out).toContain('看 ')
    expect(out).toContain(' 这个')
  })

  it('替换 @folder 标记为文件夹 chip', () => {
    const out = replaceMentionChipMarkers('@folder:"src/components"')
    expect(out).toContain('mention-chip is-folder')
    expect(out).toContain('data-is-folder="true"')
  })

  it('chip 内 title/data-path 转义特殊字符', () => {
    const out = replaceMentionChipMarkers('@file:"a<b>.ts"')
    expect(out).toContain('data-path="a&lt;b&gt;.ts"')
  })

  it('非标记文本保持不变', () => {
    expect(replaceMentionChipMarkers('没有任何标记')).toBe('没有任何标记')
  })

  it('空输入返回空', () => {
    expect(replaceMentionChipMarkers('')).toBe('')
  })

  it('同一条消息可替换多个标记', () => {
    const out = replaceMentionChipMarkers('@file:"a.ts" 和 @file:"b.ts"')
    expect(out.match(/mention-chip/g)?.length).toBeGreaterThanOrEqual(2)
  })
})

describe('mention-chips — renderMentionChipsToHtml', () => {
  it('替换标记且转义周围文本', () => {
    const out = renderMentionChipsToHtml('<b>@file:"x.ts"</b>')
    // 周围文本被转义
    expect(out).toContain('&lt;b&gt;')
    expect(out).toContain('&lt;/b&gt;')
    // chip 本身未被转义
    expect(out).toContain('class="mention-chip"')
  })

  it('空输入返回空', () => {
    expect(renderMentionChipsToHtml('')).toBe('')
  })

  it('无标记时整段转义', () => {
    expect(renderMentionChipsToHtml('a & b')).toBe('a &amp; b')
  })
})

describe('mention-chips — command chip 渲染', () => {
  it('replaceCommandChipMarkers 替换 /cmd 标记', () => {
    const out = replaceCommandChipMarkers('运行 /cmd:"build":agent_skill:project 即可')
    expect(out).toContain('command-chip kind-agent_skill source-project')
    expect(out).toContain('data-command="/build"')
    expect(out).toContain('>/build</span>')
  })

  it('goal 命令附加 is-goal 类', () => {
    const out = replaceCommandChipMarkers('/cmd:"goal":builtin:builtin')
    expect(out).toContain('is-goal')
  })

  it('未知 source 回退到 builtin 图标', () => {
    const out = replaceCommandChipMarkers('/cmd:"x":y:unknownsource')
    expect(out).toContain('source-unknownsource')
  })

  it('renderCommandChipsToHtml 转义周围文本', () => {
    const out = renderCommandChipsToHtml('<x>/cmd:"a":k:s</x>')
    expect(out).toContain('&lt;x&gt;')
    expect(out).toContain('data-command="/a"')
  })

  it('空输入返回空', () => {
    expect(replaceCommandChipMarkers('')).toBe('')
    expect(renderCommandChipsToHtml('')).toBe('')
  })
})

describe('mention-chips — renderContentWithAttachments', () => {
  const img = { id: 'img-1', name: 'shot.png' } as ImageAttachment

  it('image 标记命中附件时渲染图片 chip', () => {
    const out = renderContentWithAttachments('@image:"img-1"', [img])
    expect(out).toContain('mention-chip is-image')
    expect(out).toContain('data-image-id="img-1"')
    expect(out).toContain('shot.png')
  })

  it('image 标记未命中附件时保留原始标记（转义）', () => {
    const out = renderContentWithAttachments('@image:"missing"', [img])
    expect(out).toContain('@image:&quot;missing&quot;')
    expect(out).not.toContain('is-image')
  })

  it('无 images 参数时 image 标记原样转义', () => {
    const out = renderContentWithAttachments('@image:"img-1"')
    expect(out).not.toContain('is-image')
  })

  it('同一内容混合 file / image / cmd 标记', () => {
    const out = renderContentWithAttachments(
      '@file:"a.ts" @image:"img-1" /cmd:"b":k:s',
      [img],
    )
    expect(out).toContain('data-path="a.ts"')
    expect(out).toContain('is-image')
    expect(out).toContain('data-command="/b"')
  })

  it('空输入返回空', () => {
    expect(renderContentWithAttachments('')).toBe('')
  })
})

describe('mention-chips — buildContentWithMarkers', () => {
  it('原样返回文本', () => {
    expect(buildContentWithMarkers('hello', [])).toBe('hello')
  })

  it('text 为空时返回空字符串', () => {
    expect(buildContentWithMarkers('', [])).toBe('')
  })
})
