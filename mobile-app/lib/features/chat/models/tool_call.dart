enum ToolCallStatus { running, completed, error }

class ToolCall {
  final String id;
  final String toolName;
  final String input;
  final String? output;
  final ToolCallStatus status;

  ToolCall({
    required this.id,
    required this.toolName,
    required this.input,
    this.output,
    this.status = ToolCallStatus.running,
  });

  ToolCall copyWith({String? output, ToolCallStatus? status}) => ToolCall(
    id: id,
    toolName: toolName,
    input: input,
    output: output ?? this.output,
    status: status ?? this.status,
  );
}
