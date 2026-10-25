export default {
  cardLabel: '生成式 UI 卡片',
  retry: '重试',
  errors: {
    'handshake-timeout': '卡片未能与宿主完成握手',
    'frame-load-failed': '卡片沙箱加载失败',
    'version-mismatch': '卡片协议版本与当前版本不一致',
    'unsupported-origin': '当前宿主未接入卡片沙箱',
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
