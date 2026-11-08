// electron/preload/tools.ts
// 工具域：技能、Agent、MCP、办公文档、产物预览、设计系统、RTK、桌面控制。

import type { DesignExportRequest, DesignExportResult } from '@/shared/designExport'
import type { DesignSystemSummaryShape, PreloadIpc } from './types'

export function createToolsApi(ipcRenderer: PreloadIpc) {
  return {
    // Skills API
    skills: {
      getSkills: (cwd?: string) => ipcRenderer.invoke('skills:getSkills', cwd),
      getBundledSkills: () => ipcRenderer.invoke('skills:getBundledSkills'),
      createSkill: (name: string, scope: 'global' | 'project', content: string, cwd?: string) =>
        ipcRenderer.invoke('skills:createSkill', name, scope, content, cwd),
      saveSkill: (skill: any, content: string) => ipcRenderer.invoke('skills:saveSkill', skill, content),
      deleteSkill: (filePath: string) => ipcRenderer.invoke('skills:deleteSkill', filePath),
      searchMarketplace: (query: string) => ipcRenderer.invoke('skills:searchMarketplace', query),
      installMarketplaceSkill: (source: string, skillId: string, global: boolean, cwd?: string) => ipcRenderer.invoke('skills:installMarketplaceSkill', source, skillId, global, cwd),
      uninstallMarketplaceSkill: (skillName: string, global: boolean, cwd?: string) => ipcRenderer.invoke('skills:uninstallMarketplaceSkill', skillName, global, cwd),
      fetchMarketplaceReadme: (source: string, skillId: string) => ipcRenderer.invoke('skills:fetchMarketplaceReadme', source, skillId),
      scanLocalLibrary: (dirPaths: string[], cwd?: string) => ipcRenderer.invoke('skills:scan-local-library', dirPaths, cwd),
      installLocal: (skillName: string, scope: 'global' | 'project', cwd?: string, skillPath?: string) => ipcRenderer.invoke('skills:install-local', skillName, scope, cwd, skillPath),
      installLocalSkillsBatch: (skills: Array<{ name: string; skillPath?: string }>, scope: 'global' | 'project', cwd?: string) => ipcRenderer.invoke('skills:install-local-batch', skills, scope, cwd),
      uninstallLocal: (skillName: string, cwd?: string) => ipcRenderer.invoke('skills:uninstall-local', skillName, cwd),
      installLocalBundle: (bundleId: string, scope: 'global' | 'project', cwd?: string) => ipcRenderer.invoke('skills:install-local-bundle', bundleId, scope, cwd),
      uninstallLocalBundle: (bundleName: string, cwd?: string) => ipcRenderer.invoke('skills:uninstall-local-bundle', bundleName, cwd),
      getCustomDirs: () => ipcRenderer.invoke('skills:get-custom-dirs'),
      addCustomDir: (dirPath: string) => ipcRenderer.invoke('skills:add-custom-dir', dirPath),
      removeCustomDir: (dirPath: string) => ipcRenderer.invoke('skills:remove-custom-dir', dirPath),
    },

    // Agents API
    agents: {
      scanLibrary: (cwd?: string) => ipcRenderer.invoke('agents:scanLibrary', cwd),
      install: (agentName: string, scope: 'global' | 'project', cwd?: string) =>
        ipcRenderer.invoke('agents:install', agentName, scope, cwd),
      uninstall: (agentName: string, scope: 'global' | 'project', cwd?: string) =>
        ipcRenderer.invoke('agents:uninstall', agentName, scope, cwd),
      getInstalled: (cwd?: string) => ipcRenderer.invoke('agents:getInstalled', cwd),
      saveCustom: (agentName: string, content: string) =>
        ipcRenderer.invoke('agents:saveCustom', agentName, content),
    },

    // MCP Probe — 直接探测 MCP 服务器（不依赖 engine session）
    // MCP Config CRUD — 持久化到 <userData>/mcp-servers.json
    mcp: {
      getServers: () => ipcRenderer.invoke('mcp:getServers'),
      addServer: (name: string, server: any) => ipcRenderer.invoke('mcp:addServer', name, server),
      updateServers: (servers: Record<string, any>) => ipcRenderer.invoke('mcp:updateServers', servers),
      deleteServer: (name: string) => ipcRenderer.invoke('mcp:deleteServer', name),
      toggleEnabled: (name: string, enabled: boolean) => ipcRenderer.invoke('mcp:toggleEnabled', name, enabled),
      probeServer: (config: any) => ipcRenderer.invoke('mcp:probeServer', config),
      // 依赖检测 / 一键安装（用于内置 MCP 缺失依赖时的引导）
      checkDependency: (command: string) => ipcRenderer.invoke('mcp:checkDependency', command),
      installDependency: (command: 'uv') => ipcRenderer.invoke('mcp:installDependency', command),
      // 启用内置预设后把它从 uvx/npx 形态一次性装到持久位置（后台，失败静默）
      localizeBuiltin: (key: string, source: unknown) => ipcRenderer.invoke('mcp:localizeBuiltin', key, source),
      onInstallProgress: (callback: (progress: any) => void) => {
        const wrapper = (_: any, data: any) => callback(data)
        ipcRenderer.on('mcp:installProgress', wrapper)
        return () => ipcRenderer.removeListener('mcp:installProgress', wrapper)
      },
      // 查询当前会被注入到 CLI 的 MCP 服务器名列表（用于「已加载」标记）
      getActiveMcpNames: () => ipcRenderer.invoke('mcp:getActiveMcpNames'),
      // pi 引擎的 MCP 实况：投影结果 + 用户级 mcp.json 里不由本项目管理的条目 (#53)
      getPiState: () => ipcRenderer.invoke('mcp:getPiState'),
      setPiServerEnabled: (name: string, enabled: boolean) => ipcRenderer.invoke('mcp:setPiServerEnabled', name, enabled),
    },

    // Computer Use API — cua-driver 二进制管理、健康检查、权限管理
    computerUse: {
      /** 获取 cua-driver 完整状态（安装、版本、权限、健康检查） */
      getStatus: () => ipcRenderer.invoke('cua-driver:status'),
      /** 安装/升级 cua-driver（优先从内置二进制安装，回退到 GitHub 下载） */
      install: () => ipcRenderer.invoke('cua-driver:install'),
      /** 安装进度事件订阅 */
      onInstallProgress: (callback: (progress: { stage: string; message: string; percent: number }) => void) => {
        const handler = (_: unknown, data: { stage: string; message: string; percent: number }) => callback(data)
        ipcRenderer.on('cua-driver:installProgress', handler)
        return () => ipcRenderer.removeListener('cua-driver:installProgress', handler)
      },
      /** 运行健康检查（通过 MCP 调用 health_report）。fresh=true 会先换掉驱动子进程 */
      doctor: (fresh?: boolean) => ipcRenderer.invoke('cua-driver:doctor', Boolean(fresh)),
      /** 查询 macOS TCC 权限状态（辅助功能 + 屏幕录制） */
      getPermissions: () => ipcRenderer.invoke('cua-driver:permissions:status'),
      /** 请求 macOS TCC 权限（弹出系统设置） */
      grantPermissions: () => ipcRenderer.invoke('cua-driver:permissions:grant'),
      /** 丢弃当前驱动子进程，下一次探测重新拉起（macOS 授权后需要） */
      restart: () => ipcRenderer.invoke('cua-driver:restart'),
      /** 检查 cua-driver 更新 */
      checkUpdate: () => ipcRenderer.invoke('cua-driver:check-update'),
      /** 直接调用 cua-driver MCP 工具（高级用途） */
      callTool: (name: string, args: Record<string, unknown>) =>
        ipcRenderer.invoke('cua-driver:tool', name, args),
    },

    // Browser-Use API — 浏览器自动化（AI 操控网页）
    browserUse: {
      /** 获取 browser-use 完整状态 */
      getStatus: () => ipcRenderer.invoke('browser-use:status'),
      /** 安装 browser-use + playwright chromium（可选镜像源加速） */
      install: (options?: { useMirror: boolean; mirrorType: 'tsinghua' | 'aliyun' | 'npmmirror' }) =>
        ipcRenderer.invoke('browser-use:install', options),
      /** 安装进度事件订阅 */
      onInstallProgress: (callback: (progress: { stage: string; message: string; percent: number }) => void) => {
        const handler = (_: unknown, data: { stage: string; message: string; percent: number }) => callback(data)
        ipcRenderer.on('browser-use:installProgress', handler)
        return () => ipcRenderer.removeListener('browser-use:installProgress', handler)
      },
      /** 运行健康检查 */
      doctor: () => ipcRenderer.invoke('browser-use:doctor'),
      /** 检查更新 */
      checkUpdate: () => ipcRenderer.invoke('browser-use:check-update'),
      /** 调用 browser-use MCP 工具 */
      callTool: (name: string, args: Record<string, unknown>) =>
        ipcRenderer.invoke('browser-use:tool', name, args),
      /** 获取/更新 Agent 配置 */
      config: (config?: Record<string, unknown>) =>
        ipcRenderer.invoke('browser-use:config', config),
      /** 导航到 URL */
      navigate: (url: string) => ipcRenderer.invoke('browser-use:navigate', url),
      /** 获取实时浏览器快照 */
      getLiveSnapshot: () => ipcRenderer.invoke('browser-use:liveSnapshot'),
      /** 实时快照推送事件订阅 */
      onLiveSnapshot: (callback: (snapshot: { screenshot: string | null; url: string; title: string; currentStep: number; totalSteps: number; agentStatus: string; lastAction: string | null }) => void) => {
        const handler = (_: unknown, data: any) => callback(data)
        ipcRenderer.on('browser-use:liveSnapshot', handler)
        return () => ipcRenderer.removeListener('browser-use:liveSnapshot', handler)
      },
    },

    // Work artifacts (outputs/ folder)
    artifacts: {
      list: (workingDir: string, options?: { scanWorkspaceRoot?: boolean }) =>
        ipcRenderer.invoke('artifacts:list', workingDir, options),
      open: (filePath: string) => ipcRenderer.invoke('artifacts:open', filePath),
      reveal: (filePath: string) => ipcRenderer.invoke('artifacts:reveal', filePath),
      startWatch: (artifactsDir: string) => ipcRenderer.invoke('artifacts:startWatch', artifactsDir),
      stopWatch: () => ipcRenderer.invoke('artifacts:stopWatch'),
      onChanged: (callback: (data: { eventType: string; filename: string }) => void) => {
        const handler = (_: any, data: any) => callback(data)
        ipcRenderer.on('artifacts:changed', handler)
        return () => ipcRenderer.removeListener('artifacts:changed', handler)
      },
    },

    // OfficeCLI API — binary execution, file preview, watch mode
    officecli: {
      /** Check OfficeCLI version */
      version: () => ipcRenderer.invoke('officecli:version'),
      /** Check if the binary is installed */
      checkInstalled: () => ipcRenderer.invoke('officecli:checkInstalled'),
      /** Download binary from GitHub Releases (in-app, for packaged builds without bundled binary) */
      download: (): Promise<{ success: boolean; path?: string; error?: string }> =>
        ipcRenderer.invoke('officecli:download'),
      /** Subscribe to download progress events */
      onDownloadProgress: (callback: (progress: { stage: string; message: string; percent: number }) => void) => {
        const handler = (_: unknown, data: { stage: string; message: string; percent: number }) => callback(data)
        ipcRenderer.on('officecli:downloadProgress', handler)
        return () => ipcRenderer.removeListener('officecli:downloadProgress', handler)
      },
      /** Execute an arbitrary officecli command */
      exec: (options: { args: string[]; cwd?: string; timeout?: number; env?: Record<string, string> }) =>
        ipcRenderer.invoke('officecli:exec', options),
      /** Render a file as HTML, returns the HTML file path */
      viewHtml: (filePath: string, outputDir?: string) =>
        ipcRenderer.invoke('officecli:viewHtml', filePath, outputDir),
      /** Render a chunk of pages as one PNG sheet (pages stacked vertically) */
      viewScreenshot: (filePath: string, outputDir: string, start?: number) =>
        ipcRenderer.invoke('officecli:viewScreenshot', filePath, outputDir, start),
      /** Start a live-preview watch server */
      watchStart: (filePath: string, port?: number) =>
        ipcRenderer.invoke('officecli:watch:start', filePath, port),
      /** Stop a specific watch instance */
      watchStop: (watchId: string) =>
        ipcRenderer.invoke('officecli:watch:stop', watchId),
      /** Stop all watch instances */
      watchStopAll: () =>
        ipcRenderer.invoke('officecli:watch:stopAll'),
      /** List active watch instances */
      watchList: () =>
        ipcRenderer.invoke('officecli:watch:list'),
      /** Read an image file as base64 data URL */
      readImageAsDataURL: (filePath: string) =>
        ipcRenderer.invoke('officecli:readImageAsDataURL', filePath) as Promise<string>,
    },

    // Design API
    design: {
      listSystems: (): Promise<DesignSystemSummaryShape[]> =>
        ipcRenderer.invoke('design:list-systems'),
      createSystem: (input: {
        title: string;
        category?: string;
        summary?: string;
        accentColor?: string;
      }): Promise<DesignSystemSummaryShape> => ipcRenderer.invoke('design:create-system', input),
      deleteSystem: (systemId: string): Promise<void> =>
        ipcRenderer.invoke('design:delete-system', systemId),
      getSystemPreview: (systemId: string, pagePath: string): Promise<string> =>
        ipcRenderer.invoke('design:get-system-preview', systemId, pagePath),
      getSystemFile: (systemId: string, filePath: string): Promise<string> =>
        ipcRenderer.invoke('design:get-system-file', systemId, filePath),
      getSystemShowcase: (systemId: string): Promise<string> =>
        ipcRenderer.invoke('design:get-system-showcase', systemId),
      getSystemTokensHtml: (systemId: string): Promise<string> =>
        ipcRenderer.invoke('design:get-system-tokens-html', systemId),
      composePromptStack: (input: {
        designSystemId?: string;
        skillBody?: string;
        skillName?: string;
        locale: string;
      }): Promise<string> =>
        ipcRenderer.invoke('design:compose-prompt-stack', input),
      startFileWatcher: (sessionId: string, workspacePath: string): Promise<void> =>
        ipcRenderer.invoke('design:start-file-watcher', sessionId, workspacePath),
      stopFileWatcher: (): Promise<void> =>
        ipcRenderer.invoke('design:stop-file-watcher'),
      exportArtifact: (options: DesignExportRequest): Promise<DesignExportResult> =>
        ipcRenderer.invoke('design:export-artifact', options),
      onFileChanged: (callback: (event: { sessionId: string; filepath: string }) => void): (() => void) => {
        const wrapper = (_: any, event: any) => callback(event)
        ipcRenderer.on('design:file-changed', wrapper)
        return () => ipcRenderer.removeListener('design:file-changed', wrapper)
      },
    },

    // RTK (Rust Token Killer) API
    rtk: {
      getStatus: (): Promise<import('../tools/rtkManager').RtkStatus> =>
        ipcRenderer.invoke('rtk:getStatus'),
      enable: (): Promise<{ success: boolean; error?: string; status: import('../tools/rtkManager').RtkStatus }> =>
        ipcRenderer.invoke('rtk:enable'),
      disable: (): Promise<{ success: boolean; error?: string; status: import('../tools/rtkManager').RtkStatus }> =>
        ipcRenderer.invoke('rtk:disable'),
      downloadBinary: (): Promise<{ success: boolean; error?: string; status?: import('../tools/rtkManager').RtkStatus }> =>
        ipcRenderer.invoke('rtk:downloadBinary'),
      getStats: (): Promise<import('../tools/rtkManager').RtkGainStats | null> =>
        ipcRenderer.invoke('rtk:getStats'),
      checkUpdate: (): Promise<import('../tools/rtkManager').RtkUpdateInfo | null> =>
        ipcRenderer.invoke('rtk:checkUpdate'),
      getBinaryPath: (): Promise<string> =>
        ipcRenderer.invoke('rtk:getBinaryPath'),
      onDownloadProgress: (callback: (progress: { downloaded: number; total: number; percent: number }) => void) => {
        const wrapper = (_: any, progress: any) => callback(progress)
        ipcRenderer.on('rtk:downloadProgress', wrapper)
        return () => ipcRenderer.removeListener('rtk:downloadProgress', wrapper)
      },
    },
  }
}
