// @vitest-environment node

import { describe, expect, it } from 'vitest'
import type { UserConfig } from 'vite'
import config from '../../vite.config.mts'

describe('Vite development server', () => {
  it('listens on the IPv4 loopback used by Electron', () => {
    const server = (config as UserConfig).server

    expect(server?.host).toBe('127.0.0.1')
    expect(server?.port).toBe(5173)
  })
})
