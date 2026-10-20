export default {
  card: {
    methods: {
      select: 'The engine is asking',
      confirm: 'Confirmation needed',
      input: 'Input needed',
      editor: 'Editing needed',
    },
    status: {
      waiting: 'Waiting for your answer',
      noOptions: 'This prompt offered no choices',
    },
    actions: {
      confirm: 'Confirm',
      deny: 'Deny',
      submit: 'Submit',
      save: 'Save and reply',
      dismiss: 'Dismiss',
      // Below are the receipts left on the card, not button labels
      confirmed: 'Confirmed',
      denied: 'Denied',
      dismissed: 'Dismissed',
    },
    placeholders: {
      input: 'Type something…',
      editor: 'Edit the text…',
    },
    outcome: {
      answered: 'Answered',
      editedText: 'Replied with the edited text',
    },
    closed: {
      answered: 'Answered on another client',
      cancelled: 'Dismissed',
      timeout: 'Timed out before an answer',
      watchdog: 'Cancelled after waiting too long',
      aborted: 'This turn was stopped',
      suspended: 'Session suspended, prompt expired',
      process_exit: 'Engine exited, prompt expired',
      process_restart: 'Engine restarted, prompt expired',
    },
  },
}
