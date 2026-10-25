// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { NetworkInterfaceInfo } from 'os'
import { H5AuthService } from '../h5AuthService'
import type { H5AccessSettings } from '../h5Types'

// app.getPath('userData') is only consulted when an instance is constructed
// (never at import time), so a plain closure over this holder is enough.
const userData = { dir: '' }

vi.mock('electron', () => ({
  app: {
    getPath: (kind: string) => {
      if (kind === 'userData') return userData.dir
      throw new Error(`unexpected getPath(${kind})`)
    },
  },
}))

let interfaces: Record<string, NetworkInterfaceInfo[] | null> = {}

vi.mock('os', async (importOriginal) => {
  // Runtime is CJS interop, so `default` exists — TS's namespace view omits it.
  const actual = (await importOriginal()) as typeof import('os') & {
    default: typeof import('os')
  }
  return {
    ...actual,
    default: {
      ...actual.default,
      networkInterfaces: () => interfaces,
    },
  }
})

// Mirror of the module-private token shape: h5_ + base64url(32 bytes).
const TOKEN_SHAPE = /^h5_[A-Za-z0-9_-]{16,512}$/

const DEFAULT_SETTINGS: H5AccessSettings = {
  enabled: false,
  token: null,
  tokenPreview: null,
  publicBaseUrl: null,
  fixedPort: null,
  sandboxPort: null,
}

function iface(address: string, family: 'IPv4' | 'IPv6' = 'IPv4', internal = false): NetworkInterfaceInfo {
  return {
    address,
    family,
    internal,
    mac: '00:11:22:33:44:55',
    netmask: family === 'IPv4' ? '255.255.255.0' : 'ffff:ffff::',
    cidr: null,
    scopeid: 0,
  } as NetworkInterfaceInfo
}

describe('H5AuthService', () => {
  let box = ''

  beforeAll(() => {
    box = mkdtempSync(join(tmpdir(), 'spacecode-h5auth-'))
    userData.dir = join(box, 'userdata')
    mkdirSync(userData.dir, { recursive: true })
  })

  afterAll(() => {
    rmSync(box, { recursive: true, force: true })
  })

  beforeEach(() => {
    interfaces = {}
  })

  const settingsFile = () => join(userData.dir, 'h5-access.json')

  function seedSettings(settings: Partial<typeof DEFAULT_SETTINGS>): void {
    writeFileSync(
      settingsFile(),
      JSON.stringify({ ...DEFAULT_SETTINGS, ...settings }),
      'utf-8',
    )
  }

  describe('settings persistence', () => {
    it('falls back to defaults when no settings file exists, without creating one', () => {
      expect(new H5AuthService().getSettings()).toEqual(DEFAULT_SETTINGS)
      expect(existsSync(settingsFile())).toBe(false)
    })

    it('falls back to defaults when the settings file is corrupt', () => {
      writeFileSync(settingsFile(), '{not json', 'utf-8')

      expect(new H5AuthService().getSettings()).toEqual(DEFAULT_SETTINGS)
    })

    it('falls back to defaults when the settings file is blank', () => {
      writeFileSync(settingsFile(), '   \n', 'utf-8')

      expect(new H5AuthService().getSettings()).toEqual(DEFAULT_SETTINGS)
    })

    it('reads back settings written by an earlier run', () => {
      seedSettings({ enabled: true, token: 'h5_persisted-token-0123456789abc' })

      expect(new H5AuthService().getSettings()).toMatchObject({
        enabled: true,
        token: 'h5_persisted-token-0123456789abc',
      })
    })

    it('normalises a settings file written before the sandbox port existed', () => {
      // 票 06 之前落盘的 JSON 没有 sandboxPort；undefined 漏出去会让第二端口永远起不来
      writeFileSync(
        settingsFile(),
        JSON.stringify({ ...DEFAULT_SETTINGS, sandboxPort: undefined }),
        'utf-8',
      )

      expect(new H5AuthService().getSettings()).toEqual(DEFAULT_SETTINGS)
    })

    it('caches settings after the first read', () => {
      seedSettings({ enabled: true, token: 'h5_cached-token-0123456789abcd' })
      const service = new H5AuthService()
      const first = service.getSettings()

      expect(service.getSettings()).toBe(first)
    })
  })

  describe('enable', () => {
    it('mints a token, persists it and reports a preview', () => {
      const { token, settings } = new H5AuthService().enable()

      expect(token).toMatch(TOKEN_SHAPE)
      expect(settings.enabled).toBe(true)
      expect(settings.token).toBe(token)
      expect(settings.tokenPreview).toBe(`${token.slice(0, 8)}...${token.slice(-4)}`)
      expect(JSON.parse(readFileSync(settingsFile(), 'utf-8'))).toMatchObject({
        enabled: true,
        token,
      })
    })

    it('reuses an existing valid token so already-paired phones keep access', () => {
      seedSettings({ enabled: false, token: 'h5_existing-token-0123456789abcdef' })

      const { token, settings } = new H5AuthService().enable()

      expect(token).toBe('h5_existing-token-0123456789abcdef')
      expect(settings.enabled).toBe(true)
    })

    it('replaces an existing token that no longer matches the expected shape', () => {
      seedSettings({ token: 'h5_short' })

      const { token } = new H5AuthService().enable()

      expect(token).toMatch(TOKEN_SHAPE)
      expect(token).not.toBe('h5_short')
    })
  })

  describe('disable', () => {
    it('turns the flag off but keeps the token on disk', () => {
      const service = new H5AuthService()
      const { token } = service.enable()

      const after = service.disable()

      expect(after.enabled).toBe(false)
      expect(after.token).toBe(token)
      expect(JSON.parse(readFileSync(settingsFile(), 'utf-8'))).toMatchObject({
        enabled: false,
        token,
      })
    })

    it('disables cleanly even when never enabled', () => {
      expect(new H5AuthService().disable().enabled).toBe(false)
    })
  })

  describe('regenerateToken', () => {
    it('issues a different token and re-enables the service', () => {
      seedSettings({ enabled: true, token: 'h5_old-token-0123456789abcdefghij' })
      const service = new H5AuthService()
      const before = service.getSettings().token

      const { token, settings } = service.regenerateToken()

      expect(token).not.toBe(before)
      expect(token).toMatch(TOKEN_SHAPE)
      expect(settings.enabled).toBe(true)
      expect(settings.tokenPreview).toBe(`${token.slice(0, 8)}...${token.slice(-4)}`)
      expect(JSON.parse(readFileSync(settingsFile(), 'utf-8')).token).toBe(token)
    })
  })

  describe('updateSettings', () => {
    it('merges publicBaseUrl and fixedPort without touching the token', () => {
      seedSettings({ enabled: true, token: 'h5_update-token-0123456789abcdef' })
      const service = new H5AuthService()

      const next = service.updateSettings({
        publicBaseUrl: 'https://h5.example.com',
        fixedPort: 8765,
      })

      expect(next.publicBaseUrl).toBe('https://h5.example.com')
      expect(next.fixedPort).toBe(8765)
      expect(next.token).toBe('h5_update-token-0123456789abcdef')
      expect(next.enabled).toBe(true)
    })
  })

  describe('validateToken', () => {
    it('accepts the token it issued', () => {
      const service = new H5AuthService()
      const { token } = service.enable()

      expect(service.validateToken(token)).toBe(true)
    })

    it('rejects a wrong token', () => {
      const service = new H5AuthService()
      service.enable()

      expect(service.validateToken('h5_' + 'x'.repeat(43))).toBe(false)
    })

    it('rejects null, undefined and empty input', () => {
      const service = new H5AuthService()
      service.enable()

      expect(service.validateToken(null)).toBe(false)
      expect(service.validateToken(undefined)).toBe(false)
      expect(service.validateToken('')).toBe(false)
    })

    it('rejects every token while the service is disabled', () => {
      const service = new H5AuthService()
      const { token } = service.enable()
      service.disable()

      expect(service.validateToken(token)).toBe(false)
    })

    it('rejects when no token has ever been issued', () => {
      seedSettings({ enabled: true, token: null })

      expect(new H5AuthService().validateToken('h5_' + 'y'.repeat(43))).toBe(false)
    })
  })

  describe('persistence across instances', () => {
    it('lets a fresh instance read and verify the state a previous one wrote', () => {
      const first = new H5AuthService()
      const { token } = first.enable()

      const second = new H5AuthService()

      expect(second.getSettings()).toMatchObject({ enabled: true, token })
      expect(second.validateToken(token)).toBe(true)
    })
  })

  describe('findLanIP', () => {
    it('prefers a physical interface in a private range over other physical NICs', () => {
      interfaces = {
        'Ethernet 2': [iface('10.0.0.5')],
        'Wi-Fi': [iface('192.168.1.10')],
      }

      expect(new H5AuthService().findLanIP()).toBe('192.168.1.10')
    })

    it('ranks a physical NIC above a virtual one at the same address family', () => {
      interfaces = {
        veth0: [iface('172.17.0.1')],
        eth0: [iface('192.168.0.2')],
      }

      expect(new H5AuthService().findLanIP()).toBe('192.168.0.2')
    })

    it('prefers a routable address over a link-local one', () => {
      interfaces = {
        eth0: [iface('169.254.10.2')],
        usb0: [iface('192.168.5.5')],
      }

      expect(new H5AuthService().findLanIP()).toBe('192.168.5.5')
    })

    it('still returns the link-local address when it is the only candidate', () => {
      interfaces = {
        eth0: [iface('169.254.10.2')],
      }

      expect(new H5AuthService().findLanIP()).toBe('169.254.10.2')
    })

    it('ignores IPv6 entries and loopback interfaces', () => {
      interfaces = {
        eth0: [iface('::1', 'IPv6'), iface('fe80::1', 'IPv6')],
        lo0: [iface('127.0.0.1', 'IPv4', true)],
      }

      expect(new H5AuthService().findLanIP()).toBe('127.0.0.1')
    })

    it('skips an interface whose entry list is null', () => {
      interfaces = {
        empty: null,
        eth0: [iface('192.168.1.1')],
      }

      expect(new H5AuthService().findLanIP()).toBe('192.168.1.1')
    })
  })
})
