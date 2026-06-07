import 'package:flutter/material.dart';
import 'agent_card.dart';

class AgentsScreen extends StatelessWidget {
  const AgentsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(
            child: Container(
              width: 36,
              height: 4,
              margin: const EdgeInsets.only(bottom: 16),
              decoration: BoxDecoration(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          Text(
            '选择 Agent',
            style: TextStyle(
              color: theme.colorScheme.onSurface,
              fontSize: 18,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            '选择一个 AI 助手来协助你完成任务',
            style: TextStyle(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
              fontSize: 13,
            ),
          ),
          const SizedBox(height: 16),
          AgentCard(
            name: 'Code Agent',
            description: '代码编写、调试与重构',
            icon: Icons.code_rounded,
            iconColor: const Color(0xffcc785c),
            isSelected: true,
            onTap: () => Navigator.pop(context),
          ),
          const SizedBox(height: 8),
          AgentCard(
            name: 'Architect Agent',
            description: '架构设计与系统分析',
            icon: Icons.architecture_rounded,
            iconColor: const Color(0xff5db8a6),
            onTap: () => Navigator.pop(context),
          ),
          const SizedBox(height: 8),
          AgentCard(
            name: 'Review Agent',
            description: '代码审查与质量检查',
            icon: Icons.rate_review_rounded,
            iconColor: const Color(0xffe8a55a),
            onTap: () => Navigator.pop(context),
          ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}
