import 'package:flutter/material.dart';

/// 命令菜单数据项。
class CommandMenuItem {
  final String command;
  final String description;
  final String group;

  const CommandMenuItem({
    required this.command,
    required this.description,
    required this.group,
  });
}

class _GroupSection {
  final String group;
  final List<int> indices = [];

  _GroupSection(this.group);
}

/// 聊天输入框上方的斜杠命令浮层。
class CommandMenu extends StatelessWidget {
  final List<CommandMenuItem> items;
  final int selectedIndex;
  final ValueChanged<int> onSelected;

  const CommandMenu({
    super.key,
    required this.items,
    required this.selectedIndex,
    required this.onSelected,
  });

  List<_GroupSection> _buildSections() {
    final sections = <_GroupSection>[];
    final sectionMap = <String, _GroupSection>{};

    for (int i = 0; i < items.length; i++) {
      final group = items[i].group;
      final section = sectionMap.putIfAbsent(group, () {
        final newSection = _GroupSection(group);
        sections.add(newSection);
        return newSection;
      });
      section.indices.add(i);
    }

    return sections;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final sections = _buildSections();

    return Material(
      elevation: 4,
      borderRadius: BorderRadius.circular(8),
      color: theme.colorScheme.surface,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 260),
        child: ListView.builder(
          shrinkWrap: true,
          itemCount: sections.length + items.length,
          itemBuilder: (context, index) {
            int current = 0;
            for (final section in sections) {
              if (current == index) {
                return _buildGroupHeader(theme, section.group);
              }
              current++;
              for (final itemIndex in section.indices) {
                if (current == index) {
                  return _buildItem(theme, itemIndex);
                }
                current++;
              }
            }
            return const SizedBox.shrink();
          },
        ),
      ),
    );
  }

  Widget _buildGroupHeader(ThemeData theme, String group) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Text(
        group,
        style: TextStyle(
          fontSize: 12,
          color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
        ),
      ),
    );
  }

  Widget _buildItem(ThemeData theme, int index) {
    final item = items[index];
    final isSelected = index == selectedIndex;

    return InkWell(
      onTap: () => onSelected(index),
      child: Container(
        color: isSelected
            ? theme.colorScheme.primary.withValues(alpha: 0.1)
            : null,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Row(
          children: [
            Text(
              item.command,
              style: TextStyle(
                color: theme.colorScheme.onSurface,
                fontWeight: FontWeight.w500,
              ),
            ),
            const Spacer(),
            Expanded(
              child: Text(
                item.description,
                style: TextStyle(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
                  fontSize: 12,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.end,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
