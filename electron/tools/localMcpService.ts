/**
 * 本地安装的内置 MCP 运行时发现服务。
 *
 * cdp-bridge 与 chrome-devtools-mcp 的预设配置走 `uvx`/`npx`，每次启动都要
 * 做包解析（`@latest` 还必须联网查 registry），冷启动开销大且在弱网环境下
 * 会直接吃满 MCP 握手超时（实测拖到 40s+）。如果用户已经把这两个包安装在
 * 本地持久位置，就可以绕过 launcher 直接执行：
 *
 * - cdp-bridge：`uv tool install cdp-bridge` 产出的可执行文件
 *   （Windows 为原生 .exe trampoline，unix 为带 shebang 的入口脚本，
 *   两者都可以被 child_process.spawn 直接启动，无需 shell）
 * - chrome-devtools-mcp：`npm install -g chrome-devtools-mcp` 产出的包。
 *   npm 全局布局是 `<bin-dir>/chrome-devtools-mcp(.cmd)` +
 *   `<bin-dir>/node_modules/chrome-devtools-mcp/`。这里优先升级为
 *   `node <pkg>/build/src/bin/chrome-devtools-mcp.js` 直接执行——比 .cmd
 *   shim 更快，且绕开了 Node spawn 不能直接执行 .cmd（以及 .cmd 路径
 *   含空格时的引号问题）。js 入口或 node 任一缺失就放弃本地路径，
 *   让调用方回退到钉版本的 npx 配置，始终正确。
 *
 * 解析逻辑刻意与 mcpConfigResolver 分离：这里只负责"找"，不负责"决定"。
 */
import { accessSync, constants, existsSync, statSync } from 'fs'
import { join, dirname, extname, isAbsolute, resolve } from 'path'
import { homedir } from 'os'

/** uv tool 可执行文件安装目录（uv tool install 的默认 bin 目录） */
function uvToolBinDir(): string {
  // uv 尊重 UV_TOOL_BIN_DIR 覆盖默认位置
  const override = process.env.UV_TOOL_BIN_DIR
  if (override) return override
  return join(homedir(), '.local', 'bin')
}

function findInPath(binName: string): string | null {
  const windows = process.platform === 'win32'
  const extensions = windows && !extname(binName)
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : ['']
  for (const entry of (process.env.PATH || '').split(windows ? ';' : ':')) {
    const directory = windows ? entry.replace(/^"(.*)"$/, '$1') : entry
    if (!directory) continue
    for (const extension of extensions) {
      const candidate = join(directory, binName + extension)
      try {
        if (!existsSync(candidate) || !statSync(candidate).isFile()) continue
        if (!windows) accessSync(candidate, constants.X_OK)
        return isAbsolute(candidate) ? candidate : resolve(candidate)
      } catch {}
    }
  }
  return null
}

/**
 * 发现本地安装的 cdp-bridge 可执行文件（uv tool install 产物）。
 *
 * 查找顺序：
 * 1. uv tool bin 目录（UV_TOOL_BIN_DIR 或 ~/.local/bin）
 * 2. 系统 PATH
 *
 * Windows 上 uv 产出 `cdp-bridge.exe`，unix 上是无扩展名入口脚本。
 * 返回绝对路径；未安装返回 null。
 */
export function findCdpBridgeExecutable(): string | null {
  const binName = process.platform === 'win32' ? 'cdp-bridge.exe' : 'cdp-bridge'
  const wellKnown = join(uvToolBinDir(), binName)
  if (existsSync(wellKnown)) return wellKnown
  return findInPath(binName)
}

/** chrome-devtools-mcp 包内 MCP server 的 js 入口（npm 包 bin 字段指向的位置） */
const CHROME_DEVTOOLS_MCP_JS_ENTRY = join(
  'build', 'src', 'bin', 'chrome-devtools-mcp.js',
)

/** npm 全局 shim 在 Windows 上是 .cmd，unix 上是无扩展名脚本 */
function npmShimName(): string {
  return process.platform === 'win32' ? 'chrome-devtools-mcp.cmd' : 'chrome-devtools-mcp'
}

/**
 * npm 全局 bin 目录候选（按优先级）。
 *
 * `%APPDATA%\npm` 只是 npm 在 Windows 上的**默认** prefix，很多环境会改：本机
 * node 装在 `D:\program\node-v24.18.0-win-x64`，`npm prefix -g` 就等于该目录，
 * 全局 shim（`claude.cmd`、`pi.cmd` …）直接落在 `node.exe` 旁边，
 * `%APPDATA%\npm` 压根不存在。所以 node 所在目录也要当候选。
 *
 * 静态目录优先，node 所在目录由 PATH 扫描补齐，不启动探测子进程。
 */
function staticNpmBinDirs(): string[] {
  if (process.platform === 'win32') {
    return process.env.APPDATA ? [join(process.env.APPDATA, 'npm')] : []
  }
  return ['/usr/local/bin', join(homedir(), '.npm-global', 'bin')]
}

/**
 * 发现本地安装的 chrome-devtools-mcp，并升级为 `node <js 入口>` 直接执行。
 *
 * 查找顺序：
 * 1. 平台默认的全局 bin 目录（纯 existsSync，不起子进程）
 * 2. 系统 PATH
 * 3. 都没有才查 node 所在目录，覆盖「npm 全局 bin 不在 PATH 上」的布局
 *
 * 找到 shim 后，推导同目录的
 * `node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js`
 * 与 node 可执行文件，三者齐备才返回 `{ command: node, args: [js] }`——
 * 直接 spawn `.cmd` shim 在 Windows 上需要 shell 与引号处理，交给
 * `node + js` 更快也更稳。任一环节缺失返回 null（调用方回退钉版本 npx）。
 */
export function findChromeDevtoolsMcpLocal(): { command: string; args: string[] } | null {
  const shim = npmShimName()

  let nodeProbed = false
  let nodePath: string | null = null
  const resolveNode = (): string | null => {
    if (!nodeProbed) {
      nodeProbed = true
      nodePath = findInPath('node')
    }
    return nodePath
  }

  const fromStatic = staticNpmBinDirs()
    .map(dir => join(dir, shim))
    .find(p => existsSync(p))
  let binPath: string | null = fromStatic ?? findInPath('chrome-devtools-mcp')

  if (!binPath) {
    // node 与它自己的全局 shim 同目录（自定义 prefix / 解压版 Node 的常见布局）
    const node = resolveNode()
    if (node) {
      const nextToNode = join(dirname(node), shim)
      if (existsSync(nextToNode)) binPath = nextToNode
    }
  }
  if (!binPath) return null

  // npm 全局布局：shim 与 node_modules/<pkg> 同目录
  const jsEntry = join(
    dirname(binPath), 'node_modules', 'chrome-devtools-mcp', CHROME_DEVTOOLS_MCP_JS_ENTRY,
  )
  if (!existsSync(jsEntry)) return null

  const node = resolveNode()
  if (!node) return null

  return { command: node, args: [jsEntry] }
}
