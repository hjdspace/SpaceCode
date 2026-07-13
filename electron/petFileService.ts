// electron/petFileService.ts
import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, unlinkSync, renameSync } from 'fs'
import { info, warn } from './logger'
import type { PetConfig } from '../src/types/pet'

const CONFIG_FILENAME = 'buddy-pets.json'
const ASSETS_DIRNAME = 'buddy-pets-assets'

export class PetFileService {
  private configDir: string
  private assetsDir: string
  private configPath: string
  private cache: PetConfig | null = null

  constructor(configDir?: string) {
    this.configDir = configDir ?? join(app.getPath('home'), '.claude')
    this.assetsDir = join(this.configDir, ASSETS_DIRNAME)
    this.configPath = join(this.configDir, CONFIG_FILENAME)
  }

  async init(): Promise<void> {
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true })
    }
    if (!existsSync(this.assetsDir)) {
      mkdirSync(this.assetsDir, { recursive: true })
    }
    this.cache = await this.read()
    info('PetFileService', `Initialized, cache ${this.cache ? 'loaded' : 'empty'}`)
  }

  async read(): Promise<PetConfig | null> {
    try {
      if (!existsSync(this.configPath)) return null
      const raw = readFileSync(this.configPath, 'utf-8')
      if (!raw.trim()) return null
      const config = JSON.parse(raw) as PetConfig
      if (!config.version || !config.settings || !Array.isArray(config.customPets)) {
        warn('PetFileService', 'Config schema invalid')
        return null
      }
      this.cache = config
      return config
    } catch (err) {
      warn('PetFileService', `Failed to read config: ${err}`)
      return null
    }
  }

  async write(config: PetConfig): Promise<void> {
    try {
      const tmpPath = `${this.configPath}.tmp`
      writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8')
      renameSync(tmpPath, this.configPath)
      this.cache = config
    } catch (err) {
      warn('PetFileService', `Failed to write config: ${err}`)
      throw err
    }
  }

  async saveAsset(srcPath: string, petId: string): Promise<string> {
    const ext = srcPath.match(/\.(png|jpg|jpeg|gif|svg)$/i)?.[0]?.toLowerCase() ?? '.png'
    const filename = `${petId}${ext}`
    const destPath = join(this.assetsDir, filename)
    if (!existsSync(this.assetsDir)) {
      mkdirSync(this.assetsDir, { recursive: true })
    }
    copyFileSync(srcPath, destPath)
    return `${ASSETS_DIRNAME}/${filename}`
  }

  async deleteAsset(relativePath: string): Promise<void> {
    const fullPath = join(this.configDir, relativePath)
    if (existsSync(fullPath)) {
      unlinkSync(fullPath)
    }
  }

  getCachedConfig(): PetConfig | null {
    return this.cache
  }

  getAssetsDir(): string {
    return this.assetsDir
  }
}
