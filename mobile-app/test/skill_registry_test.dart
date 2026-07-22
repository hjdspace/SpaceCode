import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/skills/skill_registry.dart';
import 'package:spacecode_mobile/core/skills/skill_types.dart';

void main() {
  const skillA = Skill(
    name: 'a',
    description: 'A',
    filePath: '/tmp/a/SKILL.md',
    baseDir: '/tmp/a',
    source: SkillSourceKind.user,
  );
  const skillB = Skill(
    name: 'b',
    description: 'B',
    filePath: '/tmp/b/SKILL.md',
    baseDir: '/tmp/b',
    source: SkillSourceKind.bundled,
  );

  test('initial state has all skills enabled', () {
    const state = SkillRegistryState(
      skills: [skillA, skillB],
      diagnostics: [],
      loading: false,
      disabledNames: {},
    );
    expect(state.enabledSkills.length, 2);
    expect(state.find('a')?.name, 'a');
    expect(state.find('missing'), isNull);
  });

  test('toggle moves names in/out of disabledNames', () {
    var state = const SkillRegistryState(
      skills: [skillA, skillB],
      diagnostics: [],
      loading: false,
      disabledNames: {},
    );
    state = state.toggle('a');
    expect(state.disabledNames, {'a'});
    expect(state.enabledSkills.length, 1);
    expect(state.enabledSkills.first.name, 'b');
    state = state.toggle('a');
    expect(state.disabledNames, isEmpty);
    expect(state.enabledSkills.length, 2);
  });
}
