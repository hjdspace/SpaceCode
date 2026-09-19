import { app } from 'electron'
import { execFileSync } from 'child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
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

export function setupLinuxPlatform(): void {
  if (process.platform !== 'linux') return

  // Suppress Chromium's benign D-Bus diagnostics without affecting app logs.
  app.commandLine.appendSwitch('log-level', '3')
  setupLinuxIme()
  setupLinuxDbus()
}
