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

  String get label => mode == WorkspaceMode.local
      ? (localPath ?? '本地目录')
      : '${repository ?? 'Github 仓库'} · ${branch ?? '默认分支'}';

  String get promptContext => mode == WorkspaceMode.local
      ? '本地工作目录：${localPath ?? ''}'
      : 'Github 仓库：${repository ?? ''}\n目标分支：${branch ?? ''}${localPath == null ? '' : '\n手机工作目录：$localPath'}';
}
