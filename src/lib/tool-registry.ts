export type ToolCategory =
  | 'execution'
  | 'filesystem'
  | 'web'
  | 'agent'
  | 'task'
  | 'skill'
  | 'plan'
  | 'workflow'
  | 'monitor'
  | 'communication'
  | 'mcp'
  | 'config'
  | 'worktree'
  | 'review'

export type ToolAvailability = 'always' | 'feature-flag' | 'env-var' | 'runtime-check'

export interface ToolDefinition {
  name: string
  displayName: string
  icon: string
  category: ToolCategory
  description: string
  availability: ToolAvailability
  featureFlag?: string
  envVar?: string
  runtimeCheckDescription?: string
  hasSpecialUI: boolean
  primaryInputKey?: string
}

export interface ToolCategoryDefinition {
  id: ToolCategory
  name: string
  icon: string
  color: string
}

export const TOOL_CATEGORIES: ToolCategoryDefinition[] = [
  { id: 'execution', name: 'Terminal & Execution', icon: 'Terminal', color: 'rgba(34, 197, 94, 0.1)' },
  { id: 'filesystem', name: 'File Operations', icon: 'FileText', color: 'rgba(59, 130, 246, 0.1)' },
  { id: 'web', name: 'Web & Network', icon: 'Globe', color: 'rgba(249, 115, 22, 0.1)' },
  { id: 'agent', name: 'Agent System', icon: 'Bot', color: 'rgba(139, 92, 246, 0.1)' },
  { id: 'task', name: 'Task Management', icon: 'ListChecks', color: 'rgba(14, 165, 233, 0.1)' },
  { id: 'skill', name: 'Skills', icon: 'Zap', color: 'rgba(234, 179, 8, 0.1)' },
  { id: 'plan', name: 'Plan Mode', icon: 'ClipboardList', color: 'rgba(168, 85, 247, 0.1)' },
  { id: 'workflow', name: 'Workflow & Automation', icon: 'Workflow', color: 'rgba(20, 184, 166, 0.1)' },
  { id: 'monitor', name: 'Monitor & Diagnostics', icon: 'Activity', color: 'rgba(239, 68, 68, 0.1)' },
  { id: 'communication', name: 'Communication', icon: 'MessageSquare', color: 'rgba(236, 72, 153, 0.1)' },
  { id: 'mcp', name: 'MCP Integration', icon: 'Cpu', color: 'rgba(6, 182, 212, 0.1)' },
  { id: 'config', name: 'Config & IDE', icon: 'Settings2', color: 'rgba(113, 113, 122, 0.1)' },
  { id: 'worktree', name: 'Git Worktree', icon: 'GitBranch', color: 'rgba(245, 158, 11, 0.1)' },
  { id: 'review', name: 'Review', icon: 'Shield', color: 'rgba(16, 185, 129, 0.1)' },
]

export const TOOL_REGISTRY: ToolDefinition[] = [
  // ═══════════════════════════════════════
  // execution — 命令执行
  // ═══════════════════════════════════════
  {
    name: 'Bash',
    displayName: 'Bash',
    icon: 'Terminal',
    category: 'execution',
    description: 'Execute bash commands in the shell',
    availability: 'always',
    hasSpecialUI: true,
    primaryInputKey: 'command',
  },
  {
    name: 'PowerShell',
    displayName: 'PowerShell',
    icon: 'Terminal',
    category: 'execution',
    description: 'Execute PowerShell commands (Windows)',
    availability: 'runtime-check',
    runtimeCheckDescription: 'isPowerShellToolEnabled() - platform dependent',
    hasSpecialUI: false,
    primaryInputKey: 'command',
  },

  // ═══════════════════════════════════════
  // filesystem — 文件操作
  // ═══════════════════════════════════════
  {
    name: 'Read',
    displayName: 'Read File',
    icon: 'FileText',
    category: 'filesystem',
    description: 'Read contents of a file',
    availability: 'always',
    hasSpecialUI: true,
    primaryInputKey: 'file_path',
  },
  {
    name: 'Write',
    displayName: 'Write File',
    icon: 'FilePlus',
    category: 'filesystem',
    description: 'Create or overwrite a file',
    availability: 'always',
    hasSpecialUI: true,
    primaryInputKey: 'file_path',
  },
  {
    name: 'Edit',
    displayName: 'Edit File',
    icon: 'FileEdit',
    category: 'filesystem',
    description: 'Apply search-and-replace edits to a file',
    availability: 'always',
    hasSpecialUI: true,
    primaryInputKey: 'file_path',
  },
  {
    name: 'Glob',
    displayName: 'Glob Search',
    icon: 'Search',
    category: 'filesystem',
    description: 'Find files by pattern (glob syntax)',
    availability: 'always',
    hasSpecialUI: true,
    primaryInputKey: 'pattern',
  },
  {
    name: 'Grep',
    displayName: 'Grep Search',
    icon: 'TextSearch',
    category: 'filesystem',
    description: 'Search file contents using regex',
    availability: 'always',
    hasSpecialUI: true,
    primaryInputKey: 'query',
  },

  // ═══════════════════════════════════════
  // web — 网络
  // ═══════════════════════════════════════
  {
    name: 'WebFetch',
    displayName: 'Web Fetch',
    icon: 'Globe',
    category: 'web',
    description: 'Fetch and read content from a URL',
    availability: 'always',
    hasSpecialUI: true,
    primaryInputKey: 'url',
  },
  {
    name: 'WebSearch',
    displayName: 'Web Search',
    icon: 'Search',
    category: 'web',
    description: 'Search the web for information',
    availability: 'always',
    hasSpecialUI: true,
    primaryInputKey: 'query',
  },
  {
    name: 'WebBrowser',
    displayName: 'Web Browser',
    icon: 'Globe',
    category: 'web',
    description: 'Control a browser for web interactions',
    availability: 'feature-flag',
    featureFlag: 'WEB_BROWSER_TOOL',
    hasSpecialUI: false,
  },

  // ═══════════════════════════════════════
  // agent — 代理系统
  // ═══════════════════════════════════════
  {
    name: 'Agent',
    displayName: 'Agent',
    icon: 'Bot',
    category: 'agent',
    description: 'Launch a sub-agent for complex tasks',
    availability: 'always',
    hasSpecialUI: true,
    primaryInputKey: 'agentType',
  },
  {
    name: 'SendMessage',
    displayName: 'Send Message',
    icon: 'Send',
    category: 'agent',
    description: 'Send message to a teammate agent',
    availability: 'always',
    hasSpecialUI: false,
  },
  {
    name: 'TeamCreate',
    displayName: 'Create Team',
    icon: 'Users',
    category: 'agent',
    description: 'Create an agent team (swarm)',
    availability: 'feature-flag',
    featureFlag: 'AGENT_SWARMS',
    hasSpecialUI: false,
  },
  {
    name: 'TeamDelete',
    displayName: 'Delete Team',
    icon: 'UsersRoundDash',
    category: 'agent',
    description: 'Delete an agent team',
    availability: 'feature-flag',
    featureFlag: 'AGENT_SWARMS',
    hasSpecialUI: false,
  },

  // ═══════════════════════════════════════
  // task — 任务管理
  // ═══════════════════════════════════════
  {
    name: 'TodoWrite',
    displayName: 'Todo Write',
    icon: 'ListTodo',
    category: 'task',
    description: 'Write/update todo list items',
    availability: 'always',
    hasSpecialUI: true,
    primaryInputKey: 'todos',
  },
  {
    name: 'TaskCreate',
    displayName: 'Create Task',
    icon: 'CircleDot',
    category: 'task',
    description: 'Create a new task (Todo V2)',
    availability: 'runtime-check',
    runtimeCheckDescription: 'isTodoV2Enabled() - depends on settings',
    hasSpecialUI: true,
  },
  {
    name: 'TaskGet',
    displayName: 'Get Task',
    icon: 'CircleDot',
    category: 'task',
    description: 'Get details of a specific task',
    availability: 'runtime-check',
    runtimeCheckDescription: 'isTodoV2Enabled()',
    hasSpecialUI: false,
  },
  {
    name: 'TaskUpdate',
    displayName: 'Update Task',
    icon: 'Pencil',
    category: 'task',
    description: 'Update an existing task status/metadata',
    availability: 'runtime-check',
    runtimeCheckDescription: 'isTodoV2Enabled()',
    hasSpecialUI: true,
  },
  {
    name: 'TaskList',
    displayName: 'List Tasks',
    icon: 'List',
    category: 'task',
    description: 'List all tasks (Todo V2)',
    availability: 'runtime-check',
    runtimeCheckDescription: 'isTodoV2Enabled()',
    hasSpecialUI: true,
  },
  {
    name: 'TaskStop',
    displayName: 'Stop Task',
    icon: 'Octagon',
    category: 'task',
    description: 'Stop a running task or agent turn',
    availability: 'always',
    hasSpecialUI: false,
  },
  {
    name: 'TaskOutput',
    displayName: 'Task Output',
    icon: 'FileOutput',
    category: 'task',
    description: 'Get output from a completed task',
    availability: 'always',
    hasSpecialUI: false,
  },

  // ═══════════════════════════════════════
  // skill — 技能
  // ═══════════════════════════════════════
  {
    name: 'Skill',
    displayName: 'Skill',
    icon: 'Zap',
    category: 'skill',
    description: 'Execute a slash-command skill',
    availability: 'always',
    hasSpecialUI: true,
    primaryInputKey: 'skill',
  },

  // ═══════════════════════════════════════
  // plan — 计划模式
  // ═══════════════════════════════════════
  {
    name: 'EnterPlanMode',
    displayName: 'Enter Plan Mode',
    icon: 'ClipboardList',
    category: 'plan',
    description: 'Enter planning mode for design-first workflow',
    availability: 'always',
    hasSpecialUI: false,
  },
  {
    name: 'ExitPlanMode',
    displayName: 'Exit Plan Mode',
    icon: 'ClipboardCheck',
    category: 'plan',
    description: 'Exit planning mode and proceed to implementation',
    availability: 'always',
    hasSpecialUI: false,
  },
  {
    name: 'VerifyPlanExecution',
    displayName: 'Verify Plan Execution',
    icon: 'ShieldCheck',
    category: 'plan',
    description: 'Verify the execution of an approved plan',
    availability: 'env-var',
    envVar: 'CLAUDE_CODE_VERIFY_PLAN=true',
    hasSpecialUI: false,
  },

  // ═══════════════════════════════════════
  // workflow — 工作流/自动化
  // ═══════════════════════════════════════
  {
    name: 'Workflow',
    displayName: 'Workflow',
    icon: 'Workflow',
    category: 'workflow',
    description: 'Execute a workflow script (YAML-based automation)',
    availability: 'feature-flag',
    featureFlag: 'WORKFLOW_SCRIPTS',
    hasSpecialUI: true,
    primaryInputKey: 'workflow',
  },
  {
    name: 'CronCreate',
    displayName: 'Create Cron Job',
    icon: 'Clock',
    category: 'workflow',
    description: 'Create a scheduled cron job',
    availability: 'always',
    hasSpecialUI: false,
  },
  {
    name: 'CronDelete',
    displayName: 'Delete Cron Job',
    icon: 'Timer',
    category: 'workflow',
    description: 'Delete a scheduled cron job',
    availability: 'always',
    hasSpecialUI: false,
  },
  {
    name: 'CronList',
    displayName: 'List Cron Jobs',
    icon: 'Clock',
    category: 'workflow',
    description: 'List all scheduled cron jobs',
    availability: 'always',
    hasSpecialUI: false,
  },

  // ═══════════════════════════════════════
  // monitor — 监控/诊断
  // ═══════════════════════════════════════
  {
    name: 'Monitor',
    displayName: 'Monitor',
    icon: 'Activity',
    category: 'monitor',
    description: 'Monitor long-running background processes',
    availability: 'feature-flag',
    featureFlag: 'MONITOR_TOOL',
    hasSpecialUI: true,
  },
  {
    name: 'Sleep',
    displayName: 'Sleep',
    icon: 'Timer',
    category: 'monitor',
    description: 'Wait/sleep for specified duration',
    availability: 'feature-flag',
    featureFlag: 'PROACTIVE',
    hasSpecialUI: true,
    primaryInputKey: 'seconds',
  },
  {
    name: 'Brief',
    displayName: 'Brief',
    icon: 'FileBarChart',
    category: 'monitor',
    description: 'Generate a brief summary of conversation context',
    availability: 'always',
    hasSpecialUI: false,
  },
  {
    name: 'CtxInspect',
    displayName: 'Context Inspect',
    icon: 'ScanEye',
    category: 'monitor',
    description: 'Inspect current conversation context usage',
    availability: 'feature-flag',
    featureFlag: 'CONTEXT_COLLAPSE',
    hasSpecialUI: true,
  },
  {
    name: 'Snip',
    displayName: 'Snip History',
    icon: 'Scissors',
    category: 'monitor',
    description: 'Trim history messages to free context window',
    availability: 'feature-flag',
    featureFlag: 'HISTORY_SNIP',
    hasSpecialUI: true,
  },

  // ═══════════════════════════════════════
  // communication — 通信
  // ═══════════════════════════════════════
  {
    name: 'AskUserQuestion',
    displayName: 'Ask Question',
    icon: 'MessageCircleQuestion',
    category: 'communication',
    description: 'Ask the user a question for clarification',
    availability: 'always',
    hasSpecialUI: true,
  },
  {
    name: 'ListPeers',
    displayName: 'List Peers',
    icon: 'Network',
    category: 'communication',
    description: 'List active peer sessions (multi-agent)',
    availability: 'feature-flag',
    featureFlag: 'UDS_INBOX',
    hasSpecialUI: false,
  },
  {
    name: 'PushNotification',
    displayName: 'Push Notification',
    icon: 'Bell',
    category: 'communication',
    description: 'Send push notification to user device',
    availability: 'feature-flag',
    featureFlag: 'KAIROS',
    hasSpecialUI: false,
  },
  {
    name: 'SendUserFile',
    displayName: 'Send File',
    icon: 'FileUp',
    category: 'communication',
    description: 'Send a file to the user',
    availability: 'feature-flag',
    featureFlag: 'KAIROS',
    hasSpecialUI: false,
  },
  {
    name: 'SubscribePR',
    displayName: 'Subscribe PR',
    icon: 'GitPullRequest',
    category: 'communication',
    description: 'Subscribe to GitHub PR webhook events',
    availability: 'feature-flag',
    featureFlag: 'KAIROS_GITHUB_WEBHOOKS',
    hasSpecialUI: false,
  },
  {
    name: 'RemoteTrigger',
    displayName: 'Remote Trigger',
    icon: 'RadioTower',
    category: 'communication',
    description: 'Trigger remote agents via webhook',
    availability: 'feature-flag',
    featureFlag: 'AGENT_TRIGGERS_REMOTE',
    hasSpecialUI: false,
  },

  // ═══════════════════════════════════════
  // mcp — MCP 协议
  // ═══════════════════════════════════════
  {
    name: 'MCPTool',
    displayName: 'MCP Tool',
    icon: 'Plug',
    category: 'mcp',
    description: 'Execute MCP server tool (proxy)',
    availability: 'always',
    hasSpecialUI: false,
  },
  {
    name: 'ListMcpResources',
    displayName: 'List MCP Resources',
    icon: 'Database',
    category: 'mcp',
    description: 'List available resources from MCP servers',
    availability: 'always',
    hasSpecialUI: false,
  },
  {
    name: 'ReadMcpResource',
    displayName: 'Read MCP Resource',
    icon: 'FileSearch',
    category: 'mcp',
    description: 'Read a specific MCP resource',
    availability: 'always',
    hasSpecialUI: false,
  },
  {
    name: 'ToolSearch',
    displayName: 'Tool Search',
    icon: 'SearchCode',
    category: 'mcp',
    description: 'Get deferred/lazy tool definitions',
    availability: 'always',
    hasSpecialUI: false,
  },

  // ═══════════════════════════════════════
  // config — 配置/IDE
  // ═══════════════════════════════════════
  {
    name: 'Config',
    displayName: 'Config',
    icon: 'Settings',
    category: 'config',
    description: 'Modify Claude Code configuration',
    availability: 'env-var',
    envVar: 'USER_TYPE=ant',
    hasSpecialUI: false,
  },
  {
    name: 'LSP',
    displayName: 'LSP',
    icon: 'Code',
    category: 'config',
    description: 'Language Server Protocol integration',
    availability: 'env-var',
    envVar: 'ENABLE_LSP_TOOL',
    hasSpecialUI: false,
  },
  {
    name: 'NotebookEdit',
    displayName: 'Notebook Edit',
    icon: 'FileJson',
    category: 'config',
    description: 'Edit Jupyter notebook (.ipynb) files',
    availability: 'always',
    hasSpecialUI: false,
  },
  {
    name: 'TerminalCapture',
    displayName: 'Terminal Capture',
    icon: 'MonitorDot',
    category: 'config',
    description: 'Capture terminal output for display',
    availability: 'feature-flag',
    featureFlag: 'TERMINAL_PANEL',
    hasSpecialUI: false,
  },
  {
    name: 'REPL',
    displayName: 'REPL',
    icon: 'TerminalSquare',
    category: 'config',
    description: 'Read-Eval-Print Loop interactive environment',
    availability: 'env-var',
    envVar: 'USER_TYPE=ant',
    hasSpecialUI: false,
  },
  {
    name: 'Tungsten',
    displayName: 'Tungsten Monitor',
    icon: 'Monitor',
    category: 'config',
    description: 'Real-time terminal monitoring display',
    availability: 'env-var',
    envVar: 'USER_TYPE=ant',
    hasSpecialUI: false,
  },
  {
    name: 'SuggestBackgroundPR',
    displayName: 'Suggest Background PR',
    icon: 'GitPullRequestDraft',
    category: 'config',
    description: 'Suggest creating a background pull request',
    availability: 'feature-flag',
    featureFlag: 'SUGGEST_BACKGROUND_PR',
    hasSpecialUI: false,
  },
  {
    name: 'OverflowTest',
    displayName: 'Overflow Test',
    icon: 'Beaker',
    category: 'config',
    description: 'Test token overflow handling',
    availability: 'feature-flag',
    featureFlag: 'OVERFLOW_TEST_TOOL',
    hasSpecialUI: false,
  },

  // ═══════════════════════════════════════
  // worktree — Git Worktree
  // ═══════════════════════════════════════
  {
    name: 'EnterWorktree',
    displayName: 'Enter Worktree',
    icon: 'GitBranchPlus',
    category: 'worktree',
    description: 'Enter a git worktree for isolated development',
    availability: 'runtime-check',
    runtimeCheckDescription: 'isWorktreeModeEnabled()',
    hasSpecialUI: false,
  },
  {
    name: 'ExitWorktree',
    displayName: 'Exit Worktree',
    icon: 'GitBranch',
    category: 'worktree',
    description: 'Exit current git worktree',
    availability: 'runtime-check',
    runtimeCheckDescription: 'isWorktreeModeEnabled()',
    hasSpecialUI: false,
  },

  // ═══════════════════════════════════════
  // review — 代码审查
  // ═══════════════════════════════════════
  {
    name: 'ReviewArtifact',
    displayName: 'Review Artifact',
    icon: 'ShieldCheck',
    category: 'review',
    description: 'Review a code artifact for quality',
    availability: 'feature-flag',
    featureFlag: 'REVIEW_ARTIFACT',
    hasSpecialUI: false,
  },
]

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return TOOL_REGISTRY.find(t => t.name === name)
}

export function getToolDisplayName(name: string): string {
  return getToolDefinition(name)?.displayName || name
}

export function getToolIcon(name: string): string {
  return getToolDefinition(name)?.icon || 'Wrench'
}

export function getToolsByCategory(): Map<ToolCategory, ToolDefinition[]> {
  const grouped = new Map<ToolCategory, ToolDefinition[]>()
  for (const cat of TOOL_CATEGORIES) {
    grouped.set(cat.id, [])
  }
  for (const tool of TOOL_REGISTRY) {
    const list = grouped.get(tool.category)
    if (list) list.push(tool)
  }
  return grouped
}

export function getCoreTools(): ToolDefinition[] {
  return TOOL_REGISTRY.filter(t => t.availability === 'always')
}

export function getConditionalTools(): ToolDefinition[] {
  return TOOL_REGISTRY.filter(t => t.availability !== 'always')
}

export function toolHasSpecialUI(name: string): boolean {
  return getToolDefinition(name)?.hasSpecialUI ?? false
}
