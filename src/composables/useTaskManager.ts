/**
 * Task Manager for Todo V2
 * Manages task state across TaskCreate, TaskUpdate, and TaskList tool calls
 */

import { reactive, readonly } from 'vue'

export interface Task {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  owner?: string
  blockedBy?: string[]
  description?: string
}

interface TaskState {
  tasks: Map<string, Task>
}

const state = reactive<TaskState>({
  tasks: new Map()
})

export function useTaskManager() {
  function createTask(id: string, content: string, description?: string) {
    state.tasks.set(id, {
      id,
      content,
      description,
      status: 'pending'
    })
  }

  function updateTask(
    id: string,
    updates: Partial<Omit<Task, 'id'>>
  ) {
    const task = state.tasks.get(id)
    if (!task) return

    Object.assign(task, updates)
  }

  function syncTasksFromList(tasks: Array<{
    id: string
    content: string
    status: string
    owner?: string
    blockedBy?: string[]
  }>) {
    // Clear old tasks to ensure sync accuracy
    state.tasks.clear()

    for (const t of tasks) {
      state.tasks.set(t.id, {
        id: t.id,
        content: t.content,
        status: t.status as Task['status'],
        owner: t.owner,
        blockedBy: t.blockedBy
      })
    }
  }

  function clearTasks() {
    state.tasks.clear()
  }

  /**
   * 演示：创建3个待办任务并模拟依次完成过程
   * 返回 Promise，可用于 await 等待演示完成
   */
  function demoTaskCompletion(): Promise<void> {
    return new Promise((resolve) => {
      clearTasks()

      // 创建3个任务
      const demoTasks = [
        { id: '1', content: '设计用户界面原型', description: '完成首页和详情页的UI设计' },
        { id: '2', content: '实现后端API接口', description: '开发用户管理和数据查询接口' },
        { id: '3', content: '编写单元测试', description: '为核心模块编写单元测试' }
      ]

      // 依次创建任务（pending状态）
      demoTasks.forEach((task, index) => {
        setTimeout(() => {
          createTask(task.id, task.content, task.description)
          console.log(`[Demo] 创建任务 #${task.id}: ${task.content}`)
        }, index * 300)
      })

      // 依次将任务设为进行中
      demoTasks.forEach((task, index) => {
        setTimeout(() => {
          updateTask(task.id, { status: 'in_progress' })
          console.log(`[Demo] 任务 #${task.id} 开始执行...`)
        }, 2000 + index * 1500)
      })

      // 依次将任务设为完成
      demoTasks.forEach((task, index) => {
        setTimeout(() => {
          updateTask(task.id, { status: 'completed' })
          console.log(`[Demo] 任务 #${task.id} 已完成！`)
        }, 5000 + index * 1500)
      })

      // 演示完成后回调
      setTimeout(() => {
        console.log('[Demo] 所有任务已完成！')
        resolve()
      }, 5000 + demoTasks.length * 1500 + 500)
    })
  }

  function getAllTasks(): Task[] {
    return Array.from(state.tasks.values())
  }

  function getTaskById(id: string): Task | undefined {
    return state.tasks.get(id)
  }

  function getPendingTasks(): Task[] {
    return getAllTasks().filter(t => t.status === 'pending')
  }

  function getInProgressTasks(): Task[] {
    return getAllTasks().filter(t => t.status === 'in_progress')
  }

  function getCompletedTasks(): Task[] {
    return getAllTasks().filter(t => t.status === 'completed')
  }

  return {
    tasks: readonly(state.tasks),
    createTask,
    updateTask,
    syncTasksFromList,
    clearTasks,
    getAllTasks,
    getTaskById,
    getPendingTasks,
    getInProgressTasks,
    getCompletedTasks,
    demoTaskCompletion
  }
}
