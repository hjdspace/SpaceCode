export default {
  brand: 'SpaceCode',
  intro: {
    eyebrow: 'First run',
    title: 'Welcome to SpaceCode',
    subtitle: 'About a minute to settle what matters. Theme and language apply to the whole app as you pick them.',
    prep: 'We will set',
    start: 'Start setup',
    skip: 'Skip for now',
    skipHint: 'Skipping is fine. The main screen keeps a banner that brings you back.'
  },
  progress: '{done} / {total}',
  later: 'Skip for now',
  next: 'Next',
  prev: 'Back',
  enter: 'Enter SpaceCode',
  step: {
    language: {
      eyebrow: 'Language',
      title: 'Which language?',
      desc: 'It drives every label from here on. Instant, no restart.',
      hint: 'Changeable any time'
    },
    appearance: {
      eyebrow: 'Appearance',
      title: 'Pick an appearance',
      desc: 'Applied to the whole app behind this card, not just the card. Accent and density below.',
      hint: 'Applies to the whole app'
    },
    engine: {
      eyebrow: 'Engine',
      title: 'Who runs your code',
      desc: 'Decides which coding agent runs your tasks. Switching stops every active session.',
      hint: 'Claude Code is the safe default'
    },
    model: {
      eyebrow: 'Model',
      title: 'Connect a model',
      desc: 'Without a model the app cannot work. Test it right here — no key handy, skip and come back later.',
      hint: 'You can finish this later'
    },
    workspace: {
      eyebrow: 'Workspace',
      title: 'Where does code live',
      desc: 'File access and Work mode take this folder as their root. Created if missing.',
      hint: 'Skipping keeps the default'
    },
    summary: {
      eyebrow: 'Done',
      title: 'All set',
      desc: 'Here is what I collected. Everything stays editable in Settings.',
      hint: 'This screen will not return'
    }
  },
  language: {
    chinese: '简体中文',
    english: 'English'
  },
  appearance: {
    fontSize: 'Font size',
    liveHint: 'Note the sidebar and title bar behind this card all followed.'
  },
  engine: {
    claudeCode: 'Claude Code',
    claudeCodeDesc: 'Anthropic’s official engine, bundled and ready',
    pi: 'Pi',
    piDesc: 'Minimalist agent, needs its Pi SDK first',
    piChecking: 'Checking SDK',
    piMissing: 'Not found, install in one click',
    piInstalling: 'Installing',
    piInstalled: 'Installed',
    piInstalledVersion: 'Ready · v{version}',
    piVersionTooOld: 'Version too old (v{version})',
    piVersionUnknown: 'Engine version unverifiable',
    installPi: 'Install Pi SDK',
    piInstallFailed: 'Install failed: {error}',
    installedCliHint: 'Installed CLI drives the claude you installed globally via npm, so you upgrade it yourself.'
  },
  model: {
    pick: 'Connection method',
    oauthTip: 'Claude and Console use the CLI’s own login, not wired into the app yet. Use one of the first three.',
    vendor: 'Vendor',
    keyTip: 'Stored on this machine only, injected as env vars into the engine.',
    showKey: 'Show key',
    hideKey: 'Hide key',
    test: 'Test connection',
    testing: 'Requesting /models',
    fetching: 'Fetching the model list…',
    testOk: 'Working. {count} models returned',
    testFailed: 'Not working. Check URL or key',
    testNoKey: 'Add a key first',
    testProxy: 'Local proxy unavailable',
    slots: 'Model slots',
    slotFast: 'Fast',
    slotBalanced: 'Balanced',
    slotPowerful: 'Powerful',
    slotNote: 'Leave a slot empty and the engine uses its own default.',
    configured: 'Configured',
    notConfigured: 'Not set'
  },
  workspace: {
    path: 'Workspace folder',
    browse: 'Browse',
    useDefault: 'Use default',
    recent: 'Recently used',
    note: 'Work mode confirms its own folder once more on entry. This one is the global project root.',
    defaultUnavailable: 'Default folder unavailable, pick one manually'
  },
  summary: {
    language: 'Language',
    theme: 'Theme',
    engine: 'Engine',
    provider: 'Provider',
    workspace: 'Workspace',
    notSet: 'Not set',
    defaultFolder: 'Default folder (unchanged)',
    oauthSignedIn: 'Signed in as {email}',
    note: 'Written to ~/.claude/gui-settings.json with hasCompletedOnboarding set.'
  },
  banner: {
    modelPending: 'No model configured. Tasks will not run.',
    pending: 'First-run setup is not finished.',
    go: 'Continue setup',
    dismiss: 'Do not show again'
  },
  restart: {
    title: 'First-run guide',
    desc: 'Run the setup guide again: language, appearance, engine, model and workspace.',
    action: 'Re-run guide'
  }
}
