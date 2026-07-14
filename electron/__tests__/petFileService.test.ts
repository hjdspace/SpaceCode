// electron/__tests__/petFileService.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => `/tmp/mock-${name}`),
  },
}))

vi.mock('../logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
}))

import { PetFileService } from '../petFileService'

describe('PetFileService', () => {
  let tempDir: string
  let service: PetFileService

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pet-test-'))
    service = new PetFileService(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('read 返回 null 当文件不存在时', async () => {
    const config = await service.read()
    expect(config).toBeNull()
  })

  it('write 后 read 返回相同配置', async () => {
    const config = {
      version: 1,
      activePetId: 'builtin-duck',
      mode: 'embedded' as const,
      embeddedPosition: { x: 0.5, y: 0.5 },
      desktopWindow: { x: 100, y: 100, width: 120, height: 120 },
      settings: {
        reactionMode: 'preset' as const,
        aiModel: 'gpt-4o-mini',
        reactionIntervalMs: 60000,
        muted: false,
        scale: 1.0,
        alwaysOnTopDesktop: true,
        clickThrough: false
      },
      customPets: []
    }
    await service.write(config)
    const read = await service.read()
    expect(read).toEqual(config)
  })

  it('saveAsset 复制文件到 assets 目录', async () => {
    const srcPath = join(tempDir, 'source.png')
    writeFileSync(srcPath, 'fake-image-data')

    const relativePath = await service.saveAsset(srcPath, 'custom-123-abc')
    expect(relativePath).toContain('custom-123-abc')
    expect(relativePath).toMatch(/\.(png|jpg|gif|svg)$/i)

    const fullPath = join(tempDir, relativePath)
    expect(existsSync(fullPath)).toBe(true)
  })

  it('deleteAsset 删除资源文件', async () => {
    const srcPath = join(tempDir, 'source.png')
    writeFileSync(srcPath, 'fake-image-data')

    const relativePath = await service.saveAsset(srcPath, 'custom-123-abc')
    await service.deleteAsset(relativePath)

    const fullPath = join(tempDir, relativePath)
    expect(existsSync(fullPath)).toBe(false)
  })

  it('read 返回 null 当 JSON 损坏时', async () => {
    const configPath = join(tempDir, 'buddy-pets.json')
    writeFileSync(configPath, '{ invalid json }')

    const config = await service.read()
    expect(config).toBeNull()
  })
})
