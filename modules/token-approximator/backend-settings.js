// modules/token-approximator/backend-settings.js
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.
// Settings loader for the Token Approximator backend script.

(() => {
  'use strict';

  if (window.OCPTokenApproxSettings) {
    return;
  }

  const helpers = window.OCPTokenApproxHelpers;
  if (!helpers) {
    return;
  }

  const FALLBACK_SITES = [
    'ChatGPT',
    'Claude',
    'Copilot',
    'DeepSeek',
    'AIStudio',
    'Grok',
    'Gemini',
    'Perplexity'
  ];

  function buildDefaultSiteMap() {
    const supported = helpers.getSupportedSites();
    const list = Array.isArray(supported) && supported.length ? supported : FALLBACK_SITES;
    const map = {};
    list.forEach((site) => {
      map[site] = true;
    });
    return map;
  }

  function normalizeSettings(raw, defaults) {
    const catalog = helpers.getCatalog() || {};
    const defaultModelId = catalog.defaultModelId || 'ultralight-state-machine';
    const base = defaults || {};
    const s = raw && typeof raw === 'object' ? raw : {};
    const enabledSites = s.enabledSites && typeof s.enabledSites === 'object'
      ? { ...buildDefaultSiteMap(), ...s.enabledSites }
      : buildDefaultSiteMap();

    return {
      enabled: !!s.enabled,
      calibration: Number.isFinite(s.calibration) && s.calibration > 0 ? Number(s.calibration) : (base.calibration || 1.0),
      threadMode: (s.threadMode === 'ignoreEditors' || s.threadMode === 'hide') ? s.threadMode : (base.threadMode || 'withEditors'),
      showEditorCounter: typeof s.showEditorCounter === 'boolean' ? s.showEditorCounter : (base.showEditorCounter !== undefined ? base.showEditorCounter : true),
      placement: s.placement === 'after' ? 'after' : (base.placement || 'before'),
      countingMethod: s.countingMethod || defaultModelId,
      enabledSites
    };
  }

  function createDisabledDefaults() {
    return {
      enabled: false,
      calibration: 1.0,
      threadMode: 'withEditors',
      showEditorCounter: true,
      placement: 'before',
      countingMethod: helpers.getCatalog()?.defaultModelId || 'ultralight-state-machine',
      enabledSites: buildDefaultSiteMap()
    };
  }

  function createHardFailureDefaults() {
    return {
      enabled: false,
      calibration: 1.0,
      threadMode: 'withEditors',
      showEditorCounter: false,
      placement: 'after',
      countingMethod: helpers.getCatalog()?.defaultModelId || 'ultralight-state-machine',
      enabledSites: buildDefaultSiteMap()
    };
  }

  function loadSettings() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: 'getTokenApproximatorSettings' },
          (response) => {
            if (chrome.runtime.lastError) {
              return resolve(createDisabledDefaults());
            }
            const defaults = createDisabledDefaults();
            const normalized = normalizeSettings(
              response && response.settings ? response.settings : {},
              defaults
            );
            resolve(normalized);
          }
        );
      } catch {
        resolve(createHardFailureDefaults());
      }
    });
  }

  window.OCPTokenApproxSettings = Object.freeze({
    loadSettings,
    buildDefaultSiteMap,
    normalizeSettings,
    createDisabledDefaults,
    createHardFailureDefaults
  });
})();

