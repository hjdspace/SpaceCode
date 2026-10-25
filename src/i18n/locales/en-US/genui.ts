export default {
  cardLabel: 'Generative UI card',
  retry: 'Retry',
  errors: {
    'handshake-timeout': 'The card could not finish handshaking with the host',
    'frame-load-failed': 'The card sandbox failed to load',
    'version-mismatch': 'The card protocol version does not match this build',
    'render-failed': 'The card content failed to render',
    'action-timeout': 'The card action timed out before the host confirmed it',
    'unsupported-origin': 'This host does not provide a card sandbox',
    'sandbox-unreachable':
      'The card sandbox origin is unreachable. For H5 deployments, expose the second port alongside the main one.',
  },
  actions: {
    expand: 'Expand',
    expandTitle: 'Card details',
    expandClose: 'Close',
    copyFailed: 'Copy failed. Please try again.',
    linkFailed: 'The link could not be opened',
    oversized: 'The content is larger than 64KB, so it was not run',
  },
  /**
   * 卡片提交回环（票 04）。摘要只报数量，不含字段值：完整 payload 以围栏 JSON
   * 写在同一条消息正文里，折叠展示由 metadata 决定。
   */
  submission: {
    summaryFields: 'Submitted card "{name}" with {count} fields',
    summaryItems: 'Submitted card "{name}" with {count} items',
    failed: {
      'invalid-payload': 'The submitted content is not an object, so it was not sent',
      unserializable: 'The submitted content cannot be serialized, so it was not sent',
      oversized: 'The submitted content is larger than 64KB, so it was not sent',
      'send-failed': 'Submitting failed. The card is still editable — please retry.',
      'session-unavailable': 'No session is available, so the submission was not sent. Please retry.',
      timeout: 'The submission was not delivered in time. The card is still editable — please retry.',
    },
  },
  /**
   * 卡片超出会话预算后的可见占位（票 05）。卡片不会静默消失。
   */
  lifecycle: {
    expired: 'Card content expired. The submitted result is kept.',
    unavailable: 'Card content is no longer available',
  },
  /**
   * 围栏没投影成卡片时，原文仍按代码块留在正文里，这里只补一句为什么。
   * 名称缺省时不拼进文案，避免出现「：」后面空着。
   */
  fallbacks: {
    label: 'Some card schemas in this reply stayed as text:',
    reasons: {
      'malformed-json': 'the fenced content is not valid JSON',
      'not-an-object': 'the fenced content is not a JSON object',
      'missing-component-name': 'the schema root has no componentName',
      'unsupported-component': 'the root component is not in the official mini material list',
      'protocol-version': 'the schema declares a card protocol version this build cannot render',
      'oversized-schema': 'the schema is larger than the per-card size limit',
      'too-many-cards': 'this reply already reached the per-message card limit',
    },
  },
  fixtureDebugNote: 'Debug message: built-in GenUI card fixture, used only to verify the sandbox carrier.',
  fixture: {
    title: 'GenUI sandbox self-check',
    rows: {
      carrier: 'Carrier',
      carrierValue: 'iframe on an isolated origin',
      usage: 'Purpose',
      usageValue: 'Debug fixture, not part of real output',
    },
  },
}
