import { describe, it, expect, vi, beforeEach } from 'vitest'
import { syncTaskStateFromToolCall } from '@/utils/taskToolSync'

type TaskStatus = 'pending' | 'in_progress' | 'completed'

interface ListTask {
  id: string
  content: string
  status: string
  owner?: string
  blockedBy?: string[]
}

function createManager() {
  return {
    createTask: vi.fn<(id: string, content: string, description?: string) => void>(),
    updateTask: vi.fn<(id: string, updates: { status?: TaskStatus, owner?: string }) => void>(),
    clearTasks: vi.fn<() => void>(),
    syncTasksFromList: vi.fn<(tasks: ListTask[]) => void>(),
  }
}

let manager: ReturnType<typeof createManager>

beforeEach(() => {
  manager = createManager()
})

describe('syncTaskStateFromToolCall — TaskCreate', () => {
  it('从成功输出解析 id 与 content，并透传 input.description', () => {
    syncTaskStateFromToolCall(
      manager,
      { name: 'TaskCreate', input: { description: '写测试' } },
      'Task #7 created successfully: 补充单元测试',
    )

    expect(manager.createTask).toHaveBeenCalledWith('7', '补充单元测试', '写测试')
  })

  it('在输出多行时仍匹配到创建行（multiline ^ 锚定）', () => {
    syncTaskStateFromToolCall(
      manager,
      { name: 'TaskCreate', input: {} },
      '前置提示\nTask #12 created successfully: 修 bug\n后续行',
    )

    expect(manager.createTask).toHaveBeenCalledWith('12', '修 bug', undefined)
  })

  it('输出不匹配时不做任何操作', () => {
    syncTaskStateFromToolCall(manager, { name: 'TaskCreate', input: {} }, 'Task #7 failed')
    expect(manager.createTask).not.toHaveBeenCalled()
  })

  it('缺少 input 时 description 为 undefined 且不抛错', () => {
    syncTaskStateFromToolCall(manager, { name: 'TaskCreate', input: undefined as any }, 'Task #1 created successfully: a')
    expect(manager.createTask).toHaveBeenCalledWith('1', 'a', undefined)
  })
})

describe('syncTaskStateFromToolCall — TaskUpdate', () => {
  it('优先使用 status 输入，并透传 owner', () => {
    syncTaskStateFromToolCall(
      manager,
      { name: 'TaskUpdate', input: { taskId: '3', status: 'in_progress', owner: 'alice' } },
      'Updated task #3',
    )

    expect(manager.updateTask).toHaveBeenCalledWith('3', { status: 'in_progress', owner: 'alice' })
  })

  it('无 status 输入时回退解析输出中的状态迁移', () => {
    syncTaskStateFromToolCall(
      manager,
      { name: 'TaskUpdate', input: { taskId: '5' } },
      'Updated task #5\nstatus: pending -> completed',
    )

    expect(manager.updateTask).toHaveBeenCalledWith('5', { status: 'completed' })
  })

  it('输入 status 非法时同样回退到输出状态', () => {
    syncTaskStateFromToolCall(
      manager,
      { name: 'TaskUpdate', input: { taskId: '5', status: 'bogus' } },
      'status: pending -> in_progress',
    )

    expect(manager.updateTask).toHaveBeenCalledWith('5', { status: 'in_progress' })
  })

  it('从输出解析 owner（截断到逗号/换行）', () => {
    syncTaskStateFromToolCall(
      manager,
      { name: 'TaskUpdate', input: { taskId: '9' } },
      'Updated task #9\nowner: bob, pending stuff',
    )

    expect(manager.updateTask).toHaveBeenCalledWith('9', { owner: 'bob' })
  })

  it('taskId 缺失时回退 task_id 输入', () => {
    syncTaskStateFromToolCall(
      manager,
      { name: 'TaskUpdate', input: { task_id: '11', status: 'completed' } },
      'done',
    )

    expect(manager.updateTask).toHaveBeenCalledWith('11', { status: 'completed' })
  })

  it('输出 id 优先于输入 id', () => {
    syncTaskStateFromToolCall(
      manager,
      { name: 'TaskUpdate', input: { taskId: 'input-id' } },
      'Updated task #99',
    )

    expect(manager.updateTask).toHaveBeenCalledWith('99', {})
  })

  it('既无输出 id 又无输入 id 时跳过更新', () => {
    syncTaskStateFromToolCall(manager, { name: 'TaskUpdate', input: {} }, 'Updated nothing')
    expect(manager.updateTask).not.toHaveBeenCalled()
  })

  it('无法解析出状态/owner 时以空更新调用 updateTask', () => {
    syncTaskStateFromToolCall(manager, { name: 'TaskUpdate', input: { taskId: '4' } }, 'Updated task #4')
    expect(manager.updateTask).toHaveBeenCalledWith('4', {})
  })
})

describe('syncTaskStateFromToolCall — TaskList', () => {
  it('"No tasks found" 触发清空', () => {
    syncTaskStateFromToolCall(manager, { name: 'TaskList', input: {} }, 'No tasks found')
    expect(manager.clearTasks).toHaveBeenCalledTimes(1)
    expect(manager.syncTasksFromList).not.toHaveBeenCalled()
  })

  it('解析完整字段：状态、owner、blockedBy（去除 # 前缀）', () => {
    syncTaskStateFromToolCall(
      manager,
      { name: 'TaskList', input: {} },
      '#1 [in_progress] 实现登录 (alice) [blocked by #2, #3]',
    )

    expect(manager.syncTasksFromList).toHaveBeenCalledWith([
      { id: '1', status: 'in_progress', content: '实现登录', owner: 'alice', blockedBy: ['2', '3'] },
    ])
  })

  it('解析最小行：仅有状态与内容', () => {
    syncTaskStateFromToolCall(manager, { name: 'TaskList', input: {} }, '#2 [pending] 待办事项')

    expect(manager.syncTasksFromList).toHaveBeenCalledWith([
      { id: '2', status: 'pending', content: '待办事项', owner: undefined, blockedBy: [] },
    ])
  })

  it('忽略不匹配的行，仅收集合法任务行', () => {
    syncTaskStateFromToolCall(
      manager,
      { name: 'TaskList', input: {} },
      '头部说明\n#1 [completed] 已完成\n\n结束语',
    )

    expect(manager.syncTasksFromList).toHaveBeenCalledWith([
      { id: '1', status: 'completed', content: '已完成', owner: undefined, blockedBy: [] },
    ])
  })

  it('无匹配行时以空数组同步', () => {
    syncTaskStateFromToolCall(manager, { name: 'TaskList', input: {} }, '没有任何任务')
    expect(manager.syncTasksFromList).toHaveBeenCalledWith([])
  })
})

describe('syncTaskStateFromToolCall — TodoWrite', () => {
  it('映射 todos 为任务列表，保留 id/状态', () => {
    syncTaskStateFromToolCall(
      manager,
      {
        name: 'TodoWrite',
        input: { todos: [{ id: 'a', content: '写文档', status: 'completed' }] },
      },
      '',
    )

    expect(manager.syncTasksFromList).toHaveBeenCalledWith([
      { id: 'a', content: '写文档', status: 'completed' },
    ])
  })

  it('缺失 id 时以 content 作为 id', () => {
    syncTaskStateFromToolCall(
      manager,
      { name: 'TodoWrite', input: { todos: [{ content: '无 id 项' }] } },
      '',
    )

    expect(manager.syncTasksFromList).toHaveBeenCalledWith([
      { id: '无 id 项', content: '无 id 项', status: 'pending' },
    ])
  })

  it('非法状态回退为 pending', () => {
    syncTaskStateFromToolCall(
      manager,
      { name: 'TodoWrite', input: { todos: [{ id: '1', content: 'x', status: 'weird' }] } },
      '',
    )

    expect(manager.syncTasksFromList).toHaveBeenCalledWith([
      { id: '1', content: 'x', status: 'pending' },
    ])
  })

  it('过滤掉无 content 的项', () => {
    syncTaskStateFromToolCall(
      manager,
      { name: 'TodoWrite', input: { todos: [{ id: '1' }, null, { content: '有效' }] } },
      '',
    )

    expect(manager.syncTasksFromList).toHaveBeenCalledWith([
      { id: '有效', content: '有效', status: 'pending' },
    ])
  })

  it('todos 非数组时不触发同步', () => {
    syncTaskStateFromToolCall(manager, { name: 'TodoWrite', input: { todos: 'nope' } }, '')
    expect(manager.syncTasksFromList).not.toHaveBeenCalled()
  })
})

describe('syncTaskStateFromToolCall — 其它工具', () => {
  it('未知工具名不调用任何方法', () => {
    syncTaskStateFromToolCall(manager, { name: 'Bash', input: { command: 'ls' } }, 'output')

    expect(manager.createTask).not.toHaveBeenCalled()
    expect(manager.updateTask).not.toHaveBeenCalled()
    expect(manager.clearTasks).not.toHaveBeenCalled()
    expect(manager.syncTasksFromList).not.toHaveBeenCalled()
  })
})
