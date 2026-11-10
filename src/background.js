// Service worker: owns the context menu entry and converts Chinese text to
// pinyin. The pinyin dictionary is about 320 kB; keeping it here means it is
// loaded once, instead of being injected into every web page.

importScripts('../vendor/pinyin-pro.js');

const MENU_ID = 'translate-to-mandarin';
const MAX_TEXT_LENGTH = 4000;  // generous: a translation can be longer than its source

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Translate "%s" to Mandarin',
    contexts: ['selection'],
  });
});

function openTranslatorWindow(text) {
  const url = chrome.runtime.getURL('src/popup.html') + '?text=' + encodeURIComponent(text);
  chrome.windows.create({ url, type: 'popup', width: 460, height: 420 });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText) return;
  if (!tab || tab.id === undefined) {
    openTranslatorWindow(info.selectionText);
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: 'translate-selection', text: info.selectionText }, () => {
    // No content script on this page (Chrome's own pages, the Web Store, PDFs):
    // translate in the extension's own window instead.
    if (chrome.runtime.lastError) openTranslatorWindow(info.selectionText);
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.text !== 'string') return false;

  if (message.type === 'pinyin') {
    const text = message.text.slice(0, MAX_TEXT_LENGTH);
    // type 'all' gives one entry per character and resolves characters with
    // several readings from their context (行 in 银行 versus 行走).
    const characters = pinyinPro.pinyin(text, { type: 'all' }).map((c) => ({
      origin: c.origin,
      pinyin: c.pinyin,
      isZh: c.isZh,
    }));
    sendResponse({ characters });
    return false;
  }

  if (message.type === 'open-window') {
    openTranslatorWindow(message.text.slice(0, MAX_TEXT_LENGTH));
  }
  return false;
});
