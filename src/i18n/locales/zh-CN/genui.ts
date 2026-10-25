export default {
  cardLabel: '生成式 UI 卡片',
  retry: '重试',
  errors: {
    'handshake-timeout': '卡片未能与宿主完成握手',
    'frame-load-failed': '卡片沙箱加载失败',
    'version-mismatch': '卡片协议版本与当前版本不一致',
    'render-failed': '卡片内容渲染失败',
    'action-timeout': '卡片动作超时，未收到确认',
    'unsupported-origin': '当前宿主未接入卡片沙箱',
    'sandbox-unreachable': '卡片沙箱源无法访问：H5 部署请确认第二个端口已随主端口一起暴露',
  },
  actions: {
    expand: '展开',
    expandTitle: '卡片详情',
    expandClose: '关闭',
    copyFailed: '复制失败，请稍后重试',
    linkFailed: '链接无法打开',
    oversized: '内容超过 64KB，未被执行',
  },
  /**
   * 卡片提交回环（票 04）。摘要按数量生成，不含任何字段值：
   * 完整 payload 以围栏 JSON 写在同一条消息正文里，折叠展示由 metadata 决定。
   */
  submission: {
    summaryFields: '已提交卡片「{name}」，共 {count} 个字段',
    summaryItems: '已提交卡片「{name}」，共 {count} 个条目',
    failed: {
      'invalid-payload': '提交内容不是一个对象，未被发送',
      unserializable: '提交内容无法序列化，未被发送',
      oversized: '提交内容超过 64KB，未被发送',
      'send-failed': '提交发送失败，卡片仍可编辑，请重试',
      'session-unavailable': '会话不可用，提交未发送，请重试',
      timeout: '提交未在时限内送达，卡片仍可编辑，请重试',
    },
  },
  /**
   * 卡片超出会话预算后的可见占位（票 05）。卡片不会静默消失：
   * 「过期」只丢内容、「不可用」连 id 都对不上，两种都要说清发生了什么。
   */
  lifecycle: {
    expired: '卡片内容已过期，提交结果仍保留',
    unavailable: '卡片内容已不可用',
  },
  /**
   * 围栏没能投影成卡片时，原文仍按代码块留在正文里，这里只补一句为什么。
   */
  fallbacks: {
    label: '这条回复里有卡片没渲染成界面：',
    reasons: {
      'malformed-json': '围栏内容不是合法 JSON',
      'not-an-object': '围栏内容不是 JSON 对象',
      'missing-component-name': '根节点缺少 componentName',
      'unsupported-component': '根组件不在官方 mini 物料白名单内',
      'protocol-version': 'schema 声明的卡片协议版本当前无法渲染',
      'oversized-schema': 'schema 超过单卡大小限额',
      'too-many-cards': '这条消息的卡片数已达上限',
    },
  },
  fixtureDebugNote: '调试消息：内置 GenUI 卡片 fixture，仅用于验证沙箱承载链路。',
  fixture: {
    title: 'GenUI 沙箱自检',
    rows: {
      carrier: '承载方式',
      carrierValue: '独立 origin 的 iframe',
      usage: '用途',
      usageValue: '调试 fixture，不属于正式输出',
    },
  },
}
