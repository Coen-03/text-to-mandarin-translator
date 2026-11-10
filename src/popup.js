// Toolbar popup and fallback window: translate typed or passed-in text.
(function () {
  'use strict';

  const Panel = self.MandarinPanel;
  const input = document.getElementById('input');
  const traditional = document.getElementById('traditional');
  const result = document.getElementById('result');

  // The shared panel styles expect to live in a shadow root; here they are
  // applied to the document, after popup.css.
  const style = document.createElement('style');
  style.textContent = Panel.STYLE.replace(':host, .mst-root { all: initial; }', '');
  document.head.append(style);

  function translate() {
    result.hidden = false;
    Panel.translateInto(result, input.value, { traditional: traditional.checked });
  }

  document.getElementById('translate').addEventListener('click', translate);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) translate();
  });

  chrome.storage.sync.get({ traditional: false }, (settings) => {
    traditional.checked = Boolean(settings.traditional);
  });
  traditional.addEventListener('change', () => {
    chrome.storage.sync.set({ traditional: traditional.checked });
  });

  // Opened by the service worker with the selected text in the URL. The
  // translation still waits for a click, because Chrome requires one before
  // it downloads a language model.
  const passed = new URLSearchParams(location.search).get('text');
  if (passed) input.value = passed.slice(0, 1000);
  input.focus();
})();
