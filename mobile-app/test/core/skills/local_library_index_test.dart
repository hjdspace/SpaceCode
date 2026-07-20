import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/skills/local_library_index.dart';

void main() {
  group('LocalLibrarySkill', () {
    test('fromJson parses all fields', () {
      final json = {
        'name': 'code-review',
        'description': 'Review the changes',
        'category': 'development',
        'assetPath': 'assets/skills-lib/code-review/SKILL.md',
      };
      final skill = LocalLibrarySkill.fromJson(json);
      expect(skill.name, 'code-review');
      expect(skill.description, 'Review the changes');
      expect(skill.category, 'development');
      expect(skill.assetPath, 'assets/skills-lib/code-review/SKILL.md');
    });

    test('fromJson uses default category when missing', () {
      final json = {
        'name': 'foo',
        'description': 'desc',
        'assetPath': 'assets/skills-lib/foo/SKILL.md',
      };
      final skill = LocalLibrarySkill.fromJson(json);
      expect(skill.category, 'other');
    });

    test('fromJson handles null category with default', () {
      final json = {
        'name': 'foo',
        'description': 'desc',
        'category': null,
        'assetPath': 'assets/skills-lib/foo/SKILL.md',
      };
      final skill = LocalLibrarySkill.fromJson(json);
      expect(skill.category, 'other');
    });
  });

  group('LocalLibraryIndex', () {
    test('fromJson parses complete index', () {
      final json = {
        'version': 1,
        'generatedAt': '2026-07-20T10:00:00Z',
        'skills': [
          {
            'name': 'code-review',
            'description': 'desc1',
            'category': 'development',
            'assetPath': 'assets/skills-lib/code-review/SKILL.md',
          },
          {
            'name': 'pdf',
            'description': 'desc2',
            'category': 'office',
            'assetPath': 'assets/skills-lib/pdf/SKILL.md',
          },
        ],
      };
      final index = LocalLibraryIndex.fromJson(json);
      expect(index.version, 1);
      expect(index.generatedAt, DateTime.parse('2026-07-20T10:00:00Z'));
      expect(index.skills.length, 2);
      expect(index.skills[0].name, 'code-review');
      expect(index.skills[1].name, 'pdf');
    });

    test('fromJson handles empty skills array', () {
      final json = {
        'version': 1,
        'generatedAt': '2026-07-20T10:00:00Z',
        'skills': [],
      };
      final index = LocalLibraryIndex.fromJson(json);
      expect(index.skills, isEmpty);
    });

    test('fromJson uses default version when missing', () {
      final json = {
        'generatedAt': '2026-07-20T10:00:00Z',
        'skills': [],
      };
      final index = LocalLibraryIndex.fromJson(json);
      expect(index.version, 1);
    });

    test('fromJson uses now() when generatedAt missing or invalid', () {
      final before = DateTime.now();
      final json = {
        'version': 1,
        'generatedAt': 'invalid-date',
        'skills': [],
      };
      final index = LocalLibraryIndex.fromJson(json);
      final after = DateTime.now();
      expect(index.generatedAt.isAfter(before.subtract(Duration(seconds: 1))), true);
      expect(index.generatedAt.isBefore(after.add(Duration(seconds: 1))), true);
    });

    test('fromJson handles missing skills field', () {
      final json = {'version': 1, 'generatedAt': '2026-07-20T10:00:00Z'};
      final index = LocalLibraryIndex.fromJson(json);
      expect(index.skills, isEmpty);
    });

    test('empty factory returns empty index', () {
      final index = LocalLibraryIndex.empty;
      expect(index.skills, isEmpty);
      expect(index.version, 0);
    });

    test('round-trip JSON serialization', () {
      final original = {
        'version': 1,
        'generatedAt': '2026-07-20T10:00:00Z',
        'skills': [
          {
            'name': 'tdd',
            'description': 'Test-driven development',
            'category': 'development',
            'assetPath': 'assets/skills-lib/tdd/SKILL.md',
          }
        ],
      };
      final index = LocalLibraryIndex.fromJson(
          jsonDecode(jsonEncode(original)) as Map<String, dynamic>);
      expect(index.skills.length, 1);
      expect(index.skills[0].name, 'tdd');
      expect(index.skills[0].description, 'Test-driven development');
    });
  });

  group('LocalLibraryCategories', () {
    test('allValues contains 9 categories', () {
      expect(LocalLibraryCategories.allValues.length, 9);
    });

    test('allValues contains all expected categories', () {
      expect(LocalLibraryCategories.allValues, contains('all'));
      expect(LocalLibraryCategories.allValues, contains('development'));
      expect(LocalLibraryCategories.allValues, contains('frontend-design'));
      expect(LocalLibraryCategories.allValues, contains('office'));
      expect(LocalLibraryCategories.allValues, contains('ai-ml'));
      expect(LocalLibraryCategories.allValues, contains('devops'));
      expect(LocalLibraryCategories.allValues, contains('creative'));
      expect(LocalLibraryCategories.allValues, contains('communication'));
      expect(LocalLibraryCategories.allValues, contains('other'));
    });
  });
}
