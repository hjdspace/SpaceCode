export default {
  modeSelector: {
    title: 'Permission Mode',
    default: 'Default',
    defaultDesc: 'Confirm sensitive operations',
    plan: 'Plan Mode',
    planDesc: 'Read-only, no writes',
    acceptEdits: 'Auto Edit',
    acceptEditsDesc: 'Auto-approve file edits',
    bypassPermissions: 'Full Trust ⚠️',
    bypassPermissionsDesc: 'Auto-approve all operations',
  },
  card: {
    toolNames: {
      Edit: 'Edit File',
      Write: 'Write File',
      Read: 'Read File',
      Bash: 'Run Command',
      Skill: 'Skill',
      AskUserQuestion: 'Ask User',
      default: 'Tool Call',
    },
    actions: {
      allow: 'Allow',
      deny: 'Deny',
      alwaysAllow: 'Always Allow',
      processing: 'Processing...',
      completed: 'Approved',
      denied: 'Denied',
    },
    status: {
      dangerWarning: '⚠️ Requires Confirmation',
      requestPending: 'Awaiting approval...',
    },
    errors: {
      allowFailed: 'Failed to approve permission',
      denyFailed: 'Failed to deny permission',
      ipcUnavailable: 'Permission service unavailable',
    },
  },
}
