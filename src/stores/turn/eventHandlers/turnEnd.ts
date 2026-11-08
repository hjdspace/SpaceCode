// src/stores/turn/eventHandlers/turnEnd.ts
// 回合收口域：result / error / process exit，以及空转 result 的兜底计时器。

import type { TurnState } from '../types'
import { COMMAND_TOOLS } from '../types'
import { TRACE_DURATION_KEY } from '@/lib/trace/duration'
import { needsWorkspaceRootScan } from '@/utils/artifactScope'
import { isAutoPreviewPath } from '@/utils/artifactFormat'
import { extractErrorCode } from '@/composables/useAutoRetry'
import { playTaskCompleteSound } from '@/utils/notificationSound'
import { api } from '@/services/electronAPI'
import { i18n } from '@/i18n'
import type { EventHandlerContext } from './types'

export function createTurnEndHandlers(ctx: EventHandlerContext) {
  const {
    sink,
    timeline,
    streamingContents,
    loadingSessions,
    logger,
    traceEvent,
    autoRetry,
    initiateAutoRetry,
    contextUsage,
    errorHandler,
    getModel,
    getProvider,
    getBaseUrl,
    getClaudeCode,
    getArtifactsApi,
    getProjectRoot,
    openArtifactPreview,
    isSoundOnTaskComplete,
    isDesktopNotifyOnTaskComplete,
    getSessionTitle,
    onTurnCompleted,
    onTurnOutcome,
    loadTurnCheckpoints,
    userAbortedSessions,
    isObserved,
    autoPreviewedPaths,
    turnStates,
    endTurn,
    flushContentPatch,
    syncCardProjection,
  } = ctx
  const {
    ensureTextTimelineEvent,
    completeCurrentTextEvent,
    completeCurrentReasoningEvent,
    updateTimelineEvent,
  } = timeline

  // 引擎"空转"result（is_error=false、无输出、num_turns=0）的兜底计时器。
  // 正常情况下引擎处理完排队命令后会紧跟第二个 result；若始终没有（例如
  // UserPromptSubmit 钩子拦截了 prompt、或引擎队列意外清空），超时后报一个
  // 准确的错误，而不是让回合永远停在"思考中"。
  const noOpResultTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const NOOP_RESULT_FALLBACK_MS = 120_000

  const disarmNoOpResultFallback = (sessionId: string) => {
    const timer = noOpResultTimers.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      noOpResultTimers.delete(sessionId)
    }
  }

  const armNoOpResultFallback = (sessionId: string, ts: TurnState) => {
    disarmNoOpResultFallback(sessionId)
    const timer = setTimeout(() => {
      noOpResultTimers.delete(sessionId)
      // 回合已结算（后续 result / abort / 进程退出）或已被新 turn 取代 → 无事可做
      if (ts.settled || turnStates.get(sessionId) !== ts) return
      logger.warn('ChatStore', `[${sessionId.slice(0, 8)}] no follow-up result after no-op empty result — engine produced nothing for this send`)
      handleError(
        sessionId,
        ts,
        Object.assign(
          new Error(
            'The engine produced no output for this send. The previous turn was likely interrupted, and its recovery notification consumed this result. Please try resending.',
          ),
          { retryable: false },
        ),
      )
    }, NOOP_RESULT_FALLBACK_MS)
    noOpResultTimers.set(sessionId, timer)
  }

  // 桌面通知去重：记录每个 session 最近一次通知的时间戳，
  // 防止同一 turn 周期内因幽灵 turn 或残留事件触发多次通知。
  const notifiedSessions = new Map<string, number>()
  const NOTIFICATION_DEBOUNCE_MS = 5_000

  const handleResult = (sessionId: string, ts: TurnState, result: any) => {
    const isError = !!result?.is_error
    const observed = isObserved(sessionId)
    const resultText = typeof result?.result === 'string' ? result.result : ''
    const looksLikeApiError = /^API Error:/i.test(resultText)

    // Engine 内部 retry 可能在旧 turn 已 settled 后才发出成功 result。
    // 清理必须先于 settled guard，避免晚到事件被丢弃后重试状态残留。
    if (!isError && !looksLikeApiError && autoRetry.retryStates.value.has(sessionId)) {
      logger.info('ChatStore', `[${sessionId.slice(0, 8)}] auto-retry succeeded, clearing retry state`)
      autoRetry.clearOnSuccess(sessionId)
    }

    if (ts.settled) return

    if (typeof result?.model === 'string' && result.model.trim()) {
      ts.model = result.model
    }

    flushContentPatch(sessionId, ts)

    // A successful CLI result can still contain no model output when the
    // upstream API exhausted retries (for example 429/500 responses). Treat
    // that protocol-level success as a visible failure instead of silently
    // settling an empty assistant message.
    const sessionForEmptyCheck = sink.get(sessionId)
    const assistantMessageForEmptyCheck = sessionForEmptyCheck?.messages.find(m => m.id === ts.assistantMessageId)
    const hasVisibleOutput = Boolean(
      resultText.trim() ||
      ts.accumulatedContent.trim() ||
      assistantMessageForEmptyCheck?.content?.trim() ||
      assistantMessageForEmptyCheck?.toolCalls?.length ||
      assistantMessageForEmptyCheck?.reasoning,
    )
    if (!isError && !looksLikeApiError && typeof result?.result === 'string' && !hasVisibleOutput) {
      // 引擎"空转"result：is_error=false、无输出且 num_turns=0 —— 本轮连 API 都没调。
      // 实测链路：会话被中断后重启（--resume），被杀后台任务合成的 task-notification
      // 排在用户 prompt 前面被当作独立命令处理（shouldQuery=false），引擎先吐一个空
      // "成功"result；用户真正的 prompt 还在引擎队列里，紧接着会有第二个 result。
      // 这种 result 不能当失败收口，保持 turn 打开等下一个 result，超时才报错。
      if (result.num_turns === 0) {
        logger.warn('ChatStore', `[${sessionId.slice(0, 8)}] no-op empty result (num_turns=0) — engine likely processed a queued system notification; keeping turn open for the follow-up result`)
        armNoOpResultFallback(sessionId, ts)
        return
      }
      // 上游请求失败后引擎回了个"成功"的空结果。重发同一份历史只会再失败一次，
      // 所以标成不可重试 —— 否则按文本分类会落到 UNKNOWN，自动重发 5 次。
      const emptyResponseError = Object.assign(
        new Error(
          'LLM returned an empty response after the upstream request failed. Please check the API configuration and try again.',
        ),
        { retryable: false },
      )
      logger.warn('ChatStore', `[${sessionId.slice(0, 8)}] empty successful result treated as error`)
      handleError(sessionId, ts, emptyResponseError)
      return
    }

    disarmNoOpResultFallback(sessionId)

    if (isError || looksLikeApiError) {
      const errorText = resultText || 'API error'
      logger.warn('ChatStore', `[${sessionId.slice(0, 8)}] result event has error, routing to handleError | isError=${isError} | looksLikeApiError=${looksLikeApiError} | errorText=${errorText.slice(0, 120)}`)
      // pi 的上游拒绝（429/5xx/网络）由引擎内部退避重试（预算见 piRetrySettings 投影），
      // 全部失败后才以 stop_reason:'error' 收场。这是"引擎已尽力"的最终失败：
      // abort+重发整段历史只会再次撞限速，前端不该再接一轮重发循环。
      const engineRetriesExhausted = result?.stop_reason === 'error' && sink.get(sessionId)?.engineType === 'pi'
      const error = Object.assign(new Error(errorText), engineRetriesExhausted ? { engineRetriesExhausted: true } : {})
      handleError(sessionId, ts, error)
      return
    }

    ts.settled = true
    result = result || {}
    const elapsed = Date.now() - ts.sendStartTime
    logger.info('ChatStore', `[${sessionId.slice(0, 8)}] result event (LLM response complete) | totalElapsed=${elapsed}ms | accContentLen=${ts.accumulatedContent.length} | stopReason=${result.stop_reason || '(none)'}`)
    streamingContents.value.set(sessionId, '')
    loadingSessions.value.set(sessionId, false)

    const s = sink.get(sessionId)
    if (s) {
      s.processStatus = 'idle'
      s.lastActivityAt = Date.now()
      const msg = s.messages.find(m => m.id === ts.assistantMessageId)
      if (msg) {
        const finalText = typeof result.result === 'string' ? result.result : ''
        // 比较对象必须是**原始**累计文本：msg.content 是投影后的可见正文（去掉了成卡围栏），
        // 拿它比长度会误判成「还缺一段文本」，把同一段文字重复追加进时间线事件。
        if (finalText && finalText.length > ts.accumulatedContent.length) {
          const textEventId = ensureTextTimelineEvent(sessionId, ts)
          const deltaText = finalText.slice(ts.accumulatedContent.length)
          ts.accumulatedContent = finalText
          ts.currentTextContent += deltaText
          const textEvent = msg.timelineEvents?.find(event => event.id === textEventId)
          updateTimelineEvent(sessionId, ts, textEventId, {
            content: `${textEvent?.content || ''}${deltaText}`,
            status: 'completed'
          })
        }
        // 收口投影：流式期间隐藏的「仍未闭合围栏」这时必须回到正文里当普通代码块显示。
        const settled = syncCardProjection(sessionId, ts, msg, true)
        if (msg.content !== settled.content) msg.content = settled.content
        const settledTextEvent = ts.currentTextEventId
          ? msg.timelineEvents?.find(event => event.id === ts.currentTextEventId)
          : undefined
        if (settledTextEvent && settledTextEvent.content !== settled.blockText) {
          settledTextEvent.content = settled.blockText
        }
        completeCurrentTextEvent(sessionId, ts)
        if (msg.reasoning && !msg.reasoning.endTime) {
          msg.reasoning.endTime = Date.now()
          msg.reasoning.isExpanded = false
        }
        if (ts.currentReasoningEventId) {
          updateTimelineEvent(sessionId, ts, ts.currentReasoningEventId, { status: 'completed' })
        }
        const hasRunningTools = !!msg.toolCalls?.some(tool => tool.status === 'running' || tool.status === 'pending')
        const suspiciousToolStop = result.stop_reason === 'tool_use'
        const resultUsage = result.usage
        const previousApiCallUsage = msg.metadata?.apiCallUsage
        const previousGenUiCards = msg.metadata?.genUiCards
        const previousGenUiFallbacks = msg.metadata?.genUiCardFallbacks
        msg.metadata = {
          model: ts.model || getModel(),
          duration: Date.now() - msg.timestamp,
          // 卡片记录投影在流式期间就已写在 metadata 上，这里整块替换 metadata，
          // 必须把它们带过来 —— 否则一收口卡片就消失。
          ...(previousGenUiCards?.length ? { genUiCards: previousGenUiCards } : {}),
          ...(previousGenUiFallbacks?.length ? { genUiCardFallbacks: previousGenUiFallbacks } : {}),
          ...(resultUsage && {
            inputTokens: resultUsage.input_tokens,
            outputTokens: resultUsage.output_tokens,
            ...(typeof resultUsage.cache_read_input_tokens === 'number'
              ? { cacheReadInputTokens: resultUsage.cache_read_input_tokens }
              : {}),
            ...(typeof resultUsage.cache_creation_input_tokens === 'number'
              ? { cacheCreationInputTokens: resultUsage.cache_creation_input_tokens }
              : {}),
          }),
          ...(previousApiCallUsage ? { apiCallUsage: previousApiCallUsage } : {}),
          warning: suspiciousToolStop
            ? 'Agent 在工具调用状态下提前结束，当前模型可能没有稳定支持多轮工具调用协议。建议重试或切换为更强的工具调用模型。'
            : hasRunningTools
              ? 'Agent 已结束，但仍有工具调用未返回结果。'
              : undefined
        }

        if (!observed) contextUsage.refresh(sessionId)
        traceEvent({
          sessionId,
          messageId: ts.assistantMessageId,
          actor: 'assistant',
          type: 'assistant_turn',
          status: 'completed',
          title: 'Assistant turn completed',
          output: { content: msg.content },
          metadata: {
            [TRACE_DURATION_KEY]: msg.metadata?.duration,
            model: msg.metadata?.model,
            stopReason: result.stop_reason || '',
            warning: msg.metadata?.warning || '',
          },
        })

        const fileChanges = msg.toolCalls
          ?.filter(tc => ['Write', 'FileWrite', 'Edit', 'FileEdit', 'MultiEdit'].includes(tc.name))
          .map(tc => ({
            kind: tc.name,
            path: tc.input?.file_path || tc.input?.path || '',
          })) || []
        const verifications = msg.toolCalls
          ?.filter(tc => tc.name === 'Bash' && tc.output)
          .filter(tc => {
            const cmd = typeof tc.input?.command === 'string' ? tc.input.command : ''
            return /^\s*(npm\s+test|bun\s+test|pnpm\s+test|yarn\s+test|pytest|cargo\s+test|go\s+test|jest|vitest|mocha|ruff|eslint|biome|prettier|tsc|vue-tsc|npm\s+run\s+(test|lint|check|build|typecheck))/i.test(cmd)
          })
          .map(tc => ({
            kind: 'verification',
            result: tc.status === 'completed' ? 'pass' : 'fail',
            detail: (tc.output || '').slice(0, 300),
          })) || []
        const errors = msg.toolCalls
          ?.filter(tc => tc.status === 'error')
          .map(tc => ({ kind: tc.name, detail: (tc.output || '').slice(0, 300) })) || []

        traceEvent({
          sessionId,
          messageId: ts.assistantMessageId,
          actor: 'system',
          type: 'final_summary',
          // 走到这里说明回合已成功收口（失败路径早在 handleError 返回了）。
          // 工具级报错由 errorCount / error 字段记账，不能翻成整轮 failed。
          status: 'completed',
          title: 'Session turn summary',
          artifacts: fileChanges.length > 0 ? fileChanges : undefined,
          evidence: verifications.length > 0 ? verifications : undefined,
          error: errors.length > 0 ? { message: errors.map(e => `${e.kind}: ${e.detail}`).join('; ') } : undefined,
          metadata: {
            toolCallCount: msg.toolCalls?.length || 0,
            fileChangeCount: fileChanges.length,
            verificationCount: verifications.length,
            errorCount: errors.length,
            contentLength: msg.content.length,
          },
        })

        // 「本轮什么都没产出」的自主回合消息要删掉，但成卡的消息正文天生是空的
        // （围栏被投影走了），只有卡片记录本身算产出，不能一起删。
        if (
          ts.isAutonomous &&
          !msg.content &&
          !msg.metadata?.genUiCards?.length &&
          !msg.toolCalls?.length &&
          !msg.reasoning
        ) {
          const idx = s.messages.findIndex(m => m.id === ts.assistantMessageId)
          if (idx >= 0) s.messages.splice(idx, 1)
        }

        sink.persist(sessionId)

        if (!observed && s.workingDirectory) {
          const workingDir = s.workingDirectory
          const scanWorkspaceRoot = needsWorkspaceRootScan(s.mode)
          const turnStart = ts.sendStartTime
          const targetMsgId = ts.assistantMessageId
          void (async () => {
            try {
              const artifactsApi = getArtifactsApi()
              if (!artifactsApi?.list) return
              const { artifacts } = await artifactsApi.list(workingDir, { scanWorkspaceRoot })
              const produced = (artifacts || []).filter((a: any) => a.mtime >= turnStart - 1000)
              if (produced.length === 0) return
              const sess = sink.get(sessionId)
              const target = sess?.messages.find(m => m.id === targetMsgId)
              if (!sess || !target) return
              target.metadata = { ...(target.metadata || {}), artifacts: produced }
              sess.messages = [...sess.messages]
              sink.persist(sessionId)

              // 交付物一出现就送进右侧预览。这段逻辑过去住在 ArtifactsPanel 里，
              // 而那个组件只有产物 tab 挂着时才存在 —— 没挂载就永远不自动预览，
              // 正是 issue #40 问题 4 报的"生成的 Excel 看不到实时预览"。
              // design 模式跳过：它有 DesignFileWorkspace 自己的预览区，不去抢。
              if (s.mode !== 'design' && openArtifactPreview) {
                const previewable = produced
                  .filter((a: any) => isAutoPreviewPath(a.path) && !autoPreviewedPaths.has(a.path))
                  .sort((a: any, b: any) => b.mtime - a.mtime)
                if (previewable.length > 0) {
                  autoPreviewedPaths.add(previewable[0].path)
                  openArtifactPreview(previewable[0].path)
                }
              }
            } catch (err) {
              console.error('[Artifacts] turn summary collect failed:', err)
            }
          })()
        }

        // 回合窗口内被改过、但没有 Write/Edit 事件点名的文件（Bash、格式化、子代理写入）。
        // 判据用 mtime 而不是"前后两次快照求差"：原地编辑行数不变时 numstat 求差会漏，
        // 而 mtime 一定跟着写盘动。只在回合真的跑过命令或子代理时才花这次采样。
        const hasExternalWriter = msg.toolCalls?.some(tc =>
          COMMAND_TOOLS.has(tc.name) || tc.name === 'Agent' || tc.name === 'Task')
        const projectRoot = hasExternalWriter ? getProjectRoot() : null
        if (!observed && hasExternalWriter && projectRoot && !msg.metadata?.commandFiles) {
          const turnStart = ts.sendStartTime
          const targetMsgId = ts.assistantMessageId
          void (async () => {
            try {
              const stats = await api.git.getChangeStats(projectRoot)
              if (!stats) return
              const hits = stats.files
                .filter(file => file.mtimeMs >= turnStart - 1000)
                .map(file => ({ path: file.path, at: file.mtimeMs }))
              if (hits.length === 0) return

              const sess = sink.get(sessionId)
              const target = sess?.messages.find(m => m.id === targetMsgId)
              if (!sess || !target) return
              // 与工具事件重名的文件不在这里判重：collect 侧按 direct 优先合并
              target.metadata = { ...(target.metadata || {}), commandFiles: hits }
              sess.messages = [...sess.messages]
              sink.persist(sessionId)
            } catch (err) {
              console.warn('[SessionChanges] turn window scan failed:', err)
            }
          })()
        }

        if (!observed) void loadTurnCheckpoints(sessionId, s.workingDirectory, true)
      }
    }

    ts.resolve?.()
    endTurn(sessionId, ts)

    // ── Goal 续跑等跨 turn 编排钩子（仅成功结算时触发）──
    // finalText 优先取 result.result，为空时回退到消息累积内容。
    if (!observed && onTurnCompleted) {
      const s = sink.get(sessionId)
      const fallbackText = s?.messages.find(m => m.id === ts.assistantMessageId)?.content || ''
      try {
        onTurnCompleted(sessionId, resultText || fallbackText)
      } catch (e) {
        logger.warn('ChatStore', `[${sessionId.slice(0, 8)}] onTurnCompleted callback failed`, { error: String(e) })
      }
    }

    // ── Turn 结局订阅点 — settled ──
    if (onTurnOutcome) {
      try { onTurnOutcome(sessionId, 'settled') } catch (e) {
        logger.warn('ChatStore', `[${sessionId.slice(0, 8)}] onTurnOutcome(settled) failed`, { error: String(e) })
      }
    }

    // ── Play notification sound when a task completes successfully ──
    const soundEnabled = !observed && isSoundOnTaskComplete()
    logger.info('ChatStore', `[${sessionId.slice(0, 8)}] task complete, soundOnTaskComplete=${soundEnabled}`)
    if (soundEnabled) {
      try { playTaskCompleteSound() } catch (e) {
        logger.warn('ChatStore', `[${sessionId.slice(0, 8)}] failed to play task complete sound`, { error: String(e) })
      }
    }

    // ── Show desktop system notification when a task completes successfully ──
    // 去重：同一 session 在 NOTIFICATION_DEBOUNCE_MS 内只通知一次，
    // 防止残留事件创建幽灵 turn 后再次触发 handleResult 导致重复通知。
    const desktopNotifyEnabled = !observed && isDesktopNotifyOnTaskComplete()
    if (desktopNotifyEnabled) {
      const lastNotified = notifiedSessions.get(sessionId)
      const now = Date.now()
      if (!lastNotified || now - lastNotified > NOTIFICATION_DEBOUNCE_MS) {
        notifiedSessions.set(sessionId, now)
        try {
          api.showNotification({
            title: i18n.global.t('chat.taskCompleteNotificationTitle', { session: getSessionTitle(sessionId) }) as string,
            message: i18n.global.t('chat.taskCompleteNotificationBody') as string,
          })
        } catch (e) {
          logger.warn('ChatStore', `[${sessionId.slice(0, 8)}] failed to show task complete notification`, { error: String(e) })
        }
      } else {
        logger.info('ChatStore', `[${sessionId.slice(0, 8)}] task complete notification suppressed (debounced)`)
      }
    }
  }

  const handleError = (sessionId: string, ts: TurnState, error: any) => {
    if (ts.settled) return
    flushContentPatch(sessionId, ts)
    // 回合以任何非 result 方式终结（报错 / 自动重试挂起 / 中止后错误压制）都要
    // 收口未结束的 thinking：否则 timeline 事件停在 running、
    // msg.reasoning.endTime 永远为空，思考卡片一直转"思考中"。
    completeCurrentReasoningEvent(sessionId, ts)
    const elapsed = Date.now() - ts.sendStartTime
    logger.error('ChatStore', `[${sessionId.slice(0, 8)}] error in message flow | elapsed=${elapsed}ms`, { error: String(error) })

    if (userAbortedSessions.has(sessionId)) {
      logger.info('ChatStore', `[${sessionId.slice(0, 8)}] error suppressed after user abort`)
      ts.settled = true
      loadingSessions.value.set(sessionId, false)
      streamingContents.value.set(sessionId, '')
      autoRetry.removeRetryState(sessionId)
      // 中止就是这条消息的终点：再收一次口，把流式期间藏起来的「仍未闭合围栏」放回正文，
      // 否则用户停掉一个正在出卡的回合，那段 schema 就凭空消失了。
      flushContentPatch(sessionId, ts, true)
      const s = sink.get(sessionId)
      if (s) {
        s.processStatus = 'idle'
        sink.persist(sessionId)
      }
      endTurn(sessionId, ts)
      // ── Turn 结局订阅点 — aborted ──
      if (onTurnOutcome) {
        try { onTurnOutcome(sessionId, 'aborted') } catch (e) {
          logger.warn('ChatStore', `[${sessionId.slice(0, 8)}] onTurnOutcome(aborted) failed`, { error: String(e) })
        }
      }
      return
    }

    const classified = errorHandler.classifyError(error, {
      sessionId,
      provider: getProvider(),
      model: ts.model || getModel(),
      baseUrl: getBaseUrl(),
      phase: 'stream',
    })

    // pi 以 stop_reason:'error' 收场 = 引擎内部重试已全部失败（打标见 handleResult）。
    // 再发起 abort+重发只会重复撞限速，还可能跟 followUp 队列赛跑 —— 直接落错误卡片，
    // 与 claude-code「CLI 内部重试耗尽后报错」的观感对齐。
    const engineRetriesExhausted =
      (error as { engineRetriesExhausted?: boolean }).engineRetriesExhausted === true

    // 观察会话的重试归主进程流水线：渲染层再 abort+重发会和它抢同一个引擎会话。
    if (!isObserved(sessionId) && !engineRetriesExhausted && autoRetry.shouldAutoRetry(sessionId, classified.retryable, userAbortedSessions)) {
      const claudeCode = getClaudeCode()
      if (claudeCode) {
        try { claudeCode.abort(sessionId) } catch { /* ignore */ }
      }

      ts.settled = true
      void initiateAutoRetry(
        sessionId,
        ts,
        classified.category,
        classified.title,
        classified.message,
        classified.retryDelay,
        extractErrorCode(classified.technicalDetail, classified.category),
      )
      return
    }

    ts.settled = true
    loadingSessions.value.set(sessionId, false)
    streamingContents.value.set(sessionId, '')

    const hadRetry = autoRetry.retryStates.value.has(sessionId)
    autoRetry.removeRetryState(sessionId)

    errorHandler.handleError(error, {
      sessionId,
      provider: getProvider(),
      model: ts.model || getModel(),
      baseUrl: getBaseUrl(),
      phase: 'stream',
    })

    const failedDurationMs = Date.now() - ts.sendStartTime
    // 失败也是收口（自动重试那条路早在上面 return 了，还会来文本，所以不能在那儿收）：
    // 气泡正文接下来会被错误文案顶掉，但时间线里的文本事件留着，未闭合围栏要在这里回到文本。
    flushContentPatch(sessionId, ts, true)

    traceEvent({
      sessionId,
      messageId: ts.assistantMessageId,
      actor: 'assistant',
      type: 'assistant_turn',
      status: 'failed',
      title: hadRetry ? 'Assistant turn failed (retries exhausted)' : 'Assistant turn failed',
      error: { message: classified.technicalDetail },
      metadata: { [TRACE_DURATION_KEY]: failedDurationMs },
    })

    sink.patchMessage(sessionId, ts.assistantMessageId, {
      content: classified.message,
      metadata: {
        model: ts.model || getModel(),
        duration: failedDurationMs,
        error: classified,
      }
    })

    const s = sink.get(sessionId)
    if (s) {
      s.processStatus = 'exited'
      sink.persist(sessionId)
    }

    ts.reject?.(error)
    endTurn(sessionId, ts)

    // ── Turn 结局订阅点 — failed ──
    if (onTurnOutcome) {
      try { onTurnOutcome(sessionId, 'failed') } catch (e) {
        logger.warn('ChatStore', `[${sessionId.slice(0, 8)}] onTurnOutcome(failed) failed`, { error: String(e) })
      }
    }
  }

  const handleExit = (sessionId: string, ts: TurnState, data: number | null | { code?: number | null; signal?: string | null; stderr?: string }) => {
    let exitCode: number | null = null
    let stderrTail: string | undefined
    let signal: string | null | undefined
    if (typeof data === 'number' || data === null) {
      exitCode = data
    } else if (data && typeof data === 'object') {
      exitCode = data.code ?? null
      stderrTail = data.stderr || undefined
      signal = data.signal ?? undefined
    }

    logger.warn('ChatStore', `[${sessionId.slice(0, 8)}] process exit event | code=${exitCode}${signal ? ` | signal=${signal}` : ''}${stderrTail ? ` | stderr=${stderrTail.slice(0, 200)}` : ''}`)

    if (exitCode !== null && exitCode !== 0) {
      const detail = stderrTail
        ? stderrTail.split(/\r?\n/).filter(Boolean).slice(-3).join(' | ')
        : undefined
      const msg = detail
        ? `Process exited with code ${exitCode}: ${detail}`
        : `Process exited with code ${exitCode}`
      handleError(sessionId, ts, new Error(msg))
      return
    }
  }

  return { handleResult, handleError, handleExit }
}
