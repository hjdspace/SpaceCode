export default {
  cardLabel: 'Generative UI card',
  retry: 'Retry',
  errors: {
    'handshake-timeout': 'The card could not finish handshaking with the host',
    'frame-load-failed': 'The card sandbox failed to load',
    'version-mismatch': 'The card protocol version does not match this build',
    'unsupported-origin': 'This host does not provide a card sandbox',
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
