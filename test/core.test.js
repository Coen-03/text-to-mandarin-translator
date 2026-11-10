const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/core.js');

const zh = (origin, pinyin) => ({ origin, pinyin, isZh: true });
const other = (origin) => ({ origin, pinyin: '', isZh: false });

test('normalizeText trims and collapses whitespace', () => {
  assert.equal(Core.normalizeText('  hello \n\t world  '), 'hello world');
  assert.equal(Core.normalizeText(undefined), '');
  assert.equal(Core.normalizeText(42), '');
});

test('validateText', () => {
  assert.equal(Core.validateText(''), 'empty');
  assert.equal(Core.validateText('a'), null);
  assert.equal(Core.validateText('a'.repeat(Core.MAX_TEXT_LENGTH)), null);
  assert.equal(Core.validateText('a'.repeat(Core.MAX_TEXT_LENGTH + 1)), 'too-long');
});

test('isMostlyChinese', () => {
  assert.equal(Core.isMostlyChinese('你好世界'), true);
  assert.equal(Core.isMostlyChinese('你好, world'), false); // 2 of 7 letters
  assert.equal(Core.isMostlyChinese('我用 Go'), false); // 2 of 4 is not a majority
  assert.equal(Core.isMostlyChinese('hello'), false);
  assert.equal(Core.isMostlyChinese('123 !!'), false);
  assert.equal(Core.isMostlyChinese('今天 2024 年！'), true); // digits and punctuation do not count
});

test('baseLanguage', () => {
  assert.equal(Core.baseLanguage('en-US'), 'en');
  assert.equal(Core.baseLanguage('NL'), 'nl');
  assert.equal(Core.baseLanguage('zh_Hant'), 'zh');
  assert.equal(Core.baseLanguage(''), '');
  assert.equal(Core.baseLanguage(null), '');
  assert.equal(Core.baseLanguage('x'), '');
  assert.equal(Core.baseLanguage('english'), '');
});

test('pickSourceLanguage trusts a confident detection', () => {
  const detections = [
    { detectedLanguage: 'nl', confidence: 0.93 },
    { detectedLanguage: 'de', confidence: 0.04 },
  ];
  assert.equal(Core.pickSourceLanguage(detections, 'en'), 'nl');
});

test('pickSourceLanguage falls back to the page language, then to English', () => {
  const unsure = [{ detectedLanguage: 'af', confidence: 0.31 }];
  assert.equal(Core.pickSourceLanguage(unsure, 'nl-NL'), 'nl');
  assert.equal(Core.pickSourceLanguage(unsure, ''), 'en');
  assert.equal(Core.pickSourceLanguage([{ detectedLanguage: 'und', confidence: 0.99 }], 'fr'), 'fr');
  assert.equal(Core.pickSourceLanguage([], undefined), 'en');
  assert.equal(Core.pickSourceLanguage(null, 'de'), 'de');
});

test('buildSegments merges runs of non-Chinese characters', () => {
  const segments = Core.buildSegments([
    zh('你', 'nǐ'), zh('好', 'hǎo'), other('，'), other(' '), other('a'), other('b'), zh('世', 'shì'),
  ]);
  assert.deepEqual(segments, [
    { text: '你', pinyin: 'nǐ' },
    { text: '好', pinyin: 'hǎo' },
    { text: '， ab', pinyin: '' },
    { text: '世', pinyin: 'shì' },
  ]);
  assert.equal(Core.hanzi(segments), '你好， ab世');
});

test('buildSegments survives malformed input', () => {
  assert.deepEqual(Core.buildSegments(null), []);
  assert.deepEqual(Core.buildSegments([null, {}, { origin: '' }, { origin: 5 }]), []);
  // isZh without a reading is shown as plain text
  assert.deepEqual(Core.buildSegments([{ origin: '好', isZh: true }]), [{ text: '好', pinyin: '' }]);
});

test('plainPinyin spaces syllables and converts punctuation', () => {
  const segments = Core.buildSegments([
    zh('你', 'nǐ'), zh('好', 'hǎo'), other('，'), zh('世', 'shì'), zh('界', 'jiè'), other('！'),
  ]);
  assert.equal(Core.plainPinyin(segments), 'nǐ hǎo, shì jiè!');
});

test('plainPinyin keeps foreign words as separate words', () => {
  const segments = Core.buildSegments([
    zh('我', 'wǒ'), zh('用', 'yòng'), other('P'), other('y'), other('t'), other('h'), other('o'),
    other('n'), zh('写', 'xiě'), other(' '), other('3'), zh('个', 'gè'),
  ]);
  assert.equal(Core.plainPinyin(segments), 'wǒ yòng Python xiě 3 gè');
});

test('plainPinyin handles brackets and quotes', () => {
  const segments = Core.buildSegments([
    zh('他', 'tā'), zh('说', 'shuō'), other('：'), other('“'), zh('好', 'hǎo'), other('”'),
    other('（'), zh('笑', 'xiào'), other('）'), other('。'),
  ]);
  assert.equal(Core.plainPinyin(segments), 'tā shuō: "hǎo" (xiào).');
});

test('plainPinyin of nothing is empty', () => {
  assert.equal(Core.plainPinyin([]), '');
});

const voice = (name, lang, localService) => ({ name, lang, localService });

test('pickMandarinVoice prefers mainland Mandarin, and a local voice among equals', () => {
  const voices = [
    voice('Microsoft David', 'en-US', true),
    voice('Google 普通话', 'zh-CN', false),
    voice('Microsoft Huihui', 'zh-CN', true),
    voice('Microsoft Hanhan', 'zh-TW', true),
  ];
  assert.equal(Core.pickMandarinVoice(voices).name, 'Microsoft Huihui');
});

test('pickMandarinVoice takes an online mainland voice over a local Taiwan voice', () => {
  const voices = [voice('Microsoft Hanhan', 'zh-TW', true), voice('Google 普通话', 'zh-CN', false)];
  assert.equal(Core.pickMandarinVoice(voices).name, 'Google 普通话');
});

test('pickMandarinVoice never picks a Cantonese voice', () => {
  const cantonese = [
    voice('Microsoft Tracy', 'zh-HK', true),
    voice('Google 粤語', 'yue-HK', false),
    voice('Sin-ji', 'zh_HK', true),
    voice('Macau', 'zh-MO', true),
  ];
  assert.equal(Core.pickMandarinVoice(cantonese), null);
  assert.equal(
    Core.pickMandarinVoice([...cantonese, voice('Mei-Jia', 'zh_TW', true)]).name,
    'Mei-Jia'
  );
});

test('pickMandarinVoice accepts other spellings of the language tag', () => {
  assert.equal(Core.pickMandarinVoice([voice('a', 'cmn-Hans-CN', false)]).name, 'a');
  assert.equal(Core.pickMandarinVoice([voice('b', 'zh', true)]).name, 'b');
  assert.equal(Core.pickMandarinVoice([voice('c', 'ZH_cn', true)]).name, 'c');
});

test('pickMandarinVoice returns null when nothing fits', () => {
  assert.equal(Core.pickMandarinVoice([]), null);
  assert.equal(Core.pickMandarinVoice(null), null);
  assert.equal(Core.pickMandarinVoice([voice('x', 'en-GB', true), {}, null, { lang: 5 }]), null);
});
