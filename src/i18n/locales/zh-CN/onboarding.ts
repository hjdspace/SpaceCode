export default {
  brand: 'SpaceCode',
  intro: {
    eyebrow: '首次启动',
    title: '欢迎使用 SpaceCode',
    subtitle: '花大概一分钟，把该定的定下来。选主题和语言时，卡片后面的真界面会实时跟着变。',
    prep: '这次会一起定下来',
    start: '开始设置',
    skip: '稍后再配置',
    skipHint: '跳过也可以，主界面会一直留着提示，点它随时回来。'
  },
  progress: '{done} / {total}',
  later: '稍后再配置',
  next: '下一步',
  prev: '上一步',
  enter: '进入 SpaceCode',
  step: {
    language: {
      eyebrow: '语言',
      title: '用哪种语言？',
      desc: '决定之后所有界面文案。切换即时生效，不需要重启应用。',
      hint: '随时可改'
    },
    appearance: {
      eyebrow: '外观',
      title: '选一个外观',
      desc: '点了就应用到整个应用，不只是这张卡片。强调色和密度在下面。',
      hint: '即时应用到整个应用'
    },
    engine: {
      eyebrow: '引擎',
      title: '谁来执行代码',
      desc: '决定用哪个编码代理跑任务。切换会停掉当前所有活动会话。',
      hint: '默认 Claude Code 最稳'
    },
    model: {
      eyebrow: '模型',
      title: '接一个大模型',
      desc: '没有模型还干不了活。填完可以直接测一下；手头没有 Key 也可以先跳过。',
      hint: '这一步可以稍后再补'
    },
    workspace: {
      eyebrow: '工作区',
      title: '代码放在哪',
      desc: '文件读写和办公模式以这个目录为根，不存在会自动创建。',
      hint: '跳过则用默认目录'
    },
    summary: {
      eyebrow: '完成',
      title: '都配好了',
      desc: '下面是我收到的配置。进入后这些都还能在设置页里改。',
      hint: '确认后这个界面不再出现'
    }
  },
  language: {
    chinese: '简体中文',
    english: 'English'
  },
  appearance: {
    fontSize: '字号',
    liveHint: '注意：卡片后面的侧栏、标题栏都跟着变了。'
  },
  engine: {
    claudeCode: 'Claude Code',
    claudeCodeDesc: 'Anthropic 官方编码引擎，内置集成，开箱即用',
    pi: 'Pi',
    piDesc: '极简编码代理，需要先装 Pi SDK',
    piChecking: '检测 SDK 中',
    piMissing: '未检测到，可一键安装',
    piInstalling: '安装中',
    piInstalled: '已安装',
    piInstalledVersion: '已就绪 · v{version}',
    piVersionTooOld: '版本过低（v{version}）',
    piVersionUnknown: '引擎版本无法确认',
    installPi: '安装 Pi SDK',
    piInstallFailed: '安装失败：{error}',
    installedCliHint: '官网版本会调用你本机 npm 全局装的 claude，可自己升级。'
  },
  model: {
    pick: '接入方式',
    oauthTip: 'Claude 与 控制台 要靠 CLI 自身登录，应用内还没接通。先选前面三种。',
    vendor: '服务商',
    keyTip: '只存本机，作为引擎子进程的环境变量注入。',
    showKey: '显示密钥',
    hideKey: '隐藏密钥',
    test: '测试连接',
    testing: '请求 /models 中',
    fetching: '正在拉取模型列表…',
    testOk: '能用，拿到 {count} 个模型',
    testFailed: '不通，检查地址或 Key',
    testNoKey: '先填 API Key',
    testProxy: '本地代理不可用',
    slots: '模型档位',
    slotFast: '快速',
    slotBalanced: '均衡',
    slotPowerful: '强大',
    slotNote: '留空则由引擎使用它自己的默认模型。',
    configured: '已配置',
    notConfigured: '未配置'
  },
  workspace: {
    path: '工作区目录',
    browse: '浏览',
    useDefault: '用默认目录',
    recent: '最近使用',
    note: '办公模式首次进入还会再单独确认一次工作区，这里设的是全局项目根目录。',
    defaultUnavailable: '默认目录不可用，请手动选择'
  },
  summary: {
    language: '语言',
    theme: '主题',
    engine: '引擎',
    provider: '供应商',
    workspace: '工作区',
    notSet: '未设置',
    defaultFolder: '默认目录（未改）',
    oauthSignedIn: '已登录 {email}',
    note: '写入 ~/.claude/gui-settings.json，并标记 hasCompletedOnboarding。'
  },
  banner: {
    modelPending: '模型尚未配置，现在还不能发任务。',
    pending: '首次设置还没走完。',
    go: '继续配置',
    dismiss: '不再提示'
  },
  restart: {
    title: '首次引导',
    desc: '重新走一遍语言、外观、引擎、模型与工作区的配置向导。',
    action: '重走引导'
  }
}
