// Pure logic: no DOM, no chrome.* and no network, so it can be unit tested in
// Node. Loaded as a classic script in the extension (global MandarinCore) and
// with require() in the tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MandarinCore = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const MAX_TEXT_LENGTH = 1000;
  const MIN_DETECTION_CONFIDENCE = 0.5;

  // CJK Unified Ideographs, Extension A and the compatibility block.
  const HAN = /[㐀-䶿一-鿿豈-﫿]/;
  const HAN_GLOBAL = new RegExp(HAN.source, 'g');
  const LETTER_GLOBAL = /\p{L}/gu;
  const WORD_CHAR = /[\p{L}\p{N}]/u;

  // Chinese punctuation as it should appear in a line of pinyin.
  const PUNCTUATION = {
    '，': ',', '。': '.', '！': '!', '？': '?', '：': ':', '；': ';', '、': ',',
    '（': '(', '）': ')', '“': '"', '”': '"', '‘': "'", '’': "'",
    '《': '"', '》': '"', '「': '"', '」': '"', '『': '"', '』': '"',
    '…': '...', '—': '-',
  };
  // Characters that open a bracket or quotation: a space goes before them,
  // not after them.
  const OPENERS = new Set(['（', '“', '‘', '《', '「', '『', '(', '[']);

  // Trims the selection and collapses runs of whitespace. Returns '' for
  // anything that is not usable text.
  function normalizeText(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/\s+/g, ' ').trim();
  }

  // Why a selection cannot be translated, or null when it can.
  function validateText(text) {
    if (text.length === 0) return 'empty';
    if (text.length > MAX_TEXT_LENGTH) return 'too-long';
    return null;
  }

  // True when most letters are Chinese characters: such text needs pinyin,
  // not translation.
  function isMostlyChinese(text) {
    const han = (text.match(HAN_GLOBAL) || []).length;
    if (han === 0) return false;
    const letters = (text.match(LETTER_GLOBAL) || []).length;
    return han / letters > 0.5;
  }

  // 'en-US' -> 'en'. Returns '' for anything that is not a language tag.
  function baseLanguage(tag) {
    if (typeof tag !== 'string') return '';
    const match = /^[a-zA-Z]{2,3}(?=$|[-_])/.exec(tag.trim());
    return match ? match[0].toLowerCase() : '';
  }

  // Chooses the source language for the translator.
  //   detections: result of LanguageDetector.detect(), best first (may be empty)
  //   pageLanguage: the page's <html lang>, used when detection is unsure,
  //                 which is common for selections of a few words
  function pickSourceLanguage(detections, pageLanguage) {
    const best = Array.isArray(detections) ? detections[0] : null;
    if (
      best &&
      typeof best.detectedLanguage === 'string' &&
      best.detectedLanguage !== 'und' &&
      best.confidence >= MIN_DETECTION_CONFIDENCE
    ) {
      return best.detectedLanguage;
    }
    return baseLanguage(pageLanguage) || 'en';
  }

  // Turns pinyin-pro's per-character output into display segments:
  //   { text, pinyin }  pinyin is '' for anything that is not a Chinese character
  // Neighbouring non-Chinese characters are merged into one segment.
  function buildSegments(characters) {
    const segments = [];
    for (const c of Array.isArray(characters) ? characters : []) {
      if (!c || typeof c.origin !== 'string' || c.origin === '') continue;
      const reading = c.isZh && typeof c.pinyin === 'string' ? c.pinyin : '';
      const last = segments[segments.length - 1];
      if (reading === '' && last && last.pinyin === '') last.text += c.origin;
      else segments.push({ text: c.origin, pinyin: reading });
    }
    return segments;
  }

  // One line of pinyin for copying: syllables separated by spaces, Chinese
  // punctuation replaced by its western form, e.g. "nǐ hǎo, shì jiè!".
  //
  // A small state machine: `prev` is the kind of token written last, and it
  // decides whether the next token needs a space in front of it.
  function plainPinyin(segments) {
    let out = '';
    let prev = 'start';  // start | space | opener | pinyin | word | chinese-punct | ascii-punct
    const gap = () => {
      if (prev !== 'start' && prev !== 'space' && prev !== 'opener') out += ' ';
    };

    for (const segment of segments) {
      if (segment.pinyin !== '') {
        gap();
        out += segment.pinyin;
        prev = 'pinyin';
        continue;
      }
      for (const char of segment.text) {
        if (/\s/.test(char)) {
          if (prev !== 'start' && prev !== 'space') {
            out += ' ';
            prev = 'space';
          }
        } else if (OPENERS.has(char)) {
          gap();
          out += PUNCTUATION[char] || char;
          prev = 'opener';
        } else if (WORD_CHAR.test(char)) {
          // "Python" and "3.5" stay together; a word after a syllable or after
          // Chinese punctuation starts with a space
          if (prev !== 'word' && prev !== 'ascii-punct') gap();
          out += char;
          prev = 'word';
        } else if (PUNCTUATION[char]) {
          out += PUNCTUATION[char];
          prev = 'chinese-punct';
        } else {
          out += char;
          prev = 'ascii-punct';
        }
      }
    }
    return out.trim();
  }

  function hanzi(segments) {
    return segments.map((s) => s.text).join('');
  }

  return {
    MAX_TEXT_LENGTH,
    normalizeText,
    validateText,
    isMostlyChinese,
    baseLanguage,
    pickSourceLanguage,
    buildSegments,
    plainPinyin,
    hanzi,
  };
});
