import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/i18n/strings.dart';

void main() {
  test('falls back to key when not initialized', () {
    expect(I18n.t('nonexistent.key'), 'nonexistent.key');
  });

  test('returns zh strings after init with zh locale', () {
    I18n.initForTest(locale: AppLocale.zh, strings: {
      'skills.title': '技能',
    });
    expect(I18n.t('skills.title'), '技能');
  });

  test('returns en strings after init with en locale', () {
    I18n.initForTest(locale: AppLocale.en, strings: {
      'skills.title': 'Skills',
    });
    expect(I18n.t('skills.title'), 'Skills');
  });

  test('supports {placeholder} interpolation', () {
    I18n.initForTest(locale: AppLocale.zh, strings: {
      'skills.installed': '已安装 {name}',
    });
    expect(I18n.t('skills.installed', {'name': 'code-review'}), '已安装 code-review');
  });
}
