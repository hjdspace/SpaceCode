/**
 * Read an agent's MCP server and plugin configuration off disk.
 *
 * Split out of service.ts: these are pure filesystem readers with no DB or
 * service state, so they can be tested against fixture directories alone.
 */

import * as fs from 'fs'
import * as path from 'path'

import { getBuiltInAgent, pathsForAgent, pluginCachePathForAgent } from './agentRegistry'
import { pathExists } from './fsutil'
import type { McpServerStatus, PluginStatus } from '@/types/skillManagerV2'

export function readMcpServers(agentId: string): McpServerStatus[] {
  const configPath = pathsForAgent(agentId)?.mcpConfig
  if (!configPath || !pathExists(configPath)) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch {
    return []
  }
  const servers = (parsed as { mcpServers?: Record<string, unknown> }).mcpServers
  if (!servers || typeof servers !== 'object') return []
  return Object.entries(servers).map(([name, raw]) => {
    const config = raw as { command?: unknown; url?: unknown; args?: unknown }
    const command = typeof config.command === 'string'
      ? config.command
      : typeof config.url === 'string' ? config.url : ''
    const args = Array.isArray(config.args)
      ? config.args.filter((arg): arg is string => typeof arg === 'string')
      : []
    return {
      name,
      command,
      args,
      valid: command.length > 0,
      message: command.length > 0 ? 'configured' : 'missing command',
    }
  })
}

export function readPlugins(agentId: string): PluginStatus[] {
  if (agentId !== 'claude-code') return []
  const cache = pluginCachePathForAgent(agentId)
  if (!cache) return []
  // 设置文件走注册表：那里已经尊重 CLAUDE_CONFIG_DIR，硬编码 ~/.claude 会读错目录
  const settingsFile = getBuiltInAgent(agentId)?.configPath
  const enabledPlugins = settingsFile ? readEnabledPlugins(settingsFile) : {}
  const manifests = collectPluginManifests(cache, 0)
  const plugins = new Map<string, PluginStatus>()

  for (const manifestPath of manifests) {
    let manifest: {
      name?: unknown
      displayName?: unknown
      version?: unknown
      interface?: { displayName?: unknown }
    }
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as typeof manifest
    } catch {
      continue
    }
    const name = typeof manifest.name === 'string' ? manifest.name.trim() : ''
    if (!name) continue
    const relative = path.relative(cache, manifestPath)
    const source = relative.split(path.sep)[0] || null
    const configKey = source ? `${name}@${source}` : name
    const enabled = enabledPlugins[configKey] ?? enabledPlugins[name] ?? true
    const plugin: PluginStatus = {
      id: configKey,
      name: typeof manifest.interface?.displayName === 'string'
        ? manifest.interface.displayName
        : typeof manifest.displayName === 'string' ? manifest.displayName : name,
      version: typeof manifest.version === 'string' ? manifest.version : null,
      enabled,
      source: source ? `claude-plugin:${source}` : 'claude-plugin',
    }
    const existing = plugins.get(plugin.id)
    if (!existing || (plugin.version ?? '') > (existing.version ?? '')) plugins.set(plugin.id, plugin)
  }
  return [...plugins.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function collectPluginManifests(dir: string, depth: number): string[] {
  if (depth > 8) return []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const result: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const child = path.join(dir, entry.name)
    const manifest = path.join(child, '.claude-plugin', 'plugin.json')
    if (pathExists(manifest)) {
      result.push(manifest)
      continue
    }
    result.push(...collectPluginManifests(child, depth + 1))
  }
  return result
}

function readEnabledPlugins(settingsPath: string): Record<string, boolean> {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as { enabledPlugins?: unknown }
    const enabled = parsed.enabledPlugins
    if (!enabled || typeof enabled !== 'object') return {}
    return Object.fromEntries(
      Object.entries(enabled).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'),
    )
  } catch {
    return {}
  }
}