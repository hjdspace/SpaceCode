export default {
  card: {
    methods: {
      select: '引擎在提问',
      confirm: '需要确认',
      input: '需要输入',
      editor: '需要编辑',
    },
    status: {
      waiting: '等待你的回答',
      noOptions: '这条提问没有给出可选项',
    },
    actions: {
      confirm: '确认',
      deny: '拒绝',
      submit: '提交',
      save: '保存并回复',
      dismiss: '关闭',
      // 以下是留在卡片上的回执文本，不是按钮上的字
      confirmed: '已确认',
      denied: '已拒绝',
      dismissed: '已关闭',
    },
    placeholders: {
      input: '输入内容…',
      editor: '编辑内容…',
    },
    outcome: {
      answered: '已应答',
      editedText: '已回复编辑后的内容',
    },
    closed: {
      answered: '已在其他端应答',
      cancelled: '已关闭',
      timeout: '引擎未等到回答，已超时',
      watchdog: '长时间无人应答，已自动取消',
      aborted: '本轮已停止',
      suspended: '会话已挂起，这次提问过期',
      process_exit: '引擎已退出，这次提问过期',
      process_restart: '引擎已重启，这次提问过期',
    },
  },
}
