import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../chat_controller.dart';
import '../models/timeline_event.dart';
import '../models/tool_call.dart';
import 'message_bubble.dart';
import 'typing_indicator.dart';

class MessageList extends ConsumerStatefulWidget {
  const MessageList({super.key});

  @override
  ConsumerState<MessageList> createState() => _MessageListState();
}

class _MessageListState extends ConsumerState<MessageList> {
  final ScrollController _scrollController = ScrollController();
  ProviderSubscription<ChatState>? _chatSubscription;

  /// 是否应自动滚动到底部。
  ///
  /// 仅当用户当前位于底部附近（80px 阈值内）时为 true；
  /// 用户主动向上滚动查看历史时为 false，避免被强行拉回底部。
  /// 对标桌面端 `MessageList.vue` 的 `shouldAutoScrollRef`。
  bool _shouldAutoScroll = true;

  /// 程序滚动标志，用于区分用户滚动与程序滚动，避免 _handleScroll 误更新 _shouldAutoScroll。
  bool _isProgrammaticScroll = false;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_handleScroll);
    _chatSubscription = ref.listenManual(chatProvider, (prev, next) {
      final prevSignal = _buildSignal(prev ?? ChatState.initial());
      final nextSignal = _buildSignal(next);
      if (prevSignal != nextSignal) {
        if (_shouldAutoScroll) {
          _scrollToBottom();
        }
      }
    });
  }

  @override
  void dispose() {
    _chatSubscription?.close();
    _scrollController.removeListener(_handleScroll);
    _scrollController.dispose();
    super.dispose();
  }

  /// 综合信号：覆盖消息长度、最后一条消息内容/thinking/toolCalls/timelineEvents/isStreaming，
  /// 以及当前会话的 loading 状态。
  ///
  /// 对标桌面端 `MessageList.vue` 的 `streamScrollSignal`。
  /// 任何流式文本 delta、工具调用开始/结束、思考流、流式结束、loading 切换都会改变信号。
  String _buildSignal(ChatState state) {
    final messages = state.messages;
    if (messages.isEmpty) return 'empty:${state.isLoading}';

    final last = messages.last;
    final lastToolCallsSig = (last.toolCalls ?? const <ToolCall>[])
        .map((tc) => '${tc.id}:${tc.status}:${tc.input.length}:${tc.output?.length ?? 0}')
        .join('|');
    final lastTimelineSig = (last.timelineEvents ?? const <TimelineEvent>[])
        .map((e) => '${e.id}:${e.type.name}:${e.status.name}:${(e.content ?? '').length}')
        .join('|');

    return [
      messages.length,
      last.id,
      last.role.name,
      last.content.length,
      (last.thinkingContent ?? '').length,
      last.isStreaming ? 1 : 0,
      lastToolCallsSig,
      lastTimelineSig,
      state.isLoading ? 1 : 0,
    ].join(':');
  }

  /// 用户滚动监听：更新 _shouldAutoScroll。
  void _handleScroll() {
    if (_isProgrammaticScroll) return;
    if (!_scrollController.hasClients) return;
    final position = _scrollController.position;
    final distance = position.maxScrollExtent - position.pixels;
    _shouldAutoScroll = distance <= 80;
  }

  /// 滚动到底部。
  ///
  /// 流式期间频繁触发，使用 [jumpTo] 瞬间跳转（对标桌面端 `scrollTo({ behavior: 'auto' })`），
  /// 避免 [animateTo] 200ms 动画被持续打断导致滚动位置始终滞后。
  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _isProgrammaticScroll = true;
      _scrollController.jumpTo(_scrollController.position.maxScrollExtent);
      // 在下一帧释放标志，确保 scroll listener 在 jumpTo 触发的通知中不会误更新 _shouldAutoScroll
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _isProgrammaticScroll = false;
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    final chatState = ref.watch(chatProvider);
    final messages = chatState.messages;
    final isLoading = chatState.isLoading;

    if (messages.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.chat_bubble_outline_rounded,
              size: 48,
              color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.2),
            ),
            const SizedBox(height: 12),
            Text(
              '开始对话',
              style: TextStyle(
                color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.4),
                fontSize: 16,
              ),
            ),
          ],
        ),
      );
    }

    // 末位附加 typing indicator（对标桌面端 MessageList.vue 的 typing-indicator）
    final showTypingIndicator = isLoading;
    final itemCount = messages.length + (showTypingIndicator ? 1 : 0);

    return ListView.builder(
      controller: _scrollController,
      padding: const EdgeInsets.symmetric(vertical: 8),
      itemCount: itemCount,
      itemBuilder: (context, index) {
        if (index == messages.length) {
          return const Padding(
            padding: EdgeInsets.symmetric(vertical: 8, horizontal: 16),
            child: TypingIndicator(),
          );
        }
        return MessageBubble(message: messages[index]);
      },
    );
  }
}
