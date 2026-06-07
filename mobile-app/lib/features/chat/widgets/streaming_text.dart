import 'package:flutter/material.dart';

class StreamingText extends StatefulWidget {
  final String text;
  final bool isStreaming;
  final TextStyle? style;

  const StreamingText({
    super.key,
    required this.text,
    this.isStreaming = false,
    this.style,
  });

  @override
  State<StreamingText> createState() => _StreamingTextState();
}

class _StreamingTextState extends State<StreamingText>
    with SingleTickerProviderStateMixin {
  late AnimationController _cursorController;

  @override
  void initState() {
    super.initState();
    _cursorController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 530),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _cursorController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final defaultStyle = TextStyle(
      color: theme.colorScheme.onSurface,
      fontSize: 15,
      height: 1.6,
    );
    final effectiveStyle = widget.style ?? defaultStyle;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Flexible(
          child: SelectableText(
            widget.text,
            style: effectiveStyle,
          ),
        ),
        if (widget.isStreaming)
          FadeTransition(
            opacity: _cursorController,
            child: Text(
              '▌',
              style: effectiveStyle.copyWith(
                color: theme.colorScheme.primary,
              ),
            ),
          ),
      ],
    );
  }
}
