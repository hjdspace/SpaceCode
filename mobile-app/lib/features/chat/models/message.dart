import 'tool_call.dart';

enum MessageRole { user, assistant, system }

class ChatMessage {
  final String id;
  final MessageRole role;
  final String content;
  final List<ToolCall>? toolCalls;
  final String? thinkingContent;
  final bool isStreaming;
  final DateTime timestamp;

  ChatMessage({
    required this.id,
    required this.role,
    this.content = '',
    this.toolCalls,
    this.thinkingContent,
    this.isStreaming = false,
    DateTime? timestamp,
  }) : timestamp = timestamp ?? DateTime.now();

  ChatMessage copyWith({
    String? content,
    List<ToolCall>? toolCalls,
    String? thinkingContent,
    bool? isStreaming,
  }) => ChatMessage(
    id: id,
    role: role,
    content: content ?? this.content,
    toolCalls: toolCalls ?? this.toolCalls,
    thinkingContent: thinkingContent ?? this.thinkingContent,
    isStreaming: isStreaming ?? this.isStreaming,
  );
}
