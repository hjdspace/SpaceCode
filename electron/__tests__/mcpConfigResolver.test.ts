import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock the dependencies that do filesystem/system lookups
vi.mock('../cuaDriverService', () => ({
  findCuaDriverBinary: vi.fn(() => null),
}))
vi.mock('../browserUseService', () => ({
  getBrowserUseMcpServerConfig: vi.fn(() => null),
}))
vi.mock('../logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

import {
  detectBuiltinFromConfig,
  builtinNameFromServerKey,
  resolveBuiltinMcp,
} from '../mcpConfigResolver'
import { findCuaDriverBinary } from '../cuaDriverService'
import { getBrowserUseMcpServerConfig } from '../browserUseService'

describe('mcpConfigResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── detectBuiltinFromConfig ──────────────────────────────────

  describe('detectBuiltinFromConfig', () => {
    it('detects cua-driver by command name', () => {
      const result = detectBuiltinFromConfig({
        type: 'stdio',
        command: 'cua-driver',
        args: [],
      })
      expect(result).toBe('cua-driver')
    })

    it('detects browser-use by python + bridge.py pattern', () => {
      const result = detectBuiltinFromConfig({
        type: 'stdio',
        command: 'python',
        args: ['bridge.py', '--mcp'],
      })
      expect(result).toBe('browser-use')
    })

    it('detects browser-use with python3 command', () => {
      const result = detectBuiltinFromConfig({
        type: 'stdio',
        command: 'python3',
        args: ['/some/path/bridge.py', '--mcp'],
      })
      expect(result).toBe('browser-use')
    })

    it('detects browser-use with backslash path on windows', () => {
      const result = detectBuiltinFromConfig({
        type: 'stdio',
        command: 'python',
        args: ['C:\\path\\to\\bridge.py'],
      })
      expect(result).toBe('browser-use')
    })

    it('returns null for non-builtin commands', () => {
      expect(
        detectBuiltinFromConfig({ type: 'stdio', command: 'npx', args: ['some-server'] }),
      ).toBeNull()
    })

    it('returns null for python without bridge.py in args', () => {
      expect(
        detectBuiltinFromConfig({
          type: 'stdio',
          command: 'python',
          args: ['some-other.py'],
        }),
      ).toBeNull()
    })

    it('returns null for SSE type configs', () => {
      expect(
        detectBuiltinFromConfig({ type: 'sse', url: 'http://localhost:3000' }),
      ).toBeNull()
    })

    it('returns null when command is undefined', () => {
      expect(detectBuiltinFromConfig({ type: 'stdio' })).toBeNull()
    })

    it('does not detect browser-use for non-stdio type', () => {
      expect(
        detectBuiltinFromConfig({
          type: 'sse',
          command: 'python',
          args: ['bridge.py'],
        }),
      ).toBeNull()
    })
  })

  // ── builtinNameFromServerKey ─────────────────────────────────

  describe('builtinNameFromServerKey', () => {
    it('maps sc-computer-use to cua-driver', () => {
      expect(builtinNameFromServerKey('sc-computer-use')).toBe('cua-driver')
    })

    it('maps browser-use to browser-use', () => {
      expect(builtinNameFromServerKey('browser-use')).toBe('browser-use')
    })

    it('returns null for non-builtin server keys', () => {
      expect(builtinNameFromServerKey('my-custom-server')).toBeNull()
      expect(builtinNameFromServerKey('git')).toBeNull()
    })

    it('returns null for deprecated key computer-use (must be migrated first)', () => {
      // The old 'computer-use' key should be migrated to 'sc-computer-use' by
      // buildEnabledMcpConfig's DEPRECATED_KEY_ALIASES before reaching the resolver.
      expect(builtinNameFromServerKey('computer-use')).toBeNull()
    })
  })

  // ── resolveBuiltinMcp ────────────────────────────────────────

  describe('resolveBuiltinMcp', () => {
    it('resolves cua-driver when binary is found', () => {
      vi.mocked(findCuaDriverBinary).mockReturnValue('/usr/local/bin/cua-driver')

      const result = resolveBuiltinMcp('cua-driver')

      expect(result.status).toBe('resolved')
      if (result.status === 'resolved') {
        expect(result.config.command).toBe('/usr/local/bin/cua-driver')
        expect(result.config.env).toEqual({ CUA_DRIVER_RS_TELEMETRY_ENABLED: '0' })
      }
    })

    it('returns missing when cua-driver binary is not found', () => {
      vi.mocked(findCuaDriverBinary).mockReturnValue(null)

      const result = resolveBuiltinMcp('cua-driver')

      expect(result.status).toBe('missing')
      if (result.status === 'missing') {
        expect(result.error).toContain('cua-driver binary not found')
      }
    })

    it('resolves browser-use when Python and bridge.py are available', () => {
      vi.mocked(getBrowserUseMcpServerConfig).mockReturnValue({
        command: '/usr/bin/python3',
        args: ['/path/to/bridge.py', '--mcp'],
        env: { BROWSER_USE_API_KEY: 'test-key' },
      })

      const result = resolveBuiltinMcp('browser-use')

      expect(result.status).toBe('resolved')
      if (result.status === 'resolved') {
        expect(result.config.command).toBe('/usr/bin/python3')
        expect(result.config.args).toEqual(['/path/to/bridge.py', '--mcp'])
        expect(result.config.env).toEqual({ BROWSER_USE_API_KEY: 'test-key' })
      }
    })

    it('returns missing when browser-use Python is not available', () => {
      vi.mocked(getBrowserUseMcpServerConfig).mockReturnValue(null)

      const result = resolveBuiltinMcp('browser-use')

      expect(result.status).toBe('missing')
      if (result.status === 'missing') {
        expect(result.error).toContain('Python 3.11+')
      }
    })
  })
})
