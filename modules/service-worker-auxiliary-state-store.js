// modules/service-worker-auxiliary-state-store.js
// Version: 0.1 (non-profile state only)
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.
// This module centralizes non-profile state in the service worker context.
// Scope: theme, UI popup state, Cross-Chat settings & stored prompt, floating panel settings, custom selectors.
// Backward compatibility: dual-read (prefer new schema; fallback to legacy), dual-write to legacy keys where applicable.

'use strict';

// Namespaced logging
function logSS(message, ...args) {
  console.log('[state-store]', message, ...args);
}

// Safe storage helpers
async function lsGet(keys) {
  try {
    return await chrome.storage.local.get(keys);
  } catch (e) {
    logSS('lsGet error', e);
    throw e;
  }
}

async function lsSet(obj) {
  try {
    await chrome.storage.local.set(obj);
  } catch (e) {
    logSS('lsSet error', e);
    throw e;
  }
}

async function lsRemove(keys) {
  try {
    await chrome.storage.local.remove(keys);
  } catch (e) {
    logSS('lsRemove error', e);
    throw e;
  }
}

// Schema keys (new)
const KEYS = {
  ui: {
    theme: 'ui.theme', // string 'light' | 'dark'
    popup: 'ui.popup', // object { firstOpen:boolean, lastOpenedSection?:string, collapsibles?:Record<string,boolean> }
  },
  modules: {
    crossChat: 'modules.crossChat', // object { settings: {...}, storedPrompt: string }
    inlineProfileSelector: 'modules.inlineProfileSelector', // object { enabled:boolean, placement:'before'|'after' }
    tokenEstimator: 'modules.tokenEstimator', // object { enabled:boolean }
  },
  floatingPanel: 'floatingPanel', // object map { [hostname]: settings }
  global: {
    customSelectors: 'global.customSelectors', // object map { [site]: selectors }
  },
  meta: {
    schemaVersion: 'state.schemaVersion',
    debugLogging: 'dev.debugLogging',
  }
};

// Legacy keys (existing)
const LEGACY = {
  darkTheme: 'darkTheme',
  crossChatModuleSettings: 'crossChatModuleSettings',
  crossChatStoredPrompt: 'crossChatStoredPrompt',
  floatingPanelPrefix: 'floating_panel_', // floating_panel_{hostname}
  customSelectors: 'customSelectors',
};

// Utilities to get/set nested key paths by flattening as separate storage entries
// We store each top-level namespace as a whole object where applicable to limit storage ops:
async function getValue(path) {
  // Determine top namespace
  if (path === KEYS.ui.theme) {
    const r = await lsGet([KEYS.ui.theme, LEGACY.darkTheme]);
    // Prefer new schema
    const theme = r[KEYS.ui.theme] || r[LEGACY.darkTheme] || 'light';
    return theme;
  }
  if (path === KEYS.ui.popup) {
    const r = await lsGet([KEYS.ui.popup]);
    // No legacy for popup UI
    return r[KEYS.ui.popup] || { firstOpen: true, collapsibles: {} };
  }
  if (path === KEYS.modules.crossChat) {
    const r = await lsGet([KEYS.modules.crossChat, LEGACY.crossChatModuleSettings, LEGACY.crossChatStoredPrompt]);
    let obj = r[KEYS.modules.crossChat];
    if (!obj) {
      const settings = r[LEGACY.crossChatModuleSettings] || {
        enabled: false,
        autosendCopy: false,
        autosendPaste: false,
        placement: 'before',
      };
      const storedPrompt = r[LEGACY.crossChatStoredPrompt] || '';
      obj = { settings, storedPrompt };
    } else {
      // Ensure shape
      obj.settings = obj.settings || {
        enabled: false,
        autosendCopy: false,
        autosendPaste: false,
        placement: 'before',
      };
      obj.storedPrompt = typeof obj.storedPrompt === 'string' ? obj.storedPrompt : '';
    }
    return obj;
  }
  if (path === KEYS.modules.inlineProfileSelector) {
    const r = await lsGet([KEYS.modules.inlineProfileSelector]);
    const obj = r[KEYS.modules.inlineProfileSelector];
    if (obj && typeof obj === 'object') {
      // Ensure shape and defaults
      return {
        enabled: !!obj.enabled,
        placement: obj.placement === 'after' ? 'after' : 'before',
      };
    }
    return {
      enabled: false,
      placement: 'before',
    };
  }
  if (path === KEYS.modules.tokenEstimator) {
    const r = await lsGet([KEYS.modules.tokenEstimator]);
    const obj = r[KEYS.modules.tokenEstimator];
    if (obj && typeof obj === 'object') {
      // Ensure shape and defaults
      return {
        enabled: !!obj.enabled,
      };
    }
    return {
      enabled: false,
    };
  }
  if (path === KEYS.floatingPanel) {
    // Build map from structured store if exists, else from legacy scattered keys
    const all = await lsGet(null);
    const structured = all[KEYS.floatingPanel];
    if (structured && typeof structured === 'object') {
      return structured;
    }
    // Fallback: collect legacy floating_panel_* keys
    const map = {};
    Object.keys(all || {}).forEach(k => {
      if (k.startsWith(LEGACY.floatingPanelPrefix)) {
        const host = k.substring(LEGACY.floatingPanelPrefix.length);
        map[host] = all[k];
      }
    });
    return map;
  }
  if (path === KEYS.global.customSelectors) {
    const r = await lsGet([KEYS.global.customSelectors, LEGACY.customSelectors]);
    return r[KEYS.global.customSelectors] || r[LEGACY.customSelectors] || {};
  }
  if (path === KEYS.meta.schemaVersion) {
    const r = await lsGet([KEYS.meta.schemaVersion]);
    return r[KEYS.meta.schemaVersion] || 1;
  }
  if (path === KEYS.meta.debugLogging) {
    const r = await lsGet([KEYS.meta.debugLogging]);
    return !!r[KEYS.meta.debugLogging];
  }
  // Default
  const r = await lsGet([path]);
  return r[path];
}

async function setValue(path, value) {
  // Dual-write where applicable
  if (path === KEYS.ui.theme) {
    await lsSet({ [KEYS.ui.theme]: value, [LEGACY.darkTheme]: value });
    return;
  }
  if (path === KEYS.ui.popup) {
    // No legacy, write only new
    await lsSet({ [KEYS.ui.popup]: value });
    return;
  }
  if (path === KEYS.modules.crossChat) {
    // Expect value shape { settings, storedPrompt }
    const settings = value?.settings || {
      enabled: false,
      autosendCopy: false,
      autosendPaste: false,
      placement: 'before',
    };
    const storedPrompt = typeof value?.storedPrompt === 'string' ? value.storedPrompt : '';
    await lsSet({
      [KEYS.modules.crossChat]: { settings, storedPrompt },
      [LEGACY.crossChatModuleSettings]: settings,
      [LEGACY.crossChatStoredPrompt]: storedPrompt,
    });
    return;
  }
  if (path === KEYS.modules.inlineProfileSelector) {
    const settings = value && typeof value === 'object' ? value : {};
    const normalized = {
      enabled: !!settings.enabled,
      placement: settings.placement === 'after' ? 'after' : 'before',
    };
    await lsSet({ [KEYS.modules.inlineProfileSelector]: normalized });
    return;
  }
  if (path === KEYS.modules.tokenEstimator) {
    const settings = value && typeof value === 'object' ? value : {};
    const normalized = {
      enabled: !!settings.enabled,
    };
    await lsSet({ [KEYS.modules.tokenEstimator]: normalized });
    return;
  }
  if (path.startsWith(KEYS.floatingPanel)) {
    // We maintain a structured map and legacy per-host keys
    if (path === KEYS.floatingPanel) {
      // Whole map provided
      const map = value && typeof value === 'object' ? value : {};
      const legacySet = {};
      Object.entries(map).forEach(([host, settings]) => {
        legacySet[LEGACY.floatingPanelPrefix + host] = settings;
      });
      await lsSet({ [KEYS.floatingPanel]: map, ...legacySet });
      return;
    } else {
      // path like 'floatingPanel.<hostname>'
      const host = path.replace(KEYS.floatingPanel + '.', '');
      const current = await getValue(KEYS.floatingPanel);
      current[host] = value;
      await setValue(KEYS.floatingPanel, current);
      return;
    }
  }
  if (path === KEYS.global.customSelectors) {
    await lsSet({ [KEYS.global.customSelectors]: value, [LEGACY.customSelectors]: value });
    return;
  }
  if (path === KEYS.meta.schemaVersion || path === KEYS.meta.debugLogging) {
    await lsSet({ [path]: value });
    return;
  }
  await lsSet({ [path]: value });
}

// Public API (service worker-side)
export const StateStore = {
  // Theme
  async getUiTheme() {
    return await getValue(KEYS.ui.theme);
  },
  async setUiTheme(theme) {
    if (theme !== 'light' && theme !== 'dark') {
      throw new Error('Invalid theme');
    }
    await setValue(KEYS.ui.theme, theme);
    this.broadcast({ type: 'uiThemeChanged', theme });
  },

  // UI popup
  async getUiPopupState() {
    return await getValue(KEYS.ui.popup);
  },
  async setUiPopupState(patch) {
    const current = await this.getUiPopupState();
    const merged = { ...current, ...patch };
    if (!merged.collapsibles) merged.collapsibles = {};
    await setValue(KEYS.ui.popup, merged);
    this.broadcast({ type: 'uiPopupChanged', state: merged });
  },

  // Cross-Chat
  async getCrossChat() {
    return await getValue(KEYS.modules.crossChat);
  },
  async saveCrossChat(settings) {
    const current = await this.getCrossChat();
    const next = { settings: { ...current.settings, ...settings }, storedPrompt: current.storedPrompt || '' };
    await setValue(KEYS.modules.crossChat, next);
    this.broadcast({ type: 'crossChatChanged', settings: next.settings });
  },
  async getStoredPrompt() {
    const cc = await this.getCrossChat();
    return cc.storedPrompt || '';
  },
  async saveStoredPrompt(text) {
    const cc = await this.getCrossChat();
    const next = { settings: cc.settings, storedPrompt: String(text || '') };
    await setValue(KEYS.modules.crossChat, next);
    this.broadcast({ type: 'crossChatPromptChanged' });
  },
  async clearStoredPrompt() {
    const cc = await this.getCrossChat();
    const next = { settings: cc.settings, storedPrompt: '' };
    await setValue(KEYS.modules.crossChat, next);
    this.broadcast({ type: 'crossChatPromptChanged' });
  },

  // Floating Panel
  async getFloatingPanelSettings(hostname) {
    const map = await getValue(KEYS.floatingPanel);
    return map[hostname] || null;
  },
  async saveFloatingPanelSettings(hostname, settings) {
    const map = await getValue(KEYS.floatingPanel);
    map[hostname] = settings;
    await setValue(KEYS.floatingPanel, map);
    this.broadcast({ type: 'floatingPanelChanged', hostname });
  },
  async listFloatingPanelHostnames() {
    const map = await getValue(KEYS.floatingPanel);
    return Object.keys(map);
  },
  async resetFloatingPanelSettings() {
    // Remove all, both structured and legacy
    const map = await getValue(KEYS.floatingPanel);
    const legacyKeys = Object.keys(map).map(h => LEGACY.floatingPanelPrefix + h);
    await lsRemove([KEYS.floatingPanel, ...legacyKeys]);
    this.broadcast({ type: 'floatingPanelResetAll' });
    return Object.keys(map).length;
  },
  async resetFloatingPanelSettingsForHostname(hostname) {
    const map = await getValue(KEYS.floatingPanel);
    if (hostname in map) {
      delete map[hostname];
      await setValue(KEYS.floatingPanel, map);
      await lsRemove(LEGACY.floatingPanelPrefix + hostname);
      this.broadcast({ type: 'floatingPanelReset', hostname });
    }
  },

  // Custom Selectors
  async getCustomSelectors(site) {
    const all = await getValue(KEYS.global.customSelectors);
    if (site) return all[site] || null;
    return all;
  },
  async saveCustomSelectors(site, selectors) {
    const all = await getValue(KEYS.global.customSelectors);
    if (selectors) {
      all[site] = selectors;
    } else {
      delete all[site];
    }
    await setValue(KEYS.global.customSelectors, all);
    this.broadcast({ type: 'customSelectorsChanged', site });
  },
  async resetAdvancedSelectors(site) {
    const all = await getValue(KEYS.global.customSelectors);
    if (site) {
      if (all[site]) {
        delete all[site];
        await setValue(KEYS.global.customSelectors, all);
        this.broadcast({ type: 'customSelectorsChanged', site });
      }
      return 1;
    }
    await setValue(KEYS.global.customSelectors, {});
    this.broadcast({ type: 'customSelectorsChanged' });
    return 0;
  },

  // Meta
  async getSchemaVersion() {
    return await getValue(KEYS.meta.schemaVersion);
  },
  async setSchemaVersion(v) {
    await setValue(KEYS.meta.schemaVersion, v);
  },
  async getDebugLogging() {
    return await getValue(KEYS.meta.debugLogging);
  },
  async setDebugLogging(enabled) {
    await setValue(KEYS.meta.debugLogging, !!enabled);
  },

  // ===== Inline Profile Selector (Global Module) =====
  async getInlineProfileSelectorSettings() {
    return await getValue(KEYS.modules.inlineProfileSelector);
  },
  async saveInlineProfileSelectorSettings(settings) {
    await setValue(KEYS.modules.inlineProfileSelector, settings);
    this.broadcast({ type: 'inlineProfileSelectorSettingsChanged', settings });
  },

  // ===== Token Estimator (Global Module) =====
  async getTokenEstimatorSettings() {
    return await getValue(KEYS.modules.tokenEstimator);
  },
  async saveTokenEstimatorSettings(settings) {
    await setValue(KEYS.modules.tokenEstimator, settings);
    this.broadcast({ type: 'tokenEstimatorSettingsChanged', settings });
  },

  // Broadcast utility
  async broadcast(payload) {
    try {
      const clients = await chrome.tabs.query({});
      clients.forEach(tab => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
        }
      });
    } catch (e) {
      // Non-fatal
      logSS('broadcast error', e);
    }
  }
};