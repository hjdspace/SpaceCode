/**
 * 卡片沙箱文档。
 *
 * 两件事：接住宿主经 MessageChannel 注入的密钥/主题/语言/Schema 并回 ready（票 01 的承载
 * 链路），以及把真实 Schema 交给官方 mini 物料渲染（票 02）。渲染本身在
 * `src/lib/genui/cardRenderer.ts` 编排，物料胶水在 `sandbox/cardMaterials.ts`。
 *
 * `FixtureCard` 是票 01 留下的调试卡：它不在物料白名单里，真实技能输出永远不会用到，
 * 走自检渲染分支，好让「断网 / 读不到父文档 / eval 可用」这几条承载前提随时可用肉眼复核。
 */
import {
  GENUI_MSG_ACTION,
  GENUI_MSG_ERROR,
  GENUI_MSG_INIT,
  GENUI_MSG_READY,
  GENUI_MSG_SIZE,
  GENUI_SANDBOX_PROTOCOL_VERSION,
  isGenuiThemeMessage,
  type GenuiInitMessage,
  type GenuiTheme,
} from '@/shared/genuiSandbox'
import { mountGenuiCard, type MountedCard } from '@/lib/genui/cardRenderer'
import { GENUI_FIXTURE_COMPONENT_NAME } from '@/lib/genui/debugFixture'
import { renderOfficialCard } from './cardMaterials'

type Session = { nonce: string; port: MessagePort }

let session: Session | null = null
/** 已建立握手的卡片渲染实例；fixture 卡不走这条，所以可能为 null */
let mounted: MountedCard | null = null

const card = document.getElementById('card')

function isInitMessage(value: unknown): value is GenuiInitMessage {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Record<string, unknown>
  return message.type === GENUI_MSG_INIT && typeof message.nonce === 'string' && message.nonce.length > 0
}

/** 回信一律带密钥；通道与父窗口各回一份，宿主两条路都只认 nonce 匹配且来源正确的回信。 */
function postToHost(type: string, extra: Record<string, unknown> = {}): void {
  if (!session) return
  const message = { type, nonce: session.nonce, ...extra }
  session.port.postMessage(message)
  parent.postMessage(message, '*')
}

function replyReady(): void {
  postToHost(GENUI_MSG_READY, { protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION })
}

function asTheme(theme: unknown): GenuiTheme {
  return theme === 'dark' ? 'dark' : 'light'
}

function applyTheme(theme: unknown): void {
  document.documentElement.dataset.theme = asTheme(theme)
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** 宿主给的 Schema 只按已知字段渲染，其余内容一律走 textContent，不拼 HTML。 */
function renderSchema(schema: Record<string, unknown>): DocumentFragment {
  const fragment = document.createDocumentFragment()
  const componentName = typeof schema.componentName === 'string' ? schema.componentName : 'Unknown'
  const title = typeof schema.title === 'string' ? schema.title : componentName
  fragment.appendChild(el('h2', 'card-title', title))

  const rows = Array.isArray(schema.rows) ? schema.rows : []
  if (rows.length) {
    const list = el('dl', 'card-rows')
    for (const raw of rows) {
      if (typeof raw !== 'object' || raw === null) continue
      const row = raw as { label?: unknown; value?: unknown }
      const line = el('div', 'card-row')
      line.appendChild(el('dt', '', typeof row.label === 'string' ? row.label : ''))
      line.appendChild(el('dd', '', typeof row.value === 'string' ? row.value : JSON.stringify(row.value ?? null)))
      list.appendChild(line)
    }
    fragment.appendChild(list)
  }
  return fragment
}

type Verdict = 'pass' | 'fail' | 'pending'

function checkRow(name: string, value: string, verdict: Verdict): HTMLElement {
  const row = el('div', 'check')
  row.appendChild(el('span', 'check-name', name))
  const result = el('span', 'check-value', value)
  result.dataset.verdict = verdict
  row.appendChild(result)
  return row
}

/** 卡片读不到父文档与自身 storage —— 这两条是本设计的存在理由，直接显示出来。 */
function probeParentUnreadable(): boolean {
  try {
    void parent.document
    return false
  } catch {
    return true
  }
}

function probeOwnStorageBlocked(): boolean {
  try {
    window.localStorage.getItem('genui-probe')
    return false
  } catch {
    return true
  }
}

function probeEvalAllowed(): boolean {
  try {
    return new Function('return 6*7')() === 42
  } catch {
    return false
  }
}

function markNetworkCheck(row: HTMLElement, text: string, verdict: Verdict): void {
  const value = row.querySelector<HTMLElement>('.check-value')
  if (!value) return
  value.textContent = text
  value.dataset.verdict = verdict
}

function renderSelfChecks(): HTMLElement {
  const parentUnreadable = probeParentUnreadable()
  const storageBlocked = probeOwnStorageBlocked()
  const evalAllowed = probeEvalAllowed()

  const section = el('div', 'card-section')
  section.appendChild(el('div', 'card-section-title', 'sandbox self-check'))

  const checks = el('div', 'checks')
  checks.appendChild(
    checkRow('parent document unreadable', parentUnreadable ? 'blocked' : 'LEAKED', parentUnreadable ? 'pass' : 'fail'),
  )
  checks.appendChild(checkRow('own storage blocked', storageBlocked ? 'blocked' : 'LEAKED', storageBlocked ? 'pass' : 'fail'))
  checks.appendChild(checkRow('script-src unsafe-eval', evalAllowed ? 'eval ok' : 'unavailable', evalAllowed ? 'pass' : 'fail'))
  checks.appendChild(checkRow('source', location.host || location.protocol, 'pending'))

  const networkRow = checkRow('connect-src', 'probing…', 'pending')
  checks.appendChild(networkRow)
  section.appendChild(checks)

  // connect-src 'none' 下 fetch 必然被拒；被放行说明 CSP 没生效
  fetch(location.href)
    .then(() => markNetworkCheck(networkRow, 'ALLOWED', 'fail'))
    .catch(() => markNetworkCheck(networkRow, 'blocked', 'pass'))

  return section
}

function renderFixture(init: GenuiInitMessage): void {
  if (!card) return
  card.textContent = ''
  card.dataset.state = 'ready'
  card.appendChild(renderSchema(init.schema))
  card.appendChild(renderSelfChecks())
}

/**
 * 真实卡片：渲染失败与内容高度都由这里上报给宿主，宿主只换这一张卡的占位、
 * 只收放这一个 iframe —— 失败永远不外溢到消息其余部分或别的卡。
 */
function renderRealCard(init: GenuiInitMessage): void {
  if (!card) return
  card.textContent = ''
  card.dataset.state = 'rendering'
  mounted = mountGenuiCard(
    card,
    init.schema,
    { theme: asTheme(init.theme), locale: init.locale },
    {
      onError: () => postToHost(GENUI_MSG_ERROR),
      onResize: (height) => postToHost(GENUI_MSG_SIZE, { height }),
      // 动作与回信走同一条已握手通道；宿主桥再按白名单、协议与限额过滤
      onAction: (request) => postToHost(GENUI_MSG_ACTION, { action: request.action, payload: request.payload }),
    },
    { render: renderOfficialCard },
  )
  card.dataset.state = 'ready'
}

function render(init: GenuiInitMessage): void {
  applyTheme(init.theme)
  if (init.schema?.componentName === GENUI_FIXTURE_COMPONENT_NAME) {
    renderFixture(init)
    return
  }
  renderRealCard(init)
}

function adoptAppearance(data: unknown): void {
  if (!session) return
  // 主题与语言只经宿主注入进来，卡片不读父窗口 CSS
  if (!isGenuiThemeMessage(data, session.nonce)) return
  applyTheme(data.theme)
  mounted?.applyAppearance({ theme: asTheme(data.theme), locale: data.locale })
}

window.addEventListener('message', (event) => {
  const data = event.data

  if (isInitMessage(data)) {
    // 一张卡只认第一次注入：后续再来的 init（别的卡或伪造的）一律忽略
    if (session) return
    // 没有随行的端口就没有回信通道，按未握手处理
    if (event.ports.length !== 1) return
    session = { nonce: data.nonce, port: event.ports[0] }
    // 握手之后的宿主消息走端口，不再经过 window：端口上的 message 不会派发到 window，
    // 只监听 window 会让主题与语言推送静默丢失。
    session.port.onmessage = (portEvent) => adoptAppearance(portEvent.data)
    render(data)
    replyReady()
    return
  }

  // 宿主偶尔也会经 window 推一份（重试路径不重建端口时），同一套判定复用
  adoptAppearance(data)
})
