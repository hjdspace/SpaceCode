import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/skills/local_library_index.dart';
import 'package:spacecode_mobile/core/skills/local_library_notifier.dart';

void main() {
  group('LocalLibraryState', () {
    test('filteredSkills returns all when category is all and query empty', () {
      final state = LocalLibraryState(
        skills: const [
          LocalLibrarySkill(
              name: 'a', description: 'alpha', category: 'development', assetPath: 'p/a'),
          LocalLibrarySkill(
              name: 'b', description: 'beta', category: 'office', assetPath: 'p/b'),
        ],
        loading: false,
        error: null,
        installedNames: const {},
        selectedCategory: 'all',
        searchQuery: '',
      );
      expect(state.filteredSkills.length, 2);
    });

    test('filteredSkills filters by category', () {
      final state = LocalLibraryState(
        skills: const [
          LocalLibrarySkill(
              name: 'a', description: 'alpha', category: 'development', assetPath: 'p/a'),
          LocalLibrarySkill(
              name: 'b', description: 'beta', category: 'office', assetPath: 'p/b'),
        ],
        loading: false,
        error: null,
        installedNames: const {},
        selectedCategory: 'office',
        searchQuery: '',
      );
      expect(state.filteredSkills.length, 1);
      expect(state.filteredSkills[0].name, 'b');
    });

    test('filteredSkills filters by search query (case insensitive)', () {
      final state = LocalLibraryState(
        skills: const [
          LocalLibrarySkill(
              name: 'code-review', description: 'Review changes', category: 'development', assetPath: 'p'),
          LocalLibrarySkill(
              name: 'pdf', description: 'PDF processing', category: 'office', assetPath: 'p'),
        ],
        loading: false,
        error: null,
        installedNames: const {},
        selectedCategory: 'all',
        searchQuery: 'REVIEW',
      );
      expect(state.filteredSkills.length, 1);
      expect(state.filteredSkills[0].name, 'code-review');
    });

    test('filteredSkills filters by both category and query', () {
      final state = LocalLibraryState(
        skills: const [
          LocalLibrarySkill(
              name: 'code-review', description: 'Review', category: 'development', assetPath: 'p'),
          LocalLibrarySkill(
              name: 'tdd', description: 'Review-driven', category: 'development', assetPath: 'p'),
          LocalLibrarySkill(
              name: 'pdf', description: 'Review PDFs', category: 'office', assetPath: 'p'),
        ],
        loading: false,
        error: null,
        installedNames: const {},
        selectedCategory: 'development',
        searchQuery: 'review',
      );
      expect(state.filteredSkills.length, 2);
    });

    test('isInstalled returns true when name in installedNames', () {
      final state = LocalLibraryState(
        skills: const [
          LocalLibrarySkill(
              name: 'a', description: '', category: 'other', assetPath: 'p'),
        ],
        loading: false,
        error: null,
        installedNames: const {'a'},
        selectedCategory: 'all',
        searchQuery: '',
      );
      expect(state.isInstalled('a'), true);
      expect(state.isInstalled('b'), false);
    });

    test('empty factory returns default state', () {
      const state = LocalLibraryState.empty;
      expect(state.skills, isEmpty);
      expect(state.loading, true);
      expect(state.error, isNull);
      expect(state.installedNames, isEmpty);
      expect(state.selectedCategory, 'all');
      expect(state.searchQuery, '');
    });

    test('copyWith preserves unspecified fields', () {
      const original = LocalLibraryState.empty;
      final updated = original.copyWith(selectedCategory: 'office');
      expect(updated.selectedCategory, 'office');
      expect(updated.skills, isEmpty);
      expect(updated.loading, true);
    });
  });
}
