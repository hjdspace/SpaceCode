import 'package:flutter/material.dart';
import '../models/tool_call.dart';

class ToolCallCard extends StatefulWidget {
  final ToolCall toolCall;

  const ToolCallCard({
    super.key,
    required this.toolCall,
  });

  @override
  State<ToolCallCard> createState() => _ToolCallCardState();
}

class _ToolCallCardState extends State<ToolCallCard> {
  bool _isExpanded = false;

  Color _statusColor() {
    switch (widget.toolCall.status) {
      case ToolCallStatus.running:
        return const Color(0xffd4a017);
      case ToolCallStatus.completed:
        return const Color(0xff5db872);
      case ToolCallStatus.error:
        return const Color(0xffc64545);
    }
  }

  IconData _statusIcon() {
    switch (widget.toolCall.status) {
      case ToolCallStatus.running:
        return Icons.hourglass_top_rounded;
      case ToolCallStatus.completed:
        return Icons.check_circle_rounded;
      case ToolCallStatus.error:
        return Icons.error_rounded;
    }
  }

  String _statusLabel() {
    switch (widget.toolCall.status) {
      case ToolCallStatus.running:
        return '运行中';
      case ToolCallStatus.completed:
        return '已完成';
      case ToolCallStatus.error:
        return '出错';
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final statusColor = _statusColor();

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 4),
      decoration: BoxDecoration(
        color: theme.cardColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: theme.colorScheme.onSurface.withValues(alpha: 0.1),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            onTap: () => setState(() => _isExpanded = !_isExpanded),
            borderRadius: BorderRadius.circular(12),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(
                      color: statusColor,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Icon(
                    _statusIcon(),
                    size: 16,
                    color: statusColor,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      widget.toolCall.toolName,
                      style: TextStyle(
                        color: theme.colorScheme.onSurface,
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        fontFamily: 'monospace',
                      ),
                    ),
                  ),
                  Text(
                    _statusLabel(),
                    style: TextStyle(
                      color: statusColor,
                      fontSize: 12,
                    ),
                  ),
                  const SizedBox(width: 4),
                  Icon(
                    _isExpanded
                        ? Icons.expand_less_rounded
                        : Icons.expand_more_rounded,
                    size: 18,
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.4),
                  ),
                ],
              ),
            ),
          ),
          if (_isExpanded) ...[
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (widget.toolCall.input.isNotEmpty) ...[
                    Text(
                      '输入',
                      style: TextStyle(
                        color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.surface,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        widget.toolCall.input.length > 500
                            ? '${widget.toolCall.input.substring(0, 500)}...'
                            : widget.toolCall.input,
                        style: TextStyle(
                          color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                          fontSize: 12,
                          fontFamily: 'monospace',
                          height: 1.4,
                        ),
                      ),
                    ),
                  ],
                  if (widget.toolCall.output != null &&
                      widget.toolCall.output!.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Text(
                      '输出',
                      style: TextStyle(
                        color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.surface,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        widget.toolCall.output!.length > 500
                            ? '${widget.toolCall.output!.substring(0, 500)}...'
                            : widget.toolCall.output!,
                        style: TextStyle(
                          color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                          fontSize: 12,
                          fontFamily: 'monospace',
                          height: 1.4,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
