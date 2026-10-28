import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  VoiceInstallResult,
  VoiceModelInstallInfo,
  VoiceModelStatus,
} from '@/shared/channels/voice'
import { formatSize } from '@/utils/artifactFormat'

const voiceApiMock = vi.hoisted(() => ({
  onModelProgress: vi.fn(),
  getModelStatus: vi.fn(),
  getInstallInfo: vi.fn(),
  installModel: vi.fn(),
  cancelInstall: vi.fn(),
}))

const shellApiMock = vi.hoisted(() => ({
  openExternal: vi.fn(),
}))

vi.mock('@/services/electronAPI', () => ({
  api: { voice: voiceApiMock, shell: shellApiMock },
}))

vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({
    voiceInputCustomUrl: '',
    setVoiceInputCustomUrl: vi.fn(),
  }),
}))

// i18n 按仓库既有约定替换成 key 断言；带参数的 key 追加上参数值。
vi.mock('vue-i18n', () => ({
  createI18n: () => ({
    global: {
      locale: { value: 'en-US' },
      t: (key: string) => key,
    },
  }),
  useI18n: () => ({
    t: translate,
    locale: { value: 'en-US' },
  }),
}))

const INSTALL_INFO: VoiceModelInstallInfo = {
  version: 'test-model',
  archiveBytes: 300_000_000,
  installedBytes: 500_000_000,
  archiveName: 'model.tar.bz2',
  model: {
    name: 'sherpa-onnx X-ASR 480ms streaming zipformer',
    spec: 'zh-en · streaming · punctuation · int8',
    upstreamUrl: 'https://example.com/upstream',
    license: 'Apache-2.0',
  },
  sources: [{ kind: 'github', url: 'https://github.com/example/model.tar.bz2' }],
}

function partialStatus(overrides: Partial<VoiceModelStatus> = {}): VoiceModelStatus {
  return {
    state: 'missing',
    version: null,
    installedBytes: 0,
    diskUsageBytes: 12_345_678,
    partialBytes: 12_345_678,
    archiveBytes: 0,
    archiveReady: false,
    installedTotalBytes: 500_000_000,
    installedAt: null,
    ...overrides,
  }
}

const FAILED_STATUS = partialStatus({
  error: 'ECONNRESET: connection reset by peer',
  errorCode: 'network',
})

const FAILED_INSTALL: VoiceInstallResult = {
  success: false,
  error: 'ECONNRESET: connection reset by peer',
  errorCode: 'network',
  status: FAILED_STATUS,
}

function translate(key: string, params?: Record<string, unknown>): string {
  return params ? `${key}|${Object.values(params).join(',')}` : key
}

async function settle() {
  await flushPromises()
  await flushPromises()
}

let wrapper: VueWrapper<unknown> | null = null

async function mountPage(): Promise<VueWrapper<unknown>> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const { default: VoiceInputSettings } = await import('../VoiceInputSettings.vue')
  wrapper = mount(VoiceInputSettings, {
    global: {
      plugins: [pinia],
      // SFC 模板里用的是全局 $t，测试中补上同款 key 断言翻译。
      mocks: { $t: translate },
    },
  })
  await settle()
  return wrapper
}

/** 安装确认框通过 Teleport 挂到 body，需要到 document 上取。 */
function clickDialogButton(selector: string) {
  const button = document.querySelector<HTMLButtonElement>(selector)
  expect(button).not.toBeNull()
  button!.click()
}

function clickInstall(wrapper: VueWrapper<unknown>) {
  const button = wrapper.find('.actions .s-btn-primary')
  expect(button.exists()).toBe(true)
  return button.trigger('click')
}

beforeEach(() => {
  vi.clearAllMocks()
  voiceApiMock.onModelProgress.mockReturnValue(() => {})
  voiceApiMock.getModelStatus.mockResolvedValue(FAILED_STATUS)
  voiceApiMock.getInstallInfo.mockResolvedValue(INSTALL_INFO)
  voiceApiMock.installModel.mockResolvedValue(FAILED_INSTALL)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('VoiceInputSettings — download failure', () => {
  it('shows why the download failed and keeps the retained bytes visible', async () => {
    const page = await mountPage()

    const errorBox = page.find('.error-box')
    expect(errorBox.exists()).toBe(true)
    expect(errorBox.text()).toContain('voiceInput.errorNetwork')
    // 已下载字节必须保留提示，用户才知道重试会续传而不是从零开始。
    expect(page.find('.hint-list').text()).toContain(
      `voiceInput.partialHint|${formatSize(FAILED_STATUS.partialBytes)}`,
    )
    // 失败不是进行中，安装按钮可再次点击。
    const install = page.find('.actions .s-btn-primary')
    expect(install.exists()).toBe(true)
    expect(install.attributes('disabled')).toBeUndefined()
  })

  it('retries the download when the user confirms installation again', async () => {
    const page = await mountPage()

    await clickInstall(page)
    await settle()
    clickDialogButton('.vmd-btn-primary')
    await settle()

    expect(voiceApiMock.installModel).toHaveBeenCalledTimes(1)
    // 重试失败后仍展示原因与保留字节，不会卡在进度态。
    expect(page.find('.error-box').text()).toContain('voiceInput.errorNetwork')
    expect(page.find('.progress-block').exists()).toBe(false)
    expect(page.find('.actions .s-btn-primary').attributes('disabled')).toBeUndefined()
  })
})

describe('VoiceInputSettings — model identity and sources', () => {
  it('names the model, its spec and license instead of only a version date', async () => {
    const page = await mountPage()

    expect(page.find('.model-name').text()).toBe(INSTALL_INFO.model.name)
    expect(page.find('.model-spec').text()).toBe(INSTALL_INFO.model.spec)
    expect(page.find('.model-badge').text()).toBe(INSTALL_INFO.model.license)

    await page.find('.model-link').trigger('click')
    expect(shellApiMock.openExternal).toHaveBeenCalledWith(INSTALL_INFO.model.upstreamUrl)
  })

  it('lists the source chain and keeps the custom URL behind an advanced toggle', async () => {
    const page = await mountPage()

    expect(page.find('.source-chip').text()).toBe('github.com')
    // 默认不把「填一个 URL」摊给所有人。
    expect(page.find('.advanced-body').exists()).toBe(false)

    await page.find('.advanced-toggle').trigger('click')
    expect(page.find('.advanced-body').exists()).toBe(true)
  })
})
