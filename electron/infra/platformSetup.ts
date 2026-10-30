import { app } from 'electron'
import { execFileSync } from 'child_process'
import { existsSync, readFileSync, readdirSync, statfsSync, statSync } from 'fs'
import { join } from 'path'

function setupLinuxIme(): void {
  if (process.platform !== 'linux') return

  let imModule = 'ibus'
  const configuredModule = process.env.GTK_IM_MODULE
  const modifiers = process.env.XMODIFIERS

  if (configuredModule?.includes('fcitx') || modifiers?.includes('fcitx')) {
    imModule = 'fcitx'
  } else if (!configuredModule && !modifiers) {
    try {
      const processes = execFileSync('ps', ['-e', '-o', 'comm='], {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      if (processes.includes('fcitx')) imModule = 'fcitx'
    } catch {
      // IBus is the CentOS/RHEL default.
    }
  }

  process.env.GTK_IM_MODULE ||= imModule
  process.env.QT_IM_MODULE ||= imModule
  process.env.XMODIFIERS ||= `@im=${imModule}`
}

function applyDbusOutput(output: string): boolean {
  for (const line of output.split('\n')) {
    const match = line.match(/^(DBUS_SESSION_BUS_\w+)=(.+?);?\s*$/)
    if (!match) continue

    let value = match[2].replace(/;$/, '').trim()
    if ((value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1)
    }
    process.env[match[1]] = value
  }
  return Boolean(process.env.DBUS_SESSION_BUS_ADDRESS)
}

function usePersistedSessionBus(): boolean {
  const homeDir = process.env.HOME
  if (!homeDir) return false

  const busDir = join(homeDir, '.dbus', 'session-bus')
  if (!existsSync(busDir)) return false

  try {
    const files = readdirSync(busDir)
      .map((name) => ({ name, path: join(busDir, name) }))
      .sort((left, right) => statSync(right.path).mtimeMs - statSync(left.path).mtimeMs)

    for (const file of files) {
      const content = readFileSync(file.path, 'utf8')
      const address = content.match(/^DBUS_SESSION_BUS_ADDRESS=(.+?);?\s*$/m)?.[1]
        ?.replace(/;$/, '')
        .replace(/^['"]|['"]$/g, '')
      if (!address?.startsWith('unix:')) continue

      const pid = content.match(/^DBUS_SESSION_BUS_PID=(\d+)/m)?.[1]
      if (pid) {
        try {
          process.kill(Number(pid), 0)
        } catch {
          continue
        }
      }
      process.env.DBUS_SESSION_BUS_ADDRESS = address
      return true
    }
  } catch {
    return false
  }
  return false
}

function setupLinuxDbus(): void {
  if (process.platform !== 'linux') return
  if (process.env.DBUS_SESSION_BUS_ADDRESS?.startsWith('unix:')) return

  try {
    const uid = typeof process.getuid === 'function'
      ? String(process.getuid())
      : execFileSync('id', ['-u'], { encoding: 'utf8', timeout: 2000 }).trim()
    for (const socketPath of [`/run/user/${uid}/bus`, `/run/user/${uid}/dbus/session_bus_socket`]) {
      if (existsSync(socketPath)) {
        process.env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${socketPath}`
        return
      }
    }
  } catch {
    // Continue with desktop-session fallbacks.
  }

  if (usePersistedSessionBus()) return

  try {
    const output = execFileSync('xprop', ['-root', 'DBUS_SESSION_BUS_ADDRESS'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const address = output.match(/=\s*"(.+?)"/)?.[1]
    if (address?.startsWith('unix:')) {
      process.env.DBUS_SESSION_BUS_ADDRESS = address
      return
    }
  } catch {
    // xprop may not exist in minimal installations.
  }

  for (const args of [['--autolaunch', '--sh-syntax'], ['--sh-syntax']]) {
    try {
      const output = execFileSync('dbus-launch', args, {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      if (applyDbusOutput(output)) return
    } catch {
      // Try the next fallback.
    }
  }
}

/** /dev/shm 的容量（字节）；读不到返回 null。 */
function readDevShmBytes(): number | null {
  try {
    const st = statfsSync('/dev/shm')
    return st.blocks * st.bsize
  } catch {
    return null
  }
}

/**
 * Linux 上没有别的兜底：Chromium 的默认假设是"有 GPU、/dev/shm 够大"。
 * 服务器/虚机/容器两条都不满足，表现是先黑屏、随后渲染进程以 133(SIGTRAP) 退出。
 *
 *  - `--disable-dev-shm-usage`：容器里 /dev/shm 常被限到 64MB，共享内存分配失败
 *    会直接打死渲染进程。改走 /tmp。
 *  - 没有 /dev/dri 就意味着没有可用的 KMS 驱动，建 GL 上下文只会让 GPU 进程反复
 *    失败并让合成器退化成黑帧。直接软件渲染。
 */
function setupLinuxRendering(): { gpu: 'software' | 'hardware'; devShmBytes: number | null } {
  app.commandLine.appendSwitch('disable-dev-shm-usage')

  const hasDri = existsSync('/dev/dri')
  if (!hasDri) app.disableHardwareAcceleration()

  return { gpu: hasDri ? 'hardware' : 'software', devShmBytes: readDevShmBytes() }
}

export function setupLinuxPlatform(): string[] {
  if (process.platform !== 'linux') return []

  const notes: string[] = []

  // `log-level 3` 会把 Chromium 自己的 GPU / 合成器报错一起吞掉 —— 黑屏时日志里
  // 就只剩业务代码的行，现场等于没有证据。显式要日志时必须放开。
  if (app.commandLine.hasSwitch('debug') || process.argv.includes('--debug')) {
    notes.push('Chromium log level left at default (debug mode)')
  } else {
    // Suppress Chromium's benign D-Bus diagnostics without affecting app logs.
    app.commandLine.appendSwitch('log-level', '3')
  }

  setupLinuxIme()
  setupLinuxDbus()

  const rendering = setupLinuxRendering()
  notes.push(
    `GPU acceleration ${rendering.gpu === 'hardware' ? 'enabled' : 'disabled (no /dev/dri)'}, `
    + `/dev/shm=${rendering.devShmBytes === null ? 'unknown' : `${Math.round(rendering.devShmBytes / 1024 / 1024)}MB`}`,
  )

  return notes
}
