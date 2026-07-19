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

  Map<String, dynamic> toJson() => {
    'id': id,
    'toolName': toolName,
    'input': input,
    'output': output,
    'status': status.name,
  };

  factory ToolCall.fromJson(Map<String, dynamic> json) => ToolCall(
    id: json['id'] as String? ?? '',
    toolName: json['toolName'] as String? ?? '',
    input: json['input'] as String? ?? '',
    output: json['output'] as String?,
    status: ToolCallStatus.values.firstWhere(
      (e) => e.name == json['status'],
      orElse: () => ToolCallStatus.running,
    ),
  );
}
