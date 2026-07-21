import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';
import '../../core/protocol/protocol.dart';
import '../../core/connection/connection_service.dart';
import '../../core/connection/connection_state.dart' as conn;
import '../../core/storage/chat_history_storage.dart';
import 'models/message.dart';
import 'models/tool_call.dart';
import 'models/permission_request.dart';
import '../../core/agent/local_agent_service.dart';
import '../../core/agent/agent_types.dart';
import '../../core/config/mobile_config.dart';
import '../../core/github/github_service.dart';
import '../../core/github/clone_progress.dart';
import '../../core/skills/skill_registry.dart';
import '../../core/workspace/workspace_target.dart';
import 'timeline_assembler.dart';
import 'models/chat_attachment.dart';

final chatProvider = StateNotifierProvider<ChatNotifier, ChatState>((ref) {
  return ChatNotifier(ref);
});

/// 多会话并行的聊天状态。
///
/// 关键设计：
/// - `messagesBySession` 为每个 sessionId 独立缓存消息列表
/// - `messages` / `isLoading` 是 getter，返回当前 currentSessionId 对应的视图
/// - engine 推送事件携带 sessionId（见 main.ts subscribeEngineEventsForMobile），
///   _handleXxx 方法按 sessionId 路由到对应缓存，不污染其他会话
/// - newSession / switchToSession 只切换 currentSessionId，不清空其他会话缓存
/// - 这样多个会话可以真正并行：旧会话的 LLM 输出继续累积到其缓存，
///   用户切换回旧会话时能看到完整对话
class ChatState {
  final String? currentSessionId;

  /// 每个 session 的消息缓存（并行会话的核心数据结构）
  final Map<String, List<ChatMessage>> messagesBySession;

  /// 每个 session 的 loading 状态（是否正在等待 LLM 响应）
  final Map<String, bool> loadingBySession;

  /// 每个 session 的 agent 名称
  final Map<String, String> agentBySession;

  /// 每个 session 的待发送附件
  final Map<String, List<ChatAttachment>> attachmentsBySession;
  final List<PermissionRequest> pendingPermissions;

  /// 桌面端当前激活会话的项目目录，由 session_changed 推送更新
  final String? projectPath;

  /// 所有历史会话索引（不含消息体），用于 SessionsScreen 列表
  final List<SessionSummary> sessions;

  /// 历史是否已加载完成（启动时从 SharedPreferences 异步加载）
  final bool historyLoaded;
  final WorkspaceTarget? workspaceTarget;

  const ChatState({
    this.currentSessionId,
    required this.messagesBySession,
    required this.loadingBySession,
    required this.agentBySession,
    required this.attachmentsBySession,
    this.pendingPermissions = const [],
    this.projectPath,
    this.sessions = const [],
    this.historyLoaded = false,
    this.workspaceTarget,
  });

  /// 当前会话的消息列表（只读视图）
  List<ChatMessage> get messages => currentSessionId == null
      ? const []
      : (messagesBySession[currentSessionId] ?? const []);

  /// 当前会话是否正在等待 LLM 响应
  bool get isLoading => currentSessionId == null
      ? false
      : (loadingBySession[currentSessionId] ?? false);

  /// 当前会话的 agent 名称
  String? get currentAgent =>
      currentSessionId == null ? null : agentBySession[currentSessionId];

  ChatState copyWith({
    String? currentSessionId,
    Map<String, List<ChatMessage>>? messagesBySession,
    Map<String, bool>? loadingBySession,
    Map<String, String>? agentBySession,
    Map<String, List<ChatAttachment>>? attachmentsBySession,
    List<PermissionRequest>? pendingPermissions,
    String? projectPath,
    List<SessionSummary>? sessions,
    bool? historyLoaded,
    WorkspaceTarget? workspaceTarget,
    bool clearWorkspaceTarget = false,
  }) =>
      ChatState(
        currentSessionId: currentSessionId ?? this.currentSessionId,
        messagesBySession: messagesBySession ?? this.messagesBySession,
        loadingBySession: loadingBySession ?? this.loadingBySession,
        agentBySession: agentBySession ?? this.agentBySession,
        attachmentsBySession:
            attachmentsBySession ?? this.attachmentsBySession,
        pendingPermissions: pendingPermissions ?? this.pendingPermissions,
        projectPath: projectPath ?? this.projectPath,
        sessions: sessions ?? this.sessions,
        historyLoaded: historyLoaded ?? this.historyLoaded,
        workspaceTarget: clearWorkspaceTarget
            ? null
            : workspaceTarget ?? this.workspaceTarget,
      );

  /// 工厂方法：创建初始空状态
  factory ChatState.initial() => const ChatState(
        messagesBySession: {},
        loadingBySession: {},
        agentBySession: {},
        attachmentsBySession: {},
      );
}

class ChatNotifier extends StateNotifier<ChatState> {
  final Ref _ref;
  final _uuid = const Uuid();
  final _storage = ChatHistoryStorage();
  final _localAgent = LocalAgentService();
  final Map<String, WorkspaceTarget> _workspaceBySession = {};
  final Map<String, AgentCancellationToken> _localWorkflowTokens = {};
  /// 每个 session 的当前 turn 装配器（生命周期 = 一次 assistant turn）。
  final Map<String, TimelineAssembler> _assemblers = {};
  StreamSubscription? _subscription;
  // 防抖保存：连续追加流式 delta 时只在停顿 500ms 后写一次盘
  Timer? _persistTimer;

  ChatNotifier(this._ref) : super(ChatState.initial()) {
    _subscription =
        _ref.read(connectionProvider.notifier).messages.listen(_handlePush);
    _loadHistory();
  }

  /// 启动时从 SharedPreferences 加载历史会话列表 + 上次未关闭的当前会话消息
  Future<void> _loadHistory() async {
    final data = await _storage.loadAll();
    if (data.sessions.isEmpty) {
      state = state.copyWith(sessions: [], historyLoaded: true);
      return;
    }

    // 自动恢复上次激活的会话（若有）
    final currentId = data.currentSessionId ?? data.sessions.first.id;
    final messages = await _storage.loadMessages(currentId);
    final currentSummary = data.sessions.firstWhere(
      (s) => s.id == currentId,
      orElse: () => data.sessions.first,
    );

    final messagesBySession = <String, List<ChatMessage>>{currentId: messages};
    final loadingBySession = <String, bool>{currentId: false};

    state = state.copyWith(
      currentSessionId: currentId,
      messagesBySession: messagesBySession,
      loadingBySession: loadingBySession,
      agentBySession: const {},
      sessions: data.sessions,
      projectPath: currentSummary.projectPath,
      workspaceTarget: currentSummary.workspaceTarget,
      historyLoaded: true,
    );
    final target = currentSummary.workspaceTarget;
    if (target != null) _workspaceBySession[currentId] = target;
  }

  void _handlePush(MobilePush push) {
    switch (push.type) {
      case PushType.streamEvent:
        _handleStreamEvent(push.data);
        break;
      case PushType.assistant:
        _handleAssistant(push.data);
        break;
      case PushType.toolUse:
        _handleToolUse(push.data);
        break;
      case PushType.toolResult:
        _handleToolResult(push.data);
        break;
      case PushType.permissionRequest:
        _handlePermissionRequest(push.data);
        break;
      case PushType.result:
        _handleResult(push.data);
        break;
      case PushType.sessionChanged:
        _handleSessionChanged(push.data);
        break;
      case PushType.settingsSync:
        _handleSettingsSync(push.data);
        break;
      case PushType.skillsSync:
        _handleSkillsSync(push.data);
        break;
      default:
        break;
    }
  }

  /// 处理桌面端推送的技能同步消息。
  ///
  /// 推送数据格式：
  /// ```
  /// {
  ///   "skills": [
  ///     {"name": "code-review", "description": "...", "content": "---\nname: ..."}
  ///   ]
  /// }
  /// ```
  Future<void> _handleSkillsSync(Map<String, dynamic>? data) async {
    if (data == null) return;
    final skills = data['skills'];
    if (skills is! List) return;
    final docs = await getApplicationDocumentsDirectory();
    final syncDir = Directory('${docs.path}/spacecode/skills/desktop-sync');
    await syncDir.create(recursive: true);
    for (final entry in skills.whereType<Map<String, dynamic>>()) {
      final name = entry['name'] as String?;
      final content = entry['content'] as String?;
      if (name == null || name.isEmpty || content == null) continue;
      final skillDir = Directory('${syncDir.path}/$name');
      await skillDir.create(recursive: true);
      await File('${skillDir.path}/SKILL.md').writeAsString(content);
    }
    await _ref.read(skillRegistryProvider.notifier).refresh();
  }

  /// 从推送数据中提取 sessionId，回退到当前 session（兼容老协议）
  String? _extractSessionId(Map<String, dynamic>? data) {
    if (data == null) return state.currentSessionId;
    final sid = data['sessionId'] as String?;
    return sid ?? state.currentSessionId;
  }

  void sendMessage(
    String content, {
    List<ChatAttachment>? attachments,
  }) {
    final processed = _processSkillCommand(content);
    if (processed == null) return;
    final actualContent = processed;
    final effectiveAttachments = attachments ?? currentAttachments();

    final sessionId = state.currentSessionId ?? _uuid.v4();
    if (state.currentSessionId == null) {
      state = state.copyWith(currentSessionId: sessionId);
    }
    final workspace = _workspaceBySession[sessionId] ?? state.workspaceTarget;
    if (workspace != null) _workspaceBySession[sessionId] = workspace;
    final userMsg = ChatMessage(
      id: _uuid.v4(),
      role: MessageRole.user,
      content: actualContent,
    );
    final assistantMsg = ChatMessage(
      id: _uuid.v4(),
      role: MessageRole.assistant,
      isStreaming: true,
    );

    final newMessages = [...state.messages, userMsg, assistantMsg];
    _setMessages(sessionId, newMessages);
    _setLoading(sessionId, true);

    final connection = _ref.read(connectionProvider);
    if (connection.state == conn.ConnectionState.connected) {
      _ref.read(connectionProvider.notifier).send(MobileRequest(
            type: RequestType.sendMessage,
            data: {
              'sessionId': sessionId,
              'content': actualContent,
              'images': [],
              'attachments': effectiveAttachments
                  .map((attachment) => {
                        'kind': attachment.kind.name,
                        'name': attachment.name,
                        'path': attachment.path,
                        'contentBase64': attachment.contentBase64,
                      })
                  .toList(),
              if (workspace != null) 'workspace': workspace.promptContext,
            },
          ));
    } else {
      _runLocalAgent(
        sessionId,
        actualContent,
        workspace,
        attachments: effectiveAttachments,
      );
    }
    _clearCurrentAttachments();
    _schedulePersist();
  }

  /// 解析 `/skill:name [task]` 命令为完整 prompt。
  ///
  /// 返回 null 表示输入无效（应忽略）；
  /// 返回原字符串表示非技能命令；
  /// 返回拼装后的字符串表示技能命令已展开。
  String? _processSkillCommand(String content) {
    final trimmed = content.trim();
    if (trimmed.isEmpty) return null;
    if (!trimmed.startsWith('/skill:')) return trimmed;
    final rest = trimmed.substring('/skill:'.length);
    final spaceIndex = rest.indexOf(' ');
    final skillName =
        spaceIndex >= 0 ? rest.substring(0, spaceIndex).trim() : rest.trim();
    final taskText =
        spaceIndex >= 0 ? rest.substring(spaceIndex + 1).trim() : '';
    if (skillName.isEmpty) return null;
    if (taskText.isEmpty) {
      return "Load skill '$skillName' and follow its instructions.";
    }
    return "Load skill '$skillName' and follow its instructions for the following task:\n\n$taskText";
  }

  Future<void> _runLocalAgent(
    String sessionId,
    String content,
    WorkspaceTarget? selectedWorkspace, {
    List<ChatAttachment>? attachments,
  }) async {
    final token = AgentCancellationToken();
    _localWorkflowTokens[sessionId]?.cancel();
    _localWorkflowTokens[sessionId] = token;

    var prompt = content;
    if (attachments != null && attachments.isNotEmpty) {
      final context = attachments.map((a) => a.promptContext).join('\n\n');
      prompt = '$context\n\n$prompt';
    }

    try {
      final config = _ref.read(mobileConfigProvider);
      var workspace = selectedWorkspace;
      if (workspace?.mode == WorkspaceMode.github &&
          workspace?.localPath == null) {
        if (config.githubToken.isEmpty) throw StateError('请先在设置中完成 Github 认证');
        final documents = await getApplicationDocumentsDirectory();
        final repositoryName =
            (workspace!.repository ?? 'repository').split('/').last;
        final branchName = (workspace.branch ?? 'default')
            .replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_');
        final checkoutPath =
            '${documents.path}${Platform.pathSeparator}spacecode-workspaces${Platform.pathSeparator}$repositoryName-$branchName-$sessionId';
        if (!await Directory(checkoutPath).exists()) {
          // 推送虚拟 ToolCall：clone github 仓库（让用户看到 Agent 正在做什么）
          final cloneToolCallId = 'clone-${_uuid.v4()}';
          _handleLocalAgentEvent(
            sessionId,
            AgentEvent(
              type: AgentEventType.toolExecutionStart,
              toolCall: AgentToolCall(
                id: cloneToolCallId,
                name: 'clone_github_repository',
                arguments: {
                  'repository': workspace.repository ?? '',
                  'branch': workspace.branch ?? '',
                },
              ),
            ),
          );
          final github = GithubService(token: config.githubToken);
          String cloneError = '';
          try {
            await for (final progress in github.cloneRepository(
              repository: workspace.repository!,
              branch: workspace.branch!,
              targetDirectory: checkoutPath,
              abortTrigger: token.whenCancelled,
              isCancelled: () => token.isCancelled,
            )) {
              if (progress.phase == ClonePhase.error) {
                cloneError = progress.errorMessage ?? 'clone 失败';
              }
              // 中间进度不更新 UI；虚拟 ToolCallCard 已显示"运行中"
            }
          } catch (error) {
            if (token.isCancelled) rethrow;
            cloneError = error.toString();
          } finally {
            github.dispose();
          }
          _handleLocalAgentEvent(
            sessionId,
            AgentEvent(
              type: AgentEventType.toolExecutionEnd,
              toolCall: AgentToolCall(
                id: cloneToolCallId,
                name: 'clone_github_repository',
                arguments: const {},
              ),
              toolResult: cloneError.isEmpty
                  ? '已 clone 到 $checkoutPath'
                  : 'clone 失败：$cloneError',
              isError: cloneError.isNotEmpty,
            ),
          );
          if (cloneError.isNotEmpty) {
            throw StateError('Github 仓库 clone 失败：$cloneError');
          }
        }
        workspace = WorkspaceTarget.github(
          repository: workspace.repository,
          branch: workspace.branch,
          localPath: checkoutPath,
        );
        _workspaceBySession[sessionId] = workspace;
        if (state.currentSessionId == sessionId) {
          state = state.copyWith(workspaceTarget: workspace);
        }
      }
      token.throwIfCancelled();
      var answer = await _localAgent.complete(
        sessionId: sessionId,
        config: config,
        prompt: prompt,
        workspace: workspace,
        history: _buildLocalAgentHistory(sessionId, content),
        cancellationToken: token,
        onEvent: (event) => _handleLocalAgentEvent(sessionId, event),
        skillRegistry: _ref.read(skillRegistryProvider),
      );
      if (workspace?.mode == WorkspaceMode.github &&
          workspace?.localPath != null &&
          config.githubToken.isNotEmpty) {
        // 推送虚拟 ToolCall：创建 PR
        final prToolCallId = 'pr-${_uuid.v4()}';
        _handleLocalAgentEvent(
          sessionId,
          AgentEvent(
            type: AgentEventType.toolExecutionStart,
            toolCall: AgentToolCall(
              id: prToolCallId,
              name: 'create_pull_request',
              arguments: {
                'repository': workspace!.repository ?? '',
                'base': workspace.branch ?? '',
              },
            ),
          ),
        );
        final github = GithubService(token: config.githubToken);
        String prResult = '';
        String? prError;
        try {
          final pullRequest = await github.commitDirectoryAndCreatePullRequest(
            repository: workspace.repository!,
            base: workspace.branch!,
            directory: workspace.localPath!,
            title: content.length > 70 ? content.substring(0, 70) : content,
            body: '由 SpaceCode Mobile Agent 根据任务自动生成。\n\n$content',
            abortTrigger: token.whenCancelled,
            isCancelled: () => token.isCancelled,
          );
          prResult = pullRequest;
          answer = '$answer\n\nPull Request: $pullRequest';
        } catch (error) {
          if (token.isCancelled) rethrow;
          prError = error.toString();
          answer = '$answer\n\nPull Request 创建失败：$error';
        } finally {
          github.dispose();
        }
        _handleLocalAgentEvent(
          sessionId,
          AgentEvent(
            type: AgentEventType.toolExecutionEnd,
            toolCall: AgentToolCall(
              id: prToolCallId,
              name: 'create_pull_request',
              arguments: const {},
            ),
            toolResult: prError != null ? 'PR 创建失败：$prError' : prResult,
            isError: prError != null,
          ),
        );
      }
      final messages =
          List<ChatMessage>.from(state.messagesBySession[sessionId] ?? []);
      if (messages.isNotEmpty && messages.last.role == MessageRole.assistant) {
        messages[messages.length - 1] =
            messages.last.copyWith(content: answer, isStreaming: false);
        _setMessages(sessionId, messages);
      }
    } on AgentCancelledException {
      _markCancelledMessage(sessionId);
    } catch (error) {
      if (token.isCancelled) {
        _markCancelledMessage(sessionId);
        return;
      }
      final messages =
          List<ChatMessage>.from(state.messagesBySession[sessionId] ?? []);
      if (messages.isNotEmpty && messages.last.role == MessageRole.assistant) {
        messages[messages.length - 1] = messages.last.copyWith(
          content:
              '本地 Agent：${error.toString().replaceFirst('Bad state: ', '')}',
          isStreaming: false,
        );
        _setMessages(sessionId, messages);
      }
    } finally {
      // 清理当前 turn 的 assembler，避免下次发消息复用旧的事件列表
      // （否则旧 text/toolCall 事件会被带到新 turn，导致 UI 显示历史内容
      //  且旧 toolCallId 在新 message.toolCalls 中找不到 → 显示 "unknown"）
      final assembler = _assemblers.remove(sessionId);
      if (assembler != null) {
        assembler.completeTurn();
        final messages =
            List<ChatMessage>.from(state.messagesBySession[sessionId] ?? []);
        if (messages.isNotEmpty &&
            messages.last.role == MessageRole.assistant &&
            !messages.last.isStreaming) {
          messages[messages.length - 1] = messages.last.copyWith(
            timelineEvents: assembler.events,
          );
          _setMessages(sessionId, messages);
        }
      }
      if (identical(_localWorkflowTokens[sessionId], token)) {
        _localWorkflowTokens.remove(sessionId);
      }
      _setLoading(sessionId, false);
      _schedulePersist();
    }
  }

  void _markCancelledMessage(String sessionId) {
    final messages =
        List<ChatMessage>.from(state.messagesBySession[sessionId] ?? []);
    if (messages.isEmpty || messages.last.role != MessageRole.assistant) return;
    final calls = (messages.last.toolCalls ?? const <ToolCall>[]).map((call) {
      if (call.output != null) return call;
      return call.copyWith(
        output: '任务已停止',
        status: ToolCallStatus.error,
      );
    }).toList();
    messages[messages.length - 1] = messages.last.copyWith(
      content: '任务已停止',
      toolCalls: calls,
      isStreaming: false,
    );
    _setMessages(sessionId, messages);
  }

  void setWorkspaceTarget(WorkspaceTarget? target) {
    final sessionId = state.currentSessionId;
    if (sessionId != null) {
      if (target == null) {
        _workspaceBySession.remove(sessionId);
      } else {
        _workspaceBySession[sessionId] = target;
      }
    }
    state = state.copyWith(
      workspaceTarget: target,
      clearWorkspaceTarget: target == null,
    );
    _schedulePersist();
  }

  void addAttachment(ChatAttachment attachment) {
    final sessionId = state.currentSessionId;
    if (sessionId == null) return;
    final map = Map<String, List<ChatAttachment>>.from(
        state.attachmentsBySession);
    map[sessionId] = [...(map[sessionId] ?? []), attachment];
    state = state.copyWith(attachmentsBySession: map);
  }

  void removeAttachment(ChatAttachment attachment) {
    final sessionId = state.currentSessionId;
    if (sessionId == null) return;
    final map = Map<String, List<ChatAttachment>>.from(
        state.attachmentsBySession);
    final list = map[sessionId];
    if (list == null) return;
    final newList =
        list.where((item) => item != attachment).toList();
    if (newList.length == list.length) return;
    map[sessionId] = newList;
    state = state.copyWith(attachmentsBySession: map);
  }

  List<ChatAttachment> currentAttachments() {
    final sessionId = state.currentSessionId;
    if (sessionId == null) return [];
    return state.attachmentsBySession[sessionId] ?? [];
  }

  void _clearCurrentAttachments() {
    final sessionId = state.currentSessionId;
    if (sessionId == null) return;
    final map = Map<String, List<ChatAttachment>>.from(
        state.attachmentsBySession);
    map.remove(sessionId);
    state = state.copyWith(attachmentsBySession: map);
  }

  Future<void> setModel(String model) async {
    await _ref.read(mobileConfigProvider.notifier).saveModel(model);
  }

  void _handleLocalAgentEvent(String sessionId, AgentEvent event) {
    final messages =
        List<ChatMessage>.from(state.messagesBySession[sessionId] ?? []);
    if (messages.isEmpty || messages.last.role != MessageRole.assistant) return;
    final assistant = messages.last;
    final assembler =
        _assemblers.putIfAbsent(sessionId, () => TimelineAssembler());

    if (event.type == AgentEventType.assistantDelta && event.delta != null) {
      assembler.appendTextDelta(event.delta!);
      messages[messages.length - 1] = assistant.copyWith(
        content: assistant.content + event.delta!,
        isStreaming: true,
        timelineEvents: assembler.events,
      );
      _setMessages(sessionId, messages);
      _schedulePersist();
      return;
    }

    if (event.type != AgentEventType.toolExecutionStart &&
        event.type != AgentEventType.toolExecutionEnd) {
      return;
    }

    final calls = List<ToolCall>.from(assistant.toolCalls ?? const []);
    if (event.type == AgentEventType.toolExecutionStart &&
        event.toolCall != null) {
      final newCall = ToolCall(
        id: event.toolCall!.id,
        toolName: event.toolCall!.name,
        input: jsonEncode(event.toolCall!.arguments),
      );
      calls.add(newCall);
      assembler.addToolCall(newCall);
    } else if (event.type == AgentEventType.toolExecutionEnd &&
        event.toolCall != null) {
      final index = calls.indexWhere((call) => call.id == event.toolCall!.id);
      if (index >= 0) {
        final newStatus = event.isError
            ? ToolCallStatus.error
            : ToolCallStatus.completed;
        calls[index] = calls[index].copyWith(
          output: event.toolResult,
          status: newStatus,
        );
        assembler.completeToolCall(event.toolCall!.id, newStatus);
      }
    }
    messages[messages.length - 1] = assistant.copyWith(
      toolCalls: calls,
      timelineEvents: assembler.events,
    );
    _setMessages(sessionId, messages);
  }

  List<AgentMessage> _buildLocalAgentHistory(
      String sessionId, String currentPrompt) {
    final source = state.messagesBySession[sessionId] ?? const [];
    final history = <AgentMessage>[];
    final currentUserIndex = source.lastIndexWhere((message) =>
        message.role == MessageRole.user && message.content == currentPrompt);
    for (var index = 0; index < source.length; index++) {
      final message = source[index];
      if (index == currentUserIndex) {
        continue;
      }
      if (message.role == MessageRole.user) {
        history.add(AgentMessage.user(message.content));
        continue;
      }
      if (message.role != MessageRole.assistant || message.isStreaming) {
        continue;
      }
      final calls = (message.toolCalls ?? const <ToolCall>[])
          .where((call) => call.output != null)
          .toList();
      if (calls.isEmpty) {
        history.add(AgentMessage.assistant(content: message.content));
        continue;
      }
      final toolCalls = calls.map((call) {
        final decoded = _decodeToolInput(call.input);
        return AgentToolCall(
            id: call.id, name: call.toolName, arguments: decoded);
      }).toList();
      history.add(AgentMessage.assistant(toolCalls: toolCalls));
      for (final call in calls.where((call) => call.output != null)) {
        history.add(AgentMessage.tool(
          toolCallId: call.id,
          content: call.output ?? '',
          isError: call.status == ToolCallStatus.error,
        ));
      }
      if (message.content.isNotEmpty) {
        history.add(AgentMessage.assistant(content: message.content));
      }
    }
    return history;
  }

  Map<String, dynamic> _decodeToolInput(String input) {
    try {
      final decoded = jsonDecode(input);
      return decoded is Map
          ? decoded.cast<String, dynamic>()
          : {'input': input};
    } catch (_) {
      return {'input': input};
    }
  }

  void _handleStreamEvent(Map<String, dynamic>? data) {
    if (data == null) return;
    final delta = data['delta'] as String? ?? '';
    if (delta.isEmpty) return;

    final sessionId = _extractSessionId(data);
    if (sessionId == null) return;
    final messages =
        List<ChatMessage>.from(state.messagesBySession[sessionId] ?? []);

    final bool needNewMessage = messages.isEmpty ||
        messages.last.role != MessageRole.assistant ||
        !messages.last.isStreaming;

    ChatMessage msg;
    TimelineAssembler assembler;
    if (needNewMessage) {
      msg = ChatMessage(
        id: _uuid.v4(),
        role: MessageRole.assistant,
        content: delta,
        isStreaming: true,
      );
      assembler = _assemblers[sessionId] = TimelineAssembler();
      assembler.appendTextDelta(delta);
      msg = msg.copyWith(timelineEvents: assembler.events);
      _setMessages(sessionId, [...messages, msg]);
    } else {
      final last = messages.last;
      assembler = _assemblers.putIfAbsent(sessionId, () => TimelineAssembler());
      assembler.appendTextDelta(delta);
      messages[messages.length - 1] = last.copyWith(
        content: last.content + delta,
        timelineEvents: assembler.events,
      );
      _setMessages(sessionId, messages);
    }
    _schedulePersist();
  }

  void _handleAssistant(Map<String, dynamic>? data) {
    if (data == null) return;
    final message = data['message'] as Map<String, dynamic>?;
    if (message == null) return;
    final content = message['content'];

    String text = '';
    String? thinking;
    List<ToolCall> toolCalls = [];

    if (content is List) {
      for (final item in content) {
        if (item is! Map<String, dynamic>) continue;
        final itemType = item['type'];
        if (itemType == 'text') {
          text += (item['text'] as String?) ?? '';
        } else if (itemType == 'thinking') {
          thinking =
              (item['thinking'] as String?) ?? (item['text'] as String?) ?? '';
        } else if (itemType == 'tool_use') {
          toolCalls.add(ToolCall(
            id: (item['id'] as String?) ?? '',
            toolName: (item['name'] as String?) ?? '',
            input: item['input']?.toString() ?? '',
          ));
        }
      }
    } else if (content is String) {
      text = content;
    }

    final sessionId = _extractSessionId(data);
    if (sessionId == null) return;
    final messages =
        List<ChatMessage>.from(state.messagesBySession[sessionId] ?? []);

    final bool needNewMessage = messages.isEmpty ||
        messages.last.role != MessageRole.assistant ||
        !messages.last.isStreaming;

    if (needNewMessage) {
      final newMsg = ChatMessage(
        id: _uuid.v4(),
        role: MessageRole.assistant,
        content: text,
        thinkingContent: thinking,
        toolCalls: toolCalls.isEmpty ? null : toolCalls,
        isStreaming: false,
      );
      _setMessages(sessionId, [...messages, newMsg]);
    } else {
      final last = messages.last;
      messages[messages.length - 1] = last.copyWith(
        content: text.isEmpty ? last.content : text,
        thinkingContent: thinking ?? last.thinkingContent,
        toolCalls: toolCalls.isEmpty ? last.toolCalls : toolCalls,
        isStreaming: false,
      );
      _setMessages(sessionId, messages);
    }
    _schedulePersist();
  }

  void _handleToolUse(Map<String, dynamic>? data) {
    if (data == null) return;
    final toolCall = ToolCall(
      id: data['toolUseId'] as String? ?? '',
      toolName: data['toolName'] as String? ?? '',
      input: data['input']?.toString() ?? '',
    );
    final sessionId = _extractSessionId(data);
    if (sessionId == null) return;
    final messages =
        List<ChatMessage>.from(state.messagesBySession[sessionId] ?? []);
    if (messages.isEmpty || messages.last.role != MessageRole.assistant) {
      return;
    }
    final last = messages.last;
    final toolCalls = List<ToolCall>.from(last.toolCalls ?? [])..add(toolCall);
    final assembler =
        _assemblers.putIfAbsent(sessionId, () => TimelineAssembler());
    assembler.addToolCall(toolCall);
    messages[messages.length - 1] = last.copyWith(
      toolCalls: toolCalls,
      timelineEvents: assembler.events,
    );
    _setMessages(sessionId, messages);
    _schedulePersist();
  }

  void _handleToolResult(Map<String, dynamic>? data) {
    if (data == null) return;
    final toolUseId = data['toolUseId'] as String? ?? '';
    final output = data['output']?.toString() ?? '';
    final isError = data['isError'] as bool? ?? false;
    final sessionId = _extractSessionId(data);
    if (sessionId == null) return;
    final messages =
        List<ChatMessage>.from(state.messagesBySession[sessionId] ?? []);
    for (int i = messages.length - 1; i >= 0; i--) {
      final msg = messages[i];
      if (msg.toolCalls != null && msg.toolCalls!.any((tc) => tc.id == toolUseId)) {
        final toolCalls = msg.toolCalls!
            .map((tc) => tc.id == toolUseId
                ? tc.copyWith(
                    output: output,
                    status: isError
                        ? ToolCallStatus.error
                        : ToolCallStatus.completed)
                : tc)
            .toList();
        final assembler = _assemblers[sessionId];
        if (assembler != null) {
          assembler.completeToolCall(
              toolUseId,
              isError
                  ? ToolCallStatus.error
                  : ToolCallStatus.completed);
          messages[i] = msg.copyWith(
            toolCalls: toolCalls,
            timelineEvents: assembler.events,
          );
        } else {
          messages[i] = msg.copyWith(toolCalls: toolCalls);
        }
        break;
      }
    }
    _setMessages(sessionId, messages);
    _schedulePersist();
  }

  void _handlePermissionRequest(Map<String, dynamic>? data) {
    if (data == null) return;
    final request = PermissionRequest(
      sessionId: data['sessionId'] as String? ?? '',
      toolUseId: data['toolUseId'] as String? ?? '',
      toolName: data['toolName'] as String? ?? '',
      input: data['input']?.toString() ?? '',
    );
    state = state
        .copyWith(pendingPermissions: [...state.pendingPermissions, request]);
  }

  void _handleResult(Map<String, dynamic>? data) {
    final sessionId = _extractSessionId(data);
    if (sessionId == null) return;
    final assembler = _assemblers.remove(sessionId);
    final messages =
        List<ChatMessage>.from(state.messagesBySession[sessionId] ?? []);
    if (messages.isNotEmpty && messages.last.isStreaming) {
      final last = messages.last;
      assembler?.completeTurn();
      messages[messages.length - 1] = last.copyWith(
        isStreaming: false,
        timelineEvents: assembler != null ? assembler.events : last.timelineEvents,
      );
      _setMessages(sessionId, messages);
    }
    _setLoading(sessionId, false);
    _schedulePersist();
  }

  /// 桌面端推送 session_changed 事件：更新当前项目目录
  void _handleSessionChanged(Map<String, dynamic>? data) {
    if (data == null) return;
    final projectPath = data['projectPath'] as String?;
    if (projectPath != null) {
      state = state.copyWith(projectPath: projectPath);
    }
  }

  void _handleSettingsSync(Map<String, dynamic>? data) {
    if (data == null) return;
    final apiKey = data['apiKey'] as String?;
    final baseUrl = data['baseUrl'] as String?;
    final model = data['model'] as String?;
    if (apiKey == null ||
        baseUrl == null ||
        model == null ||
        apiKey.isEmpty ||
        baseUrl.isEmpty ||
        model.isEmpty) {
      return;
    }
    _ref.read(mobileConfigProvider.notifier).save(
          apiKey: apiKey,
          baseUrl: baseUrl,
          model: model,
        );
  }

  void allowPermission(String toolUseId) {
    _ref.read(connectionProvider.notifier).send(MobileRequest(
          type: RequestType.allowPermission,
          data: {
            'sessionId': state.currentSessionId,
            'toolUseId': toolUseId,
          },
        ));
    state = state.copyWith(
      pendingPermissions: state.pendingPermissions
          .where((p) => p.toolUseId != toolUseId)
          .toList(),
    );
  }

  void denyPermission(String toolUseId) {
    _ref.read(connectionProvider.notifier).send(MobileRequest(
          type: RequestType.denyPermission,
          data: {
            'sessionId': state.currentSessionId,
            'toolUseId': toolUseId,
          },
        ));
    state = state.copyWith(
      pendingPermissions: state.pendingPermissions
          .where((p) => p.toolUseId != toolUseId)
          .toList(),
    );
  }

  /// 新建会话：仅切换 currentSessionId，不清空其他会话缓存
  /// 旧会话的 engine 子进程仍在运行，事件继续累积到对应缓存
  void newSession() {
    final sessionId = _uuid.v4();
    _ref.read(connectionProvider.notifier).send(MobileRequest(
          type: RequestType.newSession,
          data: {'sessionId': sessionId},
        ));
    final newMessagesBySession =
        Map<String, List<ChatMessage>>.from(state.messagesBySession);
    newMessagesBySession[sessionId] = [];
    final newLoadingBySession = Map<String, bool>.from(state.loadingBySession);
    newLoadingBySession[sessionId] = false;
    state = state.copyWith(
      currentSessionId: sessionId,
      messagesBySession: newMessagesBySession,
      loadingBySession: newLoadingBySession,
      pendingPermissions: [],
      clearWorkspaceTarget: true,
    );
    _storage.setCurrentSessionId(sessionId);
  }

  /// 切换到历史会话：仅切换 currentSessionId，加载该会话的消息到缓存
  /// 不影响其他会话的 engine 进程
  Future<void> switchToSession(String sessionId) async {
    // 若该 session 的消息未加载到内存，从 storage 加载
    final messagesBySession =
        Map<String, List<ChatMessage>>.from(state.messagesBySession);
    if (!messagesBySession.containsKey(sessionId)) {
      final messages = await _storage.loadMessages(sessionId);
      messagesBySession[sessionId] = messages;
    }
    final summary = state.sessions.firstWhere(
      (s) => s.id == sessionId,
      orElse: () => state.sessions.first,
    );
    final loadingBySession = Map<String, bool>.from(state.loadingBySession);
    loadingBySession.putIfAbsent(sessionId, () => false);
    final workspace = _workspaceBySession[sessionId] ?? summary.workspaceTarget;
    if (workspace != null) _workspaceBySession[sessionId] = workspace;

    state = state.copyWith(
      currentSessionId: sessionId,
      messagesBySession: messagesBySession,
      loadingBySession: loadingBySession,
      projectPath: summary.projectPath,
      pendingPermissions: [],
      workspaceTarget: workspace,
      clearWorkspaceTarget: workspace == null,
    );
    _ref.read(connectionProvider.notifier).send(MobileRequest(
          type: RequestType.switchSession,
          data: {'sessionId': sessionId},
        ));
    _storage.setCurrentSessionId(sessionId);
  }

  Future<void> deleteSession(String sessionId) async {
    _localWorkflowTokens.remove(sessionId)?.cancel();
    _localAgent.resetSession(sessionId);
    _workspaceBySession.remove(sessionId);
    await _storage.deleteSession(sessionId);
    final sessions = state.sessions.where((s) => s.id != sessionId).toList();
    final messagesBySession =
        Map<String, List<ChatMessage>>.from(state.messagesBySession);
    messagesBySession.remove(sessionId);
    final loadingBySession = Map<String, bool>.from(state.loadingBySession);
    loadingBySession.remove(sessionId);

    if (state.currentSessionId == sessionId) {
      if (sessions.isEmpty) {
        state = state.copyWith(
          sessions: sessions,
          messagesBySession: messagesBySession,
          loadingBySession: loadingBySession,
          currentSessionId: null,
          projectPath: null,
          clearWorkspaceTarget: true,
        );
      } else {
        // 切到第一个会话
        final nextId = sessions.first.id;
        if (!messagesBySession.containsKey(nextId)) {
          final msgs = await _storage.loadMessages(nextId);
          messagesBySession[nextId] = msgs;
        }
        loadingBySession.putIfAbsent(nextId, () => false);
        final workspace =
            _workspaceBySession[nextId] ?? sessions.first.workspaceTarget;
        if (workspace != null) _workspaceBySession[nextId] = workspace;
        state = state.copyWith(
          sessions: sessions,
          messagesBySession: messagesBySession,
          loadingBySession: loadingBySession,
          currentSessionId: nextId,
          projectPath: sessions.first.projectPath,
          workspaceTarget: workspace,
          clearWorkspaceTarget: workspace == null,
        );
        _ref.read(connectionProvider.notifier).send(MobileRequest(
              type: RequestType.switchSession,
              data: {'sessionId': nextId},
            ));
        _storage.setCurrentSessionId(nextId);
      }
    } else {
      state = state.copyWith(
        sessions: sessions,
        messagesBySession: messagesBySession,
        loadingBySession: loadingBySession,
      );
    }
  }

  /// 切换当前会话使用的 Agent，同步到 ChatState 并通知桌面端
  void setAgent(String agentId, String agentName) {
    final sid = state.currentSessionId;
    if (sid == null) return;
    final newAgentBySession = Map<String, String>.from(state.agentBySession);
    newAgentBySession[sid] = agentName;
    state = state.copyWith(agentBySession: newAgentBySession);
    _ref.read(connectionProvider.notifier).send(MobileRequest(
          type: RequestType.listAgents,
          data: {'selectedAgentId': agentId},
        ));
  }

  void abort() {
    final sessionId = state.currentSessionId;
    if (sessionId == null) return;
    final connection = _ref.read(connectionProvider);
    if (connection.state == conn.ConnectionState.connected) {
      _ref.read(connectionProvider.notifier).send(MobileRequest(
            type: RequestType.abort,
            data: {'sessionId': sessionId},
          ));
    } else {
      _localWorkflowTokens[sessionId]?.cancel();
      _localAgent.abort(sessionId);
    }
  }

  /// 更新某个 session 的消息缓存（不可变更新）
  void _setMessages(String sessionId, List<ChatMessage> messages) {
    final newMap = Map<String, List<ChatMessage>>.from(state.messagesBySession);
    newMap[sessionId] = messages;
    state = state.copyWith(messagesBySession: newMap);
  }

  /// 更新某个 session 的 loading 状态（不可变更新）
  void _setLoading(String sessionId, bool loading) {
    final newMap = Map<String, bool>.from(state.loadingBySession);
    newMap[sessionId] = loading;
    state = state.copyWith(loadingBySession: newMap);
  }

  /// 防抖持久化：500ms 内多次状态变更只写一次盘
  void _schedulePersist() {
    _persistTimer?.cancel();
    _persistTimer = Timer(const Duration(milliseconds: 500), _persist);
  }

  Future<void> _persist() async {
    final sid = state.currentSessionId;
    if (sid == null) return;
    final messages = state.messagesBySession[sid] ?? [];
    // 仅持久化已完成的消息（避免流式中间态被存盘）
    final persistableMessages = messages
        .where((m) => !m.isStreaming || m.content.isNotEmpty)
        .map((m) => m.isStreaming ? m.copyWith(isStreaming: false) : m)
        .toList();
    // 标题：取首条用户消息前 30 字符，否则用「新对话」
    final firstUser = persistableMessages.firstWhere(
      (m) => m.role == MessageRole.user,
      orElse: () => persistableMessages.isNotEmpty
          ? persistableMessages.first
          : ChatMessage(id: '', role: MessageRole.assistant, content: '新对话'),
    );
    final title = firstUser.content.isEmpty
        ? '新对话'
        : (firstUser.content.length > 30
            ? '${firstUser.content.substring(0, 30)}...'
            : firstUser.content);

    await _storage.saveSession(
      sessionId: sid,
      title: title,
      messages: persistableMessages,
      projectPath: state.projectPath,
      workspaceTarget: _workspaceBySession[sid] ?? state.workspaceTarget,
    );

    // 同步更新 sessions 列表（upsert + 按 updatedAt 排序）
    final updated = SessionSummary(
      id: sid,
      title: title,
      createdAt: state.sessions
          .firstWhere(
            (s) => s.id == sid,
            orElse: () => SessionSummary(
              id: sid,
              title: title,
              createdAt: DateTime.now(),
              updatedAt: DateTime.now(),
              projectPath: state.projectPath,
              workspaceTarget:
                  _workspaceBySession[sid] ?? state.workspaceTarget,
              messageCount: persistableMessages.length,
            ),
          )
          .createdAt,
      updatedAt: DateTime.now(),
      projectPath: state.projectPath,
      workspaceTarget: _workspaceBySession[sid] ?? state.workspaceTarget,
      messageCount: persistableMessages.length,
    );
    final newSessions =
        (state.sessions.where((s) => s.id != sid).toList()..add(updated))
          ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    state = state.copyWith(sessions: newSessions);
  }

  @override
  void dispose() {
    _persistTimer?.cancel();
    _subscription?.cancel();
    for (final token in _localWorkflowTokens.values) {
      token.cancel();
    }
    _localWorkflowTokens.clear();
    _localAgent.dispose();
    super.dispose();
  }
}
