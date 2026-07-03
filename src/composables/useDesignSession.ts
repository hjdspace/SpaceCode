import { useDesignStore } from '@/stores/design';
import { useChatStore, useChatSessionStore } from '@/stores/chat'; // 现有 SpaceCode 聊天 Store 引用
import { api } from '@/services/electronAPI';  // 现有 SpaceCode 主进程 IPC Bridge
import { findFirstQuestionForm, splitOnQuestionForms } from '@/utils/design/questionForm';
import { ref } from 'vue';

export function useDesignSession() {
  const designStore = useDesignStore();
  const chatStore = useChatStore();
  const chatSessionStore = useChatSessionStore();
  const isGenerating = ref(false);

  /**
   * 启动全新的设计生成任务
   */
  async function startDesignGeneration() {
    if (!designStore.brief.trim()) return;

    isGenerating.value = true;
    designStore.clearPendingQuestionForm();
    designStore.previewHtml = '';

    try {
      // 1. 创建设计工作空间目录并初始化 Session
      // 默认将工作区指定在用户 SpaceCode 配置下的 design-workspace 目录
      const sessionTitle = `Design: ${designStore.brief.trim().slice(0, 20)}...`;
      const userDataPath = await api.app.getPath('userData');
      const workspacePath = `${userDataPath}/design-workspace/${Date.now()}`;
      designStore.designWorkspace = workspacePath;

      // 2. 调用现存 chatStore 里的创建会话方法，将其 mode 设为 'design'
      const session = chatSessionStore.createSession(sessionTitle, workspacePath);
      session.mode = 'design';
      designStore.activeSessionId = session.id;

      // 3. 核心：通过 Electron 主进程拼装 23 层设计专用提示词栈，并注入 system-prompt
      const systemPromptOverride = await api.design.composePromptStack({
        designSystemId: designStore.selectedSystemId || undefined,
        skillBody: undefined, // 可选：若有选定技能则传入
        skillName: designStore.selectedSkillId,
        locale: 'zh-CN', // 支持中文
      });

      // 4. 启动 Claude Code CLI 引擎会话并注入 --system-prompt 覆写参数
      await chatSessionStore.initClaudeCodeSession(session.id, {
        systemPrompt: systemPromptOverride, // 完全替换默认 system prompt
        cwd: workspacePath,
        agent: 'ui-ux-pro-max', // 使用内置的 ui-ux-pro-max 设计类 agent
      });

      // 5. 启动 Chokidar 主进程文件监听，实时追踪生成的网页
      await api.design.startFileWatcher(session.id, workspacePath);

      // 6. 发送初始的 Brief 设计需求（纯文本，不携带多余 prompt）
      // chatStore.sendMessage 始终操作 currentSessionId，因此临时切换到设计会话
      chatSessionStore.currentSessionId = session.id;
      await chatStore.sendMessage(designStore.brief);

      // 7. 开启事件流式处理
      listenToStream(session.id);
    } catch (error) {
      console.error('Failed to start design session:', error);
      isGenerating.value = false;
    }
  }

  /**
   * 监听 Claude Code CLI 的 stdout 实时输出，拦截处理 QuestionForm 协议
   */
  function listenToStream(sessionId: string) {
    let accumulatedText = '';

    const claudeCode = api.claudeCode;
    if (!claudeCode) {
      console.error('Claude Code API not available');
      isGenerating.value = false;
      return;
    }

    claudeCode.onStreamEvent(({ data, sessionId: eventSessionId }) => {
      if (eventSessionId !== sessionId) return;

      if (data.type === 'text_delta') {
        accumulatedText += data.text;

        // 拦截 <question-form> 标记
        const form = findFirstQuestionForm(accumulatedText);
        if (form && !designStore.pendingQuestionForm) {
          // 剔除 XML 伪标记，只在 Chat 框显示 conversational 纯文本
          const segments = splitOnQuestionForms(accumulatedText);
          const textOnly = segments
            .filter((s) => s.type === 'text')
            .map((s) => s.text)
            .join('');

          // 缓存表单并唤起前端表单组件
          designStore.setPendingQuestionForm(form);

          // 在前端 UI 聊天历史中更新最后一条助手消息（若不存在则新增）
          const session = chatSessionStore.sessions.find((s: { id: string }) => s.id === sessionId);
          const lastAssistantMsg = session && [...session.messages].reverse().find(m => m.role === 'assistant');
          if (lastAssistantMsg) {
            chatSessionStore.updateMessage(lastAssistantMsg.id, { content: textOnly }, sessionId);
          } else {
            chatSessionStore.addMessage({ role: 'assistant', content: textOnly }, sessionId);
          }
        }
      } else if (data.type === 'status' && data.status === 'idle') {
        // AI 闲置/完成时，关闭 loading 态
        isGenerating.value = false;
      }
    });
  }

  /**
   * 用户提交发现表单答案，回传给 AI 驱动第二轮逻辑
   */
  async function submitQuestionForm(answers: Record<string, any>) {
    const sessionId = designStore.activeSessionId;
    if (!sessionId) return;

    // 依照 open-design 协议格式化回传
    const responseMessage = `[form answers — discovery] ${JSON.stringify(answers)}`;

    designStore.clearPendingQuestionForm();
    isGenerating.value = true;

    // 发送答案作为新一轮 user message
    chatSessionStore.currentSessionId = sessionId;
    await chatStore.sendMessage(responseMessage);
  }

  /**
   * 主动终止设计生成进程
   */
  async function stopDesignGeneration() {
    const sessionId = designStore.activeSessionId;
    if (!sessionId) return;

    const claudeCode = api.claudeCode;
    if (claudeCode) {
      try {
        await claudeCode.stop(sessionId);
      } catch (error) {
        console.error('Failed to stop design session:', error);
      }
    }
    await api.design.stopFileWatcher();
    isGenerating.value = false;
  }

  return {
    isGenerating,
    startDesignGeneration,
    submitQuestionForm,
    stopDesignGeneration,
  };
}
