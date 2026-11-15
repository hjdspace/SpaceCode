// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  normalizeImageGenConfig,
  loadImageGenConfig,
  redactImageGenApiKey,
  mergeImageGenApiKey,
} from '../imageGenConfig'

describe('normalizeImageGenConfig', () => {
  it('预置补齐 baseUrl 与 model，并锁定方言', () => {
    expect(normalizeImageGenConfig({ presetId: 'zhipu', apiKey: 'k', baseUrl: '', model: '' })).toEqual({
      presetId: 'zhipu',
      dialect: 'zhipu',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'k',
      model: 'cogview-4',
      disableWatermark: false,
    })
  })

  it('预置下用户填的方言被忽略 —— 协议由供应商决定，不是用户选项', () => {
    const config = normalizeImageGenConfig({ presetId: 'ark', apiKey: 'k', dialect: 'openai' })
    expect(config?.dialect).toBe('seedream')
    expect(config?.baseUrl).toBe('https://ark.cn-beijing.volces.com/api/v3')
  })

  it('预置下用户改过的模型名保留 —— 供应商上新版本时不必等预置更新', () => {
    expect(normalizeImageGenConfig({ presetId: 'openai', apiKey: 'k', model: 'gpt-image-2' })?.model).toBe('gpt-image-2')
  })

  it('custom 必须显式给出合法方言', () => {
    const base = { presetId: 'custom', baseUrl: 'https://x.test/v1', apiKey: 'k', model: 'm' }
    expect(normalizeImageGenConfig({ ...base, dialect: 'seedream' })?.dialect).toBe('seedream')
    expect(normalizeImageGenConfig(base)).toBeNull()
    expect(normalizeImageGenConfig({ ...base, dialect: 'nope' })).toBeNull()
  })

  it('缺 key / 缺 model / baseUrl 非 http 一律回 null，而不是拿半个配置去发请求', () => {
    const base = { presetId: 'openai', apiKey: 'k', model: 'm' }
    expect(normalizeImageGenConfig({ ...base, apiKey: '' })).toBeNull()
    expect(normalizeImageGenConfig({ ...base, apiKey: '   ' })).toBeNull()
    expect(normalizeImageGenConfig({ ...base, baseUrl: 'ftp://x.test' })).toBeNull()
    expect(normalizeImageGenConfig({ presetId: 'custom', dialect: 'openai', apiKey: 'k', model: 'm', baseUrl: '' })).toBeNull()
    expect(normalizeImageGenConfig({ presetId: 'custom', dialect: 'openai', apiKey: 'k', model: '  ', baseUrl: 'https://x.test/v1' })).toBeNull()
  })

  it('预置下留空的模型名回落到预置默认值，与 baseUrl 同口径', () => {
    expect(normalizeImageGenConfig({ presetId: 'openai', apiKey: 'k', model: '  ' })?.model).toBe('gpt-image-1')
  })

  it('baseUrl 去掉尾斜杠；非对象输入回 null', () => {
    expect(normalizeImageGenConfig({ presetId: 'openai', apiKey: 'k', model: 'm', baseUrl: 'https://x.test/v1///' })?.baseUrl)
      .toBe('https://x.test/v1')
    expect(normalizeImageGenConfig(null)).toBeNull()
    expect(normalizeImageGenConfig('nope')).toBeNull()
    expect(normalizeImageGenConfig([])).toBeNull()
  })

  it('去水印只认真正的布尔 true —— 默认关闭，智谱未签声明时开启会直接报错', () => {
    const base = { presetId: 'openai', apiKey: 'k', model: 'm' }
    expect(normalizeImageGenConfig(base)?.disableWatermark).toBe(false)
    expect(normalizeImageGenConfig({ ...base, disableWatermark: true })?.disableWatermark).toBe(true)
    expect(normalizeImageGenConfig({ ...base, disableWatermark: 'true' })?.disableWatermark).toBe(false)
  })

  it('未知 presetId 归到 custom，因此必须自带方言才算有效', () => {
    expect(normalizeImageGenConfig({ presetId: 'aliyun', apiKey: 'k', model: 'm', baseUrl: 'https://x.test/v1' })).toBeNull()
    expect(normalizeImageGenConfig({ presetId: 'aliyun', dialect: 'openai', apiKey: 'k', model: 'm', baseUrl: 'https://x.test/v1' })?.presetId)
      .toBe('custom')
  })
})
describe('loadImageGenConfig', () => {
  function home(): string {
    return mkdtempSync(join(tmpdir(), 'spacecode-imagegen-config-'))
  }

  it('文件缺失或坏 JSON 回 null', () => {
    const dir = home()
    expect(loadImageGenConfig(dir)).toBeNull()

    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(join(dir, '.claude', 'gui-settings.json'), '{ not json', 'utf-8')
    expect(loadImageGenConfig(dir)).toBeNull()
  })

  it('主进程读得到保存后的完整配置，含明文 key', () => {
    const dir = home()
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(
      join(dir, '.claude', 'gui-settings.json'),
      JSON.stringify({ imageGenConfig: { presetId: 'ark', apiKey: 'ark-secret', model: 'doubao-seedream-4-0-250828' } }),
      'utf-8',
    )
    expect(loadImageGenConfig(dir)).toEqual({
      presetId: 'ark',
      dialect: 'seedream',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey: 'ark-secret',
      model: 'doubao-seedream-4-0-250828',
      disableWatermark: false,
    })
  })

  it('没配过生图时回 null —— 工具据此指向设置分区', () => {
    const dir = home()
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(join(dir, '.claude', 'gui-settings.json'), JSON.stringify({ authMethod: 'claudeai' }), 'utf-8')
    expect(loadImageGenConfig(dir)).toBeNull()
  })
})

describe('redactImageGenApiKey（回读边界）', () => {
  const withKey = JSON.stringify({
    authMethod: 'anthropic_compatible',
    anthropicConfig: { apiKey: 'chat-key' },
    imageGenConfig: { presetId: 'openai', dialect: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'img-secret', model: 'gpt-image-1', disableWatermark: false },
  })

  it('回读不含明文 key，只给「是否已配置」', () => {
    const out = redactImageGenApiKey(withKey)
    expect(out).not.toContain('img-secret')
    expect(JSON.parse(out).imageGenConfig).toEqual({
      presetId: 'openai',
      dialect: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-image-1',
      disableWatermark: false,
      hasApiKey: true,
    })
  })

  it('没配过 key 时 hasApiKey 为 false', () => {
    const raw = JSON.stringify({ imageGenConfig: { presetId: 'openai', apiKey: '  ' } })
    expect(JSON.parse(redactImageGenApiKey(raw)).imageGenConfig.hasApiKey).toBe(false)
  })

  it('只动生图这一段：对话模型的配置原样保留', () => {
    const parsed = JSON.parse(redactImageGenApiKey(withKey))
    expect(parsed.anthropicConfig.apiKey).toBe('chat-key')
    expect(parsed.authMethod).toBe('anthropic_compatible')
  })

  it('没有生图配置或解析不了时原样返回，不重排别人的文档', () => {
    const raw = '{\n  "authMethod": "claudeai"\n}'
    expect(redactImageGenApiKey(raw)).toBe(raw)
    expect(redactImageGenApiKey('{ oops')).toBe('{ oops')
  })
})

describe('mergeImageGenApiKey（保存边界）', () => {
  const persisted = JSON.stringify({ imageGenConfig: { presetId: 'openai', apiKey: 'stored-key', model: 'gpt-image-1' } })
  const incoming = (apiKey: string) => JSON.stringify({
    authMethod: 'claudeai',
    imageGenConfig: { presetId: 'openai', dialect: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey, model: 'gpt-image-1', disableWatermark: false, hasApiKey: true },
  })

  it('留空的 key 沿用磁盘上那份 —— 改别的设置不该把生图 key 抹掉', () => {
    const merged = JSON.parse(mergeImageGenApiKey(incoming(''), persisted))
    expect(merged.imageGenConfig.apiKey).toBe('stored-key')
    expect(merged.imageGenConfig.hasApiKey).toBe(true)
  })

  it('填了新 key 就覆盖旧的', () => {
    const merged = JSON.parse(mergeImageGenApiKey(incoming('fresh-key'), persisted))
    expect(merged.imageGenConfig.apiKey).toBe('fresh-key')
  })

  it('磁盘上也没有 key 时 hasApiKey 回落 false，不谎报已配置', () => {
    const merged = JSON.parse(mergeImageGenApiKey(incoming(''), null))
    expect(merged.imageGenConfig.apiKey).toBe('')
    expect(merged.imageGenConfig.hasApiKey).toBe(false)
  })

  it('磁盘那份解析不了时按没配过处理', () => {
    expect(JSON.parse(mergeImageGenApiKey(incoming(''), '{ broken')).imageGenConfig.apiKey).toBe('')
  })

  it('清空整个生图配置时连 key 一起丢掉', () => {
    const cleared = JSON.stringify({ imageGenConfig: null })
    expect(mergeImageGenApiKey(cleared, persisted)).toBe(cleared)
  })

  it('没有生图字段或解析不了时原样返回', () => {
    const raw = '{\n  "authMethod": "claudeai"\n}'
    expect(mergeImageGenApiKey(raw, persisted)).toBe(raw)
    expect(mergeImageGenApiKey('{ oops', persisted)).toBe('{ oops')
  })

  it('往返一致：写进去的 key 主进程读得到，回读给渲染层仍是空', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spacecode-imagegen-roundtrip-'))
    mkdirSync(join(dir, '.claude'), { recursive: true })
    const path = join(dir, '.claude', 'gui-settings.json')

    writeFileSync(path, mergeImageGenApiKey(incoming('round-trip-key'), null), 'utf-8')
    expect(loadImageGenConfig(dir)?.apiKey).toBe('round-trip-key')

    // 渲染层拿到脱敏那份后，任何一次无关保存都不能把 key 写没
    const fromRenderer = redactImageGenApiKey(readFileSync(path, 'utf-8'))
    writeFileSync(path, mergeImageGenApiKey(fromRenderer, readFileSync(path, 'utf-8')), 'utf-8')
    expect(loadImageGenConfig(dir)?.apiKey).toBe('round-trip-key')
  })
})
