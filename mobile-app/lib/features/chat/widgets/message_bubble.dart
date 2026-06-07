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
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: isUser
              ? const Color(0xffcc785c)
              : const Color(0xff252320),
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(12),
            topRight: const Radius.circular(12),
            bottomLeft: isUser
                ? const Radius.circular(12)
                : const Radius.circular(4),
            bottomRight: isUser
                ? const Radius.circular(4)
                : const Radius.circular(12),
          ),
          border: isUser
              ? null
              : Border.all(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.1),
                ),
        ),
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
