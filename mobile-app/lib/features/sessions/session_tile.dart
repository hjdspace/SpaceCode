import 'package:flutter/material.dart';
import '../../core/i18n/strings.dart';

class SessionTile extends StatelessWidget {
  final String title;
  final String? subtitle;
  final DateTime? timestamp;
  final bool isActive;
  final VoidCallback? onTap;

  const SessionTile({
    super.key,
    required this.title,
    this.subtitle,
    this.timestamp,
    this.isActive = false,
    this.onTap,
  });

  String _formatTime(DateTime? time) {
    if (time == null) return '';
    final now = DateTime.now();
    final diff = now.difference(time);
    if (diff.inMinutes < 1) return I18n.t('sessions.justNow');
    if (diff.inHours < 1) return I18n.t('sessions.minutesAgo', {'count': diff.inMinutes.toString()});
    if (diff.inDays < 1) return I18n.t('sessions.hoursAgo', {'count': diff.inHours.toString()});
    if (diff.inDays < 7) return I18n.t('sessions.daysAgo', {'count': diff.inDays.toString()});
    return '${time.month}/${time.day}';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return ListTile(
      onTap: onTap,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
      ),
      selected: isActive,
      selectedTileColor: theme.colorScheme.primary.withValues(alpha: 0.1),
      leading: Container(
        width: 36,
        height: 36,
        decoration: BoxDecoration(
          color: isActive
              ? theme.colorScheme.primary.withValues(alpha: 0.15)
              : theme.colorScheme.surface,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Icon(
          Icons.chat_bubble_outline_rounded,
          size: 18,
          color: isActive
              ? theme.colorScheme.primary
              : theme.colorScheme.onSurface.withValues(alpha: 0.4),
        ),
      ),
      title: Text(
        title,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          color: theme.colorScheme.onSurface,
          fontSize: 14,
          fontWeight: isActive ? FontWeight.w600 : FontWeight.w400,
        ),
      ),
      subtitle: subtitle != null
          ? Text(
              subtitle!,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.4),
                fontSize: 12,
              ),
            )
          : null,
      trailing: timestamp != null
          ? Text(
              _formatTime(timestamp),
              style: TextStyle(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.3),
                fontSize: 11,
              ),
            )
          : null,
    );
  }
}
