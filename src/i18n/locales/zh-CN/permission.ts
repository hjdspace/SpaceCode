export default {
  modeSelector: {
    title: '权限模式',
    default: '默认模式',
    defaultDesc: '敏感操作需确认',
    plan: '计划模式',
    planDesc: '只读，禁止写入',
    acceptEdits: '自动编辑',
    acceptEditsDesc: '文件修改自动放行',
    bypassPermissions: '完全信任 ⚠️',
    bypassPermissionsDesc: '所有操作自动放行',
  },
  card: {
    toolNames: {
      Edit: '编辑文件',
      Write: '写入文件',
      Read: '读取文件',
      Bash: '执行命令',
      Skill: '技能调用',
      AskUserQuestion: '询问用户',
      default: '工具调用',
    },
    actions: {
      allow: '允许',
      deny: '拒绝',
      alwaysAllow: '始终允许',
      processing: '处理中...',
      completed: '已批准',
      denied: '已拒绝',
    },
    status: {
      dangerWarning: '⚠️ 需要确认',
      requestPending: '等待审批...',
    },
    errors: {
      allowFailed: '批准权限失败',
      denyFailed: '拒绝权限失败',
      ipcUnavailable: '权限服务不可用',
    },
  },
}
