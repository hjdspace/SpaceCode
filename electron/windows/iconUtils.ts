/**
 * Icon resolution and loading utilities for BrowserWindow, Tray, etc.
 *
 * Extracted from main.ts to provide a single source of truth for icon paths
 * and NativeImage creation across window and tray modules.
 */
import { app, nativeImage } from 'electron'
import { join, extname } from 'path'
import { existsSync } from 'fs'
import { info, warn, error } from '../infra/logger'

/** Resolve icon path: dev mode uses project root icons/, production uses extraResources. */
export function getIconPath(): string {
  if (app.isPackaged) {
    const icoPath = join(process.resourcesPath, 'icons', 'icon.ico')
    const pngPath = join(process.resourcesPath, 'icons', 'icon.png')
    if (existsSync(icoPath)) return icoPath
    if (existsSync(pngPath)) return pngPath
    warn('Icon', `No icon found in resources: tried ${icoPath} and ${pngPath}`)
    return icoPath
  }
  const devIcoPath = join(__dirname, '../icons/icon.ico')
  const devPngPath = join(__dirname, '../icons/icon.png')
  if (existsSync(devIcoPath)) return devIcoPath
  if (existsSync(devPngPath)) return devPngPath
  warn('Icon', `No icon found in dev: tried ${devIcoPath} and ${devPngPath}`)
  return devIcoPath
}

/**
 * Load a NativeImage for tray/window icon.
 * Always prefer .png for NativeImage creation (more reliable across platforms).
 */
export function loadIconImage(): Electron.NativeImage {
  const icoPath = getIconPath()
  const pngPath = icoPath.replace(/\.ico$/, '.png')
  const preferredPath = existsSync(pngPath) ? pngPath : icoPath
  info('Icon', `Loading icon from: ${preferredPath} | exists=${existsSync(preferredPath)}`)

  try {
    if (existsSync(preferredPath)) {
      const img = nativeImage.createFromPath(preferredPath)
      if (!img.isEmpty()) {
        const size = img.getSize()
        info('Icon', `Icon loaded: ${preferredPath} (${size.width}x${size.height})`)
        return img
      }
      warn('Icon', `Icon at ${preferredPath} loaded but is EMPTY — trying fallback`)
    }

    const fallbackExt = extname(preferredPath) === '.ico' ? '.png' : '.ico'
    const fallbackPath = preferredPath.replace(/\.(ico|png)$/, fallbackExt)
    if (fallbackPath !== preferredPath && existsSync(fallbackPath)) {
      const fallbackImg = nativeImage.createFromPath(fallbackPath)
      if (!fallbackImg.isEmpty()) {
        info('Icon', `Using fallback icon: ${fallbackPath}`)
        return fallbackImg
      }
      warn('Icon', `Fallback icon at ${fallbackPath} also empty`)
    }

    warn('Icon', 'No valid icon found — using empty image (will show default)')
    return nativeImage.createEmpty()
  } catch (err) {
    error('Icon', 'Error loading icon image', err)
    return nativeImage.createEmpty()
  }
}

/** Resolve icon path for BrowserWindow constructor (needs a file path, not NativeImage). */
export function getWindowIconPath(): string {
  const iconPath = getIconPath()
  if (existsSync(iconPath)) return iconPath
  const pngPath = iconPath.replace(/\.ico$/, '.png')
  if (existsSync(pngPath)) return pngPath
  return iconPath
}
