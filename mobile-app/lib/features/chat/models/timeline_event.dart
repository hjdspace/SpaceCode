/// Timeline 事件类型。
///
/// 对应桌面端 [MessageTimelineEvent.type]，移动端按需实现核心子集：
/// - [text]：LLM 输出的文本片段
/// - [toolCall]：工具调用
/// - [reasoning]：LLM 思考过程
/// - [metadata]：模型/token/耗时等元信息（暂不主动产生，预留类型）
enum TimelineEventType { reasoning, text, toolCall, metadata }

/// Timeline 事件状态。
enum TimelineEventStatus { pending, running, completed, error }

/// Timeline 中的单个事件。
///
/// 一次 assistant turn 内的 text/toolCall/reasoning 按时间顺序记录为
/// [TimelineEvent] 列表，渲染时遍历该列表形成时间线视图。
class TimelineEvent {
  final String id;
  final TimelineEventType type;
  final DateTime timestamp;
  final TimelineEventStatus status;
  final String? content;
  final String? toolCallId;
  final Map<String, dynamic>? metadata;

  const TimelineEvent({
    required this.id,
    required this.type,
    required this.timestamp,
    required this.status,
    this.content,
    this.toolCallId,
    this.metadata,
  });

  TimelineEvent copyWith({
    TimelineEventStatus? status,
    String? content,
    Map<String, dynamic>? metadata,
  }) =>
      TimelineEvent(
        id: id,
        type: type,
        timestamp: timestamp,
        status: status ?? this.status,
        content: content ?? this.content,
        toolCallId: toolCallId,
        metadata: metadata ?? this.metadata,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'type': type.name,
        'timestamp': timestamp.toIso8601String(),
        'status': status.name,
        if (content != null) 'content': content,
        if (toolCallId != null) 'toolCallId': toolCallId,
        if (metadata != null) 'metadata': metadata,
      };

  factory TimelineEvent.fromJson(Map<String, dynamic> json) => TimelineEvent(
        id: json['id'] as String? ?? '',
        type: TimelineEventType.values.firstWhere(
          (e) => e.name == json['type'],
          orElse: () => TimelineEventType.text,
        ),
        timestamp: DateTime.tryParse(json['timestamp'] as String? ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0),
        status: TimelineEventStatus.values.firstWhere(
          (e) => e.name == json['status'],
          orElse: () => TimelineEventStatus.completed,
        ),
        content: json['content'] as String?,
        toolCallId: json['toolCallId'] as String?,
        metadata: json['metadata'] as Map<String, dynamic>?,
      );
}
