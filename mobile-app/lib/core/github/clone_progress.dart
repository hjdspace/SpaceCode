/// Clone 任务进度阶段。
enum ClonePhase { downloading, extracting, done, error }

/// Clone 任务的瞬时进度快照。
///
/// 由 [GithubService.cloneRepository] 通过 Stream 推送，
/// [CloneNotifier] 消费后转化为 [CloneState]。
class CloneProgress {
  final ClonePhase phase;
  final int receivedBytes;
  final int? totalBytes;
  final int processedFiles;
  final int? totalFiles;
  final String? errorMessage;
  final String? resultPath;

  const CloneProgress({
    required this.phase,
    required this.receivedBytes,
    required this.totalBytes,
    required this.processedFiles,
    this.totalFiles,
    this.errorMessage,
    this.resultPath,
  });

  /// 下载阶段百分比 [0, 1]；totalBytes 未知时返回 null。
  double? get downloadPercent =>
      (totalBytes == null || totalBytes == 0) ? null : receivedBytes / totalBytes!;

  /// 解压阶段百分比 [0, 1]；totalFiles 未知时返回 null。
  double? get extractPercent =>
      (totalFiles == null || totalFiles == 0) ? null : processedFiles / totalFiles!;

  Map<String, dynamic> toJson() => {
        'phase': phase.name,
        'receivedBytes': receivedBytes,
        'totalBytes': totalBytes,
        'processedFiles': processedFiles,
        'totalFiles': totalFiles,
        if (errorMessage != null) 'errorMessage': errorMessage,
        if (resultPath != null) 'resultPath': resultPath,
      };

  factory CloneProgress.fromJson(Map<String, dynamic> json) => CloneProgress(
        phase: ClonePhase.values.firstWhere(
          (e) => e.name == json['phase'],
          orElse: () => ClonePhase.downloading,
        ),
        receivedBytes: (json['receivedBytes'] as num?)?.toInt() ?? 0,
        totalBytes: (json['totalBytes'] as num?)?.toInt(),
        processedFiles: (json['processedFiles'] as num?)?.toInt() ?? 0,
        totalFiles: (json['totalFiles'] as num?)?.toInt(),
        errorMessage: json['errorMessage'] as String?,
        resultPath: json['resultPath'] as String?,
      );
}
