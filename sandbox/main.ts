/**
 * 卡片沙箱文档（票 01 的 fixture 渲染器）。
 *
 * 这一版只证明"沙箱能安全地跑起来并和宿主说话"：接住宿主经 MessageChannel 注入的
 * 密钥/主题/语言/Schema，回 ready 与协议版本，并把承载链路的安全前提自检一遍。
 * 真实 GenUI 渲染器在票 02 接入，届时替换本文件的 render()。
 */
import {
  GENUI_MSG_INIT,
  GENUI_MSG_READY,
  GENUI_MSG_THEME,
  GENUI_SANDBOX_PROTOCOL_VERSION,
  hasGenuiNonce,
  type GenuiInitMessage,
  type GenuiTheme,
} from '@/shared/genuiSandbox'

type Session = { nonce: string; port: MessagePort }

let session: Session | null = null

const card = document.getElementById('card')

function isInitMessage(value: unknown): value is GenuiInitMessage {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Record<string, unknown>
  return message.type === GENUI_MSG_INIT && typeof message.nonce === 'string' && message.nonce.length > 0
}

function messageType(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const type = (value as { type?: unknown }).type
  return typeof type === 'string' ? type : null
}

function replyReady(): void {
  if (!session) return
  const message = {
    type: GENUI_MSG_READY,
    nonce: session.nonce,
    protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION,
  }
  // 通道与父窗口各回一份：宿主两条路都只认 nonce 匹配且来源正确的回信
  session.port.postMessage(message)
  parent.postMessage(message, '*')
}

function applyTheme(theme: unknown): void {
  if (theme !== 'light' && theme !== 'dark') return
  document.documentElement.dataset.theme = theme as GenuiTheme
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

function render(init: GenuiInitMessage): void {
  if (!card) return
  card.textContent = ''
  card.dataset.state = 'ready'
  card.appendChild(renderSchema(init.schema))
  card.appendChild(renderSelfChecks())
  applyTheme(init.theme)
}

function adoptTheme(data: unknown): void {
  if (!session) return
  if (messageType(data) !== GENUI_MSG_THEME) return
  if (!hasGenuiNonce(data, session.nonce)) return
  applyTheme((data as { theme?: unknown }).theme)
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
    session.port.onmessage = (portEvent) => adoptTheme(portEvent.data)
    render(data)
    replyReady()
    return
  }

  // 宿主偶尔也会经 window 推一份（重试路径不重建端口时），同一套判定复用
  adoptTheme(data)
})
