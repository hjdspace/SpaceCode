import 'package:flutter/material.dart';

/// 斜杠命令菜单数据项。
class CommandMenuItem {
  final String command;
  final String description;

  const CommandMenuItem({required this.command, required this.description});
}

/// 聊天输入框上方的斜杠命令浮层。
class SkillCommandMenu extends StatelessWidget {
  final List<CommandMenuItem> items;
  final int selectedIndex;
  final ValueChanged<int> onSelected;

  const SkillCommandMenu({
    super.key,
    required this.items,
    required this.selectedIndex,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Material(
      elevation: 4,
      borderRadius: BorderRadius.circular(8),
      color: theme.colorScheme.surface,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 240),
        child: ListView.builder(
          shrinkWrap: true,
          itemCount: items.length,
          itemBuilder: (context, index) {
            final item = items[index];
            final isSelected = index == selectedIndex;
            return InkWell(
              onTap: () => onSelected(index),
              child: Container(
                color: isSelected
                    ? theme.colorScheme.primary.withValues(alpha: 0.1)
                    : null,
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.command,
                      style: TextStyle(
                        color: theme.colorScheme.onSurface,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    Text(
                      item.description,
                      style: TextStyle(
                        color: theme.colorScheme.onSurface
                            .withValues(alpha: 0.6),
                        fontSize: 12,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}
