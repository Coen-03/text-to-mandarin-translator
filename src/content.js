// Content script: shows a small button next to a text selection and, after a
// click, a panel with the Mandarin translation. The UI lives in a shadow root
// so the page's CSS cannot change it and its CSS cannot leak into the page.
(function () {
  'use strict';

  if (window.__mandarinSelectionTranslator) return;  // injected twice
  window.__mandarinSelectionTranslator = true;

  const Core = self.MandarinCore;
  const Panel = self.MandarinPanel;
  const MARGIN = 8;

  let host = null;
  let rootEl = null;
  let lastPointer = { x: 0, y: 0 };

  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0;';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = Panel.STYLE;
    rootEl = Panel.el('div', 'mst-root');
    rootEl.style.position = 'fixed';
    shadow.append(style, rootEl);
    document.documentElement.append(host);
  }

  function clear() {
    if (isOpen() && window.speechSynthesis) window.speechSynthesis.cancel();  // stop reading aloud
    if (rootEl) rootEl.replaceChildren();
  }

  function isOpen() {
    return Boolean(rootEl && rootEl.firstChild);
  }

  // Places the UI near (x, y) and keeps it inside the viewport.
  function place(x, y) {
    rootEl.style.left = '0px';
    rootEl.style.top = '0px';
    const box = rootEl.getBoundingClientRect();
    const left = Math.min(Math.max(MARGIN, x), window.innerWidth - box.width - MARGIN);
    let top = y + 14;
    if (top + box.height > window.innerHeight - MARGIN) top = y - box.height - 14;  // flip above
    rootEl.style.left = `${Math.max(MARGIN, left)}px`;
    rootEl.style.top = `${Math.max(MARGIN, top)}px`;
  }

  function selectedText() {
    const selection = window.getSelection();
    return Core.normalizeText(selection ? selection.toString() : '');
  }

  function openWindowFallback(text) {
    chrome.runtime.sendMessage({ type: 'open-window', text });
  }

  async function showPanel(text, x, y) {
    ensureHost();
    const card = Panel.el('div', 'mst-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Mandarin translation');
    rootEl.replaceChildren(card);
    place(x, y);

    let traditional = false;
    try {
      traditional = Boolean((await chrome.storage.sync.get({ traditional: false })).traditional);
    } catch {
      // storage unavailable: keep simplified
    }
    await Panel.translateInto(card, text, {
      traditional,
      pageLanguage: document.documentElement.lang,
      onFallback: openWindowFallback,
    });
    if (card.isConnected) place(x, y);  // the size changed
  }

  function showTrigger(text, x, y) {
    ensureHost();
    const trigger = Panel.button('中 Translate', () => showPanel(text, x, y));
    trigger.className = 'mst-trigger';
    trigger.title = 'Translate the selection to Mandarin';
    rootEl.replaceChildren(trigger);
    place(x, y);
  }

  function isOwnEvent(event) {
    return Boolean(host) && event.composedPath().includes(host);
  }

  document.addEventListener(
    'mouseup',
    (event) => {
      if (isOwnEvent(event)) return;
      lastPointer = { x: event.clientX, y: event.clientY };
      // The selection is final only after the browser has handled the mouseup.
      setTimeout(() => {
        const text = selectedText();
        if (Core.validateText(text) === null) showTrigger(text, lastPointer.x, lastPointer.y);
      }, 0);
    },
    true
  );

  document.addEventListener(
    'mousedown',
    (event) => {
      if (!isOwnEvent(event)) clear();
    },
    true
  );

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && isOpen()) clear();
    },
    true
  );

  // A scrolled page moves the selection away from a fixed-position button.
  window.addEventListener(
    'scroll',
    () => {
      if (rootEl && rootEl.querySelector('.mst-trigger')) clear();
    },
    { passive: true }
  );

  // Context menu entry, handled by the service worker.
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== 'translate-selection') return;
    const text = Core.normalizeText(message.text) || selectedText();
    if (Core.validateText(text) !== null) return;
    const selection = window.getSelection();
    let x = lastPointer.x;
    let y = lastPointer.y;
    if (selection && selection.rangeCount > 0) {
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        x = rect.left;
        y = rect.bottom;
      }
    }
    showPanel(text, x, y);
  });
})();
