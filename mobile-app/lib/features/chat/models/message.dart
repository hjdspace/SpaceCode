import 'timeline_event.dart';
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
  final List<TimelineEvent>? timelineEvents;

  ChatMessage({
    required this.id,
    required this.role,
    this.content = '',
    this.toolCalls,
    this.thinkingContent,
    this.isStreaming = false,
    DateTime? timestamp,
    this.timelineEvents,
  }) : timestamp = timestamp ?? DateTime.now();

  bool get hasTimeline =>
      timelineEvents != null && timelineEvents!.isNotEmpty;

  ChatMessage copyWith({
    String? content,
    List<ToolCall>? toolCalls,
    String? thinkingContent,
    bool? isStreaming,
    List<TimelineEvent>? timelineEvents,
  }) =>
      ChatMessage(
        id: id,
        role: role,
        content: content ?? this.content,
        toolCalls: toolCalls ?? this.toolCalls,
        thinkingContent: thinkingContent ?? this.thinkingContent,
        isStreaming: isStreaming ?? this.isStreaming,
        timelineEvents: timelineEvents ?? this.timelineEvents,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'role': role.name,
        'content': content,
        'toolCalls': toolCalls?.map((t) => t.toJson()).toList(),
        'thinkingContent': thinkingContent,
        'isStreaming': isStreaming,
        'timestamp': timestamp.toIso8601String(),
        if (timelineEvents != null)
          'timelineEvents': timelineEvents!.map((e) => e.toJson()).toList(),
      };

  factory ChatMessage.fromJson(Map<String, dynamic> json) => ChatMessage(
        id: json['id'] as String? ?? '',
        role: MessageRole.values.firstWhere(
          (e) => e.name == json['role'],
          orElse: () => MessageRole.assistant,
        ),
        content: json['content'] as String? ?? '',
        toolCalls: (json['toolCalls'] as List<dynamic>?)
            ?.map((t) => ToolCall.fromJson(t as Map<String, dynamic>))
            .toList(),
        thinkingContent: json['thinkingContent'] as String?,
        // 反序列化时一律标记为已完成（流式状态不持久化）
        isStreaming: false,
        timestamp:
            DateTime.tryParse(json['timestamp'] as String? ?? '') ??
                DateTime.now(),
        timelineEvents: (json['timelineEvents'] as List<dynamic>?)
            ?.map((e) => TimelineEvent.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}
