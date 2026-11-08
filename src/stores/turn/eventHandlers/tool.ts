// src/stores/turn/eventHandlers/tool.ts
// 工具域：tool_use / tool_result 的落库、追溯事件与交付物联动。

import type { TurnState } from '../types'
import { FILE_TOOLS, COMMAND_TOOLS, VERIFICATION_PATTERNS, MAX_INMEMORY_TOOL_OUTPUT } from '../types'
import { createUuid } from '@/utils/uuid'
import {
  recordAgentToolCall,
  isAgentLaunchResult,
} from '@/services/teamTranscriptService'
import type { EventHandlerContext } from './types'

export function createToolHandlers(ctx: EventHandlerContext) {
  const {
    sink,
    timeline,
    logger,
    traceEvent,
    updateTaskStateFromToolResult,
    recordWriteToLedger,
    maybeAutoPreviewArtifact,
  } = ctx
  const { updateTimelineEvent, addToolTimelineEvent } = timeline

  const handleToolUse = (sessionId: string, ts: TurnState, toolUse: any) => {
    const toolNameLog = toolUse.name || toolUse.tool_use?.name || 'Unknown Tool'
    logger.info('ChatStore', `[${sessionId.slice(0, 8)}] tool_use event | name=${toolNameLog}`)
    const s = sink.get(sessionId)
    if (s) {
      const msg = s.messages.find(m => m.id === ts.assistantMessageId)
      if (msg) {
        const toolId = toolUse.id || toolUse.tool_use?.id || createUuid()
        const toolName = toolUse.name || toolUse.tool_use?.name || 'Unknown Tool'
        const toolInput = toolUse.input || toolUse.tool_use?.input || {}
        const existingTool = msg.toolCalls?.find(tc => tc.id === toolId)
        if (!existingTool) {
          msg.toolCalls = [...(msg.toolCalls || []), {
            id: toolId, name: toolName, input: toolInput,
            status: 'running', startTime: Date.now()
          }]
          let traceType: string = 'tool_call'
          if (FILE_TOOLS.has(toolName)) traceType = 'file_change'
          else if (COMMAND_TOOLS.has(toolName)) {
            const cmd = typeof toolInput.command === 'string' ? toolInput.command : ''
            const isVerification = VERIFICATION_PATTERNS.some(p => p.test(cmd))
            traceType = isVerification ? 'verification' : 'command_run'
          }

          traceEvent({
            sessionId,
            actor: 'tool',
            type: traceType,
            status: 'started',
            title: toolName,
            input: toolInput,
            metadata: { toolId, assistantMessageId: ts.assistantMessageId },
          })
          addToolTimelineEvent(sessionId, ts, toolId)
          sink.persist(sessionId)
        } else if (msg.toolCalls) {
          // 流式期间已创建的 toolCall，用完整数据覆盖。
          // tool_use / tool_execution_start 是权威帧，不能按 key 数量判断是否"更完整" ——
          // 早期提取写下的 { command: 半截 } 与完整 input 键数相同，旧条件会拒绝覆盖。
          const idx = msg.toolCalls.findIndex(tc => tc.id === toolId)
          const hasFullInput = toolInput && Object.keys(toolInput).length > 0
          if (idx >= 0 && hasFullInput) {
            const updatedToolCalls = [...msg.toolCalls]
            updatedToolCalls[idx] = {
              ...updatedToolCalls[idx],
              input: toolInput
            }
            msg.toolCalls = updatedToolCalls
            sink.persist(sessionId)
          }
        }
      }
    }
  }

  const handleToolResult = (sessionId: string, ts: TurnState, toolResult: any) => {
    const resultToolUseIdLog = toolResult.tool_use_id || toolResult.tool_result?.tool_use_id
    const resultIsErrorLog = toolResult.is_error || toolResult.tool_result?.is_error
    logger.info('ChatStore', `[${sessionId.slice(0, 8)}] tool_result event | toolUseId=${resultToolUseIdLog?.slice(0, 8)} | error=${!!resultIsErrorLog}`)
    const s = sink.get(sessionId)
    if (s) {
      const msg = s.messages.find(m => m.id === ts.assistantMessageId)
      if (msg?.toolCalls) {
        const resultToolUseId = toolResult.tool_use_id || toolResult.tool_result?.tool_use_id
        const rawResultOutput = toolResult.output ?? toolResult.content ?? toolResult.tool_result?.output ?? toolResult.tool_result?.content
        let resultOutput = typeof rawResultOutput === 'string' ? rawResultOutput : JSON.stringify(rawResultOutput)
        if (resultOutput.length > MAX_INMEMORY_TOOL_OUTPUT) {
          resultOutput = resultOutput.slice(0, MAX_INMEMORY_TOOL_OUTPUT) + '\n\n[Output truncated to prevent memory overflow]'
        }
        const resultIsError = toolResult.is_error || toolResult.tool_result?.is_error

        updateTaskStateFromToolResult(msg.toolCalls, resultToolUseId, resultOutput)

        const toolCallIndex = msg.toolCalls.findIndex(tc => tc.id === resultToolUseId)
        if (toolCallIndex >= 0) {
          const toolName = msg.toolCalls[toolCallIndex].name

          const isAsyncLaunch = !resultIsError &&
            (toolName === 'Agent' || toolName === 'Task') &&
            isAgentLaunchResult(resultOutput)

          const updatedToolCalls = [...msg.toolCalls]
          updatedToolCalls[toolCallIndex] = {
            ...updatedToolCalls[toolCallIndex],
            status: isAsyncLaunch
              ? 'running'
              : (resultIsError ? 'error' : 'completed'),
            output: resultOutput,
            ...(isAsyncLaunch ? {} : { endTime: Date.now() })
          }
          msg.toolCalls = updatedToolCalls
          recordAgentToolCall(s, updatedToolCalls[toolCallIndex], isAsyncLaunch ? 'running' : (resultIsError ? 'failed' : 'completed'))

          let traceType: string = 'tool_result'
          let evidence: Array<{ kind: string; result?: string; detail: string }> | undefined
          if (FILE_TOOLS.has(toolName)) {
            traceType = 'file_change'
          } else if (COMMAND_TOOLS.has(toolName)) {
            const cmd = typeof updatedToolCalls[toolCallIndex].input?.command === 'string'
              ? updatedToolCalls[toolCallIndex].input.command : ''
            const isVerification = VERIFICATION_PATTERNS.some(p => p.test(cmd))
            if (isVerification) {
              traceType = 'verification'
              const passKeywords = ['passed', 'pass', '0 failures', '0 errors', 'all tests passed', 'success']
              const failKeywords = ['failed', 'fail', 'error', 'failure', 'failing']
              const lowerOutput = resultOutput.toLowerCase()
              const isPass = !resultIsError && passKeywords.some(k => lowerOutput.includes(k))
              const isFail = resultIsError || failKeywords.some(k => lowerOutput.includes(k))
              evidence = [{
                kind: cmd.match(/test/i) ? 'test' : cmd.match(/(lint|eslint|biome|ruff)/i) ? 'lint' : cmd.match(/(build|tsc|typecheck)/i) ? 'build' : 'manual',
                result: isFail ? 'fail' : isPass ? 'pass' : 'unknown',
                detail: resultOutput.slice(0, 500),
              }]
            } else {
              traceType = 'command_run'
            }
          }

          traceEvent({
            sessionId,
            actor: 'tool',
            type: traceType,
            status: resultIsError ? 'failed' : 'completed',
            title: toolName,
            output: resultOutput,
            evidence,
            metadata: { toolId: resultToolUseId, assistantMessageId: ts.assistantMessageId },
          })
          updateTimelineEvent(sessionId, ts, `tool-${resultToolUseId}`, {
            status: resultIsError ? 'error' : 'completed'
          })
          sink.persist(sessionId)

          if (FILE_TOOLS.has(toolName) || COMMAND_TOOLS.has(toolName)) {
            if (!resultIsError) recordWriteToLedger(sessionId, toolName, updatedToolCalls[toolCallIndex].input)
            window.dispatchEvent(new CustomEvent('scm:refresh'))
            window.dispatchEvent(new CustomEvent('refresh-file-tree'))
          }

          // 工具刚产出交付物（Write 了 xlsx / 跑了 officecli 命令）→ 创建即打开预览
          if (!resultIsError && toolCallIndex >= 0) {
            maybeAutoPreviewArtifact(sessionId, toolName, updatedToolCalls[toolCallIndex].input)
          }
        }
      }
    }
  }

  return { handleToolUse, handleToolResult }
}
