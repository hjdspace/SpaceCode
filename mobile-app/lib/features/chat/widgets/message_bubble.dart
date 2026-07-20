import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/message.dart';
import '../models/timeline_event.dart';
import '../models/tool_call.dart';
import 'streaming_text.dart';
import 'thinking_block.dart';
import 'tool_call_card.dart';
import 'markdown_renderer.dart';

class MessageBubble extends ConsumerWidget {
  final ChatMessage message;

  const MessageBubble({
    super.key,
    required this.message,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final isUser = message.role == MessageRole.user;

    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.82,
        ),
        margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 12),
        padding: isUser ? const EdgeInsets.all(12) : EdgeInsets.zero,
        decoration: isUser
            ? const BoxDecoration(
                color: Color(0xffcc785c),
                borderRadius: BorderRadius.only(
                  topLeft: Radius.circular(12),
                  topRight: Radius.circular(12),
                  bottomLeft: Radius.circular(12),
                  bottomRight: Radius.circular(4),
                ),
              )
            : const BoxDecoration(),
        child: isUser
            ? _buildUserContent(theme)
            : (!isUser && message.hasTimeline)
                ? _buildTimeline(theme)
                : _buildLegacyAssistant(theme),
      ),
    );
  }

  Widget _buildUserContent(ThemeData theme) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (message.content.isNotEmpty)
          Text(
            message.content,
            style: const TextStyle(
              color: Color(0xfffaf9f5),
              fontSize: 15,
              height: 1.6,
            ),
          ),
      ],
    );
  }

  /// 旧路径：thinking → content → toolCalls（向后兼容）。
  Widget _buildLegacyAssistant(ThemeData theme) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (message.thinkingContent != null &&
            message.thinkingContent!.isNotEmpty)
          ThinkingBlock(
            content: message.thinkingContent!,
            isStreaming: message.isStreaming,
          ),
        if (message.content.isNotEmpty)
          message.isStreaming
              ? StreamingText(
                  text: message.content,
                  isStreaming: message.isStreaming,
                )
              : MarkdownRenderer(
                  content: message.content,
                  isStreaming: message.isStreaming,
                )
        else if (message.isStreaming)
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(
                width: 12,
                height: 12,
                child: CircularProgressIndicator(
                  strokeWidth: 1.5,
                  valueColor: AlwaysStoppedAnimation<Color>(
                    theme.colorScheme.onSurface.withValues(alpha: 0.5),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Text(
                '正在思考...',
                style: TextStyle(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
                  fontSize: 13,
                ),
              ),
            ],
          ),
        if (message.toolCalls != null && message.toolCalls!.isNotEmpty)
          ...message.toolCalls!.map((tc) => ToolCallCard(toolCall: tc)),
      ],
    );
  }

  /// 新路径：按 timelineEvents 顺序渲染。
  Widget _buildTimeline(ThemeData theme) {
    final events = message.timelineEvents!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (int i = 0; i < events.length; i++)
          _buildTimelineEvent(
            events[i],
            theme,
            isLast: i == events.length - 1,
          ),
      ],
    );
  }

  Widget _buildTimelineEvent(
    TimelineEvent event,
    ThemeData theme, {
    required bool isLast,
  }) {
    switch (event.type) {
      case TimelineEventType.text:
        final isRunning = message.isStreaming &&
            event.status == TimelineEventStatus.running;
        return _TimelineEntry(
          dotColor: _statusColor(event.status, theme),
          showLine: !isLast,
          lineColor: theme.colorScheme.onSurface.withValues(alpha: 0.15),
          child: isRunning
              ? StreamingText(text: event.content ?? '')
              : MarkdownRenderer(content: event.content ?? ''),
        );
      case TimelineEventType.toolCall:
        final toolCall = message.toolCalls?.firstWhere(
          (tc) => tc.id == event.toolCallId,
          orElse: () => const ToolCall(
            id: '',
            toolName: 'unknown',
            input: '',
          ),
        );
        if (toolCall == null) {
          return const SizedBox.shrink();
        }
        return _TimelineEntry(
          dotColor: _statusColor(event.status, theme),
          showLine: !isLast,
          lineColor: theme.colorScheme.onSurface.withValues(alpha: 0.15),
          child: ToolCallCard(toolCall: toolCall),
        );
      case TimelineEventType.reasoning:
        return _TimelineEntry(
          dotColor: theme.colorScheme.onSurface.withValues(alpha: 0.4),
          showLine: !isLast,
          lineColor: theme.colorScheme.onSurface.withValues(alpha: 0.15),
          child: ThinkingBlock(
            content: event.content ?? '',
            isStreaming: message.isStreaming &&
                event.status == TimelineEventStatus.running,
          ),
        );
      case TimelineEventType.metadata:
        // 元信息事件不渲染（暂不产生）
        return const SizedBox.shrink();
    }
  }

  Color _statusColor(TimelineEventStatus status, ThemeData theme) {
    switch (status) {
      case TimelineEventStatus.running:
      case TimelineEventStatus.pending:
        return theme.colorScheme.primary;
      case TimelineEventStatus.completed:
        return theme.colorScheme.primary;
      case TimelineEventStatus.error:
        return theme.colorScheme.error;
    }
  }
}

/// Timeline 单条目：左侧圆点 + 竖线 + 右侧内容。
class _TimelineEntry extends StatelessWidget {
  final Color dotColor;
  final bool showLine;
  final Color lineColor;
  final Widget child;

  const _TimelineEntry({
    required this.dotColor,
    required this.showLine,
    required this.lineColor,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // 左侧装饰列：圆点 + 竖线
        SizedBox(
          width: 24,
          child: Column(
            children: [
              Container(
                width: 12,
                height: 12,
                margin: const EdgeInsets.only(top: 4),
                decoration: BoxDecoration(
                  color: dotColor,
                  shape: BoxShape.circle,
                ),
              ),
              if (showLine)
                Container(
                  width: 2,
                  height: 28,
                  color: lineColor,
                ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        // 右侧内容
        Expanded(
          child: Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: child,
          ),
        ),
      ],
    );
  }
}
