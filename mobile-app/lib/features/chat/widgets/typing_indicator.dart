import 'package:flutter/material.dart';

/// LLM 等待指示器：三个错峰跳动的圆点。
///
/// 对标桌面端 `MessageList.vue` 的 `.typing-indicator`：
/// - 三个 8x8 圆点，间隔 4px
/// - 颜色取自主题 colorScheme.primary（对应桌面端 --accent-primary）
/// - bounce 动画 1.4s，三个点错峰 -0.32s / -0.16s / 0s
/// - keyframes: 0%/80%/100% scale(0)，40% scale(1)
class TypingIndicator extends StatefulWidget {
  const TypingIndicator({super.key});

  @override
  State<TypingIndicator> createState() => _TypingIndicatorState();
}

class _TypingIndicatorState extends State<TypingIndicator>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  /// 动画周期 1.4s，对应桌面端 `animation: bounce 1.4s infinite ease-in-out both`。
  static const Duration _duration = Duration(milliseconds: 1400);

  /// 三个点的相位偏移（0~1），对应桌面端 delay -0.32s / -0.16s / 0s。
  /// 负 delay 在 infinite 动画中等价于正向相位偏移。
  static const List<double> _offsets = [0.32 / 1.4, 0.16 / 1.4, 0.0];

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: _duration,
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  /// 单个点在给定 progress（0~1）下的缩放。
  ///
  /// 对齐桌面端 keyframes：
  /// - 0% → scale 0
  /// - 40% → scale 1
  /// - 80% → scale 0
  /// - 100% → scale 0
  double _scaleAt(double progress) {
    if (progress < 0.4) return progress / 0.4;
    if (progress < 0.8) return (0.8 - progress) / 0.4;
    return 0.0;
  }

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.primary;
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        return Row(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            for (int i = 0; i < 3; i++) ...[
              if (i > 0) const SizedBox(width: 4),
              Transform.scale(
                scale: _scaleAt((_controller.value + _offsets[i]) % 1.0),
                child: Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: color,
                    shape: BoxShape.circle,
                  ),
                ),
              ),
            ],
          ],
        );
      },
    );
  }
}
