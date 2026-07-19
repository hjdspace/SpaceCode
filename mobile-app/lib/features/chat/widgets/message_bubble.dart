import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/message.dart';
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
        // LLM 答复不使用 bubble 外壳：避免黑底黑字可读性问题；
        // 仅用户消息保留气泡以区分发送方。
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
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (message.thinkingContent != null &&
                message.thinkingContent!.isNotEmpty)
              ThinkingBlock(
                content: message.thinkingContent!,
                isStreaming: message.isStreaming,
              ),
            if (message.content.isNotEmpty)
              isUser
                  ? Text(
                      message.content,
                      style: const TextStyle(
                        color: Color(0xfffaf9f5),
                        fontSize: 15,
                        height: 1.6,
                      ),
                    )
                  : message.isStreaming
                      ? StreamingText(
                          text: message.content,
                          isStreaming: message.isStreaming,
                        )
                      : MarkdownRenderer(
                          content: message.content,
                          isStreaming: message.isStreaming,
                        )
            else if (!isUser && message.isStreaming)
              // 助手消息正在流式输出但内容尚未到达：显示加载指示
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
              ...message.toolCalls!.map(
                (tc) => ToolCallCard(toolCall: tc),
              ),
          ],
        ),
      ),
    );
  }
}
