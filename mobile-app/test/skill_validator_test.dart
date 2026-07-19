import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/skills/skill_validator.dart';

void main() {
  group('validateName', () {
    test('accepts valid lowercase name', () {
      expect(SkillValidator.validateName('code-review'), isEmpty);
      expect(SkillValidator.validateName('commit-message'), isEmpty);
      expect(SkillValidator.validateName('a1b2'), isEmpty);
    });

    test('rejects empty name', () {
      expect(SkillValidator.validateName(''), isNotEmpty);
      expect(SkillValidator.validateName('   '), isNotEmpty);
    });

    test('rejects uppercase letters', () {
      expect(SkillValidator.validateName('CodeReview'), isNotEmpty);
      expect(SkillValidator.validateName('code-Review'), isNotEmpty);
    });

    test('rejects special characters', () {
      expect(SkillValidator.validateName('code_review'), isNotEmpty);
      expect(SkillValidator.validateName('code.review'), isNotEmpty);
      expect(SkillValidator.validateName('code review'), isNotEmpty);
    });

    test('rejects leading/trailing hyphen', () {
      expect(SkillValidator.validateName('-code'), isNotEmpty);
      expect(SkillValidator.validateName('code-'), isNotEmpty);
    });

    test('rejects consecutive hyphens', () {
      expect(SkillValidator.validateName('code--review'), isNotEmpty);
    });

    test('rejects name exceeding 64 chars', () {
      final long = 'a' * 65;
      expect(SkillValidator.validateName(long), isNotEmpty);
    });

    test('accepts name of exactly 64 chars', () {
      final valid = 'a' * 64;
      expect(SkillValidator.validateName(valid), isEmpty);
    });
  });

  group('validateDescription', () {
    test('accepts valid description', () {
      expect(SkillValidator.validateDescription('审查代码'), isEmpty);
      expect(SkillValidator.validateDescription('A skill for code review.'), isEmpty);
    });

    test('rejects null', () {
      expect(SkillValidator.validateDescription(null), isNotEmpty);
    });

    test('rejects empty or whitespace-only', () {
      expect(SkillValidator.validateDescription(''), isNotEmpty);
      expect(SkillValidator.validateDescription('   '), isNotEmpty);
    });

    test('rejects description exceeding 1024 chars', () {
      final long = 'a' * 1025;
      expect(SkillValidator.validateDescription(long), isNotEmpty);
    });

    test('accepts description of exactly 1024 chars', () {
      final valid = 'a' * 1024;
      expect(SkillValidator.validateDescription(valid), isEmpty);
    });
  });

  group('validate', () {
    test('returns skip=true and non-empty errors when description is null', () {
      final result = SkillValidator.validate(
        name: 'code-review',
        description: null,
      );
      expect(result.skip, isTrue);
      expect(result.errors, isNotEmpty);
      expect(
        result.errors,
        contains('description 不能为空'),
      );
    });

    test('returns skip=false and merged errors when name and description both invalid', () {
      final result = SkillValidator.validate(
        name: 'Invalid Name!',
        description: '',
      );
      expect(result.skip, isFalse);
      expect(result.errors.length, greaterThanOrEqualTo(2));
      expect(
        result.errors.any((e) => e.contains('name')),
        isTrue,
      );
      expect(
        result.errors.any((e) => e.contains('description')),
        isTrue,
      );
    });

    test('returns skip=false and empty errors when name and description both valid', () {
      final result = SkillValidator.validate(
        name: 'code-review',
        description: '审查代码',
      );
      expect(result.skip, isFalse);
      expect(result.errors, isEmpty);
    });
  });
}
