import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Message, SessionTurnCheckpoint } from '@/types'

/**
 * Turn checkpoint / rewind 契约。
 *
 * Rewind 让用户把会话回滚到某个历史用户轮次（可选同时回滚代码）。核心风险点：
 *  - turnChangeCards 只应展示"代码确有改动且该轮已完成"的卡片：目标用户消息不存在、
 *    其后没有实质 assistant 回复（空消息 / 正在流式的初始态）都必须过滤掉，否则会
 *    把没跑完的轮次也标成可回滚。
 *  - loadTurnCheckpoints 后端返回 ok:false 或整个调用抛错时，必须清空卡片并落到可见的
 *    错误态，而不是残留上一份 checkpoints。
 *  - undoTurn 用 rewindingTurnId 互斥，成功后重新加载 checkpoints；失败要抛出交给 UI。
 *  - rewindSession 分 code / conversation / both 三条路径：代码回滚失败时 both 模式必须
 *    跳过对话回滚（避免只回滚一半），对话回滚要把最后一条用户消息内容存进 pendingInputText。
 * 这些断言直接读状态迁移与下发到 api.session 的真实参数。
 */

const mocks = vi.hoisted(() => ({
  getSessionStatus: vi.fn().mockResolvedValue({ isRunning: false }),
  startSession: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  resumeSession: vi.fn().mockResolvedValue(undefined),
  setPermissionMode: vi.fn().mockResolvedValue(undefined),
  listAllSessions: vi.fn().mockResolvedValue([]),
  getFullSession: vi.fn().mockResolvedValue({ messages: [] }),
  traceEvent: vi.fn(),
  getTurnCheckpoints: vi.fn(),
  getTurnRewindPreviewFiles: vi.fn(),
  getTurnCheckpointDiff: vi.fn(),
  rewindTurn: vi.fn(),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    claudeCode: {
      getSessionStatus: mocks.getSessionStatus,
      startSession: mocks.startSession,
      stop: mocks.stop,
      resumeSession: mocks.resumeSession,
      setPermissionMode: mocks.setPermissionMode,
      listAgents: vi.fn().mockResolvedValue([]),
      listAllSessions: mocks.listAllSessions,
      getFullSession: mocks.getFullSession,
    },
    image: null,
    trace: { event: mocks.traceEvent },
    session: {
      getTurnCheckpoints: mocks.getTurnCheckpoints,
      getTurnRewindPreviewFiles: mocks.getTurnRewindPreviewFiles,
      getTurnCheckpointDiff: mocks.getTurnCheckpointDiff,
      rewindTurn: mocks.rewindTurn,
    },
    getCwd: vi.fn().mockResolvedValue(''),
    injectGuiModelsToSettings: vi.fn().mockResolvedValue({ success: true }),
    loadGuiSettings: vi.fn().mockResolvedValue({ success: true, data: null }),
    saveGuiSettings: vi.fn().mockResolvedValue({ success: true }),
    getEnv: vi.fn().mockResolvedValue(undefined),
    notifyEngineSourceChanged: vi.fn().mockResolvedValue(undefined),
  },
}))

function checkpoint(
  targetUserMessageId: string,
  userMessageIndex: number,
  files: string[],
  available = true,
): SessionTurnCheckpoint {
  return {
    target: { targetUserMessageId, userMessageIndex, userMessageCount: userMessageIndex + 1 },
    code: {
      available,
      filesChanged: files.map(path => ({ path, insertions: 1, deletions: 0 })),
      insertions: files.length,
      deletions: 0,
    },
    workDir: '/repo',
  }
}

function user(id: string, content: string, ts: number): Message {
  return { id, role: 'user', content, timestamp: ts }
}
function assistant(id: string, content: string, ts: number, toolCalls?: Message['toolCalls']): Message {
  return { id, role: 'assistant', content, timestamp: ts, toolCalls }
}

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
  setActivePinia(createPinia())
  vi.clearAllMocks()
  mocks.getSessionStatus.mockResolvedValue({ isRunning: false })
  mocks.getTurnCheckpoints.mockResolvedValue({ ok: true, checkpoints: [], error: null })
  mocks.rewindTurn.mockResolvedValue({ ok: true, error: null })
  mocks.getTurnRewindPreviewFiles.mockResolvedValue({ ok: true, files: [], error: null })
})

async function loadStore() {
  const { useChatSessionStore } = await import('../chatSession')
  return useChatSessionStore()
}

function seedCurrentSession(messages: Message[]): void {
  localStorage.setItem('chat_sessions_v2', JSON.stringify([{
    id: 'sess-rw',
    title: 'seeded',
    messages,
    createdAt: 1,
    updatedAt: 2,
    lastActivityAt: 2,
    workingDirectory: '/repo',
    processStatus: 'none',
    isTabOpen: true,
  }]))
}

describe('chatSession loadTurnCheckpoints', () => {
  it('adopts the checkpoints returned by a successful load', async () => {
    const cps = [checkpoint('u1', 0, ['a.ts'])]
    mocks.getTurnCheckpoints.mockResolvedValueOnce({ ok: true, checkpoints: cps, error: null })
    seedCurrentSession([user('u1', 'go', 1), assistant('a1', 'did it', 2)])
    const store = await loadStore()

    await store.loadTurnCheckpoints('sess-rw')

    expect(store.turnCheckpoints).toEqual(cps)
    expect(store.turnCardsError).toBeNull()
    expect(store.isLoadingTurnCards).toBe(false)
    expect(mocks.getTurnCheckpoints).toHaveBeenCalledWith('sess-rw', '/repo')
  })

  it('clears the cards and surfaces an error when the backend reports failure', async () => {
    mocks.getTurnCheckpoints
      .mockResolvedValueOnce({ ok: true, checkpoints: [checkpoint('u1', 0, ['a.ts'])], error: null })
      .mockResolvedValueOnce({ ok: false, checkpoints: [], error: 'checkpoint index missing' })
    seedCurrentSession([user('u1', 'go', 1), assistant('a1', 'did it', 2)])
    const store = await loadStore()

    await store.loadTurnCheckpoints('sess-rw')
    expect(store.turnCheckpoints).toHaveLength(1)

    await store.loadTurnCheckpoints('sess-rw', undefined, true)

    expect(store.turnCheckpoints).toEqual([])
    expect(store.turnCardsError).toBe('checkpoint index missing')
  })

  it('records the thrown message when the IPC call itself rejects', async () => {
    mocks.getTurnCheckpoints.mockRejectedValueOnce(new Error('ipc down'))
    seedCurrentSession([user('u1', 'go', 1)])
    const store = await loadStore()

    await store.loadTurnCheckpoints('sess-rw')

    expect(store.turnCardsError).toBe('ipc down')
    expect(store.turnCheckpoints).toEqual([])
  })

  it('clears checkpoints and error on demand', async () => {
    mocks.getTurnCheckpoints.mockResolvedValueOnce({ ok: true, checkpoints: [checkpoint('u1', 0, ['a.ts'])], error: null })
    seedCurrentSession([user('u1', 'go', 1)])
    const store = await loadStore()
    await store.loadTurnCheckpoints('sess-rw')

    store.clearTurnCheckpoints()

    expect(store.turnCheckpoints).toEqual([])
    expect(store.turnCardsError).toBeNull()
  })

  it('ignores a late checkpoint response from a session left during mode switching', async () => {
    let resolveWorkFirst!: (value: unknown) => void
    let resolveCode!: (value: unknown) => void
    let resolveWorkSecond!: (value: unknown) => void
    mocks.getTurnCheckpoints.mockImplementation((sessionId: string) => {
      if (sessionId === 'work') {
        return new Promise(resolve => {
          if (!resolveWorkFirst) resolveWorkFirst = resolve
          else resolveWorkSecond = resolve
        })
      }
      return new Promise(resolve => { resolveCode = resolve })
    })
    localStorage.setItem('chat_sessions_v2', JSON.stringify([
      {
        id: 'work', title: 'Work', messages: [user('work-u', 'work', 1), assistant('work-a', 'done', 2)],
        createdAt: 1, updatedAt: 2, lastActivityAt: 2, workingDirectory: '/work', processStatus: 'none', isTabOpen: true, mode: 'work',
      },
      {
        id: 'code', title: 'Code', messages: [user('code-u', 'code', 3), assistant('code-a', 'done', 4)],
        createdAt: 3, updatedAt: 4, lastActivityAt: 4, workingDirectory: '/code', processStatus: 'none', isTabOpen: true, mode: 'code',
      },
    ]))
    const store = await loadStore()

    await store.selectSession('work')
    await store.selectSession('code')
    await store.selectSession('work')

    const flush = () => new Promise(resolve => setTimeout(resolve, 0))
    resolveWorkSecond({ ok: true, checkpoints: [checkpoint('work-u', 0, ['new.ts'])], error: null })
    await flush()
    resolveCode({ ok: true, checkpoints: [checkpoint('code-u', 0, ['wrong.ts'])], error: null })
    await flush()

    expect(store.currentSessionId).toBe('work')
    expect(store.turnCheckpoints.map(c => c.target.targetUserMessageId)).toEqual(['work-u'])

    resolveWorkFirst({ ok: true, checkpoints: [checkpoint('work-u', 0, ['stale.ts'])], error: null })
    await Promise.resolve()
    expect(store.turnCheckpoints.map(c => c.code.filesChanged[0].path)).toEqual(['new.ts'])
    await flush()
  })
})

describe('chatSession turnChangeCards filtering', () => {
  async function buildStore(
    messages: Message[],
    cps: SessionTurnCheckpoint[],
  ) {
    seedCurrentSession(messages)
    // 持久 mock：selectSession 内部会 fire-and-forget 触发一次 loadTurnCheckpoints，
    // 用 mockResolvedValue 保证两次加载都落到同一份 checkpoints，不与之竞态。
    mocks.getTurnCheckpoints.mockResolvedValue({ ok: true, checkpoints: cps, error: null })
    const store = await loadStore()
    await store.selectSession('sess-rw')
    await store.loadTurnCheckpoints('sess-rw', undefined, true)
    return store
  }

  it('keeps only cards whose turn finished with a substantive assistant reply', async () => {
    const store = await buildStore(
      [
        user('u1', 'first', 1),
        assistant('a1', 'answered', 2),
        user('u2', 'second', 3),
        assistant('a2', 'also answered', 4),
      ],
      [checkpoint('u1', 0, ['x.ts']), checkpoint('u2', 1, ['y.ts'])],
    )

    expect(store.turnChangeCards.map(c => c.targetUserMessageId)).toEqual(['u1', 'u2'])
    // 最后一张标记为 latest，供 UI 高亮
    expect(store.turnChangeCards.map(c => c.isLatest)).toEqual([false, true])
  })

  it('drops cards with no code changes or an unavailable snapshot', async () => {
    const store = await buildStore(
      [user('u1', 'first', 1), assistant('a1', 'answered', 2)],
      [checkpoint('u1', 0, [], true), checkpoint('u1', 0, ['z.ts'], false)],
    )

    expect(store.turnChangeCards).toEqual([])
  })

  it('drops cards whose target user message is not present in the transcript', async () => {
    const store = await buildStore(
      [user('u1', 'first', 1), assistant('a1', 'answered', 2)],
      [checkpoint('gone', 5, ['q.ts'])],
    )

    expect(store.turnChangeCards).toEqual([])
  })

  it('drops cards whose turn has no assistant reply yet (still streaming)', async () => {
    const store = await buildStore(
      [user('u1', 'first', 1)],
      [checkpoint('u1', 0, ['w.ts'])],
    )

    expect(store.turnChangeCards).toEqual([])
  })

  it('counts an assistant message carrying only tool calls as a completed turn', async () => {
    const store = await buildStore(
      [user('u1', 'first', 1), assistant('a1', '', 2, [{ id: 'tc', name: 'Bash', input: {}, status: 'completed' }])],
      [checkpoint('u1', 0, ['v.ts'])],
    )

    expect(store.turnChangeCards.map(c => c.targetUserMessageId)).toEqual(['u1'])
  })

  it('hides the latest checkpoint while the current session turn is still active', async () => {
    const store = await buildStore(
      [
        user('u1', 'first', 1),
        assistant('a1', 'completed response', 2),
        user('u2', 'second', 3),
        assistant('a2', 'partial response', 4),
      ],
      [checkpoint('u1', 0, ['completed.ts']), checkpoint('u2', 1, ['in-progress.ts'])],
    )

    store.getSession('sess-rw')!.processStatus = 'active'

    expect(store.turnChangeCards.map(card => card.targetUserMessageId)).toEqual(['u1'])
  })
})

describe('chatSession undoTurn', () => {
  it('rewinds the requested turn then reloads the checkpoint list', async () => {
    seedCurrentSession([user('u1', 'go', 1), assistant('a1', 'done', 2)])
    const store = await loadStore()
    await store.selectSession('sess-rw')

    await store.undoTurn('sess-rw', 'u1', 0)

    expect(mocks.rewindTurn).toHaveBeenCalledWith(
      'sess-rw',
      { targetUserMessageId: 'u1', userMessageIndex: 0 },
      '/repo',
    )
    expect(store.rewindingTurnId).toBeNull()
  })

  it('throws so the caller can toast when the rewind is rejected', async () => {
    mocks.rewindTurn.mockResolvedValueOnce({ ok: false, error: 'git dirty tree' })
    seedCurrentSession([user('u1', 'go', 1)])
    const store = await loadStore()
    await store.selectSession('sess-rw')

    await expect(store.undoTurn('sess-rw', 'u1')).rejects.toThrow('git dirty tree')
    expect(store.rewindingTurnId).toBeNull()
  })

  it('does nothing when there is no session id to act on', async () => {
    const store = await loadStore()

    await store.undoTurn('', 'u1')

    expect(mocks.rewindTurn).not.toHaveBeenCalled()
  })
})

describe('chatSession loadFilesToRewind', () => {
  it('returns the preview files the backend hands back', async () => {
    mocks.getTurnRewindPreviewFiles.mockResolvedValueOnce({ ok: true, files: ['src/a.ts', 'src/b.ts'], error: null })
    seedCurrentSession([user('u1', 'go', 1), assistant('a1', 'done', 2)])
    const store = await loadStore()

    const files = await store.loadFilesToRewind('sess-rw', 'u1')

    expect(files).toEqual(['src/a.ts', 'src/b.ts'])
    expect(mocks.getTurnRewindPreviewFiles).toHaveBeenCalledWith('sess-rw', 'u1', 0, '/repo')
  })

  it('falls back to the checkpoint file list when the preview endpoint yields nothing', async () => {
    mocks.getTurnRewindPreviewFiles.mockResolvedValue({ ok: false, files: [], error: 'no preview' })
    mocks.getTurnCheckpoints.mockResolvedValue({ ok: true, checkpoints: [checkpoint('u1', 0, ['legacy.ts'])], error: null })
    seedCurrentSession([user('u1', 'go', 1), assistant('a1', 'done', 2)])
    const store = await loadStore()
    await store.selectSession('sess-rw')
    await store.loadTurnCheckpoints('sess-rw', undefined, true)

    const files = await store.loadFilesToRewind('sess-rw', 'u1')

    expect(files).toEqual(['legacy.ts'])
  })

  it('returns an empty list instead of throwing when the preview call rejects', async () => {
    mocks.getTurnRewindPreviewFiles.mockRejectedValueOnce(new Error('ipc boom'))
    seedCurrentSession([user('u1', 'go', 1)])
    const store = await loadStore()

    const files = await store.loadFilesToRewind('sess-rw', 'u1')

    expect(files).toEqual([])
  })
})

describe('chatSession rewindSession', () => {
  it('conversation-only rewind truncates messages and stages the last user prompt', async () => {
    seedCurrentSession([
      user('u1', 'keep this', 1),
      assistant('a1', 'kept', 2),
      user('u2', 'rewind me', 3),
      assistant('a2', 'will go', 4),
    ])
    const store = await loadStore()
    await store.selectSession('sess-rw')

    await store.rewindSession('sess-rw', 'u2', 'conversation')

    expect(store.getSession('sess-rw')!.messages.map(m => m.id)).toEqual(['u1', 'a1'])
    expect(store.pendingInputText).toBe('rewind me')
    expect(store.rewindState.error).toBeNull()
  })

  it('code rewind asks the backend to roll back the files', async () => {
    seedCurrentSession([user('u1', 'go', 1), assistant('a1', 'done', 2)])
    const store = await loadStore()
    await store.selectSession('sess-rw')

    await store.rewindSession('sess-rw', 'u1', 'code')

    expect(mocks.rewindTurn).toHaveBeenCalledWith(
      'sess-rw',
      { targetUserMessageId: 'u1', userMessageIndex: 0 },
      '/repo',
    )
    // 代码模式不动对话
    expect(store.getSession('sess-rw')!.messages).toHaveLength(2)
  })

  it('both mode skips the conversation truncation when the code rewind fails', async () => {
    mocks.rewindTurn.mockResolvedValueOnce({ ok: false, error: 'checkpoint lost' })
    seedCurrentSession([user('u1', 'go', 1), assistant('a1', 'done', 2)])
    const store = await loadStore()
    await store.selectSession('sess-rw')

    await expect(store.rewindSession('sess-rw', 'u1', 'both')).rejects.toThrow('checkpoint lost')

    // 代码失败 → 对话保持不动，绝不只回滚一半
    expect(store.getSession('sess-rw')!.messages).toHaveLength(2)
    expect(store.rewindState.error).toContain('checkpoint lost')
  })

  it('reports a conversation error when the target message cannot be found', async () => {
    seedCurrentSession([user('u1', 'go', 1), assistant('a1', 'done', 2)])
    const store = await loadStore()
    await store.selectSession('sess-rw')

    await expect(store.rewindSession('sess-rw', 'ghost', 'conversation')).rejects.toThrow('Target message not found')
  })

  it('refuses to rewind without a session id instead of touching state', async () => {
    const store = await loadStore()

    await store.rewindSession('', 'u1', 'conversation')

    expect(store.rewindState.error).toBe('Session ID is required')
    expect(mocks.rewindTurn).not.toHaveBeenCalled()
  })
})

describe('chatSession rewind state setters and summarize', () => {
  it('patches the rewind dialog state through the thin delegating setters', async () => {
    const store = await loadStore()

    store.setShowRewindDialog(true)
    store.setRewindSelectedMessage('u1')
    store.setRewindSelectedOption('conversation')
    store.setRewindSummarizeFeedback('be brief')
    store.setFilesToRewind(['a.ts'])
    store.setShowCodeConfirm(true)

    expect(store.rewindState).toMatchObject({
      showDialog: true,
      selectedMessageId: 'u1',
      selectedOption: 'conversation',
      summarizeFeedback: 'be brief',
      filesToRewind: ['a.ts'],
      showCodeConfirm: true,
    })

    store.setRewindError('boom')
    expect(store.rewindState.error).toBe('boom')

    store.resetRewindState()
    expect(store.rewindState.selectedMessageId).toBeNull()
    expect(store.rewindState.error).toBeNull()
  })

  it('sets and clears the pending input text used to restore the prompt', async () => {
    const store = await loadStore()

    store.setPendingInputText('draft to restore')
    expect(store.pendingInputText).toBe('draft to restore')

    store.clearPendingInputText()
    expect(store.pendingInputText).toBe('')
  })

  it('resolves summarizeTurn as a no-op placeholder', async () => {
    const store = await loadStore()

    await expect(store.summarizeTurn('sess-rw', 'u1', 'feedback')).resolves.toBeUndefined()
  })
})
