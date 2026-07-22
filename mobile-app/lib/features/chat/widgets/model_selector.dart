import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/config/mobile_config.dart';
import '../../../core/i18n/strings.dart';
import '../providers/model_provider.dart';

/// 聊天模型选择器。
///
/// 显示当前选中的模型名称，点击后从底部弹出模型列表供用户切换。
/// 选择结果通过 [onSelected] 回调返回。
class ModelSelector extends ConsumerWidget {
  final ValueChanged<String>? onSelected;

  const ModelSelector({super.key, this.onSelected});

  String _truncateModelName(String name) {
    if (name.length <= 12) return name;
    return '${name.substring(0, 12)}...';
  }

  Future<void> _showModelSheet(BuildContext context, WidgetRef ref) async {
    final theme = Theme.of(context);
    final currentModel = ref.read(mobileConfigProvider).model;
    final modelsFuture = ref.read(modelsProvider.future);

    final selected = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: theme.colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (sheetContext) => SafeArea(
        child: FutureBuilder<List<String>>(
          future: modelsFuture,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const SizedBox(
                height: 220,
                child: Center(child: CircularProgressIndicator()),
              );
            }

            final models = snapshot.data ?? ModelService.defaultModels;

            return Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 36,
                    height: 4,
                    margin: const EdgeInsets.only(top: 12, bottom: 16),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.2),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Text(
                    I18n.t('chat.modelTitle'),
                    style: TextStyle(
                      color: theme.colorScheme.onSurface,
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                Flexible(
                  child: ListView.builder(
                    shrinkWrap: true,
                    itemCount: models.length,
                    itemBuilder: (context, index) {
                      final model = models[index];
                      final isSelected = model == currentModel;
                      return ListTile(
                        leading: Icon(
                          isSelected
                              ? Icons.check_circle_rounded
                              : Icons.radio_button_unchecked_rounded,
                          color: isSelected
                              ? theme.colorScheme.primary
                              : theme.colorScheme.onSurface.withValues(
                                  alpha: 0.4,
                                ),
                        ),
                        title: Text(
                          model,
                          style: TextStyle(
                            color: theme.colorScheme.onSurface,
                          ),
                        ),
                        onTap: () => Navigator.pop(sheetContext, model),
                      );
                    },
                  ),
                ),
                const SizedBox(height: 8),
              ],
            );
          },
        ),
      ),
    );

    if (selected != null) {
      onSelected?.call(selected);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final currentModel = ref.watch(mobileConfigProvider).model;

    return InkWell(
      onTap: () => _showModelSheet(context, ref),
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: theme.colorScheme.surface,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: theme.colorScheme.onSurface.withValues(alpha: 0.1),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              _truncateModelName(currentModel),
              style: TextStyle(
                color: theme.colorScheme.onSurface,
                fontSize: 12,
              ),
            ),
            const SizedBox(width: 4),
            Icon(
              Icons.keyboard_arrow_down_rounded,
              size: 16,
              color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
            ),
          ],
        ),
      ),
    );
  }
}
