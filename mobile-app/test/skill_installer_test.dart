import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/skills/skill_installer.dart';

void main() {
  group('parseGithubUrl', () {
    test('parses full https URL', () {
      final parsed = SkillInstaller.parseGithubUrl(
        'https://github.com/user/repo',
      );
      expect(parsed?.owner, 'user');
      expect(parsed?.name, 'repo');
    });

    test('parses github.com/user/repo', () {
      final parsed = SkillInstaller.parseGithubUrl('github.com/user/repo');
      expect(parsed?.owner, 'user');
      expect(parsed?.name, 'repo');
    });

    test('parses user/repo shorthand', () {
      final parsed = SkillInstaller.parseGithubUrl('user/repo');
      expect(parsed?.owner, 'user');
      expect(parsed?.name, 'repo');
    });

    test('parses URL with .git suffix', () {
      final parsed = SkillInstaller.parseGithubUrl(
        'https://github.com/user/repo.git',
      );
      expect(parsed?.owner, 'user');
      expect(parsed?.name, 'repo');
    });

    test('returns null for invalid URL', () {
      expect(SkillInstaller.parseGithubUrl('not-a-url'), isNull);
      expect(SkillInstaller.parseGithubUrl('https://example.com/foo'), isNull);
      expect(SkillInstaller.parseGithubUrl('user'), isNull);
    });

    test('parses URL with trailing path', () {
      final parsed = SkillInstaller.parseGithubUrl(
        'https://github.com/user/repo/tree/main',
      );
      expect(parsed?.owner, 'user');
      expect(parsed?.name, 'repo');
    });
  });
}
