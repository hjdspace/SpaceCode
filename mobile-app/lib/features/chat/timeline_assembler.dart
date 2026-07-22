import 'models/timeline_event.dart';
import 'models/tool_call.dart';

/// Timeline 事件装配器。
///
/// 每个 assistant turn 创建一个实例，按事件到达顺序维护
/// [TimelineEvent] 列表。工具调用开始时会"切断"当前 text 事件，
/// LLM 工具调用后继续输出文本会创建**新的** text 事件，
/// 从而自然形成时间顺序。
///
/// 参照桌面端 `src/stores/turn/timelineAssembler.ts` 实现。
class TimelineAssembler {
  final List<TimelineEvent> _events = [];
  String? _currentTextEventId;
  String? _currentReasoningEventId;
  int _counter = 0;

  /// 当前已装配的事件列表（不可变视图）。
  List<TimelineEvent> get events => List.unmodifiable(_events);

  /// 流式文本 delta 到达：追加到当前 text 事件，若不存在则创建。
  void appendTextDelta(String delta) {
    if (delta.isEmpty) return;
    if (_currentTextEventId == null) {
      _currentTextEventId = _nextId();
      _events.add(TimelineEvent(
        id: _currentTextEventId!,
        type: TimelineEventType.text,
        timestamp: DateTime.now(),
        status: TimelineEventStatus.running,
        content: '',
      ));
    }
    final idx = _indexById(_currentTextEventId!);
    if (idx >= 0) {
      _events[idx] = _events[idx].copyWith(
        content: _events[idx].content! + delta,
      );
    }
  }

  /// 流式思考 delta 到达：追加到当前 reasoning 事件，若不存在则创建。
  void appendReasoningDelta(String delta) {
    if (delta.isEmpty) return;
    if (_currentReasoningEventId == null) {
      _currentReasoningEventId = _nextId();
      _events.add(TimelineEvent(
        id: _currentReasoningEventId!,
        type: TimelineEventType.reasoning,
        timestamp: DateTime.now(),
        status: TimelineEventStatus.running,
        content: '',
      ));
    }
    final idx = _indexById(_currentReasoningEventId!);
    if (idx >= 0) {
      _events[idx] = _events[idx].copyWith(
        content: _events[idx].content! + delta,
      );
    }
  }

  /// 工具调用开始：先关闭当前 text 事件，再追加 toolCall 事件。
  void addToolCall(ToolCall toolCall) {
    _completeCurrentTextEvent();
    _events.add(TimelineEvent(
      id: _nextId(),
      type: TimelineEventType.toolCall,
      timestamp: DateTime.now(),
      status: TimelineEventStatus.running,
      toolCallId: toolCall.id,
    ));
  }

  /// 工具结果到达：更新对应 toolCall 事件的状态。
  void completeToolCall(String toolCallId, ToolCallStatus status) {
    final idx = _events.indexWhere((e) =>
        e.type == TimelineEventType.toolCall && e.toolCallId == toolCallId);
    if (idx >= 0) {
      _events[idx] = _events[idx].copyWith(
        status: status == ToolCallStatus.completed
            ? TimelineEventStatus.completed
            : TimelineEventStatus.error,
      );
    }
  }

  /// turn 结束：关闭所有未完成事件。
  void completeTurn() {
    _completeCurrentTextEvent();
    _completeCurrentReasoningEvent();
  }

  void _completeCurrentTextEvent() {
    if (_currentTextEventId == null) return;
    final idx = _indexById(_currentTextEventId!);
    if (idx >= 0 && _events[idx].status == TimelineEventStatus.running) {
      if (_events[idx].content!.isEmpty) {
        _events.removeAt(idx);
      } else {
        _events[idx] =
            _events[idx].copyWith(status: TimelineEventStatus.completed);
      }
    }
    _currentTextEventId = null;
  }

  void _completeCurrentReasoningEvent() {
    if (_currentReasoningEventId == null) return;
    final idx = _indexById(_currentReasoningEventId!);
    if (idx >= 0 && _events[idx].status == TimelineEventStatus.running) {
      if (_events[idx].content!.isEmpty) {
        _events.removeAt(idx);
      } else {
        _events[idx] =
            _events[idx].copyWith(status: TimelineEventStatus.completed);
      }
    }
    _currentReasoningEventId = null;
  }

  int _indexById(String id) =>
      _events.indexWhere((e) => e.id == id);

  String _nextId() {
    _counter += 1;
    return 'tl-${DateTime.now().microsecondsSinceEpoch}-$_counter';
  }
}
