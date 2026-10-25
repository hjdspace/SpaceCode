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
  },
  actions: {
    expand: 'Expand',
    expandTitle: 'Card details',
    expandClose: 'Close',
    copyFailed: 'Copy failed. Please try again.',
    linkFailed: 'The link could not be opened',
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
