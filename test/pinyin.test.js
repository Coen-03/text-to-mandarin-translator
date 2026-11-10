// Checks the bundled pinyin-pro build together with core.js, the way the
// service worker and the panel use them.
const test = require('node:test');
const assert = require('node:assert/strict');
const { pinyin } = require('../vendor/pinyin-pro.js');
const Core = require('../src/core.js');

const convert = (text) =>
  Core.buildSegments(
    pinyin(text, { type: 'all' }).map((c) => ({ origin: c.origin, pinyin: c.pinyin, isZh: c.isZh }))
  );

test('tone marks and punctuation', () => {
  assert.equal(Core.plainPinyin(convert('你好，世界！')), 'nǐ hǎo, shì jiè!');
});

test('characters with several readings are resolved from context', () => {
  assert.equal(Core.plainPinyin(convert('银行')), 'yín háng');
  assert.equal(Core.plainPinyin(convert('行走')), 'xíng zǒu');
});

test('traditional characters get pinyin too', () => {
  assert.equal(Core.plainPinyin(convert('學習中文')), 'xué xí zhōng wén');
});

test('mixed text keeps the original characters intact', () => {
  const segments = convert('我爱 Python 3');
  assert.equal(Core.hanzi(segments), '我爱 Python 3');
  assert.equal(Core.plainPinyin(segments), 'wǒ ài Python 3');
});
