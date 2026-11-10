// Renders a translation result into a container element. Shared by the
// in-page panel (content script) and the toolbar popup.
//
// Everything that comes from a web page or from the translator is inserted
// with textContent, never as HTML, so a page cannot inject markup into the
// extension's UI.
(function (root) {
  'use strict';

  const Core = root.MandarinCore;
  const Translate = root.MandarinTranslate;

  const STYLE = `
    :host, .mst-root { all: initial; }
    .mst-root {
      --bg: #ffffff; --fg: #1c1c1e; --muted: #6b6b70; --line: #d9d9de;
      --accent: #b3261e; --button: #f2f2f5;
      display: block; box-sizing: border-box;
      font: 14px/1.4 system-ui, "Segoe UI", sans-serif; color: var(--fg);
    }
    @media (prefers-color-scheme: dark) {
      .mst-root {
        --bg: #1f1f23; --fg: #f2f2f5; --muted: #a0a0a8; --line: #3a3a41;
        --accent: #ff8a80; --button: #2c2c32;
      }
    }
    .mst-card {
      background: var(--bg); border: 1px solid var(--line); border-radius: 10px;
      padding: 12px 14px; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.22);
      max-width: 420px; min-width: 220px; box-sizing: border-box;
    }
    .mst-status { color: var(--muted); }
    .mst-error { color: var(--accent); }
    .mst-hanzi {
      font-size: 24px; line-height: 2.3; word-break: break-word;
      font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif;
    }
    .mst-hanzi rt { font-size: 12px; color: var(--accent); font-family: system-ui, sans-serif; }
    .mst-pinyin { color: var(--muted); margin-top: 4px; word-break: break-word; }
    .mst-source { color: var(--muted); font-size: 12px; margin-top: 8px; }
    .mst-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    button {
      all: unset; cursor: pointer; background: var(--button); color: var(--fg);
      border: 1px solid var(--line); border-radius: 6px; padding: 4px 10px;
      font: 13px system-ui, sans-serif;
    }
    button:hover { border-color: var(--muted); }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    .mst-trigger {
      background: var(--accent); color: #fff; border: none; font-weight: 600;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      font-family: "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
    }
    @media (prefers-color-scheme: dark) { .mst-trigger { color: #1f1f23; } }
  `;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(label, onClick) {
    const node = el('button', '', label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  function requestPinyin(text) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'pinyin', text }, (response) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!response || !Array.isArray(response.characters)) {
          reject(new Error('No pinyin received from the extension.'));
        } else resolve(response.characters);
      });
    });
  }

  function copyButton(label, text) {
    const node = button(label, async () => {
      try {
        await navigator.clipboard.writeText(text);
        node.textContent = 'Copied';
      } catch {
        node.textContent = 'Copy failed';
      }
      setTimeout(() => (node.textContent = label), 1200);
    });
    return node;
  }

  // The list of voices is filled asynchronously in Chrome: the first call can
  // return an empty list, followed by a 'voiceschanged' event.
  function loadVoices(synth) {
    const voices = synth.getVoices();
    if (voices.length > 0) return Promise.resolve(voices);
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        synth.removeEventListener('voiceschanged', done);
        resolve(synth.getVoices());
      };
      const timer = setTimeout(done, 1500);
      synth.addEventListener('voiceschanged', done);
    });
  }

  // Button that reads the Chinese text aloud. `note` is a line below the
  // result where the chosen voice, or the reason for silence, is shown.
  function listenButton(text, note) {
    const label = 'Listen';
    let speaking = false;
    const node = button(label, async () => {
      const synth = root.speechSynthesis;
      if (!synth || typeof root.SpeechSynthesisUtterance !== 'function') {
        note.textContent = 'This browser cannot read text aloud.';
        return;
      }
      if (speaking) {
        synth.cancel();
        return;
      }
      const voice = Core.pickMandarinVoice(await loadVoices(synth));
      if (!voice) {
        note.textContent =
          'No Mandarin voice found. Add Chinese (Simplified) with speech in the Windows language settings.';
        return;
      }
      const utterance = new root.SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = 0.9;  // slightly slow: easier to follow along with the pinyin
      utterance.onstart = () => {
        speaking = true;
        node.textContent = 'Stop';
      };
      utterance.onend = utterance.onerror = () => {
        speaking = false;
        node.textContent = label;
      };
      note.textContent = voice.localService
        ? `Voice: ${voice.name}`
        : `Voice: ${voice.name} (online voice: the Chinese text is sent to its provider)`;
      synth.cancel();  // stop anything still playing from an earlier panel
      synth.speak(utterance);
    });
    return node;
  }

  function renderResult(card, result, segments) {
    card.replaceChildren();

    const hanzi = el('div', 'mst-hanzi');
    hanzi.lang = 'zh';
    for (const segment of segments) {
      if (segment.pinyin === '') {
        hanzi.append(segment.text);
      } else {
        const ruby = el('ruby');
        ruby.append(segment.text, el('rt', '', segment.pinyin));
        hanzi.append(ruby);
      }
    }
    const pinyinLine = Core.plainPinyin(segments);
    const actions = el('div', 'mst-actions');
    const voiceNote = el('div', 'mst-source');
    actions.append(
      listenButton(result.chinese, voiceNote),
      copyButton('Copy characters', result.chinese),
      copyButton('Copy pinyin', pinyinLine)
    );
    const source = result.translated
      ? `Translated from ${result.sourceLanguage} on this device`
      : 'Already Chinese: pinyin added';
    card.append(
      hanzi,
      el('div', 'mst-pinyin', pinyinLine),
      el('div', 'mst-source', source),
      actions,
      voiceNote
    );
  }

  // Translates text and fills `card`. options: { traditional, pageLanguage, onFallback }
  // onFallback(text) is offered as a button when the page cannot use the
  // translator itself.
  async function translateInto(card, text, options = {}) {
    card.replaceChildren(el('div', 'mst-status', 'Translating…'));
    const status = card.firstChild;
    try {
      const result = await Translate.toMandarin(text, {
        traditional: options.traditional,
        pageLanguage: options.pageLanguage,
        onProgress: (fraction) => {
          status.textContent = `Downloading language model… ${Math.round(fraction * 100)}%`;
        },
      });
      const segments = Core.buildSegments(await requestPinyin(result.chinese));
      renderResult(card, result, segments);
    } catch (error) {
      card.replaceChildren();
      if (error && error.name === 'NotAllowedError') {
        // Chrome only starts a model download after a click on the page.
        card.append(
          el('div', 'mst-status', 'Chrome needs a click before it downloads a language model.'),
          el('div', 'mst-actions')
        );
        card.lastChild.append(button('Translate', () => translateInto(card, text, options)));
        return;
      }
      card.append(el('div', 'mst-error', (error && error.message) || 'Translation failed.'));
      if (error && error.code === 'unsupported' && options.onFallback) {
        const actions = el('div', 'mst-actions');
        actions.append(button('Open translator window', () => options.onFallback(text)));
        card.append(actions);
      }
    }
  }

  root.MandarinPanel = { STYLE, el, button, translateInto };
})(typeof self !== 'undefined' ? self : globalThis);
