/**
 * Tests that process pools use MAX_PROCESSES = 20 (ADR-0010).
 * Orchestration fan-out requires more concurrent sessions than the old cap of 3.
 */
import { describe, it, expect, vi } from 'vitest'

// Mock electron
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn((name: string) => '/tmp'),
  },
}))

// Mock logger
vi.mock('../logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

// Mock proxyManager
vi.mock('../proxyManager', () => ({
  proxyManager: {
    getProxyUrl: vi.fn(() => null),
  },
}))

import { MAX_PROCESSES as ClaudeCodeMaxProcesses } from '../claudeCodeProcessPool'
import { MAX_PROCESSES as PiMaxProcesses } from '../engines/PiProcessPool'

describe('Process pool MAX_PROCESSES — ADR-0010 (20)', () => {
  it('ClaudeCodeProcessPool MAX_PROCESSES = 20', () => {
    expect(ClaudeCodeMaxProcesses).toBe(20)
  })

  it('PiProcessPool MAX_PROCESSES = 20', () => {
    expect(PiMaxProcesses).toBe(20)
  })
})
