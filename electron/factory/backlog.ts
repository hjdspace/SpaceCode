/**
 * 本地待办（`.spacecode/factory/backlog.json`）：读取、增改、调序、删除。
 *
 * 所有变更都先读整份列表、再原子写回；order 每次重排为 0..n-1，
 * 保证「调序」在磁盘上也是稳定事实，而不是靠 UI 临时排序。
 */
import { existsSync, readFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { join } from 'path'
import {
  FACTORY_BACKLOG_PATH,
  type FactoryBacklogInput,
  type FactoryBacklogItem,
  type FactoryBacklogResult,
  type FactoryBacklogUpdate,
} from '@/shared/factory'
import { writeJsonAtomic } from './atomic'

export interface FactoryBacklogDeps {
  now?: () => Date
  genId?: () => string
}

export function backlogFilePath(repoRoot: string): string {
  return join(repoRoot, FACTORY_BACKLOG_PATH)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeItem(raw: unknown, index: number): FactoryBacklogItem | null {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== 'string' || !raw.id.trim()) return null
  if (typeof raw.title !== 'string' || !raw.title.trim()) return null
  return {
    id: raw.id,
    title: raw.title,
    goal: typeof raw.goal === 'string' ? raw.goal : '',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    order: typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : index,
  }
}

/** 读取时容忍损坏文件与手写脏数据；顺序以 order 为准。 */
export function readBacklog(repoRoot: string): FactoryBacklogItem[] {
  try {
    const path = backlogFilePath(repoRoot)
    if (!existsSync(path)) return []
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(normalizeItem)
      .filter((item): item is FactoryBacklogItem => item !== null)
      .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
  } catch {
    return []
  }
}

function persist(repoRoot: string, items: FactoryBacklogItem[]): FactoryBacklogItem[] {
  // 变更函数已经按目标顺序排好；这里只把 order 重排为连续序号。
  const ordered = items.map((item, index) => ({ ...item, order: index }))
  writeJsonAtomic(backlogFilePath(repoRoot), ordered)
  return ordered
}

function defaultDeps(): Required<FactoryBacklogDeps> {
  return { now: () => new Date(), genId: () => `bl-${randomUUID().slice(0, 8)}` }
}

export function createBacklogItem(
  repoRoot: string,
  input: FactoryBacklogInput,
  deps: FactoryBacklogDeps = {},
): FactoryBacklogResult {
  const items = readBacklog(repoRoot)
  const title = (input.title ?? '').trim()
  if (!title) return { ok: false, error: 'title-required', items }

  const resolved = { ...defaultDeps(), ...deps }
  const item: FactoryBacklogItem = {
    id: resolved.genId(),
    title,
    goal: (input.goal ?? '').trim(),
    createdAt: resolved.now().toISOString(),
    order: items.length,
  }
  return { ok: true, items: persist(repoRoot, [...items, item]) }
}

export function updateBacklogItem(repoRoot: string, input: FactoryBacklogUpdate): FactoryBacklogResult {
  const items = readBacklog(repoRoot)
  const index = items.findIndex((item) => item.id === input.id)
  if (index < 0) return { ok: false, error: 'not-found', items }

  const title = input.title === undefined ? items[index].title : input.title.trim()
  if (!title) return { ok: false, error: 'title-required', items }
  const goal = input.goal === undefined ? items[index].goal : input.goal.trim()

  const next = items.map((item, i) => (i === index ? { ...item, title, goal } : item))
  return { ok: true, items: persist(repoRoot, next) }
}

export function deleteBacklogItem(repoRoot: string, id: string): FactoryBacklogResult {
  const items = readBacklog(repoRoot)
  const next = items.filter((item) => item.id !== id)
  if (next.length === items.length) return { ok: false, error: 'not-found', items }
  return { ok: true, items: persist(repoRoot, next) }
}

export function moveBacklogItem(
  repoRoot: string,
  id: string,
  direction: 'up' | 'down',
): FactoryBacklogResult {
  const items = readBacklog(repoRoot)
  const index = items.findIndex((item) => item.id === id)
  if (index < 0) return { ok: false, error: 'not-found', items }

  const target = direction === 'up' ? index - 1 : index + 1
  // 边界移动是无操作而不是错误：按钮可见时用户可能点到尽头。
  if (target < 0 || target >= items.length) return { ok: true, items }

  const next = items.slice()
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved)
  return { ok: true, items: persist(repoRoot, next) }
}
