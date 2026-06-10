# Cron 定时任务系统实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为 SpaceCode 桌面应用添加项目级 Cron 定时任务管理系统，支持创建/编辑/删除/启禁/立即执行定时任务，任务到时自动在 CLI 子进程中执行。

**架构：** Electron 主进程独立实现 cron 解析和调度（不修改 Engine），通过 IPC 通道与渲染进程通信。渲染进程使用 Vue 3 + Pinia 构建独立管理面板，通过侧边栏 Clock 图标入口访问。

**技术栈：** Electron IPC, Vue 3 Composition API, Pinia, SCSS (CSS 变量主题), Node.js child_process

---

## 文件结构

### 新建文件

| 文件 | 职责 |
|------|------|
| `electron/cronParser.ts` | Cron 表达式解析、验证、人类可读描述、频率转换 |
| `electron/cronFileStore.ts` | 任务文件 CRUD（原子写入，兼容 Engine 格式） |
| `electron/cronScheduler.ts` | 调度引擎（60s 轮询 + cron 匹配 + CLI 执行） |
| `electron/taskRunLogger.ts` | 执行记录持久化（追加/更新/裁剪/清理） |
| `electron/cronService.ts` | IPC Handler 注册 + 调度器生命周期管理 |
| `src/stores/cron.ts` | Pinia store（useCronStore） |
| `src/components/cron/CronManager.vue` | 主面板入口 |
| `src/components/cron/CronTaskList.vue` | 任务列表 + 统计卡片 + 筛选器 |
| `src/components/cron/CronTaskRow.vue` | 单任务行 |
| `src/components/cron/NewCronTaskModal.vue` | 新建/编辑任务弹窗 |
| `src/components/cron/CronRunsPanel.vue` | 执行记录展开面板 |
| `src/components/cron/CronEmptyState.vue` | 空状态引导页 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/stores/app.ts` | 添加 `showCronManager` ref |
| `src/App.vue` | 添加 CronManager 条件渲染 + import |
| `src/components/layout/Sidebar.vue` | 添加 Clock 图标按钮 + handler |
| `electron/preload.ts` | 添加 `cron` 命名空间 |
| `src/services/electronAPI.ts` | 添加 `cron` API 封装 |
| `electron/main.ts` | import + 注册 `registerCronIPCHandlers()` |

---

## 任务 1：Cron 表达式解析器

**文件：**
- 创建：`electron/cronParser.ts`
- 创建：`electron/__tests__/cronParser.test.ts`

- [ ] **步骤 1：编写失败的测试**

```typescript
// electron/__tests__/cronParser.test.ts
import { describe, it, expect } from 'vitest'
import { parseCronExpression, isValidCron, cronMatches, computeNextCronRun, cronToHuman, frequencyToCron } from '../cronParser'

describe('parseCronExpression', () => {
  it('parses standard 5-field cron', () => {
    const result = parseCronExpression('0 9 * * *')
    expect(result.minute).toEqual([0])
    expect(result.hour).toEqual([9])
    expect(result.dayOfMonth).toEqual('*')
    expect(result.month).toEqual('*')
    expect(result.dayOfWeek).toEqual('*')
  })

  it('parses step values', () => {
    const result = parseCronExpression('*/15 * * * *')
    expect(result.minute).toEqual('*/15')
  })

  it('parses ranges', () => {
    const result = parseCronExpression('0 9 * * 1-5')
    expect(result.dayOfWeek).toEqual('1-5')
  })

  it('parses lists', () => {
    const result = parseCronExpression('0 9 * * 1,3,5')
    expect(result.dayOfWeek).toEqual('1,3,5')
  })

  it('rejects invalid cron with wrong field count', () => {
    expect(() => parseCronExpression('0 9 * *')).toThrow()
  })

  it('treats dayOfWeek 7 as 0 (Sunday)', () => {
    const result = parseCronExpression('0 9 * * 7')
    expect(result.dayOfWeek).toEqual('0')
  })
})

describe('isValidCron', () => {
  it('returns true for valid expressions', () => {
    expect(isValidCron('0 9 * * *')).toBe(true)
    expect(isValidCron('*/15 * * * *')).toBe(true)
    expect(isValidCron('0 9 15 6 *')).toBe(true)
  })

  it('returns false for invalid expressions', () => {
    expect(isValidCron('')).toBe(false)
    expect(isValidCron('0 9 * *')).toBe(false)
    expect(isValidCron('60 9 * * *')).toBe(false)
    expect(isValidCron('0 25 * * *')).toBe(false)
  })
})

describe('cronMatches', () => {
  it('matches a simple daily cron', () => {
    const date = new Date(2026, 5, 10, 9, 0, 0) // 2026-06-10 09:00
    expect(cronMatches('0 9 * * *', date)).toBe(true)
  })

  it('does not match when minute differs', () => {
    const date = new Date(2026, 5, 10, 9, 30, 0)
    expect(cronMatches('0 9 * * *', date)).toBe(false)
  })

  it('matches weekday cron on Monday', () => {
    // 2026-06-08 is Monday
    const date = new Date(2026, 5, 8, 10, 0, 0)
    expect(cronMatches('0 10 * * 1-5', date)).toBe(true)
  })

  it('does not match weekday cron on Saturday', () => {
    // 2026-06-13 is Saturday
    const date = new Date(2026, 5, 13, 10, 0, 0)
    expect(cronMatches('0 10 * * 1-5', date)).toBe(false)
  })
})

describe('computeNextCronRun', () => {
  it('computes next daily run', () => {
    const from = new Date(2026, 5, 10, 10, 0, 0) // 09:00 already passed
    const next = computeNextCronRun('0 9 * * *', from)
    expect(next.getDate()).toBe(11)
    expect(next.getHours()).toBe(9)
    expect(next.getMinutes()).toBe(0)
  })

  it('computes next hourly run', () => {
    const from = new Date(2026, 5, 10, 9, 30, 0)
    const next = computeNextCronRun('0 * * * *', from)
    expect(next.getHours()).toBe(10)
    expect(next.getMinutes()).toBe(0)
  })
})

describe('cronToHuman', () => {
  it('describes daily cron', () => {
    expect(cronToHuman('0 9 * * *')).toBe('每天 09:00')
  })

  it('describes hourly cron', () => {
    expect(cronToHuman('0 * * * *')).toBe('每小时')
  })

  it('describes weekday cron', () => {
    expect(cronToHuman('0 10 * * 1-5')).toBe('工作日 10:00')
  })

  it('describes weekly cron', () => {
    expect(cronToHuman('0 17 * * 5')).toBe('每周五 17:00')
  })

  it('describes monthly cron', () => {
    expect(cronToHuman('0 8 15 * *')).toBe('每月15日 08:00')
  })
})

describe('frequencyToCron', () => {
  it('converts hourly', () => {
    expect(frequencyToCron('hourly')).toBe('0 * * * *')
  })

  it('converts daily with time', () => {
    expect(frequencyToCron('daily', '09:00')).toBe('0 9 * * *')
  })

  it('converts weekdays with time', () => {
    expect(frequencyToCron('weekdays', '10:00')).toBe('0 10 * * 1-5')
  })

  it('converts weekly with time', () => {
    expect(frequencyToCron('weekly', '17:00')).toBe('0 17 * * 1')
  })

  it('converts monthly with time', () => {
    expect(frequencyToCron('monthly', '08:00')).toBe('0 8 1 * *')
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run electron/__tests__/cronParser.test.ts`
预期：FAIL，模块不存在

- [ ] **步骤 3：实现 cronParser.ts**

```typescript
// electron/cronParser.ts

export interface CronFields {
  minute: number[] | string
  hour: number[] | string
  dayOfMonth: number[] | string
  month: number[] | string
  dayOfWeek: number[] | string
}

type FieldName = 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek'

const FIELD_RANGES: Record<FieldName, { min: number; max: number }>> = {
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  dayOfMonth: { min: 1, max: 31 },
  month: { min: 1, max: 12 },
  dayOfWeek: { min: 0, max: 7 },
}

function parseField(field: string, name: FieldName): number[] | string {
  if (field === '*') return '*'

  const range = FIELD_RANGES[name]
  const values: number[] = []

  for (const part of field.split(',')) {
    if (part.includes('/')) {
      const [base, stepStr] = part.split('/')
      const step = parseInt(stepStr, 10)
      if (isNaN(step) || step <= 0) throw new Error(`Invalid step in ${name}: ${part}`)
      const start = base === '*' ? range.min : parseInt(base, 10)
      for (let i = start; i <= range.max; i += step) {
        values.push(i)
      }
    } else if (part.includes('-')) {
      const [startStr, endStr] = part.split('-')
      const start = parseInt(startStr, 10)
      const end = parseInt(endStr, 10)
      if (isNaN(start) || isNaN(end)) throw new Error(`Invalid range in ${name}: ${part}`)
      for (let i = start; i <= end; i++) {
        values.push(i)
      }
    } else {
      const val = parseInt(part, 10)
      if (isNaN(val)) throw new Error(`Invalid value in ${name}: ${part}`)
      values.push(val)
    }
  }

  // dayOfWeek: 7 → 0 (Sunday alias)
  if (name === 'dayOfWeek') {
    for (let i = 0; i < values.length; i++) {
      if (values[i] === 7) values[i] = 0
    }
  }

  // Validate ranges
  for (const v of values) {
    if (v < range.min || v > (name === 'dayOfWeek' ? 7 : range.max)) {
      throw new Error(`Value ${v} out of range for ${name} (${range.min}-${name === 'dayOfWeek' ? 7 : range.max})`)
    }
  }

  return values
}

export function parseCronExpression(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(`Expected 5 fields, got ${parts.length}`)

  return {
    minute: parseField(parts[0], 'minute'),
    hour: parseField(parts[1], 'hour'),
    dayOfMonth: parseField(parts[2], 'dayOfMonth'),
    month: parseField(parts[3], 'month'),
    dayOfWeek: parseField(parts[4], 'dayOfWeek'),
  }
}

export function isValidCron(expr: string): boolean {
  try {
    parseCronExpression(expr)
    return true
  } catch {
    return false
  }
}

function fieldMatches(field: number[] | string, value: number): boolean {
  if (field === '*') return true
  if (Array.isArray(field)) return field.includes(value)
  return false
}

export function cronMatches(cronExpr: string, date: Date): boolean {
  try {
    const fields = parseCronExpression(cronExpr)
    const minMatch = fieldMatches(fields.minute, date.getMinutes())
    const hourMatch = fieldMatches(fields.hour, date.getHours())
    const monthMatch = fieldMatches(fields.month, date.getMonth() + 1)

    const domMatch = fieldMatches(fields.dayOfMonth, date.getDate())
    const dowMatch = fieldMatches(fields.dayOfWeek, date.getDay())

    // Standard cron: if both dom and dow are constrained, OR semantics
    const domConstrained = fields.dayOfMonth !== '*'
    const dowConstrained = fields.dayOfWeek !== '*'
    const dayMatch = (domConstrained && dowConstrained)
      ? (domMatch || dowMatch)
      : (domMatch && dowMatch)

    return minMatch && hourMatch && monthMatch && dayMatch
  } catch {
    return false
  }
}

export function computeNextCronRun(cronExpr: string, from: Date): Date {
  const fields = parseCronExpression(cronExpr)
  const next = new Date(from.getTime())
  next.setSeconds(0, 0)
  next.setMinutes(next.getMinutes() + 1) // Start from next minute

  const maxDate = new Date(from.getTime() + 366 * 24 * 60 * 60 * 1000)

  while (next <= maxDate) {
    if (
      fieldMatches(fields.minute, next.getMinutes()) &&
      fieldMatches(fields.hour, next.getHours()) &&
      fieldMatches(fields.month, next.getMonth() + 1)
    ) {
      const domMatch = fieldMatches(fields.dayOfMonth, next.getDate())
      const dowMatch = fieldMatches(fields.dayOfWeek, next.getDay())
      const domConstrained = fields.dayOfMonth !== '*'
      const dowConstrained = fields.dayOfWeek !== '*'
      const dayMatch = (domConstrained && dowConstrained)
        ? (domMatch || dowMatch)
        : (domMatch && dowMatch)

      if (dayMatch) return next
    }
    next.setMinutes(next.getMinutes() + 1)
  }

  return maxDate
}

export function cronToHuman(cronExpr: string): string {
  try {
    const fields = parseCronExpression(cronExpr)
    const minuteArr = Array.isArray(fields.minute) ? fields.minute[0] : 0
    const hourArr = Array.isArray(fields.hour) ? fields.hour[0] : 0
    const time = `${String(hourArr).padStart(2, '0')}:${String(minuteArr).padStart(2, '0')}`

    const isAll = (f: number[] | string) => f === '*'
    const isWeekdays = Array.isArray(fields.dayOfWeek) &&
      fields.dayOfWeek.length === 5 &&
      [1, 2, 3, 4, 5].every(d => fields.dayOfWeek.includes(d))

    if (isAll(fields.dayOfMonth) && isAll(fields.month) && isAll(fields.dayOfWeek) &&
        isAll(fields.hour) && Array.isArray(fields.minute)) {
      return '每小时'
    }
    if (isAll(fields.dayOfMonth) && isAll(fields.month) && isAll(fields.dayOfWeek)) {
      return `每天 ${time}`
    }
    if (isWeekdays && isAll(fields.dayOfMonth) && isAll(fields.month)) {
      return `工作日 ${time}`
    }
    if (Array.isArray(fields.dayOfWeek) && fields.dayOfWeek.length === 1 && isAll(fields.dayOfMonth) && isAll(fields.month)) {
      const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
      return `每${days[fields.dayOfWeek[0]]} ${time}`
    }
    if (Array.isArray(fields.dayOfMonth) && fields.dayOfMonth.length === 1 && isAll(fields.month) && isAll(fields.dayOfWeek)) {
      return `每月${fields.dayOfMonth[0]}日 ${time}`
    }
    return cronExpr
  } catch {
    return cronExpr
  }
}

export function frequencyToCron(frequency: string, time?: string): string {
  const [h, m] = (time || '00:00').split(':').map(Number)
  const hh = isNaN(h) ? 0 : h
  const mm = isNaN(m) ? 0 : m

  switch (frequency) {
    case 'hourly': return `${mm} * * * *`
    case 'daily': return `${mm} ${hh} * * *`
    case 'weekdays': return `${mm} ${hh} * * 1-5`
    case 'weekly': return `${mm} ${hh} * * 1`
    case 'monthly': return `${mm} ${hh} 1 * *`
    default: return `${mm} ${hh} * * *`
  }
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run electron/__tests__/cronParser.test.ts`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add electron/cronParser.ts electron/__tests__/cronParser.test.ts
git commit -m "feat(cron): add cron expression parser with validation and human-readable description"
```

---

## 任务 2：任务文件存储

**文件：**
- 创建：`electron/cronFileStore.ts`
- 创建：`electron/__tests__/cronFileStore.test.ts`

- [ ] **步骤 1：编写失败的测试**

```typescript
// electron/__tests__/cronFileStore.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { readCronTasks, addCronTask, updateCronTask, deleteCronTask, updateLastFired } from '../cronFileStore'

describe('cronFileStore', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cron-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns empty array when no file exists', async () => {
    const tasks = await readCronTasks(tempDir)
    expect(tasks).toEqual([])
  })

  it('creates and reads a task', async () => {
    const task = await addCronTask({
      cron: '0 9 * * *',
      prompt: 'review code',
      recurring: true,
      name: 'Daily Review',
    }, tempDir)

    expect(task.id).toBeTruthy()
    expect(task.cron).toBe('0 9 * * *')
    expect(task.prompt).toBe('review code')
    expect(task.recurring).toBe(true)
    expect(task.name).toBe('Daily Review')
    expect(task.enabled).toBe(true)

    const tasks = await readCronTasks(tempDir)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].id).toBe(task.id)
  })

  it('updates a task', async () => {
    const task = await addCronTask({
      cron: '0 9 * * *',
      prompt: 'review code',
    }, tempDir)

    await updateCronTask(task.id, { prompt: 'new prompt', enabled: false }, tempDir)

    const tasks = await readCronTasks(tempDir)
    expect(tasks[0].prompt).toBe('new prompt')
    expect(tasks[0].enabled).toBe(false)
  })

  it('deletes a task', async () => {
    const task = await addCronTask({
      cron: '0 9 * * *',
      prompt: 'review code',
    }, tempDir)

    await deleteCronTask(task.id, tempDir)

    const tasks = await readCronTasks(tempDir)
    expect(tasks).toHaveLength(0)
  })

  it('updates lastFiredAt', async () => {
    const task = await addCronTask({
      cron: '0 9 * * *',
      prompt: 'review code',
      recurring: true,
    }, tempDir)

    const firedAt = Date.now()
    await updateLastFired(task.id, firedAt, tempDir)

    const tasks = await readCronTasks(tempDir)
    expect(tasks[0].lastFiredAt).toBe(firedAt)
  })

  it('silently skips tasks with invalid cron on read', async () => {
    const { writeFileSync, mkdirSync } = await import('fs')
    const dir = join(tempDir, '.claude')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'scheduled_tasks.json'), JSON.stringify({
      tasks: [
        { id: 'a1', cron: '0 9 * * *', prompt: 'valid', createdAt: Date.now() },
        { id: 'b2', cron: 'invalid', prompt: 'bad', createdAt: Date.now() },
      ]
    }))

    const tasks = await readCronTasks(tempDir)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].id).toBe('a1')
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run electron/__tests__/cronFileStore.test.ts`
预期：FAIL

- [ ] **步骤 3：实现 cronFileStore.ts**

```typescript
// electron/cronFileStore.ts
import { readFileSync, mkdirSync, renameSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { isValidCron } from './cronParser'

export interface CronTask {
  id: string
  cron: string
  prompt: string
  createdAt: number
  lastFiredAt?: number
  recurring?: boolean
  permanent?: boolean
  name?: string
  description?: string
  enabled?: boolean
  frequency?: string
  scheduledTime?: string
}

type CronFile = { tasks: CronTask[] }

const CRON_DIR_REL = '.claude'
const CRON_FILE_REL = join(CRON_DIR_REL, 'scheduled_tasks.json')

function getCronFilePath(projectRoot: string): string {
  return join(projectRoot, CRON_FILE_REL)
}

function readCronFileSync(projectRoot: string): CronTask[] {
  const filePath = getCronFilePath(projectRoot)
  try {
    const raw = readFileSync(filePath, { encoding: 'utf-8' })
    const data: CronFile = JSON.parse(raw)
    if (!data.tasks || !Array.isArray(data.tasks)) return []
    // Filter out tasks with invalid cron expressions
    return data.tasks.filter(t => isValidCron(t.cron))
  } catch {
    return []
  }
}

function writeCronFileSync(tasks: CronTask[], projectRoot: string): void {
  const filePath = getCronFilePath(projectRoot)
  const dir = join(projectRoot, CRON_DIR_REL)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const data: CronFile = { tasks }
  const json = JSON.stringify(data, null, 2)

  // Atomic write: tmp → rename
  const tmpPath = filePath + `.tmp.${process.pid}.${Date.now()}`
  writeFileSync(tmpPath, json, { encoding: 'utf-8' })
  renameSync(tmpPath, filePath)
}

export async function readCronTasks(projectRoot: string): Promise<CronTask[]> {
  return readCronFileSync(projectRoot)
}

export async function addCronTask(
  input: Omit<CronTask, 'id' | 'createdAt' | 'enabled'> & { enabled?: boolean },
  projectRoot: string
): Promise<CronTask> {
  const tasks = readCronFileSync(projectRoot)
  const task: CronTask = {
    id: randomUUID().replace(/-/g, '').slice(0, 8),
    cron: input.cron,
    prompt: input.prompt,
    createdAt: Date.now(),
    lastFiredAt: input.lastFiredAt,
    recurring: input.recurring,
    permanent: input.permanent,
    name: input.name,
    description: input.description,
    enabled: input.enabled ?? true,
    frequency: input.frequency,
    scheduledTime: input.scheduledTime,
  }
  tasks.push(task)
  writeCronFileSync(tasks, projectRoot)
  return task
}

export async function updateCronTask(
  id: string,
  updates: Partial<CronTask>,
  projectRoot: string
): Promise<void> {
  const tasks = readCronFileSync(projectRoot)
  const idx = tasks.findIndex(t => t.id === id)
  if (idx === -1) throw new Error(`Task ${id} not found`)
  // Validate new cron if provided
  if (updates.cron && !isValidCron(updates.cron)) {
    throw new Error(`Invalid cron expression: ${updates.cron}`)
  }
  tasks[idx] = { ...tasks[idx], ...updates, id: tasks[idx].id, createdAt: tasks[idx].createdAt }
  writeCronFileSync(tasks, projectRoot)
}

export async function deleteCronTask(id: string, projectRoot: string): Promise<void> {
  const tasks = readCronFileSync(projectRoot)
  const filtered = tasks.filter(t => t.id !== id)
  if (filtered.length === tasks.length) throw new Error(`Task ${id} not found`)
  writeCronFileSync(filtered, projectRoot)
}

export async function updateLastFired(id: string, firedAt: number, projectRoot: string): Promise<void> {
  const tasks = readCronFileSync(projectRoot)
  const task = tasks.find(t => t.id === id)
  if (!task) return
  task.lastFiredAt = firedAt
  writeCronFileSync(tasks, projectRoot)
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run electron/__tests__/cronFileStore.test.ts`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add electron/cronFileStore.ts electron/__tests__/cronFileStore.test.ts
git commit -m "feat(cron): add task file store with atomic writes and Engine format compatibility"
```

---

## 任务 3：执行记录日志

**文件：**
- 创建：`electron/taskRunLogger.ts`
- 创建：`electron/__tests__/taskRunLogger.test.ts`

- [ ] **步骤 1：编写失败的测试**

```typescript
// electron/__tests__/taskRunLogger.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { appendRun, updateRun, getRecentRuns, getTaskRuns, cleanupStaleRuns } from '../taskRunLogger'
import type { TaskRun } from '../taskRunLogger'

describe('taskRunLogger', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cron-log-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('appends and reads runs', async () => {
    const run: TaskRun = {
      id: 'r1',
      taskId: 't1',
      taskName: 'Test',
      startedAt: new Date().toISOString(),
      status: 'running',
      prompt: 'test prompt',
    }
    await appendRun(run, tempDir)

    const runs = await getRecentRuns(tempDir)
    expect(runs).toHaveLength(1)
    expect(runs[0].id).toBe('r1')
  })

  it('updates a run', async () => {
    const run: TaskRun = {
      id: 'r2',
      taskId: 't1',
      taskName: 'Test',
      startedAt: new Date().toISOString(),
      status: 'running',
      prompt: 'test',
    }
    await appendRun(run, tempDir)
    await updateRun('r2', { status: 'completed', durationMs: 5000 }, tempDir)

    const runs = await getRecentRuns(tempDir)
    expect(runs[0].status).toBe('completed')
    expect(runs[0].durationMs).toBe(5000)
  })

  it('filters runs by taskId', async () => {
    await appendRun({ id: 'r3', taskId: 't1', taskName: 'A', startedAt: new Date().toISOString(), status: 'completed', prompt: 'a' }, tempDir)
    await appendRun({ id: 'r4', taskId: 't2', taskName: 'B', startedAt: new Date().toISOString(), status: 'completed', prompt: 'b' }, tempDir)

    const runs = await getTaskRuns('t1', tempDir)
    expect(runs).toHaveLength(1)
    expect(runs[0].taskId).toBe('t1')
  })

  it('cleans up stale running records', async () => {
    const oldTime = new Date(Date.now() - 15 * 60 * 1000).toISOString() // 15 min ago
    await appendRun({ id: 'r5', taskId: 't1', taskName: 'Stale', startedAt: oldTime, status: 'running', prompt: 'stale' }, tempDir)

    await cleanupStaleRuns(tempDir)

    const runs = await getRecentRuns(tempDir)
    expect(runs[0].status).toBe('failed')
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run electron/__tests__/taskRunLogger.test.ts`
预期：FAIL

- [ ] **步骤 3：实现 taskRunLogger.ts**

```typescript
// electron/taskRunLogger.ts
import { readFileSync, mkdirSync, renameSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

export interface TaskRun {
  id: string
  taskId: string
  taskName: string
  startedAt: string
  completedAt?: string
  status: 'running' | 'completed' | 'failed' | 'timeout'
  prompt: string
  output?: string
  error?: string
  durationMs?: number
  sessionId?: string
}

type RunFile = { runs: TaskRun[] }

const CRON_DIR_REL = '.claude'
const RUN_FILE_REL = join(CRON_DIR_REL, 'scheduled_tasks_log.json')
const MAX_RUNS_PER_TASK = 100
const STALE_THRESHOLD_MS = 11 * 60 * 1000 // 10min timeout + 1min buffer

function getRunFilePath(projectRoot: string): string {
  return join(projectRoot, RUN_FILE_REL)
}

function readRunFileSync(projectRoot: string): TaskRun[] {
  const filePath = getRunFilePath(projectRoot)
  try {
    const raw = readFileSync(filePath, { encoding: 'utf-8' })
    const data: RunFile = JSON.parse(raw)
    return data.runs || []
  } catch {
    return []
  }
}

function writeRunFileSync(runs: TaskRun[], projectRoot: string): void {
  const filePath = getRunFilePath(projectRoot)
  const dir = join(projectRoot, CRON_DIR_REL)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const data: RunFile = { runs }
  const json = JSON.stringify(data, null, 2)
  const tmpPath = filePath + `.tmp.${process.pid}.${Date.now()}`
  writeFileSync(tmpPath, json, { encoding: 'utf-8' })
  renameSync(tmpPath, filePath)
}

function trimRunsByTask(runs: TaskRun[], taskId: string): TaskRun[] {
  const taskRuns = runs.filter(r => r.taskId === taskId)
  if (taskRuns.length <= MAX_RUNS_PER_TASK) return runs
  const toRemove = new Set(
    taskRuns
      .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())
      .slice(0, taskRuns.length - MAX_RUNS_PER_TASK)
      .map(r => r.id)
  )
  return runs.filter(r => !toRemove.has(r.id))
}

export async function appendRun(run: TaskRun, projectRoot: string): Promise<void> {
  const runs = readRunFileSync(projectRoot)
  runs.push(run)
  const trimmed = trimRunsByTask(runs, run.taskId)
  writeRunFileSync(trimmed, projectRoot)
}

export async function updateRun(id: string, updates: Partial<TaskRun>, projectRoot: string): Promise<void> {
  const runs = readRunFileSync(projectRoot)
  const run = runs.find(r => r.id === id)
  if (!run) return
  Object.assign(run, updates)
  writeRunFileSync(runs, projectRoot)
}

export async function getRecentRuns(projectRoot: string, limit: number = 50): Promise<TaskRun[]> {
  const runs = readRunFileSync(projectRoot)
  return runs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()).slice(0, limit)
}

export async function getTaskRuns(taskId: string, projectRoot: string): Promise<TaskRun[]> {
  const runs = readRunFileSync(projectRoot)
  return runs
    .filter(r => r.taskId === taskId)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
}

export async function cleanupStaleRuns(projectRoot: string): Promise<void> {
  const runs = readRunFileSync(projectRoot)
  const now = Date.now()
  let changed = false
  for (const run of runs) {
    if (run.status === 'running') {
      const startedAt = new Date(run.startedAt).getTime()
      if (now - startedAt > STALE_THRESHOLD_MS) {
        run.status = 'failed'
        run.error = 'Stale run: exceeded timeout threshold'
        run.completedAt = new Date().toISOString()
        changed = true
      }
    }
  }
  if (changed) writeRunFileSync(runs, projectRoot)
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run electron/__tests__/taskRunLogger.test.ts`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add electron/taskRunLogger.ts electron/__tests__/taskRunLogger.test.ts
git commit -m "feat(cron): add task run logger with stale run cleanup"
```

---

## 任务 4：调度引擎

**文件：**
- 创建：`electron/cronScheduler.ts`

- [ ] **步骤 1：实现 cronScheduler.ts**

```typescript
// electron/cronScheduler.ts
import { randomUUID } from 'crypto'
import { readCronTasks, updateLastFired } from './cronFileStore'
import { appendRun, updateRun, cleanupStaleRuns } from './taskRunLogger'
import { cronMatches } from './cronParser'
import type { CronTask } from './cronFileStore'
import type { TaskRun } from './taskRunLogger'

export interface CronSchedulerOptions {
  getProjectRoot: () => string | null
  spawnCliProcess: (prompt: string, cwd: string) => Promise<{ exitCode: number | null; stdout: string; stderr: string; sessionId?: string }>
  onTaskFired?: (run: TaskRun) => void
  onRunCompleted?: (run: TaskRun) => void
}

const TICK_INTERVAL_MS = 60_000
const EXECUTION_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

export class CronScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private runningTasks = new Set<string>() // taskId set for dedup
  private firedMinuteKeys = new Set<string>() // "taskId:YYYY-MM-DDTHH:mm" dedup
  private options: CronSchedulerOptions

  constructor(options: CronSchedulerOptions) {
    this.options = options
  }

  start(): void {
    if (this.timer) return
    // Cleanup stale runs on start
    const projectRoot = this.options.getProjectRoot()
    if (projectRoot) {
      cleanupStaleRuns(projectRoot).catch(() => {})
    }
    // Immediate first tick
    this.tick()
    this.timer = setInterval(() => this.tick(), TICK_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.runningTasks.clear()
    this.firedMinuteKeys.clear()
  }

  private async tick(): Promise<void> {
    const projectRoot = this.options.getProjectRoot()
    if (!projectRoot) return

    const now = new Date()
    const minuteKey = (taskId: string) =>
      `${taskId}:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

    let tasks: CronTask[]
    try {
      tasks = await readCronTasks(projectRoot)
    } catch {
      return
    }

    for (const task of tasks) {
      // Skip disabled tasks
      if (task.enabled === false) continue
      // Skip already running tasks
      if (this.runningTasks.has(task.id)) continue
      // Skip already fired this minute
      const key = minuteKey(task.id)
      if (this.firedMinuteKeys.has(key)) continue
      // Cross-process dedup: if lastFiredAt is within this minute, skip
      if (task.lastFiredAt) {
        const lastFired = new Date(task.lastFiredAt)
        if (
          lastFired.getFullYear() === now.getFullYear() &&
          lastFired.getMonth() === now.getMonth() &&
          lastFired.getDate() === now.getDate() &&
          lastFired.getHours() === now.getHours() &&
          lastFired.getMinutes() === now.getMinutes()
        ) continue
      }
      // Check cron match
      if (!cronMatches(task.cron, now)) continue

      // Fire the task
      this.firedMinuteKeys.add(key)
      this.executeTask(task, projectRoot).catch(() => {})
    }

    // Clean up old minute keys (keep only last 2 minutes worth)
    const currentMinute = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    for (const key of this.firedMinuteKeys) {
      if (!key.endsWith(currentMinute)) {
        this.firedMinuteKeys.delete(key)
      }
    }
  }

  async executeTask(task: CronTask, projectRoot: string): Promise<TaskRun> {
    const runId = randomUUID().replace(/-/g, '').slice(0, 8)
    const run: TaskRun = {
      id: runId,
      taskId: task.id,
      taskName: task.name || task.cron,
      startedAt: new Date().toISOString(),
      status: 'running',
      prompt: task.prompt,
    }

    this.runningTasks.add(task.id)

    // Update lastFiredAt immediately for cross-process dedup
    await updateLastFired(task.id, Date.now(), projectRoot)
    await appendRun(run, projectRoot)
    this.options.onTaskFired?.(run)

    try {
      // Set timeout
      const timeoutPromise = new Promise<{ exitCode: null; stdout: ''; stderr: 'Execution timeout' }>((resolve) =>
        setTimeout(() => resolve({ exitCode: null, stdout: '', stderr: 'Execution timeout' }), EXECUTION_TIMEOUT_MS)
      )

      const result = await Promise.race([
        this.options.spawnCliProcess(task.prompt, projectRoot),
        timeoutPromise,
      ])

      const completedRun: Partial<TaskRun> = {
        completedAt: new Date().toISOString(),
        status: result.exitCode === 0 ? 'completed' : (result.stderr.includes('timeout') ? 'timeout' : 'failed'),
        output: result.stdout.slice(0, 5000), // Truncate output
        error: result.stderr ? result.stderr.slice(0, 2000) : undefined,
        durationMs: Date.now() - new Date(run.startedAt).getTime(),
        sessionId: result.sessionId,
      }

      await updateRun(runId, completedRun, projectRoot)
      Object.assign(run, completedRun)

      // One-shot task: disable after execution
      if (!task.recurring) {
        const { updateCronTask } = await import('./cronFileStore')
        await updateCronTask(task.id, { enabled: false }, projectRoot)
      }
    } catch (err: any) {
      const failedRun: Partial<TaskRun> = {
        completedAt: new Date().toISOString(),
        status: 'failed',
        error: err.message || String(err),
        durationMs: Date.now() - new Date(run.startedAt).getTime(),
      }
      await updateRun(runId, failedRun, projectRoot)
      Object.assign(run, failedRun)
    } finally {
      this.runningTasks.delete(task.id)
      this.options.onRunCompleted?.(run)
    }

    return run
  }
}
```

- [ ] **步骤 2：Commit**

```bash
git add electron/cronScheduler.ts
git commit -m "feat(cron): add cron scheduler engine with 60s polling and CLI execution"
```

---

## 任务 5：IPC 服务层 + 主进程集成

**文件：**
- 创建：`electron/cronService.ts`
- 修改：`electron/main.ts` — 添加 import 和注册调用

- [ ] **步骤 1：实现 cronService.ts**

```typescript
// electron/cronService.ts
import { ipcMain, BrowserWindow, Notification } from 'electron'
import { readCronTasks, addCronTask, updateCronTask, deleteCronTask } from './cronFileStore'
import { getRecentRuns, getTaskRuns } from './taskRunLogger'
import { isValidCron, cronToHuman, computeNextCronRun } from './cronParser'
import { CronScheduler } from './cronScheduler'
import type { CronTask } from './cronFileStore'
import type { TaskRun } from './taskRunLogger'

let scheduler: CronScheduler | null = null

function getProjectRoot(): string | null {
  // Get from the active project root, same pattern as other services
  // This will be injected during registration
  return projectRootGetter()
}

let projectRootGetter: () => string | null = () => null

async function spawnCliProcess(prompt: string, cwd: string): Promise<{ exitCode: number | null; stdout: string; stderr: string; sessionId?: string }> {
  // Use the existing session process spawning pattern
  // This will be implemented by importing from the existing process management
  const { spawn } = await import('child_process')
  const path = await import('path')

  // Determine CLI binary path - same logic as sessionProcess.ts
  const isDev = !app.isPackaged
  const cliPath = isDev
    ? path.join(process.cwd(), 'engine', 'dist-desktop', 'cli.js')
    : path.join(process.resourcesPath, 'engine', 'dist-desktop', 'cli.js')

  return new Promise((resolve) => {
    const proc = spawn('bun', [cliPath, '--print', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''

    proc.stdout!.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr!.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      resolve({ exitCode: code, stdout, stderr })
    })

    proc.on('error', (err) => {
      resolve({ exitCode: -1, stdout, stderr: err.message })
    })

    // Send prompt via stdin
    const msg = JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } }) + '\n'
    proc.stdin!.write(msg)
    proc.stdin!.end()
  })
}

const { app } = require('electron')

function sendToRenderer(channel: string, data: any): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data)
  }
}

export function registerCronIPCHandlers(getRoot: () => string | null): void {
  projectRootGetter = getRoot

  // Start scheduler
  scheduler = new CronScheduler({
    getProjectRoot: getRoot,
    spawnCliProcess,
    onTaskFired: (run: TaskRun) => {
      sendToRenderer('cron:onTaskFired', run)
    },
    onRunCompleted: (run: TaskRun) => {
      sendToRenderer('cron:onRunCompleted', run)
      // Desktop notification
      const statusText = run.status === 'completed' ? '执行成功' : run.status === 'failed' ? '执行失败' : '执行超时'
      const durationText = run.durationMs ? ` (${Math.round(run.durationMs / 1000)}s)` : ''
      try {
        new Notification({
          title: run.taskName,
          body: `${statusText}${durationText}`,
        }).show()
      } catch {}
    },
  })
  scheduler.start()

  // IPC Handlers
  ipcMain.handle('cron:list', async (_event, projectRoot: string) => {
    return readCronTasks(projectRoot || getProjectRoot())
  })

  ipcMain.handle('cron:create', async (_event, projectRoot: string, task: Omit<CronTask, 'id' | 'createdAt'>) => {
    if (!isValidCron(task.cron)) throw new Error(`Invalid cron expression: ${task.cron}`)
    return addCronTask(task, projectRoot || getProjectRoot())
  })

  ipcMain.handle('cron:update', async (_event, projectRoot: string, id: string, updates: Partial<CronTask>) => {
    if (updates.cron && !isValidCron(updates.cron)) throw new Error(`Invalid cron expression: ${updates.cron}`)
    return updateCronTask(id, updates, projectRoot || getProjectRoot())
  })

  ipcMain.handle('cron:delete', async (_event, projectRoot: string, id: string) => {
    return deleteCronTask(id, projectRoot || getProjectRoot())
  })

  ipcMain.handle('cron:run', async (_event, projectRoot: string, id: string) => {
    const root = projectRoot || getProjectRoot()
    if (!root) throw new Error('No project root')
    const tasks = await readCronTasks(root)
    const task = tasks.find(t => t.id === id)
    if (!task) throw new Error(`Task ${id} not found`)
    return scheduler!.executeTask(task, root)
  })

  ipcMain.handle('cron:runs', async (_event, projectRoot: string, limit?: number) => {
    return getRecentRuns(projectRoot || getProjectRoot(), limit)
  })

  ipcMain.handle('cron:taskRuns', async (_event, projectRoot: string, taskId: string) => {
    return getTaskRuns(taskId, projectRoot || getProjectRoot())
  })

  ipcMain.handle('cron:validate', async (_event, cron: string) => {
    const valid = isValidCron(cron)
    if (valid) return { valid: true }
    return { valid: false, error: `Invalid cron expression: ${cron}` }
  })

  ipcMain.handle('cron:describe', async (_event, cron: string) => {
    return cronToHuman(cron)
  })

  // Cleanup on app quit
  app.on('before-quit', () => {
    scheduler?.stop()
  })
}
```

- [ ] **步骤 2：修改 electron/main.ts**

在 import 区域添加：
```typescript
import { registerCronIPCHandlers } from './cronService'
```

在 `app.whenReady().then(...)` 回调中，`registerAgentsIPCHandlers()` 之后添加：
```typescript
registerCronIPCHandlers(() => /* project root getter */)
info('Startup', 'Cron IPC handlers registered')
```

- [ ] **步骤 3：Commit**

```bash
git add electron/cronService.ts electron/main.ts
git commit -m "feat(cron): add IPC service layer and integrate with main process"
```

---

## 任务 6：Preload + electronAPI 桥接

**文件：**
- 修改：`electron/preload.ts` — 添加 `cron` 命名空间
- 修改：`src/services/electronAPI.ts` — 添加 `cron` API 封装

- [ ] **步骤 1：修改 preload.ts**

在 `contextBridge.exposeInMainWorld('electronAPI', {` 的闭合 `})` 之前，添加 `cron` 命名空间：

```typescript
// Cron API
cron: {
  list: (projectRoot: string) => ipcRenderer.invoke('cron:list', projectRoot),
  create: (projectRoot: string, task: any) => ipcRenderer.invoke('cron:create', projectRoot, task),
  update: (projectRoot: string, id: string, updates: any) => ipcRenderer.invoke('cron:update', projectRoot, id, updates),
  delete: (projectRoot: string, id: string) => ipcRenderer.invoke('cron:delete', projectRoot, id),
  run: (projectRoot: string, id: string) => ipcRenderer.invoke('cron:run', projectRoot, id),
  runs: (projectRoot: string, limit?: number) => ipcRenderer.invoke('cron:runs', projectRoot, limit),
  taskRuns: (projectRoot: string, taskId: string) => ipcRenderer.invoke('cron:taskRuns', projectRoot, taskId),
  validate: (cron: string) => ipcRenderer.invoke('cron:validate', cron),
  describe: (cron: string) => ipcRenderer.invoke('cron:describe', cron),
  onTaskFired: (callback: (data: any) => void) => {
    const wrapper = (_: any, data: any) => callback(data)
    ipcRenderer.on('cron:onTaskFired', wrapper)
    return () => ipcRenderer.removeListener('cron:onTaskFired', wrapper)
  },
  onRunCompleted: (callback: (data: any) => void) => {
    const wrapper = (_: any, data: any) => callback(data)
    ipcRenderer.on('cron:onRunCompleted', wrapper)
    return () => ipcRenderer.removeListener('cron:onRunCompleted', wrapper)
  },
},
```

- [ ] **步骤 2：修改 electronAPI.ts**

在 `api` 对象中添加 `cron` 命名空间（参照 `git` 的完整包装模式）：

```typescript
cron: {
  list: (projectRoot: string): Promise<any[]> =>
    electronAPI?.cron?.list(projectRoot) || Promise.resolve([]),
  create: (projectRoot: string, task: any): Promise<any> =>
    electronAPI?.cron?.create(projectRoot, task) || Promise.resolve(null),
  update: (projectRoot: string, id: string, updates: any): Promise<void> =>
    electronAPI?.cron?.update(projectRoot, id, updates) || Promise.resolve(),
  delete: (projectRoot: string, id: string): Promise<void> =>
    electronAPI?.cron?.delete(projectRoot, id) || Promise.resolve(),
  run: (projectRoot: string, id: string): Promise<any> =>
    electronAPI?.cron?.run(projectRoot, id) || Promise.resolve(null),
  runs: (projectRoot: string, limit?: number): Promise<any[]> =>
    electronAPI?.cron?.runs(projectRoot, limit) || Promise.resolve([]),
  taskRuns: (projectRoot: string, taskId: string): Promise<any[]> =>
    electronAPI?.cron?.taskRuns(projectRoot, taskId) || Promise.resolve([]),
  validate: (cron: string): Promise<{ valid: boolean; error?: string }> =>
    electronAPI?.cron?.validate(cron) || Promise.resolve({ valid: false, error: 'Cron API not available' }),
  describe: (cron: string): Promise<string> =>
    electronAPI?.cron?.describe(cron) || Promise.resolve(cron),
  onTaskFired: (callback: (data: any) => void): (() => void) | null =>
    electronAPI?.cron?.onTaskFired(callback) || null,
  onRunCompleted: (callback: (data: any) => void): (() => void) | null =>
    electronAPI?.cron?.onRunCompleted(callback) || null,
},
```

- [ ] **步骤 3：Commit**

```bash
git add electron/preload.ts src/services/electronAPI.ts
git commit -m "feat(cron): add IPC bridge in preload and electronAPI"
```

---

## 任务 7：Pinia Store

**文件：**
- 创建：`src/stores/cron.ts`

- [ ] **步骤 1：实现 useCronStore**

```typescript
// src/stores/cron.ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/services/electronAPI'

export interface CronTask {
  id: string
  cron: string
  prompt: string
  createdAt: number
  lastFiredAt?: number
  recurring?: boolean
  permanent?: boolean
  name?: string
  description?: string
  enabled?: boolean
  frequency?: string
  scheduledTime?: string
}

export interface TaskRun {
  id: string
  taskId: string
  taskName: string
  startedAt: string
  completedAt?: string
  status: 'running' | 'completed' | 'failed' | 'timeout'
  prompt: string
  output?: string
  error?: string
  durationMs?: number
  sessionId?: string
}

export const useCronStore = defineStore('cron', () => {
  const tasks = ref<CronTask[]>([])
  const recentRuns = ref<TaskRun[]>([])
  const taskRunsMap = ref<Record<string, TaskRun[]>>({})
  const loading = ref(false)
  const error = ref<string | null>(null)
  const expandedTaskId = ref<string | null>(null)

  // Statistics
  const totalCount = computed(() => tasks.value.length)
  const enabledCount = computed(() => tasks.value.filter(t => t.enabled !== false).length)
  const disabledCount = computed(() => tasks.value.filter(t => t.enabled === false).length)
  const oneShotCount = computed(() => tasks.value.filter(t => !t.recurring).length)

  async function fetchTasks(projectRoot: string) {
    loading.value = true
    error.value = null
    try {
      tasks.value = await api.cron.list(projectRoot)
    } catch (e: any) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  async function createTask(projectRoot: string, input: Omit<CronTask, 'id' | 'createdAt'>) {
    const task = await api.cron.create(projectRoot, input)
    tasks.value.push(task)
    return task
  }

  async function updateTask(projectRoot: string, id: string, updates: Partial<CronTask>) {
    await api.cron.update(projectRoot, id, updates)
    const idx = tasks.value.findIndex(t => t.id === id)
    if (idx !== -1) tasks.value[idx] = { ...tasks.value[idx], ...updates }
  }

  async function deleteTask(projectRoot: string, id: string) {
    await api.cron.delete(projectRoot, id)
    tasks.value = tasks.value.filter(t => t.id !== id)
  }

  async function toggleTask(projectRoot: string, id: string, enabled: boolean) {
    await updateTask(projectRoot, id, { enabled })
  }

  async function runTaskNow(projectRoot: string, id: string) {
    return api.cron.run(projectRoot, id)
  }

  async function fetchRecentRuns(projectRoot: string, limit?: number) {
    recentRuns.value = await api.cron.runs(projectRoot, limit)
  }

  async function fetchTaskRuns(projectRoot: string, taskId: string) {
    const runs = await api.cron.taskRuns(projectRoot, taskId)
    taskRunsMap.value[taskId] = runs
  }

  async function validateCron(cron: string) {
    return api.cron.validate(cron)
  }

  async function describeCron(cron: string) {
    return api.cron.describe(cron)
  }

  function toggleExpanded(taskId: string) {
    expandedTaskId.value = expandedTaskId.value === taskId ? null : taskId
  }

  return {
    tasks,
    recentRuns,
    taskRunsMap,
    loading,
    error,
    expandedTaskId,
    totalCount,
    enabledCount,
    disabledCount,
    oneShotCount,
    fetchTasks,
    createTask,
    updateTask,
    deleteTask,
    toggleTask,
    runTaskNow,
    fetchRecentRuns,
    fetchTaskRuns,
    validateCron,
    describeCron,
    toggleExpanded,
  }
})
```

- [ ] **步骤 2：Commit**

```bash
git add src/stores/cron.ts
git commit -m "feat(cron): add Pinia store for cron task management"
```

---

## 任务 8：前端组件 — 入口集成 + CronManager + EmptyState

**文件：**
- 创建：`src/components/cron/CronManager.vue`
- 创建：`src/components/cron/CronEmptyState.vue`
- 修改：`src/stores/app.ts` — 添加 `showCronManager`
- 修改：`src/App.vue` — 添加 CronManager 条件渲染
- 修改：`src/components/layout/Sidebar.vue` — 添加 Clock 按钮

- [ ] **步骤 1：修改 app.ts**

在 `src/stores/app.ts` 第 112 行后添加：
```typescript
const showCronManager = ref(false)
```

在 return 块中 `showAgentManager,` 后添加：
```typescript
showCronManager,
```

- [ ] **步骤 2：修改 App.vue**

在 import 区域第 64 行后添加：
```typescript
import CronManager from './components/cron/CronManager.vue'
```

在模板第 31 行 `<McpManager v-else-if="appStore.showMCPManager" />` 后添加：
```html
<CronManager v-else-if="appStore.showCronManager" />
```

- [ ] **步骤 3：修改 Sidebar.vue**

在 lucide import 中添加 `Clock`。

在 Debug/Trace 按钮（第 75 行）后、spacer（第 77 行）前添加：
```html
<!-- Cron Tab -->
<button
  class="icon-btn"
  :class="{ active: appStore.showCronManager }"
  @click="handleOpenCron"
  :title="t('sidebar.cron')"
>
  <Clock :size="20" />
  <span class="icon-label">{{ t('sidebar.cron') }}</span>
</button>
```

在 handler 函数区域添加：
```typescript
function handleOpenCron() {
  appStore.showCronManager = true
}
```

- [ ] **步骤 4：创建 CronManager.vue**

```vue
<template>
  <div class="cron-manager">
    <CronEmptyState v-if="cronStore.tasks.length === 0 && !cronStore.loading" @create="showNewTaskModal = true" />
    <template v-else>
      <div class="cron-header">
        <div class="cron-header-left">
          <div class="cron-header-icon">
            <Clock :size="20" />
          </div>
          <div>
            <div class="cron-title">{{ t('cron.title') }}</div>
            <div class="cron-subtitle">{{ t('cron.subtitle') }}</div>
          </div>
        </div>
        <button class="btn-create" @click="showNewTaskModal = true">
          <Plus :size="16" />
          {{ t('cron.newTask') }}
        </button>
      </div>
      <CronTaskList />
    </template>
    <NewCronTaskModal v-model:visible="showNewTaskModal" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { Clock, Plus } from 'lucide-vue-next'
import { useCronStore } from '@/stores/cron'
import { useAppStore } from '@/stores/app'
import CronTaskList from './CronTaskList.vue'
import CronEmptyState from './CronEmptyState.vue'
import NewCronTaskModal from './NewCronTaskModal.vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const cronStore = useCronStore()
const appStore = useAppStore()
const showNewTaskModal = ref(false)

let unsubscribeFired: (() => void) | null = null
let unsubscribeCompleted: (() => void) | null = null

onMounted(async () => {
  const projectRoot = appStore.projectRoot
  if (projectRoot) {
    await cronStore.fetchTasks(projectRoot)
  }
  // Listen for real-time updates
  unsubscribeFired = api.cron.onTaskFired?.(() => {
    if (projectRoot) cronStore.fetchTasks(projectRoot)
  }) || null
  unsubscribeCompleted = api.cron.onRunCompleted?.(() => {
    if (projectRoot) cronStore.fetchTasks(projectRoot)
  }) || null
})

onUnmounted(() => {
  unsubscribeFired?.()
  unsubscribeCompleted?.()
})
</script>
```

- [ ] **步骤 5：创建 CronEmptyState.vue**

```vue
<template>
  <div class="cron-empty">
    <div class="empty-icon">
      <Clock :size="36" />
    </div>
    <div class="empty-title">{{ t('cron.emptyTitle') }}</div>
    <div class="empty-desc">{{ t('cron.emptyDesc') }}</div>
    <button class="btn-create-first" @click="$emit('create')">
      <Plus :size="18" />
      {{ t('cron.createFirst') }}
    </button>
    <div class="empty-examples">
      <div class="empty-examples-title">{{ t('cron.examples') }}</div>
      <div class="empty-example-item" v-for="ex in examples" :key="ex">
        <span class="empty-example-bullet">&#9656;</span>
        <span>{{ ex }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Clock, Plus } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

defineEmits<{ create: [] }>()

const { t } = useI18n()
const examples = [
  t('cron.example1'),
  t('cron.example2'),
  t('cron.example3'),
  t('cron.example4'),
]
</script>
```

- [ ] **步骤 6：Commit**

```bash
git add src/stores/app.ts src/App.vue src/components/layout/Sidebar.vue src/components/cron/CronManager.vue src/components/cron/CronEmptyState.vue
git commit -m "feat(cron): add CronManager entry point, empty state, and sidebar integration"
```

---

## 任务 9：前端组件 — TaskList + TaskRow + RunsPanel

**文件：**
- 创建：`src/components/cron/CronTaskList.vue`
- 创建：`src/components/cron/CronTaskRow.vue`
- 创建：`src/components/cron/CronRunsPanel.vue`

- [ ] **步骤 1：创建 CronTaskList.vue**

包含统计卡片行 + 筛选器 + 任务列表，使用 CSS 变量适配主题。样式从 `_temp/cron-ui-prototype.html` 中提取，转换为 scoped SCSS。

- [ ] **步骤 2：创建 CronTaskRow.vue**

包含状态点、名称、类型标签、频率描述、cron 表达式、下次触发时间、操作按钮（执行/记录/编辑/启禁/删除）。

- [ ] **步骤 3：创建 CronRunsPanel.vue**

在任务行下方展开的执行记录面板，显示历史执行记录（状态/时间/耗时/查看输出）。

- [ ] **步骤 4：Commit**

```bash
git add src/components/cron/CronTaskList.vue src/components/cron/CronTaskRow.vue src/components/cron/CronRunsPanel.vue
git commit -m "feat(cron): add task list, task row, and runs panel components"
```

---

## 任务 10：前端组件 — NewCronTaskModal

**文件：**
- 创建：`src/components/cron/NewCronTaskModal.vue`

- [ ] **步骤 1：创建 NewCronTaskModal.vue**

新建/编辑任务弹窗，包含：名称、描述、频率选择（6宫格）、时间选择、类型（循环/一次性）、提示词、cron 预览。使用 `api.cron.validate()` 和 `api.cron.describe()` 实时验证和描述 cron 表达式。

- [ ] **步骤 2：Commit**

```bash
git add src/components/cron/NewCronTaskModal.vue
git commit -m "feat(cron): add new task modal with cron builder and validation"
```

---

## 任务 11：i18n 国际化

**文件：**
- 修改：`src/locales/zh-CN.json` — 添加 cron 相关翻译
- 修改：`src/locales/en.json` — 添加 cron 相关翻译

- [ ] **步骤 1：添加中文翻译**

在 `zh-CN.json` 中添加 `cron` 命名空间下的所有翻译 key。

- [ ] **步骤 2：添加英文翻译**

在 `en.json` 中添加对应的英文翻译。

- [ ] **步骤 3：Commit**

```bash
git add src/locales/zh-CN.json src/locales/en.json
git commit -m "feat(cron): add i18n translations for cron feature"
```

---

## 任务 12：端到端验证

- [ ] **步骤 1：启动应用，验证侧边栏 Clock 图标可见且可点击**

- [ ] **步骤 2：点击 Clock 图标，验证 CronManager 面板显示空状态页**

- [ ] **步骤 3：点击"创建第一个任务"，验证弹窗打开，填写并创建任务**

- [ ] **步骤 4：验证任务列表显示新创建的任务，统计卡片更新**

- [ ] **步骤 5：验证操作按钮（执行/记录/编辑/启禁/删除）功能正常**

- [ ] **步骤 6：切换 4 套主题，验证 UI 适配正常**

- [ ] **步骤 7：运行全部测试**

```bash
npx vitest run
```

预期：所有测试通过

- [ ] **步骤 8：Final Commit**

```bash
git add -A
git commit -m "feat(cron): complete cron scheduled task system"
```
