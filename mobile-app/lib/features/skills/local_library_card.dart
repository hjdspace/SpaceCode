import 'package:flutter/material.dart';

import '../../core/i18n/strings.dart';
import '../../core/skills/local_library_index.dart';

/// 库技能的安装状态。
enum InstallStatus {
  /// 未安装。
  notInstalled,

  /// 已安装（来自 user source）。
  installedUser,

  /// 已安装（来自 github source）。
  installedGithub,
}

/// 本地技能库的单个技能卡片。
class LocalLibraryCard extends StatelessWidget {
  final LocalLibrarySkill skill;
  final InstallStatus installStatus;
  final VoidCallback? onInstall;
  final VoidCallback? onUninstall;
  final VoidCallback? onTap;

  const LocalLibraryCard({
    super.key,
    required this.skill,
    required this.installStatus,
    this.onInstall,
    this.onUninstall,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: ListTile(
        leading: Icon(_categoryIcon(skill.category), color: theme.colorScheme.primary),
        title: Text(
          skill.name,
          style: TextStyle(color: theme.colorScheme.onSurface),
        ),
        subtitle: Text(
          skill.description,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.6)),
        ),
        trailing: _buildTrailing(theme),
        onTap: onTap,
      ),
    );
  }

  Widget _buildTrailing(ThemeData theme) {
    switch (installStatus) {
      case InstallStatus.notInstalled:
        return FilledButton.tonal(
          onPressed: onInstall,
          child: Text(I18n.t('skills.install')),
        );
      case InstallStatus.installedUser:
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.check_circle, color: theme.colorScheme.primary, size: 18),
            const SizedBox(width: 4),
            OutlinedButton(
              onPressed: onUninstall,
              child: Text(I18n.t('skills.uninstall')),
            ),
          ],
        );
      case InstallStatus.installedGithub:
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.cloud_download_outlined,
                color: theme.colorScheme.secondary, size: 18),
            const SizedBox(width: 4),
            Text(
              I18n.t('skills.installedFromGithub'),
              style: TextStyle(
                  color: theme.colorScheme.secondary,
                  fontSize: 12),
            ),
          ],
        );
    }
  }

  IconData _categoryIcon(String category) {
    switch (category) {
      case LocalLibraryCategories.development:
        return Icons.code;
      case LocalLibraryCategories.frontendDesign:
        return Icons.design_services_outlined;
      case LocalLibraryCategories.office:
        return Icons.description_outlined;
      case LocalLibraryCategories.aiMl:
        return Icons.psychology_outlined;
      case LocalLibraryCategories.devops:
        return Icons.cloud_outlined;
      case LocalLibraryCategories.creative:
        return Icons.palette_outlined;
      case LocalLibraryCategories.communication:
        return Icons.chat_outlined;
      default:
        return Icons.extension_outlined;
    }
  }
}
