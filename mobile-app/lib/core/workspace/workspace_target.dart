enum WorkspaceMode { local, github }

class WorkspaceTarget {
  final WorkspaceMode mode;
  final String? localPath;
  final String? repository;
  final String? branch;

  const WorkspaceTarget.local(this.localPath)
      : mode = WorkspaceMode.local,
        repository = null,
        branch = null;

  const WorkspaceTarget.github(
      {required this.repository, required this.branch, this.localPath})
      : mode = WorkspaceMode.github;

  factory WorkspaceTarget.fromJson(Map<String, dynamic> json) {
    if (json['mode'] == WorkspaceMode.github.name) {
      return WorkspaceTarget.github(
        repository: json['repository'] as String?,
        branch: json['branch'] as String?,
        localPath: json['localPath'] as String?,
      );
    }
    return WorkspaceTarget.local(json['localPath'] as String?);
  }

  Map<String, dynamic> toJson() => {
        'mode': mode.name,
        'localPath': localPath,
        'repository': repository,
        'branch': branch,
      };

  String get label => mode == WorkspaceMode.local
      ? (localPath ?? '本地目录')
      : '${repository ?? 'Github 仓库'} · ${branch ?? '默认分支'}';

  String get promptContext => mode == WorkspaceMode.local
      ? '本地工作目录：${localPath ?? ''}'
      : 'Github 仓库：${repository ?? ''}\n目标分支：${branch ?? ''}${localPath == null ? '' : '\n手机工作目录：$localPath'}';
}
