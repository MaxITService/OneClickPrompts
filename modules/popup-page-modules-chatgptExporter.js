'use strict';

// modules/popup-page-modules-chatgptExporter.js
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.
// Popup UI for the ChatGPT Exporter module (global settings, stored by the service worker under
// `modules.chatgptExporter`). Every change is saved immediately; the service worker broadcasts
// `chatgptExporterSettingsChanged` so open ChatGPT tabs add/remove the buttons without a reload.
// Collapsing/expanding is handled centrally by popup-page-collapsible.js + CSS.

document.addEventListener('DOMContentLoaded', () => {
  const enableToggle = document.getElementById('chatgptExporterEnableToggle');
  const thinkingToggle = document.getElementById('chatgptExporterIncludeThinkingToggle');
  const sourcesToggle = document.getElementById('chatgptExporterIncludeSourcesToggle');
  const placementRadios = [...document.getElementsByName('chatgptExporterPlacement')];

  if (!enableToggle || !thinkingToggle || !sourcesToggle) {
    console.warn('[chatgptExporter] Module elements not found; skipping initialization');
    return;
  }

  // Must mirror normalizeChatGptExporterSettings in service-worker-auxiliary-state-store.js.
  const normalize = (raw) => ({
    enabled: raw?.enabled === true,
    placement: raw?.placement === 'before' ? 'before' : 'after',
    includeThinking: raw?.includeThinking !== false,
    includeSources: raw?.includeSources !== false,
    icons: window.OCPModuleButtonIcons.normalize('chatgptExporter', raw?.icons),
  });

  let settings = normalize(null);

  // Square emoji inputs for the three injected export buttons (popup-page-modules-buttonIcons.js).
  const renderIcons = window.OCPModuleIconInputs.bind(
    document.getElementById('chatgptExporterIconsRow'),
    'chatgptExporter',
    (icons) => save({ icons }),
  );

  function render() {
    renderIcons(settings.icons);
    enableToggle.checked = settings.enabled;
    thinkingToggle.checked = settings.includeThinking;
    sourcesToggle.checked = settings.includeSources;
    for (const radio of placementRadios) radio.checked = radio.value === settings.placement;
  }

  async function save(patch) {
    settings = normalize({ ...settings, ...patch });
    // One delayed retry covers a service worker that is still starting up (typically right
    // after the extension was reloaded), which is the only transient failure seen so far.
    for (const attempt of [1, 2]) {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'saveChatGptExporterSettings', settings });
        if (response?.error) throw new Error(response.error);
        return;
      } catch (error) {
        if (attempt === 1) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          continue;
        }
        console.error('[chatgptExporter] Failed to save settings:', error);
        const reloaded = /context invalidated/i.test(String(error?.message ?? ''));
        window.showToast?.(reloaded
          ? 'The extension was reloaded: reopen this settings page and try again.'
          : 'Could not save ChatGPT Exporter settings.', 'error');
      }
    }
  }

  enableToggle.addEventListener('change', () => save({ enabled: enableToggle.checked }));
  thinkingToggle.addEventListener('change', () => save({ includeThinking: thinkingToggle.checked }));
  sourcesToggle.addEventListener('change', () => save({ includeSources: sourcesToggle.checked }));
  for (const radio of placementRadios) {
    radio.addEventListener('change', () => {
      if (radio.checked) save({ placement: radio.value });
    });
  }

  (async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'getChatGptExporterSettings' });
      if (response?.settings) settings = normalize(response.settings);
    } catch (error) {
      console.error('[chatgptExporter] Failed to load settings:', error);
    }
    render();
  })();
});
