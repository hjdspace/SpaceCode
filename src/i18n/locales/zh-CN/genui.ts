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
  },
  actions: {
    expand: '展开',
    expandTitle: '卡片详情',
    expandClose: '关闭',
    copyFailed: '复制失败，请稍后重试',
    linkFailed: '链接无法打开',
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
