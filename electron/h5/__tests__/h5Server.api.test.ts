// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * The authenticated API surface of the H5 server: token handling, route
 * dispatch, the session guards, and the fan-out a remote user message performs
 * onto the desktop renderer.
 *
 * Everything is driven over a real socket against a real `http.createServer`
 * started on port 0 — no handler is called directly, so a route that forgot to
 * authenticate or to validate its payload would show up as a different status
 * code rather than as a passing unit test.
 */

vi.mock('electron', async () => {
  const { electronMock } = await import('./h5TestKit')
  return electronMock
})

vi.mock('../../infra/logger', async () => {
  const { loggerStub } = await import('./h5TestKit')
  return loggerStub
})

vi.mock('../../engine/engineGateway', async () => {
  const { gatewayStub } = await import('./h5TestKit')
  return { engineGateway: gatewayStub, NotImplementedError: class NotImplementedError extends Error {} }
})

vi.mock('../../engine/engines/EngineFactory', async () => {
  const { engineFactoryStub } = await import('./h5TestKit')
  return { EngineFactory: engineFactoryStub }
})

vi.mock('../../session/sessionHistoryManager', async () => {
  const { historyStub } = await import('./h5TestKit')
  return { SessionHistoryManager: historyStub }
})

// The proxy resolves hostnames before fetching; stubbing the resolver keeps the
// suite off real DNS.
vi.mock('dns', async () => {
  const { dnsStub } = await import('./h5TestKit')
  return { promises: dnsStub }
})

import { H5Server } from '../h5Server'
import {
  TEST_TOKEN,
  auth,
  dnsStub,
  engineFactoryStub,
  gatewayStub,
  historyStub,
  jsonOf,
  loggerStub,
  makeWindow,
  rawRequest,
  resetDnsStub,
  resetEngineFactoryStub,
  resetGatewayStub,
  resetHistoryStub,
  resetRuntime,
  runtime,
  type FakeWindow,
  type RawResponse,
} from './h5TestKit'

type AuthMode = 'header' | 'query' | 'none' | 'wrong' | 'empty-bearer'

const WRONG_TOKEN = 'h5_wrongtoken0000000000000'

describe('H5Server API surface', () => {
  let server: H5Server
  let port = 0

  async function call(
    pathname: string,
    body?: Record<string, unknown>,
    init?: { method?: string; auth?: AuthMode },
  ): Promise<RawResponse> {
    const mode = init?.auth ?? 'header'
    const withQuery = mode === 'query' ? `${pathname}?token=${TEST_TOKEN}` : pathname
    return rawRequest({
      port,
      path: withQuery,
      method: init?.method ?? (body === undefined ? 'GET' : 'POST'),
      body,
      token: mode === 'header' ? TEST_TOKEN : mode === 'wrong' ? WRONG_TOKEN : undefined,
      headers: mode === 'empty-bearer' ? { Authorization: 'Bearer ' } : undefined,
    })
  }

  beforeEach(async () => {
    resetRuntime()
    resetGatewayStub()
    resetHistoryStub()
    resetEngineFactoryStub()
    resetDnsStub()
    server = new H5Server(auth)
    port = (await server.start(0)).port
  })

  afterEach(() => {
    server.stop()
  })

  describe('token gate', () => {
    it('rejects an API call that carries no credential', async () => {
      const res = await call('/api/sessions/active', undefined, { auth: 'none' })

      expect(res.status).toBe(401)
      expect(jsonOf(res)).toEqual({ error: 'Unauthorized' })
      expect(gatewayStub.getActiveSessions).not.toHaveBeenCalled()
    })

    it('rejects a wrong bearer token', async () => {
      const res = await call('/api/sessions/active', undefined, { auth: 'wrong' })

      expect(res.status).toBe(401)
      expect(auth.validateToken).toHaveBeenCalledWith(WRONG_TOKEN)
    })

    it('rejects a bare "Bearer " prefix instead of treating it as a token', async () => {
      const res = await call('/api/sessions/active', undefined, { auth: 'empty-bearer' })

      expect(res.status).toBe(401)
      expect(auth.validateToken).toHaveBeenCalledWith(null)
    })

    it('accepts the token from the Authorization header', async () => {
      const res = await call('/api/sessions/active')

      expect(res.status).toBe(200)
      expect(auth.validateToken).toHaveBeenCalledWith(TEST_TOKEN)
    })

    it('refuses the token when it arrives in the query string', async () => {
      // Query strings end up in browser history, proxy and server logs, and
      // Referer headers. Only /ws may still take a token that way.
      const res = await call('/api/sessions/active', undefined, { auth: 'query' })

      expect(res.status).toBe(401)
      expect(jsonOf(res)).toEqual({ error: 'Unauthorized' })
      expect(auth.validateToken).toHaveBeenCalledWith(null)
    })

    it('validates the token before reading the request body', async () => {
      const res = await rawRequest({
        port,
        path: '/api/session/send',
        method: 'POST',
        body: 'not json at all',
      })

      expect(res.status).toBe(401)
    })

    it('answers 500 instead of hanging on a malformed JSON body', async () => {
      const res = await rawRequest({
        port,
        path: '/api/session/send',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TEST_TOKEN}` },
        body: '{"sessionId": ',
      })

      expect(res.status).toBe(500)
      expect(jsonOf(res)).toEqual({ error: 'Invalid JSON body' })
      expect(loggerStub.error).toHaveBeenCalledWith('H5Server', expect.stringContaining('API error'))
    })

    it('does not parse a body for GET, so query-string reads stay possible', async () => {
      historyStub.listProjectSessions.mockResolvedValueOnce([])

      const res = await call('/api/sessions/list?projectPath=/work/p')

      expect(res.status).toBe(200)
      expect(historyStub.listProjectSessions).toHaveBeenCalledWith('/work/p')
    })
  })

  describe('route dispatch', () => {
    it('404s an unknown API path rather than falling through to statics', async () => {
      const res = await call('/api/nope/nope')

      expect(res.status).toBe(404)
      expect(jsonOf(res)).toEqual({ error: 'Unknown API: /api/nope/nope' })
    })

    it('surfaces an engine failure as a 500 with the gateway message', async () => {
      gatewayStub.abort.mockRejectedValueOnce(new Error('cli process gone'))

      const res = await call('/api/session/abort', { sessionId: 'sess-1' })

      expect(res.status).toBe(500)
      expect(jsonOf(res)).toEqual({ error: 'cli process gone' })
    })

    it('serves the configured body of a GET-only route as an empty object', async () => {
      const res = await call('/api/session/status', undefined, { method: 'GET' })

      expect(res.status).toBe(400)
      expect(jsonOf(res)).toEqual({ error: 'sessionId required' })
    })

    it('starts a session with an undefined id when the caller uses GET (no body at all)', async () => {
      // /api/session/start has no requireSessionId guard, so a bare GET reaches
      // the gateway with `undefined` instead of being rejected.
      const res = await call('/api/session/start', undefined, { method: 'GET' })

      expect(res.status).toBe(200)
      expect(gatewayStub.startSession).toHaveBeenCalledWith(undefined, undefined)
    })
  })

  describe('session lifecycle routes', () => {
    it('starts a session and mirrors it when the config carries a cwd', async () => {
      const config = { cwd: '/work/project', engineType: 'claude-code', title: 'First run' }

      const res = await call('/api/session/start', { sessionId: 'sess-1', config })

      expect(res.status).toBe(200)
      expect(gatewayStub.startSession).toHaveBeenCalledWith('sess-1', config)
      expect(jsonOf(await call('/api/desktop-config'))).toMatchObject({
        mirrorSessionId: 'sess-1',
        mirrorProjectPath: '/work/project',
      })
    })

    it('leaves the mirror alone when a session starts without a cwd', async () => {
      const res = await call('/api/session/start', { sessionId: 'sess-2', config: {} })

      expect(res.status).toBe(200)
      expect(jsonOf(await call('/api/desktop-config'))).toMatchObject({
        mirrorSessionId: null,
        mirrorProjectPath: null,
      })
    })

    it('reports active sessions through the desktop config projection', async () => {
      gatewayStub.getActiveSessions.mockReturnValue([
        { sessionId: 'a', engineSessionId: 'e-a', status: 'running', isRunning: true },
        { sessionId: 'b', engineSessionId: null, status: 'idle', isRunning: false },
      ])

      const res = await call('/api/desktop-config')

      expect(jsonOf(res)).toMatchObject({
        activeSessions: [
          { sessionId: 'a', engineSessionId: 'e-a', status: 'running', isRunning: true },
          { sessionId: 'b', engineSessionId: null, status: 'idle', isRunning: false },
        ],
      })
    })

    it('returns the live mcp / context / settings payloads', async () => {
      gatewayStub.getMcpStatus.mockResolvedValueOnce({ servers: [{ name: 'fs', status: 'connected' }] })
      gatewayStub.getContextUsage.mockResolvedValueOnce({ used: 42_000, limit: 200_000 })

      const mcp = await call('/api/session/mcp-status', { sessionId: 'sess-1' })
      const context = await call('/api/session/context-usage', { sessionId: 'sess-1' })
      const settings = await call('/api/session/settings', { sessionId: 'sess-1' })

      expect(jsonOf(mcp)).toEqual({ servers: [{ name: 'fs', status: 'connected' }] })
      expect(jsonOf(context)).toEqual({ used: 42_000, limit: 200_000 })
      expect(jsonOf(settings)).toEqual({ model: 'sonnet' })
    })

    it('answers a POST with no body as an empty payload', async () => {
      // readBody resolves {} for an empty chunk list rather than parsing ''
      const res = await rawRequest({
        port,
        path: '/api/session/suspend',
        method: 'POST',
        token: TEST_TOKEN,
      })

      expect(res.status).toBe(400)
      expect(jsonOf(res)).toEqual({ error: 'sessionId required' })
    })

    it('aborts, stops and suspends a session by id', async () => {
      expect(await call('/api/session/abort', { sessionId: 'sess-1' })).toMatchObject({ status: 200 })
      expect(await call('/api/session/stop', { sessionId: 'sess-1' })).toMatchObject({ status: 200 })
      expect(await call('/api/session/suspend', { sessionId: 'sess-1' })).toMatchObject({ status: 200 })

      expect(gatewayStub.abort).toHaveBeenCalledWith('sess-1')
      expect(gatewayStub.stop).toHaveBeenCalledWith('sess-1')
      expect(gatewayStub.suspendSession).toHaveBeenCalledWith('sess-1')
    })

    it('returns the resumed status', async () => {
      gatewayStub.resumeSession.mockResolvedValueOnce({ status: 'running', engineSessionId: 'e-1' })

      const res = await call('/api/session/resume', { sessionId: 'sess-1' })

      expect(jsonOf(res)).toEqual({ status: { status: 'running', engineSessionId: 'e-1' } })
    })

    it('forwards every permission decision field to the gateway', async () => {
      await call('/api/session/permission/allow', {
        sessionId: 'sess-1',
        requestId: 'req-1',
        updatedInput: { command: 'ls' },
        decisionClassification: 'user_temporary',
      })
      await call('/api/session/permission/deny', {
        sessionId: 'sess-1',
        requestId: 'req-1',
        message: 'nope',
        options: { interrupt: true },
      })

      expect(gatewayStub.allowPermission).toHaveBeenCalledWith(
        'sess-1',
        'req-1',
        { command: 'ls' },
        'user_temporary',
      )
      expect(gatewayStub.denyPermission).toHaveBeenCalledWith('sess-1', 'req-1', 'nope', {
        interrupt: true,
      })
    })

    it('forwards tool answers and skips', async () => {
      await call('/api/session/tool-answer', {
        sessionId: 'sess-1',
        toolCallId: 'tool-1',
        answers: { colour: 'blue' },
      })
      await call('/api/session/tool-skip', { sessionId: 'sess-1', toolCallId: 'tool-2' })

      expect(gatewayStub.submitToolAnswer).toHaveBeenCalledWith('sess-1', 'tool-1', { colour: 'blue' })
      expect(gatewayStub.skipToolAnswer).toHaveBeenCalledWith('sess-1', 'tool-2')
    })

    /**
     * pi 扩展对话框的应答 (issue #54)。H5 与桌面共用同一张卡片，差别只在回帧走 REST。
     * 这里钉的是「失败要回非 2xx」：渲染层靠它把卡片退回可重试态，回 200 等于骗用户。
     */
    it('forwards an extension dialog answer keyed by the pi-side id', async () => {
      const res = await call('/api/session/extension-dialog/respond', {
        sessionId: 'sess-1',
        dialogId: 'uuid-1',
        answer: { kind: 'value', value: 'Implement here' },
      })

      expect(res.status).toBe(200)
      expect(gatewayStub.respondExtensionDialog).toHaveBeenCalledWith('sess-1', 'uuid-1', {
        kind: 'value',
        value: 'Implement here',
      })
    })

    it('400s the dialog route without a dialogId', async () => {
      const res = await call('/api/session/extension-dialog/respond', {
        sessionId: 'sess-1',
        answer: { kind: 'cancel' },
      })

      expect(res.status).toBe(400)
      expect(gatewayStub.respondExtensionDialog).not.toHaveBeenCalled()
    })

    it('500s when the dialog is already gone, so the client can roll the card back', async () => {
      gatewayStub.respondExtensionDialog.mockImplementationOnce(() => {
        throw new Error('No pending extension dialog id=uuid-1')
      })

      const res = await call('/api/session/extension-dialog/respond', {
        sessionId: 'sess-1',
        dialogId: 'uuid-1',
        answer: { kind: 'confirmed', confirmed: true },
      })

      expect(res.status).toBe(500)
      expect(jsonOf(res)).toEqual({ error: 'No pending extension dialog id=uuid-1' })
    })
  })

  describe('requireSessionId', () => {
    const guarded = [
      '/api/session/suspend',
      '/api/session/resume',
      '/api/session/permission-mode',
      '/api/session/model',
      '/api/session/thinking-level',
      '/api/session/mcp-status',
      '/api/session/context-usage',
      '/api/session/settings',
      '/api/session/pending-permissions',
      '/api/session/task-stop',
      '/api/session/agent-transcript',
      '/api/session/extension-dialog/respond',
    ]

    it.each(guarded)('400s %s when the sessionId is absent', async (pathname) => {
      const res = await call(pathname, { mode: 'plan' })

      expect(res.status).toBe(400)
      expect(jsonOf(res)).toEqual({ error: 'sessionId required' })
    })

    it.each(guarded)('400s %s when the sessionId is an empty string', async (pathname) => {
      const res = await call(pathname, { sessionId: '' })

      expect(res.status).toBe(400)
      expect(jsonOf(res)).toEqual({ error: 'sessionId required' })
    })

    it('never asks the engine for a guarded call without a session', async () => {
      await call('/api/session/mcp-status', {})
      await call('/api/session/model', {})

      expect(gatewayStub.getMcpStatus).not.toHaveBeenCalled()
      expect(gatewayStub.setModel).not.toHaveBeenCalled()
    })

    it('passes a non-string sessionId straight through to the engine', async () => {
      // the guard only tests truthiness; a numeric id reaches the gateway as-is
      const res = await call('/api/session/settings', { sessionId: 42 as unknown as string })

      expect(res.status).toBe(200)
      expect(gatewayStub.getSettings).toHaveBeenCalledWith(42)
    })
  })

  describe('query routes', () => {
    it('returns the session status for a known session', async () => {
      gatewayStub.getSessionStatus.mockReturnValueOnce({
        sessionId: 'sess-1',
        status: 'running',
        isRunning: true,
      })

      const res = await call('/api/session/status', { sessionId: 'sess-1' })

      expect(jsonOf(res)).toMatchObject({ sessionId: 'sess-1', status: 'running' })
    })

    it('mirrors the desktop selection and pushes the change', async () => {
      const res = await call('/api/mirror-session', {
        sessionId: 'sess-9',
        projectPath: '/work/nine',
      })

      expect(res.status).toBe(200)
      expect(jsonOf(await call('/api/desktop-config'))).toMatchObject({
        mirrorSessionId: 'sess-9',
        mirrorProjectPath: '/work/nine',
      })
    })

    it('clears the mirror when the desktop reports no session', async () => {
      await call('/api/mirror-session', { sessionId: 'sess-9', projectPath: '/work/nine' })

      const res = await call('/api/mirror-session', { sessionId: null, projectPath: null })

      expect(res.status).toBe(200)
      expect(jsonOf(await call('/api/desktop-config'))).toMatchObject({
        mirrorSessionId: null,
        mirrorProjectPath: null,
      })
    })

    it('lists project sessions through the history manager mapping', async () => {
      historyStub.listProjectSessions.mockResolvedValueOnce([
        { projectPath: '/work/p', sessionId: 's-1', firstUserMessage: 'hello', lastMessageTimestamp: 1700 },
      ])
      historyStub.getSessionTitle.mockReturnValueOnce('titled')
      historyStub.formatTimestamp.mockReturnValueOnce('just now')

      const res = await call('/api/sessions/list', { projectPath: '/work/p' })

      expect(res.status).toBe(200)
      expect(jsonOf(res)).toEqual([
        {
          projectPath: '/work/p',
          sessionId: 's-1',
          firstUserMessage: 'hello',
          lastMessageTimestamp: 1700,
          title: 'titled',
          displayTime: 'just now',
        },
      ])
    })

    it('reads the projectPath from the query for sessions/list', async () => {
      await call('/api/sessions/list?projectPath=/work/qp')

      expect(historyStub.listProjectSessions).toHaveBeenCalledWith('/work/qp')
    })

    it('400s sessions/list when neither body nor query names a project', async () => {
      const res = await call('/api/sessions/list', {})

      expect(res.status).toBe(400)
    })

    it('fetches a full session history when both ids are present', async () => {
      historyStub.getFullSession.mockResolvedValueOnce({ messages: [1, 2, 3] })

      const res = await call('/api/sessions/history', { projectPath: '/work/p', sessionId: 's-1' })

      expect(jsonOf(res)).toEqual({ messages: [1, 2, 3] })
      expect(historyStub.getFullSession).toHaveBeenCalledWith('/work/p', 's-1')
    })

    it('400s sessions/history when the sessionId is missing', async () => {
      const res = await call('/api/sessions/history', { projectPath: '/work/p' })

      expect(res.status).toBe(400)
      expect(jsonOf(res)).toEqual({ error: 'projectPath and sessionId required' })
    })

    it('passes cwd and engine type through to the agent list', async () => {
      const res = await call('/api/agents/list', { cwd: '/work/p', engineType: 'claude-code' })

      expect(res.status).toBe(200)
      expect(gatewayStub.listAgents).toHaveBeenCalledWith('/work/p', 'claude-code')
    })

    it('400s an availability probe with no engine type', async () => {
      const res = await call('/api/engine/available', {})

      expect(res.status).toBe(400)
      expect(jsonOf(res)).toEqual({ error: 'engineType required' })
    })

    it('reports engine availability with the reason and version the UI needs', async () => {
      engineFactoryStub.getEngineAvailability.mockResolvedValueOnce({
        available: false, reason: 'version-too-old', version: '0.73.0', installable: false,
      })

      const res = await call('/api/engine/available', { engineType: 'pi' })

      expect(jsonOf(res)).toEqual({ available: false, reason: 'version-too-old', version: '0.73.0', installable: false })
      expect(engineFactoryStub.getEngineAvailability).toHaveBeenCalledWith('pi')
    })

    it('returns agent transcript paths and degrades to null when lookup fails', async () => {
      const ok = await call('/api/session/agent-transcript', {
        sessionId: 'sess-1',
        agentId: 'agent-1',
        projectPath: '/work/p',
      })
      expect(jsonOf(ok)).toBe('/tmp/transcript.jsonl')
      expect(historyStub.getAgentTranscriptPath).toHaveBeenCalledWith('/work/p', 'sess-1', 'agent-1')

      historyStub.getAgentTranscriptPath.mockImplementationOnce(() => {
        throw new Error('no transcript')
      })
      const failed = await call('/api/session/agent-transcript', { sessionId: 'sess-1', agentId: 'a-2' })

      expect(failed.status).toBe(200)
      expect(jsonOf(failed)).toBeNull()
      expect(loggerStub.warn).toHaveBeenCalledWith('H5Server', expect.stringContaining('getAgentTranscriptPath failed'))
    })

    it('400s an agent transcript request without an agentId', async () => {
      const res = await call('/api/session/agent-transcript', { sessionId: 'sess-1' })

      expect(res.status).toBe(400)
      expect(jsonOf(res)).toEqual({ error: 'agentId required' })
    })

    it('400s a task stop without a taskId', async () => {
      const res = await call('/api/session/task-stop', { sessionId: 'sess-1' })

      expect(res.status).toBe(400)
      expect(jsonOf(res)).toEqual({ error: 'taskId required' })
    })

    it('stops an engine task', async () => {
      const res = await call('/api/session/task-stop', { sessionId: 'sess-1', taskId: 'task-1' })

      expect(res.status).toBe(200)
      expect(gatewayStub.stopEngineTask).toHaveBeenCalledWith('sess-1', 'task-1')
    })

    it('forwards model, permission mode and thinking level updates', async () => {
      await call('/api/session/model', { sessionId: 'sess-1', model: 'opus' })
      await call('/api/session/permission-mode', { sessionId: 'sess-1', mode: 'plan' })
      const thinking = await call('/api/session/thinking-level', { sessionId: 'sess-1', enabled: true })

      expect(gatewayStub.setModel).toHaveBeenCalledWith('sess-1', 'opus')
      expect(gatewayStub.setPermissionMode).toHaveBeenCalledWith('sess-1', 'plan')
      expect(gatewayStub.updateThinkingLevel).toHaveBeenCalledWith('sess-1', true)
      // 生效时机要带回客户端：H5 界面靠它决定提示，光 ok:true 分不清 now / next-turn。
      expect(jsonOf(thinking)).toEqual({ ok: true, timing: 'now' })
    })

    it('surfaces a thinking-level failure as a 500 instead of ok:true', async () => {
      gatewayStub.updateThinkingLevel.mockRejectedValueOnce(new Error('pi process gone'))

      const res = await call('/api/session/thinking-level', { sessionId: 'sess-1', enabled: true })

      expect(res.status).toBe(500)
      expect(jsonOf(res)).toEqual({ error: 'pi process gone' })
    })

    it('projects the pending permission request ids', async () => {
      gatewayStub.getPendingPermissionRequestIds.mockReturnValueOnce(['r-1', 'r-2'])

      const res = await call('/api/session/pending-permissions', { sessionId: 'sess-1' })

      expect(jsonOf(res)).toEqual(['r-1', 'r-2'])
    })
  })

  describe('session send', () => {
    it('sends a message and mirrors it onto the desktop window', async () => {
      const win = makeWindow()
      runtime.windows = [win]

      const res = await call('/api/session/send', {
        sessionId: 'sess-1',
        content: 'do the thing',
        clientMessageId: 'cm-1',
      })

      expect(res.status).toBe(200)
      expect(gatewayStub.sendMessage).toHaveBeenCalledWith('sess-1', 'do the thing', undefined)
      expect(win.webContents.send).toHaveBeenCalledWith(
        'claude-code:user',
        expect.objectContaining({
          sessionId: 'sess-1',
          data: expect.objectContaining({ __h5RemoteUserMessage: true, messageId: 'cm-1', content: 'do the thing' }),
        }),
      )
    })

    it('uses the remembered project path for later sends in the same session', async () => {
      const win = makeWindow()
      runtime.windows = [win]
      await call('/api/session/start', { sessionId: 'sess-1', config: { cwd: '/work/kept' } })

      await call('/api/session/send', { sessionId: 'sess-1', content: 'again' })

      expect(win.webContents.send).toHaveBeenCalledWith(
        'claude-code:user',
        expect.objectContaining({ data: expect.objectContaining({ projectPath: '/work/kept' }) }),
      )
    })

    it('prefers displayContent over the raw prompt', async () => {
      const win = makeWindow()
      runtime.windows = [win]

      await call('/api/session/send', {
        sessionId: 'sess-1',
        content: 'raw prompt with base64 attachments',
        displayContent: '用户可见文本',
      })

      expect(win.webContents.send).toHaveBeenCalledWith(
        'claude-code:user',
        expect.objectContaining({ data: expect.objectContaining({ content: '用户可见文本' }) }),
      )
      expect(gatewayStub.sendMessage).toHaveBeenCalledWith(
        'sess-1',
        'raw prompt with base64 attachments',
        undefined,
      )
    })

    it('accepts an image-only message and titles it [Image]', async () => {
      const win = makeWindow()
      runtime.windows = [win]

      const res = await call('/api/session/send', {
        sessionId: 'sess-1',
        content: '',
        images: [{ mediaType: 'image/png', data: 'AAAA' }],
      })

      expect(res.status).toBe(200)
      expect(win.webContents.send).toHaveBeenCalledWith(
        'claude-code:user',
        expect.objectContaining({ data: expect.objectContaining({ content: '[Image]' }) }),
      )
    })

    it('400s a send with no session', async () => {
      const res = await call('/api/session/send', { content: 'orphan' })

      expect(res.status).toBe(400)
      expect(jsonOf(res)).toEqual({ error: 'sessionId and content required' })
    })

    it('400s a send whose content is not a string', async () => {
      const res = await call('/api/session/send', { sessionId: 'sess-1', content: 7 })

      expect(res.status).toBe(400)
      expect(jsonOf(res)).toEqual({ error: 'sessionId and content required' })
    })

    it('400s an empty message with no images attached', async () => {
      const res = await call('/api/session/send', { sessionId: 'sess-1', content: '', images: [] })

      expect(res.status).toBe(400)
      expect(jsonOf(res)).toEqual({ error: 'content or images required' })
    })

    it('409s when the session has no live process', async () => {
      gatewayStub.getSessionStatus.mockReturnValueOnce(null)

      const res = await call('/api/session/send', { sessionId: 'sess-dead', content: 'hi' })

      expect(res.status).toBe(409)
      // reason code 让 H5 客户端走 i18n 文案（issue #55），不再直出英文原句。
      expect(jsonOf(res)).toEqual({
        error: 'Session sess-dead has no active process',
        reason: 'session-not-active',
      })
      expect(gatewayStub.sendMessage).not.toHaveBeenCalled()
    })

    it('409s when the recorded process is not running', async () => {
      gatewayStub.getSessionStatus.mockReturnValueOnce({ sessionId: 'sess-1', isRunning: false })

      const res = await call('/api/session/send', { sessionId: 'sess-1', content: 'hi' })

      expect(res.status).toBe(409)
    })

    it('pushes the failure to the desktop and answers 500 when the engine rejects', async () => {
      const win = makeWindow()
      runtime.windows = [win]
      gatewayStub.sendMessage.mockRejectedValueOnce(new Error('cli died mid-turn'))

      const res = await call('/api/session/send', { sessionId: 'sess-1', content: 'hi' })

      expect(res.status).toBe(500)
      expect(win.webContents.send).toHaveBeenCalledWith(
        'claude-code:error',
        expect.objectContaining({ data: { message: 'cli died mid-turn' } }),
      )
    })

    it('survives a non-Error rejection', async () => {
      gatewayStub.sendMessage.mockRejectedValueOnce('plain string failure')

      const res = await call('/api/session/send', { sessionId: 'sess-1', content: 'hi' })

      expect(res.status).toBe(500)
    })

    it('pushes the engine failure only to windows that are still alive', async () => {
      const dead = makeWindow(true)
      const live = makeWindow()
      runtime.windows = [dead, live]
      gatewayStub.sendMessage.mockRejectedValueOnce(new Error('gpu process crashed'))

      const res = await call('/api/session/send', { sessionId: 'sess-1', content: 'hi' })

      expect(res.status).toBe(500)
      expect(dead.webContents.send).not.toHaveBeenCalled()
      expect(live.webContents.send).toHaveBeenCalledWith(
        'claude-code:error',
        expect.objectContaining({ sessionId: 'sess-1', data: { message: 'gpu process crashed' } }),
      )
    })

    it('skips a desktop window that has already been destroyed', async () => {
      const dead = makeWindow(true)
      runtime.windows = [dead, makeWindow()]

      const res = await call('/api/session/send', { sessionId: 'sess-1', content: 'hi' })

      expect(res.status).toBe(200)
      expect(dead.webContents.send).not.toHaveBeenCalled()
    })
  })

  describe('desktop config', () => {
    let home = ''

    beforeEach(() => {
      home = mkdtempSync(join(tmpdir(), 'spacecode-h5-home-'))
      runtime.homeDir = home
    })

    afterEach(() => {
      rmSync(home, { recursive: true, force: true })
      runtime.homeDir = ''
    })

    it('returns null gui settings when the file was never written', async () => {
      const res = await call('/api/desktop-config')

      expect(jsonOf(res)).toMatchObject({ guiSettings: null })
    })

    function writeSettings(content: string): void {
      mkdirSync(join(home, '.claude'), { recursive: true })
      writeFileSync(join(home, '.claude', 'gui-settings.json'), content, 'utf-8')
    }

    it('returns the settings file verbatim', async () => {
      const raw = JSON.stringify({ model: 'sonnet', thinkingEnabled: true })
      writeSettings(raw)

      const res = await call('/api/desktop-config')

      expect(jsonOf(res)).toMatchObject({ guiSettings: raw })
    })

    it('strips provider credentials before the settings leave the desktop', async () => {
      writeSettings(
        JSON.stringify({
          authMethod: 'anthropic_compatible',
          anthropicConfig: { baseUrl: 'https://api.example.com', apiKey: 'sk-ant-secret', sonnetModel: 'claude-sonnet-4' },
          openaiConfig: { apiKey: 'sk-open-secret', baseUrl: 'https://o.example.com' },
          pet: { nickname: 'Bo' },
        }),
      )

      const res = await call('/api/desktop-config')

      const guiSettings = (jsonOf(res) as { guiSettings: string }).guiSettings
      expect(guiSettings).not.toContain('sk-ant-secret')
      expect(guiSettings).not.toContain('sk-open-secret')
      expect(JSON.parse(guiSettings)).toEqual({
        authMethod: 'anthropic_compatible',
        anthropicConfig: { baseUrl: 'https://api.example.com', sonnetModel: 'claude-sonnet-4' },
        openaiConfig: { baseUrl: 'https://o.example.com' },
        pet: { nickname: 'Bo' },
      })
    })

    it('answers null for a settings document it cannot inspect', async () => {
      writeSettings('{oops')

      const res = await call('/api/desktop-config')

      // A document that will not parse cannot be proven credential-free, so it
      // is not forwarded.
      expect(res.status).toBe(200)
      expect(jsonOf(res)).toMatchObject({ guiSettings: null })
    })

    it('answers null settings when the home path cannot be read', async () => {
      mkdirSync(join(home, '.claude'), { recursive: true })
      // a directory where the file is expected makes readFileSync throw
      mkdirSync(join(home, '.claude', 'gui-settings.json'), { recursive: true })

      const res = await call('/api/desktop-config')

      expect(res.status).toBe(200)
      expect(jsonOf(res)).toMatchObject({ guiSettings: null })
      expect(loggerStub.warn).toHaveBeenCalledWith('H5Server', expect.stringContaining('gui-settings.json'))
    })

    it('reports the mirror it is holding even before any client connects', async () => {
      server.setMirrorSession('sess-m', '/work/m')

      const res = await call('/api/desktop-config')

      expect(jsonOf(res)).toMatchObject({
        mirrorSessionId: 'sess-m',
        mirrorProjectPath: '/work/m',
      })
    })
  })

  describe('http fetch proxy', () => {
    function fetchJson(body: Record<string, unknown>): Promise<RawResponse> {
      return call('/api/http/fetch', body)
    }

    it('refuses a URL that is not http(s)', async () => {
      const res = await fetchJson({ url: 'file:///etc/passwd' })

      expect(res.status).toBe(200)
      expect(jsonOf(res)).toEqual({ ok: false, status: 0, error: 'Invalid URL' })
      expect(runtime.fetchImpl).not.toHaveBeenCalled()
    })

    it('refuses an empty url', async () => {
      const res = await fetchJson({})

      expect(jsonOf(res)).toEqual({ ok: false, status: 0, error: 'Invalid URL' })
    })

    it('refuses loopback targets so the proxy is not an SSRF hop', async () => {
      const res = await fetchJson({ url: 'http://127.0.0.1:9999/api' })

      expect(jsonOf(res)).toEqual({ ok: false, status: 0, error: 'URL is not allowed' })
      expect(runtime.fetchImpl).not.toHaveBeenCalled()
      expect(loggerStub.warn).toHaveBeenCalledWith('H5Server', expect.stringContaining('blocked internal/private URL'))
    })

    it('refuses a public hostname that resolves to an internal address', async () => {
      // The literal hostname says "public"; only the answer does not.
      dnsStub.lookup.mockResolvedValueOnce([{ address: '169.254.169.254' }])

      const res = await fetchJson({ url: 'https://metadata.example.com/latest' })

      expect(jsonOf(res)).toEqual({ ok: false, status: 0, error: 'URL is not allowed' })
      expect(runtime.fetchImpl).not.toHaveBeenCalled()
    })

    it('refuses a hostname that resolves to nothing', async () => {
      dnsStub.lookup.mockResolvedValueOnce([])

      const res = await fetchJson({ url: 'https://gone.example.com/' })

      expect(jsonOf(res)).toEqual({ ok: false, status: 0, error: 'URL is not allowed' })
      expect(runtime.fetchImpl).not.toHaveBeenCalled()
    })

    it('does not let the resolver run when the host is already an IP literal', async () => {
      runtime.fetchImpl.mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'fine' })

      const res = await fetchJson({ url: 'https://93.184.216.34/' })

      expect(jsonOf(res)).toMatchObject({ ok: true, status: 200 })
      expect(dnsStub.lookup).not.toHaveBeenCalled()
    })

    it('refuses a redirect instead of following it to another address', async () => {
      runtime.fetchImpl.mockResolvedValueOnce({
        type: 'opaqueredirect',
        status: 0,
        ok: false,
        text: async () => '',
      })

      const res = await fetchJson({ url: 'https://hop.example.com/' })

      expect(jsonOf(res)).toEqual({ ok: false, status: 0, error: 'Redirects are not allowed' })
      expect(runtime.fetchImpl).toHaveBeenCalledWith(
        'https://hop.example.com/',
        expect.objectContaining({ redirect: 'manual' }),
      )
    })

    it('refuses a visible 3xx the upstream answers with', async () => {
      runtime.fetchImpl.mockResolvedValueOnce({ status: 302, ok: false, text: async () => '' })

      const res = await fetchJson({ url: 'https://hop.example.com/away' })

      expect(jsonOf(res)).toEqual({ ok: false, status: 0, error: 'Redirects are not allowed' })
      expect(loggerStub.warn).toHaveBeenCalledWith('H5Server', expect.stringContaining('blocked redirect'))
    })

    it('names the redirect refusal when Electron throws instead of answering 3xx', async () => {
      // redirect:'manual' measured on Electron 43: a redirect rejects with
      // "Redirect was cancelled" rather than surfacing the 3xx response.
      runtime.fetchImpl.mockRejectedValueOnce(new Error('Redirect was cancelled'))

      const res = await fetchJson({ url: 'https://hop.example.com/' })

      expect(jsonOf(res)).toEqual({ ok: false, status: 0, error: 'Redirects are not allowed' })
    })

    it('proxies a public URL and returns the body text', async () => {
      runtime.fetchImpl.mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: async () => 'created',
      })

      const res = await fetchJson({
        url: 'https://example.com/things',
        options: { method: 'POST', headers: { 'X-Test': '1' }, body: '{"a":1}', timeoutMs: 5000 },
      })

      expect(jsonOf(res)).toEqual({ ok: true, status: 201, data: 'created' })
      expect(runtime.fetchImpl).toHaveBeenCalledWith(
        'https://example.com/things',
        expect.objectContaining({ method: 'POST', headers: { 'X-Test': '1' }, body: '{"a":1}' }),
      )
    })

    it('defaults to GET with no headers or body', async () => {
      runtime.fetchImpl.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' })

      await fetchJson({ url: 'https://example.com/' })

      expect(runtime.fetchImpl).toHaveBeenCalledWith(
        'https://example.com/',
        expect.objectContaining({ method: 'GET', headers: {}, body: undefined }),
      )
    })

    it('aborts a hung upstream when its own timeout fires', async () => {
      runtime.fetchImpl.mockImplementationOnce((_url: unknown, init: unknown) =>
        new Promise<never>((_resolve, reject) => {
          const signal = (init as { signal?: AbortSignal }).signal
          signal?.addEventListener('abort', () => {
            const aborted = new Error('This operation was aborted')
            aborted.name = 'AbortError'
            reject(aborted)
          })
        }),
      )

      const res = await fetchJson({ url: 'https://example.com/hang', options: { timeoutMs: 1200 } })

      expect(jsonOf(res)).toEqual({ ok: false, status: 0, error: 'Request timed out (1s)' })
      expect(loggerStub.warn).toHaveBeenCalledWith('H5Server', expect.stringContaining('http fetch failed'))
    })

    it('reports a timeout as a bounded message', async () => {
      runtime.fetchImpl.mockImplementationOnce(async () => {
        const error = new Error('This operation was aborted')
        error.name = 'AbortError'
        throw error
      })

      const res = await fetchJson({ url: 'https://example.com/slow', options: { timeoutMs: 1000 } })

      expect(jsonOf(res)).toEqual({ ok: false, status: 0, error: 'Request timed out (1s)' })
    })

    it('reports a transport failure verbatim', async () => {
      runtime.fetchImpl.mockRejectedValueOnce(new Error('socket hang up'))

      const res = await fetchJson({ url: 'https://example.com/', options: { timeoutMs: 250 } })

      expect(jsonOf(res)).toEqual({ ok: false, status: 0, error: 'socket hang up' })
    })

    it('passes a non-Error rejection through as a string', async () => {
      runtime.fetchImpl.mockRejectedValueOnce({ toString: () => 'weird failure' })

      const res = await fetchJson({ url: 'https://example.com/', options: { timeoutMs: 250 } })

      expect(jsonOf(res)).toEqual({ ok: false, status: 0, error: 'weird failure' })
    })

    it('returns ok:false with the upstream status for a failed response', async () => {
      runtime.fetchImpl.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => 'unavailable',
      })

      const res = await fetchJson({ url: 'https://example.com/', options: { timeoutMs: 250 } })

      expect(jsonOf(res)).toEqual({ ok: false, status: 503, data: 'unavailable' })
    })
  })

  describe('status projection', () => {
    it('keeps reporting the connected client count through getStatus', async () => {
      expect(server.getStatus()).toMatchObject({ running: true, connectedClients: 0, ip: '192.168.7.20' })
    })

    it('unsubscribes the engine route listener on stop', () => {
      expect(engineFactoryStub.listeners).toHaveLength(1)

      server.stop()

      expect(engineFactoryStub.unsubscribeCalls).toBe(1)
      expect(server.getStatus().running).toBe(false)
    })

    it('uses the configured publicBaseUrl for both start and status', async () => {
      runtime.settings = { ...runtime.settings, publicBaseUrl: 'https://h5.example' }
      const other = new H5Server(auth)
      const started = await other.start(0)

      expect(started.publicUrl).toBe('https://h5.example')
      expect(other.getStatus().publicUrl).toBe('https://h5.example')

      other.stop()
    })

    it('picks an ephemeral port when neither the call nor the settings name one', async () => {
      const other = new H5Server(auth)

      const started = await other.start()

      expect(started.running).toBe(true)
      expect(started.port).toBeGreaterThan(0)
      expect(started.publicUrl).toBe(`http://192.168.7.20:${started.port}`)

      other.stop()
    })

    it('refuses to start twice', async () => {
      await expect(server.start(0)).rejects.toThrow('H5 Server is already running')
    })

    it('rejects the start promise instead of hanging when the fixed port is taken', async () => {
      runtime.settings = { ...runtime.settings, fixedPort: port }
      const other = new H5Server(auth)

      await expect(other.start()).rejects.toThrow(/EADDRINUSE/)

      other.stop()
    })
  })

  describe('mirror broadcast with no clients', () => {
    it('is a no-op rather than a crash', () => {
      const wins: FakeWindow[] = [makeWindow()]
      runtime.windows = wins

      expect(() => server.setMirrorSession(null, null)).not.toThrow()
    })
  })
})
