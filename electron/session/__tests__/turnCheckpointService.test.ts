// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  listSessionTurnCheckpoints,
  getTurnRewindPreviewFiles,
  getTurnCheckpointDiff,
  getSessionFileDiff,
  rewindTurn,
} from '../turnCheckpointService'

// 会话目录定位走 os.homedir() 回退链，用部分 mock 顶掉 homedir，其余（tmpdir）保持真实。
const osState = vi.hoisted(() => ({ home: '' }))
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  const patched = { ...actual, homedir: () => osState.home }
  return { ...patched, default: patched }
})

vi.mock('../../infra/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

// ── Fixtures ───────────────────────────────────────────────────────

let tmpRoot = ''
let configHome = ''
let projectDir = ''
let savedXdg: string | undefined

/** claude 数据根：XDG_CONFIG_HOME/claude 优先，否则 homedir/.claude */
function claudeHome(): string {
  return process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, 'claude')
    : path.join(osState.home, '.claude')
}

/** 与源码同构的目录定位：realpath → NFC → 非字母数字全部替换成 '-' */
function projectSlug(p: string): string {
  return fs.realpathSync(p).normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-')
}

function sessionFile(p: string, sessionId: string): string {
  return path.join(claudeHome(), 'projects', projectSlug(p), `${sessionId}.jsonl`)
}

function backupDir(sessionId: string): string {
  return path.join(claudeHome(), 'file-history', sessionId)
}

function writeSession(entries: unknown[], p = projectDir, sessionId = 's1'): string {
  const file = sessionFile(p, sessionId)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n'), 'utf8')
  return file
}

function putBackup(sessionId: string, name: string, content: string): void {
  const dir = backupDir(sessionId)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), content, 'utf8')
}

function putWork(relPath: string, content: string): void {
  const full = path.join(projectDir, relPath)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content, 'utf8')
}

function backup(backupFileName: string | null, version = 1) {
  return { backupFileName, version, backupTime: '2026-01-01T00:00:00.000Z' }
}

function userMsg(uuid: string, content: unknown = [{ type: 'text', text: 'hi' }], timestamp?: string) {
  return {
    type: 'user',
    uuid,
    ...(timestamp ? { timestamp } : {}),
    message: { role: 'user', content },
  }
}

function assistantMsg(uuid: string) {
  return { type: 'assistant', uuid, message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }
}

function toolResultMsg(uuid: string) {
  return {
    type: 'user',
    uuid,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'done' }] },
  }
}

/** entry.messageId 是触发方的 uuid（与 user 消息无关），snapshot.messageId 才是本轮 user 消息 uuid */
function snapshot(userMsgId: string, tracked: Record<string, ReturnType<typeof backup>>, opts?: { triggerId?: string; isUpdate?: boolean }) {
  return {
    type: 'file-history-snapshot',
    messageId: opts?.triggerId ?? `trigger-${userMsgId}`,
    snapshot: {
      messageId: userMsgId,
      trackedFileBackups: tracked,
      timestamp: '2026-01-01T00:00:00.000Z',
    },
    isSnapshotUpdate: opts?.isUpdate ?? false,
  }
}

/**
 * 新版引擎的 trackEdit 条目：编辑前把原文件备份写进独立的 file-history-delta
 * （不再写 isSnapshotUpdate=true 的 snapshot 条目）。snapshotMessageId 指向本轮
 * user 消息 uuid；backup.backupFileName=null 表示编辑前文件不存在（新建）。
 */
function delta(userMsgId: string, trackingPath: string, backupFileName: string | null) {
  return {
    type: 'file-history-delta',
    messageId: `tool-${userMsgId}`,
    snapshotMessageId: userMsgId,
    trackingPath,
    backup: backup(backupFileName),
    timestamp: '2026-01-01T00:00:01.000Z',
  }
}

// ── Tests ──────────────────────────────────────────────────────────

describe('turnCheckpointService', () => {
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-ckpt-'))
    configHome = path.join(tmpRoot, 'cfg')
    projectDir = path.join(tmpRoot, 'proj')
    osState.home = path.join(tmpRoot, 'home')
    fs.mkdirSync(path.join(configHome, 'claude'), { recursive: true })
    fs.mkdirSync(projectDir, { recursive: true })
    savedXdg = process.env.XDG_CONFIG_HOME
    process.env.XDG_CONFIG_HOME = configHome
  })

  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = savedXdg
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  describe('会话定位与 JSONL 解析', () => {
    it('会话 JSONL 不存在时返回空数组', async () => {
      expect(await listSessionTurnCheckpoints('missing', projectDir)).toEqual([])
    })

    it('未设置 XDG_CONFIG_HOME 时回退到 homedir/.claude', async () => {
      delete process.env.XDG_CONFIG_HOME
      expect(os.homedir()).toBe(osState.home)
      fs.mkdirSync(claudeHome(), { recursive: true })

      writeSession([userMsg('u1'), assistantMsg('a1'), snapshot('u1', { 'a.ts': backup('b1') })])
      putBackup('s1', 'b1', 'x\ny\n')
      putWork('a.ts', 'x\nz\n')

      const result = await listSessionTurnCheckpoints('s1', projectDir)
      expect(result).toHaveLength(1)
    })

    it('CLAUDE_CONFIG_DIR 优先于 XDG_CONFIG_HOME（与引擎 envUtils.ts 对齐）', async () => {
      const customDir = path.join(tmpRoot, 'custom-claude')
      fs.mkdirSync(path.join(customDir, 'projects', projectSlug(projectDir)), { recursive: true })
      fs.mkdirSync(path.join(customDir, 'file-history', 's1'), { recursive: true })
      const file = path.join(customDir, 'projects', projectSlug(projectDir), 's1.jsonl')
      fs.writeFileSync(
        file,
        [
          JSON.stringify(userMsg('u1')),
          JSON.stringify(assistantMsg('a1')),
          JSON.stringify(snapshot('u1', { 'a.ts': backup('b1') })),
        ].join('\n'),
        'utf8'
      )
      fs.writeFileSync(path.join(customDir, 'file-history', 's1', 'b1'), 'x\n', 'utf8')
      putWork('a.ts', 'x\ny\n')

      const savedConfigDir = process.env.CLAUDE_CONFIG_DIR
      process.env.CLAUDE_CONFIG_DIR = customDir
      try {
        // XDG_CONFIG_HOME 仍指向 configHome，但必须被 CLAUDE_CONFIG_DIR 覆盖
        const result = await listSessionTurnCheckpoints('s1', projectDir)
        expect(result).toHaveLength(1)
      } finally {
        if (savedConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
        else process.env.CLAUDE_CONFIG_DIR = savedConfigDir
      }
    })

    it('会话没有任何真实用户输入时返回空数组', async () => {
      writeSession([assistantMsg('a1'), toolResultMsg('tr1')])
      expect(await listSessionTurnCheckpoints('s1', projectDir)).toEqual([])
    })

    it('跳过 JSONL 里的空行与损坏行，其余条目照常解析', async () => {
      const file = writeSession([userMsg('u1'), assistantMsg('a1'), snapshot('u1', { 'a.ts': backup('b1') })])
      fs.appendFileSync(file, '\n\n{ this is not json }\n', 'utf8')
      putBackup('s1', 'b1', 'x\ny\n')
      putWork('a.ts', 'x\nz\n')

      expect(await listSessionTurnCheckpoints('s1', projectDir)).toHaveLength(1)
    })

    it('有用户消息但没有任何快照时返回空数组', async () => {
      writeSession([userMsg('u1'), assistantMsg('a1')])
      expect(await listSessionTurnCheckpoints('s1', projectDir)).toEqual([])
    })
  })

  describe('真实用户输入的判定（tool_result 不占轮次序号）', () => {
    it('tool_result 消息不消耗 userMessageIndex，第二轮仍能对上快照', async () => {
      writeSession([
        userMsg('u1'),
        assistantMsg('a1'),
        toolResultMsg('tr1'),
        userMsg('u2'),
        assistantMsg('a2'),
        snapshot('u1', { 'a.ts': backup('b1') }),
        snapshot('u2', { 'a.ts': backup('b2') }, { isUpdate: true }),
      ])
      putBackup('s1', 'b1', 'x\n')
      putBackup('s1', 'b2', 'x\ny\n')
      putWork('a.ts', 'x\ny\nz\n')

      const result = await listSessionTurnCheckpoints('s1', projectDir)
      expect(result.map((c) => c.target.userMessageIndex)).toEqual([0, 1])
      expect(result.map((c) => c.target.targetUserMessageId)).toEqual(['u1', 'u2'])
      expect(result[0].target.userMessageCount).toBe(2)
    })

    it('content 为字符串与空数组的用户消息都算真实输入', async () => {
      writeSession([
        userMsg('u1', 'plain string'),
        assistantMsg('a1'),
        userMsg('u2', []),
        assistantMsg('a2'),
        snapshot('u1', { 'a.ts': backup('b1') }),
        snapshot('u2', { 'a.ts': backup('b2') }),
      ])
      putBackup('s1', 'b1', 'x\n')
      putBackup('s1', 'b2', 'x\ny\n')
      putWork('a.ts', 'x\ny\nz\n')

      const result = await listSessionTurnCheckpoints('s1', projectDir)
      expect(result.map((c) => c.target.userMessageIndex)).toEqual([0, 1])
    })

    it('混合 content 里只要有一个非 tool_result block 就算真实输入', async () => {
      writeSession([
        userMsg('u1', [
          { type: 'tool_result', tool_use_id: 't1', content: 'x' },
          { type: 'text', text: '继续' },
        ]),
        assistantMsg('a1'),
        snapshot('u1', { 'a.ts': backup('b1') }),
      ])
      putBackup('s1', 'b1', 'x\n')
      putWork('a.ts', 'x\ny\n')

      expect(await listSessionTurnCheckpoints('s1', projectDir)).toHaveLength(1)
    })

    it('没有 assistant 响应的最后一轮不出检查点卡片', async () => {
      writeSession([userMsg('u1'), assistantMsg('a1'), userMsg('u2'), snapshot('u1', { 'a.ts': backup('b1') }), snapshot('u2', { 'a.ts': backup('b2') })])
      putBackup('s1', 'b1', 'x\n')
      putBackup('s1', 'b2', 'x\ny\n')
      putWork('a.ts', 'x\ny\nz\n')

      const result = await listSessionTurnCheckpoints('s1', projectDir)
      expect(result.map((c) => c.target.targetUserMessageId)).toEqual(['u1'])
    })

    it('缺少任何 id 的用户消息不参与计数', async () => {
      writeSession([
        { type: 'user', message: { role: 'user', content: 'no id' } },
        userMsg('u1'),
        assistantMsg('a1'),
        snapshot('u1', { 'a.ts': backup('b1') }),
      ])
      putBackup('s1', 'b1', 'x\n')
      putWork('a.ts', 'x\ny\n')

      const result = await listSessionTurnCheckpoints('s1', projectDir)
      expect(result[0].target.userMessageIndex).toBe(0)
      expect(result[0].target.userMessageCount).toBe(1)
    })

    it('回退取 messageId / message.id 作为用户消息 id', async () => {
      writeSession([
        { type: 'user', messageId: 'm1', message: { role: 'user', content: 'x' } },
        assistantMsg('a1'),
        snapshot('m1', { 'a.ts': backup('b1') }),
      ])
      putBackup('s1', 'b1', 'x\n')
      putWork('a.ts', 'x\ny\n')

      const result = await listSessionTurnCheckpoints('s1', projectDir)
      expect(result[0].target.targetUserMessageId).toBe('m1')
    })

    it('turnStartedAt 解析 ISO 时间戳，坏时间戳与缺失时为 undefined', async () => {
      writeSession([
        userMsg('u1', [{ type: 'text', text: 'x' }], '2026-03-04T05:06:07.000Z'),
        assistantMsg('a1'),
        userMsg('u2', [{ type: 'text', text: 'y' }], 'not-a-date'),
        assistantMsg('a2'),
        snapshot('u1', { 'a.ts': backup('b1') }),
        snapshot('u2', { 'a.ts': backup('b2') }),
      ])
      putBackup('s1', 'b1', 'x\n')
      putBackup('s1', 'b2', 'x\ny\n')
      putWork('a.ts', 'x\ny\nz\n')

      const result = await listSessionTurnCheckpoints('s1', projectDir)
      expect(result[0].target.turnStartedAt).toBe(Date.parse('2026-03-04T05:06:07.000Z'))
      expect(result[1].target.turnStartedAt).toBeUndefined()
    })
  })

  describe('快照聚合与目标匹配', () => {
    it('同一轮的多条快照只保留最后一条（累积态）', async () => {
      writeSession([
        userMsg('u1'),
        assistantMsg('a1'),
        snapshot('u1', { 'a.ts': backup('early') }, { isUpdate: false }),
        snapshot('u1', { 'a.ts': backup('early'), 'b.ts': backup('late') }, { isUpdate: true }),
      ])
      putBackup('s1', 'early', 'x\ny\n')
      putBackup('s1', 'late', 'p\nq\n')
      putWork('a.ts', 'x\ny\n')
      putWork('b.ts', 'p\nr\n')

      const result = await listSessionTurnCheckpoints('s1', projectDir)
      expect(result).toHaveLength(1)
      // 生效的是 update 条目：a.ts 无变化被过滤，仅剩 b.ts
      expect(result[0].code.filesChanged).toEqual([{ path: 'b.ts', insertions: 1, deletions: 1 }])
      expect(result[0].code.insertions).toBe(1)
      expect(result[0].code.deletions).toBe(1)
    })

    it('丢弃没有 snapshot.messageId 的条目', async () => {
      writeSession([
        userMsg('u1'),
        assistantMsg('a1'),
        { type: 'file-history-snapshot', messageId: 'x', snapshot: { trackedFileBackups: {} }, isSnapshotUpdate: false },
        snapshot('u1', { 'a.ts': backup('b1') }),
      ])
      putBackup('s1', 'b1', 'x\n')
      putWork('a.ts', 'x\ny\n')

      const result = await listSessionTurnCheckpoints('s1', projectDir)
      expect(result).toHaveLength(1)
    })

    it('精确 id 匹配失败时按 userMessageIndex 回退命中', async () => {
      writeSession([
        userMsg('frontend-id-1'),
        assistantMsg('a1'),
        snapshot('engine-uuid-1', { 'a.ts': backup('b1') }),
      ])
      putBackup('s1', 'b1', 'x\n')
      putWork('a.ts', 'x\ny\n')

      const result = await listSessionTurnCheckpoints('s1', projectDir)
      expect(result).toHaveLength(1)
      expect(result[0].target.targetUserMessageId).toBe('frontend-id-1')
    })

    it('轮次数超过快照数时，越界的轮次被跳过', async () => {
      writeSession([
        userMsg('u1'),
        assistantMsg('a1'),
        userMsg('u2'),
        assistantMsg('a2'),
        snapshot('other', { 'a.ts': backup('b1') }),
      ])
      putBackup('s1', 'b1', 'x\n')
      putWork('a.ts', 'x\ny\n')

      // u1 走索引回退命中唯一快照；u2 索引 1 越界 → 无快照 → 不产出
      const result = await listSessionTurnCheckpoints('s1', projectDir)
      expect(result.map((c) => c.target.targetUserMessageId)).toEqual(['u1'])
    })

    it('该轮文件内容与备份完全相同（无变化）时不产出检查点', async () => {
      writeSession([userMsg('u1'), assistantMsg('a1'), snapshot('u1', { 'a.ts': backup('b1') })])
      putBackup('s1', 'b1', 'x\ny\n')
      putWork('a.ts', 'x\ny\n')

      expect(await listSessionTurnCheckpoints('s1', projectDir)).toEqual([])
    })

    it('跟踪路径为绝对路径时不再拼 workDir', async () => {
      const abs = path.join(projectDir, 'a.ts').normalize('NFC')
      writeSession([userMsg('u1'), assistantMsg('a1'), snapshot('u1', { [abs]: backup('b1') })])
      putBackup('s1', 'b1', 'x\n')
      putWork('a.ts', 'x\ny\n')

      const result = await listSessionTurnCheckpoints('s1', projectDir)
      expect(result[0].code.filesChanged[0].path).toBe(abs)
    })

    it('DEFECT 修复回归：历史轮次的增删方向与最新轮次一致', async () => {
      // 备份 = 本轮开始前的内容。u1 那轮把 a.ts 从 "x\n" 改成 "x\ny\n"（v1→v2 备份），
      // u2 轮又加了一行（v2→磁盘）。两个轮次的 diff 都应是正向新增。
      // 曾经的缺陷：历史分支把 before 取成下一快照、after 取成本快照，方向相反。
      writeSession([
        userMsg('u1'),
        assistantMsg('a1'),
        userMsg('u2'),
        assistantMsg('a2'),
        snapshot('u1', { 'a.ts': backup('v1') }),
        snapshot('u2', { 'a.ts': backup('v2') }),
      ])
      putBackup('s1', 'v1', 'x\n')
      putBackup('s1', 'v2', 'x\ny\n')
      putWork('a.ts', 'x\ny\nz\n')

      const result = await listSessionTurnCheckpoints('s1', projectDir)
      const historical = result.find((c) => c.target.targetUserMessageId === 'u1')
      const latest = result.find((c) => c.target.targetUserMessageId === 'u2')
      expect(historical?.code).toMatchObject({ insertions: 1, deletions: 0 })
      expect(latest?.code).toMatchObject({ insertions: 1, deletions: 0 })
    })

    it('新版引擎：file-history-delta 合并进对应轮次，开始快照为空也能产出检查点', async () => {
      // 真实引擎数据形态（2026-10 实测）：轮次开始快照 trackedFileBackups 为空，
      // 编辑前备份全部写在独立的 file-history-delta 条目里。若不合并 delta，
      // 该轮 trackedPaths 为空 → filesChanged 恒为空 → 检查点不产出（卡片不显示）。
      writeSession([
        userMsg('u1', [{ type: 'text', text: 'edit readme' }], '2026-10-13T06:28:33.929Z'),
        assistantMsg('a1'),
        snapshot('u1', {}),
        delta('u1', 'README.md', 'dc3dd03f1893a43f@v1'),
      ])
      putBackup('s1', 'dc3dd03f1893a43f@v1', 'old readme\n')
      putWork('README.md', 'old readme\nnew line\n')

      const result = await listSessionTurnCheckpoints('s1', projectDir)
      expect(result).toHaveLength(1)
      expect(result[0].code.filesChanged).toEqual([{ path: 'README.md', insertions: 1, deletions: 0 }])
      expect(result[0].target.turnStartedAt).toBe(Date.parse('2026-10-13T06:28:33.929Z'))
    })

    it('新版引擎：delta 的 null 备份（编辑前文件不存在）整份算新增', async () => {
      writeSession([
        userMsg('u1'),
        assistantMsg('a1'),
        snapshot('u1', {}),
        delta('u1', 'new.ts', null),
      ])
      putWork('new.ts', 'a\nb\n')

      const result = await listSessionTurnCheckpoints('s1', projectDir)
      expect(result).toHaveLength(1)
      expect(result[0].code.filesChanged).toEqual([{ path: 'new.ts', insertions: 2, deletions: 0 }])
    })

    it('新版引擎：历史轮次的 delta 与下一轮快照备份对比出该轮改动', async () => {
      // u1 轮新建 README（delta 备份为 null）并写入两行；u2 轮开始快照记录了
      // u1 结束后的状态（v2 备份）。u1 的 diff 应为整份新增。
      writeSession([
        userMsg('u1'),
        assistantMsg('a1'),
        userMsg('u2'),
        assistantMsg('a2'),
        snapshot('u1', {}),
        delta('u1', 'README.md', null),
        snapshot('u2', { 'README.md': backup('readme@v2') }),
      ])
      putBackup('s1', 'readme@v2', 'line1\nline2\n')
      putWork('README.md', 'line1\nline2\nline3\n')

      const result = await listSessionTurnCheckpoints('s1', projectDir)
      const turn1 = result.find((c) => c.target.targetUserMessageId === 'u1')
      const turn2 = result.find((c) => c.target.targetUserMessageId === 'u2')
      expect(turn1?.code).toMatchObject({ insertions: 2, deletions: 0 })
      expect(turn2?.code).toMatchObject({ insertions: 1, deletions: 0 })
    })
  })

  describe('getTurnRewindPreviewFiles', () => {
    it('会话文件缺失 → ok:false + Session file not found', async () => {
      expect(await getTurnRewindPreviewFiles('nope', projectDir, 'u1')).toEqual({
        ok: false,
        files: [],
        error: 'Session file not found',
      })
    })

    it('找不到目标快照 → ok:true + 空列表', async () => {
      writeSession([userMsg('u1'), assistantMsg('a1')])
      expect(await getTurnRewindPreviewFiles('s1', projectDir, 'u1')).toEqual({ ok: true, files: [], error: null })
    })

    it('返回该轮实际变化的文件路径', async () => {
      writeSession([
        userMsg('u1'),
        assistantMsg('a1'),
        snapshot('u1', { 'a.ts': backup('b1'), 'b.ts': backup('b2') }),
      ])
      putBackup('s1', 'b1', 'x\n')
      putBackup('s1', 'b2', 'same\n')
      putWork('a.ts', 'x\ny\n')
      putWork('b.ts', 'same\n')

      const result = await getTurnRewindPreviewFiles('s1', projectDir, 'u1')
      expect(result).toEqual({ ok: true, files: ['a.ts'], error: null })
    })

    it('传入 userMessageIndex 时可命中引擎 uuid 的快照', async () => {
      writeSession([userMsg('frontend-1'), assistantMsg('a1'), snapshot('engine-1', { 'a.ts': backup('b1') })])
      putBackup('s1', 'b1', 'x\n')
      putWork('a.ts', 'x\ny\n')

      const result = await getTurnRewindPreviewFiles('s1', projectDir, 'frontend-1', 0)
      expect(result.files).toEqual(['a.ts'])
    })
  })

  describe('getTurnCheckpointDiff', () => {
    it('会话缺失 → state error', async () => {
      expect(await getTurnCheckpointDiff('nope', projectDir, 'u1', 'a.ts')).toEqual({
        state: 'error',
        path: 'a.ts',
        error: 'Session file not found',
      })
    })

    it('无快照 → missing No snapshot found', async () => {
      writeSession([userMsg('u1'), assistantMsg('a1')])
      const result = await getTurnCheckpointDiff('s1', projectDir, 'u1', 'a.ts')
      expect(result.state).toBe('missing')
      expect(result.error).toBe('No snapshot found for target message')
    })

    it('文件不在该轮跟踪列表 → missing File not found in snapshot', async () => {
      writeSession([userMsg('u1'), assistantMsg('a1'), snapshot('u1', { 'a.ts': backup('b1') })])
      const result = await getTurnCheckpointDiff('s1', projectDir, 'u1', 'other.ts')
      expect(result.state).toBe('missing')
      expect(result.error).toBe('File not found in snapshot')
    })

    it('最新一轮：备份对磁盘，产出带 diff --git 头部的 hunk', async () => {
      writeSession([userMsg('u1'), assistantMsg('a1'), snapshot('u1', { 'a.ts': backup('b1') })])
      putBackup('s1', 'b1', 'one\ntwo\n')
      putWork('a.ts', 'one\nTWO\nthree\n')

      const result = await getTurnCheckpointDiff('s1', projectDir, 'u1', 'a.ts')
      expect(result.state).toBe('ok')
      expect(result.diff!.startsWith('diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n')).toBe(true)
      expect(result.diff).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/)
      expect(result.diff).toContain('-two')
      expect(result.diff).toContain('+TWO')
      expect(result.diff).toContain('+three')
    })

    it('绝对路径与 workDir 拼接后等价也能匹配跟踪键', async () => {
      const abs = path.join(projectDir, 'a.ts').normalize('NFC')
      writeSession([userMsg('u1'), assistantMsg('a1'), snapshot('u1', { 'a.ts': backup('b1') })])
      putBackup('s1', 'b1', 'one\n')
      putWork('a.ts', 'two\n')

      const result = await getTurnCheckpointDiff('s1', projectDir, 'u1', abs)
      expect(result.state).toBe('ok')
      expect(result.path).toBe(abs)
    })

    it('无差异内容 → missing No diff content available', async () => {
      writeSession([userMsg('u1'), assistantMsg('a1'), snapshot('u1', { 'a.ts': backup('b1') })])
      putBackup('s1', 'b1', 'same\n')
      putWork('a.ts', 'same\n')

      const result = await getTurnCheckpointDiff('s1', projectDir, 'u1', 'a.ts')
      expect(result.state).toBe('missing')
      expect(result.error).toBe('No diff content available')
    })

    it('本轮新建的文件（备份为 null）整份算新增', async () => {
      writeSession([userMsg('u1'), assistantMsg('a1'), snapshot('u1', { 'new.ts': backup(null) })])
      putWork('new.ts', 'a\nb\nc\n')

      const result = await getTurnCheckpointDiff('s1', projectDir, 'u1', 'new.ts')
      expect(result.state).toBe('ok')
      expect(result.diff).toContain('+a')
      const removedBody = (result.diff ?? '').split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'))
      expect(removedBody).toEqual([])
    })

    it('历史轮次：本快照备份为 before、下一快照备份为 after', async () => {
      // u1 轮把 a.ts 从 "x\n" 改成 "x\ny\n"，正向 diff 应包含 +y
      writeSession([
        userMsg('u1'),
        assistantMsg('a1'),
        userMsg('u2'),
        assistantMsg('a2'),
        snapshot('u1', { 'a.ts': backup('v1') }),
        snapshot('u2', { 'a.ts': backup('v2') }),
      ])
      putBackup('s1', 'v1', 'x\n')
      putBackup('s1', 'v2', 'x\ny\n')

      const result = await getTurnCheckpointDiff('s1', projectDir, 'u1', 'a.ts')
      expect(result.state).toBe('ok')
      expect(result.diff).toContain('+y')
    })

    it('上下文行数封顶 3 行', async () => {
      const before = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n') + '\n'
      const after = before.replace('line10', 'LINE10')
      writeSession([userMsg('u1'), assistantMsg('a1'), snapshot('u1', { 'a.ts': backup('b1') })])
      putBackup('s1', 'b1', before)
      putWork('a.ts', after)

      const result = await getTurnCheckpointDiff('s1', projectDir, 'u1', 'a.ts')
      const contextLines = (result.diff ?? '').split('\n').filter((l) => l.startsWith(' line'))
      expect(contextLines.length).toBeLessThanOrEqual(6)
      expect(contextLines.length).toBeGreaterThan(0)
      expect(result.diff).toContain('-line10')
      expect(result.diff).toContain('+LINE10')
    })

    it('磁盘文件已消失时全部算删除', async () => {
      writeSession([userMsg('u1'), assistantMsg('a1'), snapshot('u1', { 'a.ts': backup('b1') })])
      putBackup('s1', 'b1', 'x\ny\n')

      const result = await getTurnCheckpointDiff('s1', projectDir, 'u1', 'a.ts')
      expect(result.state).toBe('ok')
      expect(result.diff).toContain('-x')
      expect(result.diff).toContain('-y')
    })

    it('下一轮快照没再跟踪该文件 → after 回落磁盘，而不是渲染成整文件删除', async () => {
      // buildTurnCodePreview 一直有磁盘兜底，getTurnCheckpointDiff 原来没有：
      // 缺键时 after 被读成 null，本轮只改了两行的文件会出现一片红色删除。
      writeSession([
        userMsg('u1'),
        assistantMsg('a1'),
        userMsg('u2'),
        assistantMsg('a2'),
        snapshot('u1', { 'a.ts': backup('v1') }),
        snapshot('u2', {}),
      ])
      putBackup('s1', 'v1', 'one\ntwo\n')
      putWork('a.ts', 'one\nTWO\n')

      const result = await getTurnCheckpointDiff('s1', projectDir, 'u1', 'a.ts')
      expect(result.state).toBe('ok')
      expect(result.diff).toContain('-two')
      expect(result.diff).toContain('+TWO')
      expect(result.diff).not.toContain('-one')
    })
  })

  describe('getSessionFileDiff', () => {
    it('会话 JSONL 不存在 → state error', async () => {
      expect(await getSessionFileDiff('nope', projectDir, 'a.ts')).toEqual({
        state: 'error',
        path: 'a.ts',
        error: 'Session file not found',
      })
    })

    it('本会话没写过该文件 → no_evidence', async () => {
      writeSession([userMsg('u1'), assistantMsg('a1'), snapshot('u1', { 'a.ts': backup('b1') })])
      putBackup('s1', 'b1', 'x\n')
      putWork('a.ts', 'y\n')

      expect((await getSessionFileDiff('s1', projectDir, 'other.ts')).state).toBe('no_evidence')
    })

    it('仓库外绝对路径：备份对磁盘出真 diff，全程不查 git', async () => {
      const outside = path.join(tmpRoot, 'memory', 'MEMORY.md').normalize('NFC')
      // 引擎把绝对路径原样写进 trackingPath，且带本机分隔符
      writeSession([userMsg('u1'), assistantMsg('a1'), delta('u1', outside, 'mb1')])
      putBackup('s1', 'mb1', 'one\ntwo\n')
      fs.mkdirSync(path.dirname(outside), { recursive: true })
      fs.writeFileSync(outside, 'one\nTWO\n', 'utf8')

      const result = await getSessionFileDiff('s1', projectDir, outside.replace(/\\/g, '/'))
      expect(result.state).toBe('ok')
      expect(result.diff).toContain('-two')
      expect(result.diff).toContain('+TWO')
    })

    it('盘符大小写不一致时仍能匹配跟踪键', async () => {
      const abs = path.join(projectDir, 'a.ts').normalize('NFC')
      const flipped = abs.replace(/^[a-zA-Z]/, c => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()))
      writeSession([userMsg('u1'), assistantMsg('a1'), delta('u1', abs, 'b1')])
      putBackup('s1', 'b1', 'x\n')
      putWork('a.ts', 'y\n')

      const result = await getSessionFileDiff('s1', projectDir, flipped.replace(/\\/g, '/'))
      expect(result.state).toBe('ok')
      expect(result.diff).toContain('+y')
    })

    it('before 取会话第一次动手前的状态，不是最近一轮', async () => {
      writeSession([
        userMsg('u1'),
        assistantMsg('a1'),
        userMsg('u2'),
        assistantMsg('a2'),
        snapshot('u1', { 'a.ts': backup('v1') }),
        snapshot('u2', { 'a.ts': backup('v2') }),
      ])
      putBackup('s1', 'v1', 'base\n')
      putBackup('s1', 'v2', 'middle\n')
      putWork('a.ts', 'final\n')

      const result = await getSessionFileDiff('s1', projectDir, 'a.ts')
      expect(result.state).toBe('ok')
      expect(result.diff).toContain('-base')
      expect(result.diff).toContain('+final')
      expect(result.diff).not.toContain('-middle')
    })

    it('本会话新建的文件整份算新增', async () => {
      writeSession([userMsg('u1'), assistantMsg('a1'), delta('u1', 'new.ts', null)])
      putWork('new.ts', 'a\nb\n')

      const result = await getSessionFileDiff('s1', projectDir, 'new.ts')
      expect(result.state).toBe('ok')
      expect(result.diff).toContain('+a')
      const removed = (result.diff ?? '').split('\n').filter(l => l.startsWith('-') && !l.startsWith('---'))
      expect(removed).toEqual([])
    })

    it('会话之后文件被删掉 → 整份算删除', async () => {
      writeSession([userMsg('u1'), assistantMsg('a1'), snapshot('u1', { 'a.ts': backup('b1') })])
      putBackup('s1', 'b1', 'x\ny\n')

      const result = await getSessionFileDiff('s1', projectDir, 'a.ts')
      expect(result.state).toBe('ok')
      expect(result.diff).toContain('-x')
      expect(result.diff).toContain('-y')
    })

    it('备份文件已被清理 → evidence_lost，不能冒充"编辑前不存在"的全新增', async () => {
      // 跟踪表记着 b1 但 file-history 目录不在：按 null 内容处理会把整个文件报成本会话新增
      writeSession([userMsg('u1'), assistantMsg('a1'), snapshot('u1', { 'a.ts': backup('b1') })])
      putWork('a.ts', 'x\ny\n')

      const result = await getSessionFileDiff('s1', projectDir, 'a.ts')
      expect(result.state).toBe('evidence_lost')
      expect(result.diff).toBeUndefined()
    })

    it('改动已被撤销（前后一致）→ no_evidence', async () => {
      writeSession([userMsg('u1'), assistantMsg('a1'), snapshot('u1', { 'a.ts': backup('b1') })])
      putBackup('s1', 'b1', 'same\n')
      putWork('a.ts', 'same\n')

      expect((await getSessionFileDiff('s1', projectDir, 'a.ts')).state).toBe('no_evidence')
    })
  })

  describe('rewindTurn', () => {
    it('会话缺失 → ok:false', async () => {
      expect(await rewindTurn('nope', projectDir, 'u1')).toEqual({ ok: false, error: 'Session file not found' })
    })

    it('找不到目标快照 → ok:false', async () => {
      writeSession([userMsg('u1'), assistantMsg('a1')])
      expect(await rewindTurn('s1', projectDir, 'u1')).toEqual({ ok: false, error: 'No snapshot found for target message' })
    })

    it('备份为 null 且文件存在 → 删除该文件', async () => {
      writeSession([userMsg('u1'), assistantMsg('a1'), snapshot('u1', { 'a.ts': backup(null) })])
      putWork('a.ts', 'created\n')

      expect(await rewindTurn('s1', projectDir, 'u1')).toEqual({ ok: true, error: null })
      expect(fs.existsSync(path.join(projectDir, 'a.ts'))).toBe(false)
    })

    it('备份为 null 且文件也不存在 → 计为跳过且不报错', async () => {
      writeSession([userMsg('u1'), assistantMsg('a1'), snapshot('u1', { 'gone.ts': backup(null) })])
      expect(await rewindTurn('s1', projectDir, 'u1')).toEqual({ ok: true, error: null })
    })

    it('内容与备份相同 → 跳过恢复', async () => {
      writeSession([userMsg('u1'), assistantMsg('a1'), snapshot('u1', { 'a.ts': backup('b1') })])
      putBackup('s1', 'b1', 'same\n')
      putWork('a.ts', 'same\n')

      expect(await rewindTurn('s1', projectDir, 'u1')).toEqual({ ok: true, error: null })
      expect(fs.readFileSync(path.join(projectDir, 'a.ts'), 'utf8')).toBe('same\n')
    })

    it('内容有差异 → 用备份覆盖当前文件', async () => {
      writeSession([userMsg('u1'), assistantMsg('a1'), snapshot('u1', { 'a.ts': backup('b1') })])
      putBackup('s1', 'b1', 'before\n')
      putWork('a.ts', 'after\n')

      expect(await rewindTurn('s1', projectDir, 'u1')).toEqual({ ok: true, error: null })
      expect(fs.readFileSync(path.join(projectDir, 'a.ts'), 'utf8')).toBe('before\n')
    })

    it('目标文件在子目录里且目录缺失 → 递归补建目录', async () => {
      writeSession([userMsg('u1'), assistantMsg('a1'), snapshot('u1', { 'src/deep/a.ts': backup('b1') })])
      putBackup('s1', 'b1', 'before\n')

      expect(await rewindTurn('s1', projectDir, 'u1')).toEqual({ ok: true, error: null })
      expect(fs.readFileSync(path.join(projectDir, 'src', 'deep', 'a.ts'), 'utf8')).toBe('before\n')
    })

    it('非最新轮次：用下一快照的备份判断当前内容，相同则跳过', async () => {
      writeSession([
        userMsg('u1'),
        assistantMsg('a1'),
        userMsg('u2'),
        assistantMsg('a2'),
        snapshot('u1', { 'a.ts': backup('v1') }),
        snapshot('u2', { 'a.ts': backup('v1') }),
      ])
      putBackup('s1', 'v1', 'x\n')
      putWork('a.ts', 'totally-different\n')

      expect(await rewindTurn('s1', projectDir, 'u1')).toEqual({ ok: true, error: null })
      expect(fs.readFileSync(path.join(projectDir, 'a.ts'), 'utf8')).toBe('totally-different\n')
    })

    it('非最新轮次：下一快照内容不同 → 恢复到本轮之前的状态', async () => {
      writeSession([
        userMsg('u1'),
        assistantMsg('a1'),
        userMsg('u2'),
        assistantMsg('a2'),
        snapshot('u1', { 'a.ts': backup('v1') }),
        snapshot('u2', { 'a.ts': backup('v2') }),
      ])
      putBackup('s1', 'v1', 'before-turn-1\n')
      putBackup('s1', 'v2', 'before-turn-2\n')
      putWork('a.ts', 'now\n')

      expect(await rewindTurn('s1', projectDir, 'u1')).toEqual({ ok: true, error: null })
      expect(fs.readFileSync(path.join(projectDir, 'a.ts'), 'utf8')).toBe('before-turn-1\n')
    })

    it('备份文件丢失 → 全部失败时 ok:false 并报告数量', async () => {
      writeSession([userMsg('u1'), assistantMsg('a1'), snapshot('u1', { 'a.ts': backup('gone') })])
      putWork('a.ts', 'now\n')

      expect(await rewindTurn('s1', projectDir, 'u1')).toEqual({ ok: false, error: 'Failed to restore all 1 files' })
    })

    it('部分失败时 ok:true 且 error 汇总失败数', async () => {
      writeSession([
        userMsg('u1'),
        assistantMsg('a1'),
        snapshot('u1', { 'a.ts': backup('b1'), 'b.ts': backup('missing-backup') }),
      ])
      putBackup('s1', 'b1', 'restore-a\n')
      putWork('a.ts', 'dirty-a\n')
      putWork('b.ts', 'dirty-b\n')

      expect(await rewindTurn('s1', projectDir, 'u1')).toEqual({ ok: true, error: '1 files could not be restored' })
      expect(fs.readFileSync(path.join(projectDir, 'a.ts'), 'utf8')).toBe('restore-a\n')
    })

    it('单个文件恢复抛错 → 计入失败而不中断整轮', async () => {
      // 'block' 被占成文件：其父目录 existsSync 为 true 但 copyFileSync 必抛 ENOTDIR
      putWork('block', 'i am a file\n')
      writeSession([userMsg('u1'), assistantMsg('a1'), snapshot('u1', { 'block/x.ts': backup('b1'), 'ok.ts': backup('b2') })])
      putBackup('s1', 'b1', 'restore\n')
      putBackup('s1', 'b2', 'restore-ok\n')
      putWork('ok.ts', 'dirty\n')

      const result = await rewindTurn('s1', projectDir, 'u1')
      expect(result).toEqual({ ok: true, error: '1 files could not be restored' })
      expect(fs.readFileSync(path.join(projectDir, 'ok.ts'), 'utf8')).toBe('restore-ok\n')
    })

    it('trackedFileBackups 为空对象时直接返回成功', async () => {
      writeSession([userMsg('u1'), assistantMsg('a1'), snapshot('u1', {})])
      expect(await rewindTurn('s1', projectDir, 'u1')).toEqual({ ok: true, error: null })
    })
  })
})
