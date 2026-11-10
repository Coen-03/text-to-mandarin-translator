// Translation with Chrome's built-in Translator and LanguageDetector APIs.
// They run a model on the user's device: the selected text is not sent to a
// server. Both APIs exist only in windows (not in workers), which is why this
// file runs in the content script and in the popup, not in the service worker.
(function (root) {
  'use strict';

  const Core = root.MandarinCore;
  const translators = new Map();  // "source>target" -> Translator
  let detectorPromise = null;

  class TranslateError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  // The built-in APIs can stay silent forever when a browser exposes them but
  // ships no language models (seen in an embedded Chromium). A panel that says
  // "Translating…" indefinitely is worse than an error, so every step has a
  // deadline. `timer.touch()` restarts it, used while a download reports progress.
  function withDeadline(promise, ms, timer) {
    return new Promise((resolve, reject) => {
      let handle = null;
      const arm = () => {
        clearTimeout(handle);
        handle = setTimeout(() => {
          reject(
            new TranslateError(
              'timeout',
              'The translator of Chrome did not respond. Check chrome://on-device-translation-internals or try again.'
            )
          );
        }, ms);
      };
      if (timer) timer.touch = arm;
      arm();
      promise.then(
        (value) => {
          clearTimeout(handle);
          resolve(value);
        },
        (error) => {
          clearTimeout(handle);
          reject(error);
        }
      );
    });
  }

  const AVAILABILITY_DEADLINE_MS = 10000;
  const CREATE_DEADLINE_MS = 60000;  // restarted on every download progress event
  const TRANSLATE_DEADLINE_MS = 30000;

  function isSupported() {
    return 'Translator' in root;
  }

  async function detectLanguage(text, pageLanguage) {
    if (!('LanguageDetector' in root)) return Core.pickSourceLanguage([], pageLanguage);
    try {
      if (!detectorPromise) detectorPromise = root.LanguageDetector.create();
      const detector = await withDeadline(detectorPromise, AVAILABILITY_DEADLINE_MS);
      const detections = await withDeadline(detector.detect(text), AVAILABILITY_DEADLINE_MS);
      return Core.pickSourceLanguage(detections, pageLanguage);
    } catch (error) {
      detectorPromise = null;  // allow a retry, for example after a user click
      if (error && error.name === 'NotAllowedError') throw error;
      return Core.pickSourceLanguage([], pageLanguage);
    }
  }

  async function getTranslator(sourceLanguage, targetLanguage, onProgress) {
    const key = `${sourceLanguage}>${targetLanguage}`;
    if (translators.has(key)) return translators.get(key);

    const availability = await withDeadline(
      root.Translator.availability({ sourceLanguage, targetLanguage }),
      AVAILABILITY_DEADLINE_MS
    );
    if (availability === 'unavailable') {
      throw new TranslateError(
        'pair-unavailable',
        `Chrome cannot translate from "${sourceLanguage}" to Chinese.`
      );
    }
    const timer = {};
    const translator = await withDeadline(
      root.Translator.create({
        sourceLanguage,
        targetLanguage,
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => {
            if (timer.touch) timer.touch();
            if (onProgress) onProgress(e.loaded);
          });
        },
      }),
      CREATE_DEADLINE_MS,
      timer
    );
    translators.set(key, translator);
    return translator;
  }

  // Returns { sourceLanguage, chinese, translated }.
  //   translated is false when the text was Chinese already.
  // Options: traditional (bool), pageLanguage (string), onProgress(fraction 0..1)
  // Throws TranslateError with code 'empty' | 'too-long' | 'unsupported' |
  // 'pair-unavailable', or the browser's NotAllowedError when a language model
  // has to be downloaded and the call did not come from a user click.
  async function toMandarin(rawText, options = {}) {
    const text = Core.normalizeText(rawText);
    const problem = Core.validateText(text);
    if (problem === 'empty') throw new TranslateError('empty', 'No text selected.');
    if (problem === 'too-long') {
      throw new TranslateError(
        'too-long',
        `The selection is longer than ${Core.MAX_TEXT_LENGTH} characters.`
      );
    }

    if (Core.isMostlyChinese(text)) {
      return { sourceLanguage: 'zh', chinese: text, translated: false };
    }
    if (!isSupported()) {
      throw new TranslateError(
        'unsupported',
        'This page cannot use the built-in translator of Chrome (needs Chrome 138 or newer on desktop).'
      );
    }

    const sourceLanguage = await detectLanguage(text, options.pageLanguage);
    if (Core.baseLanguage(sourceLanguage) === 'zh') {
      return { sourceLanguage, chinese: text, translated: false };
    }
    const targetLanguage = options.traditional ? 'zh-Hant' : 'zh';
    const translator = await getTranslator(sourceLanguage, targetLanguage, options.onProgress);
    const chinese = await withDeadline(translator.translate(text), TRANSLATE_DEADLINE_MS);
    return { sourceLanguage, chinese, translated: true };
  }

  root.MandarinTranslate = { toMandarin, isSupported, TranslateError };
})(typeof self !== 'undefined' ? self : globalThis);
