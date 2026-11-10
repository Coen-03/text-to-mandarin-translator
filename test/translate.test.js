// translate.js against fake Translator / LanguageDetector objects, so the
// decision logic is tested without a browser.
const test = require('node:test');
const assert = require('node:assert/strict');

const modulePath = require.resolve('../src/translate.js');

// Loads a fresh copy of translate.js (its caches are module state) with the
// given fake browser APIs installed as globals.
function load({ Translator, LanguageDetector } = {}) {
  globalThis.MandarinCore = require('../src/core.js');
  delete globalThis.Translator;
  delete globalThis.LanguageDetector;
  if (Translator) globalThis.Translator = Translator;
  if (LanguageDetector) globalThis.LanguageDetector = LanguageDetector;
  delete require.cache[modulePath];
  require(modulePath);
  return globalThis.MandarinTranslate;
}

function fakeDetector(language, confidence = 0.99) {
  return {
    create: async () => ({ detect: async () => [{ detectedLanguage: language, confidence }] }),
  };
}

function fakeTranslator({ availability = 'available', calls = [] } = {}) {
  return {
    calls,
    availability: async (pair) => {
      calls.push(['availability', pair.sourceLanguage, pair.targetLanguage]);
      return availability;
    },
    create: async (options) => {
      calls.push(['create', options.sourceLanguage, options.targetLanguage]);
      return { translate: async (text) => `[${options.targetLanguage}] ${text}` };
    },
  };
}

test('Chinese text is returned unchanged, without touching the translator', async () => {
  const translator = fakeTranslator();
  const api = load({ Translator: translator });
  const result = await api.toMandarin('  今天天气很好  ');
  assert.deepEqual(result, { sourceLanguage: 'zh', chinese: '今天天气很好', translated: false });
  assert.deepEqual(translator.calls, []);
});

test('Chinese text works even when the browser has no translator', async () => {
  const api = load();
  assert.equal((await api.toMandarin('你好')).translated, false);
});

test('detected language is used as the source', async () => {
  const translator = fakeTranslator();
  const api = load({ Translator: translator, LanguageDetector: fakeDetector('nl') });
  const result = await api.toMandarin('Goedemorgen allemaal');
  assert.deepEqual(result, {
    sourceLanguage: 'nl',
    chinese: '[zh] Goedemorgen allemaal',
    translated: true,
  });
  assert.deepEqual(translator.calls, [
    ['availability', 'nl', 'zh'],
    ['create', 'nl', 'zh'],
  ]);
});

test('traditional option selects zh-Hant', async () => {
  const api = load({ Translator: fakeTranslator(), LanguageDetector: fakeDetector('en') });
  const result = await api.toMandarin('Good morning', { traditional: true });
  assert.equal(result.chinese, '[zh-Hant] Good morning');
});

test('an unsure detection falls back to the page language', async () => {
  const translator = fakeTranslator();
  const api = load({ Translator: translator, LanguageDetector: fakeDetector('af', 0.2) });
  await api.toMandarin('kat', { pageLanguage: 'nl-NL' });
  assert.deepEqual(translator.calls[0], ['availability', 'nl', 'zh']);
});

test('without a language detector the page language is used', async () => {
  const translator = fakeTranslator();
  const api = load({ Translator: translator });
  await api.toMandarin('bonjour', { pageLanguage: 'fr' });
  assert.deepEqual(translator.calls[0], ['availability', 'fr', 'zh']);
});

test('a failing detector does not block the translation', async () => {
  const translator = fakeTranslator();
  const broken = { create: async () => { throw new Error('Model not available'); } };
  const api = load({ Translator: translator, LanguageDetector: broken });
  const result = await api.toMandarin('hello');
  assert.equal(result.sourceLanguage, 'en');
});

test('the translator is created once per language pair', async () => {
  const translator = fakeTranslator();
  const api = load({ Translator: translator, LanguageDetector: fakeDetector('en') });
  await api.toMandarin('one');
  await api.toMandarin('two');
  assert.equal(translator.calls.filter((c) => c[0] === 'create').length, 1);
});

test('text detected as Chinese is not translated', async () => {
  const translator = fakeTranslator();
  // Mostly Latin letters, so the character check does not catch it.
  const api = load({ Translator: translator, LanguageDetector: fakeDetector('zh') });
  const result = await api.toMandarin('ni hao 你');
  assert.equal(result.translated, false);
  assert.deepEqual(translator.calls, []);
});

test('errors carry a code', async () => {
  const api = load({
    Translator: fakeTranslator({ availability: 'unavailable' }),
    LanguageDetector: fakeDetector('xx'),
  });
  await assert.rejects(api.toMandarin('hello'), (e) => e.code === 'pair-unavailable');
  await assert.rejects(api.toMandarin('   '), (e) => e.code === 'empty');
  await assert.rejects(api.toMandarin('a'.repeat(1001)), (e) => e.code === 'too-long');
  await assert.rejects(load().toMandarin('hello'), (e) => e.code === 'unsupported');
});

test('a user-activation error from the browser is passed on unchanged', async () => {
  const notAllowed = Object.assign(new Error('needs a user gesture'), { name: 'NotAllowedError' });
  const translator = fakeTranslator();
  translator.create = async () => { throw notAllowed; };
  const api = load({ Translator: translator, LanguageDetector: fakeDetector('en') });
  await assert.rejects(api.toMandarin('hello'), (e) => e === notAllowed);
});

test('a translator that never answers ends in a timeout error', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const silent = { availability: () => new Promise(() => {}), create: async () => ({}) };
  const api = load({ Translator: silent });
  const pending = assert.rejects(api.toMandarin('hello'), (e) => e.code === 'timeout');
  await new Promise((resolve) => setImmediate(resolve));  // let toMandarin reach the await
  t.mock.timers.tick(10000);
  await pending;
});
