/**
 * Super Agent 模型输入的预算集中处（设计 §8.1）。
 *
 * 所有内联/分页/评估窗口的字符与条数上限只在这里定义；其它模块（context、
 * contextReader、评估卡、卡片投影）一律引用，不散落硬编码。预算值从原型起步：
 * 卡片 preview 160、Worker Trigger 600、assignment 1500、文本页默认 4000/最大
 * 8000 UTF-16 code units、列表默认 20/最大 50。
 */
export const SUPER_AGENT_CONTEXT_BUDGETS = Object.freeze({
  /** Trigger / 卡片 preview。 */
  triggerPreviewChars: 160,
  /** Worker 首轮消息内联的目标描述上限。 */
  workerTriggerChars: 600,
  /** Assignment 摘要预算。 */
  assignmentChars: 1500,
  /** 文本页默认/最大 UTF-16 code units。 */
  textPageChars: 4000,
  textPageMaxChars: 8000,
  /** 列表默认/最大条数。 */
  listDefault: 20,
  listMax: 50,
  /** 评估窗口：Thread 开头条数与候选前后条数。 */
  evalWindowHead: 5,
  evalWindowNeighbors: 5,
  /** 评估窗口正文：普通消息与候选/紧邻消息的字符上限。 */
  evalMessageChars: 400,
  evalNeighborChars: 1200,
})
