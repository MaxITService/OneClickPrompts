/**
 * File: modules/selector-auto-detector/index.js
 * Version: 1.0
 *
 * Description:
 * The "Brain" of the selector auto-detection system.
 * Manages failure tracking, coordinates recovery attempts, and handles user notifications.
 */

'use strict';

window.OneClickPromptsSelectorAutoDetector = {
    state: {
        editor: {
            failures: 0,
            lastFailure: 0,
            recovering: false
        },
        sendButton: {
            failures: 0,
            lastFailure: 0,
            recovering: false
        }
    },

    config: {
        failureThreshold: 1, // Number of failures before triggering recovery (can be >1 to debounce)
        cooldownMs: 2000,    // Time to wait before re-alerting or re-trying
    },
    settings: {
        enableEditorHeuristics: true,
        enableSendButtonHeuristics: true,
        loaded: false
    },
    lastOffers: {
        editor: { selector: null, site: null, at: 0 },
        sendButton: { selector: null, site: null, at: 0 }
    },

    /**
     * Reports a failure to find a specific element type.
     * @param {string} type - 'editor' or 'sendButton'
     * @param {Object} context - Additional context (e.g., selectors tried)
     */
    reportFailure: async function (type, context = {}) {
        const now = Date.now();
        const s = this.state[type];

        if (!s) {
            logConCgp(`[SelectorAutoDetector] Unknown type reported: ${type}`);
            return null;
        }

        // Debounce/Cooldown check
        if (s.recovering || (now - s.lastFailure < this.config.cooldownMs)) {
            return null;
        }

        s.failures++;
        s.lastFailure = now;

        logConCgp(`[SelectorAutoDetector] ${type} failure reported. Count: ${s.failures}`, context);

        if (s.failures >= this.config.failureThreshold) {
            return await this.triggerRecovery(type);
        }
        return null;
    },

    /**
     * Reports that an element was successfully found.
     * Resets failure counters.
     * @param {string} type - 'editor' or 'sendButton'
     */
    reportRecovery: function (type) {
        const s = this.state[type];
        if (s && s.failures > 0) {
            logConCgp(`[SelectorAutoDetector] ${type} recovered. Resetting state.`);
            s.failures = 0;
            s.recovering = false;
        }
    },

    /**
     * Initiates the recovery process.
     * @param {string} type - 'editor' or 'sendButton'
     * @returns {Promise<HTMLElement|null>}
     */
    triggerRecovery: async function (type) {
        const s = this.state[type];
        s.recovering = true;

        const heuristicsAllowed = type === 'editor'
            ? this.settings.enableEditorHeuristics !== false
            : this.settings.enableSendButtonHeuristics !== false;

        // Readable name for the type
        const typeName = type === 'editor' ? 'Text input area' : 'send button';

        // Unified message logic
        const statusSuffix = heuristicsAllowed ? "Trying to find it..." : "Auto-detect is off.";
        const toastType = heuristicsAllowed ? 'info' : 'error';

        if (window.showToast) {
            window.showToast(`OneClickPrompts: ${typeName} not found. ${statusSuffix}`, toastType);
        } else {
            console.warn(`OneClickPrompts: ${typeName} not found. ${statusSuffix}`);
        }

        // If heuristics are disabled, stop here.
        if (!heuristicsAllowed) {
            logConCgp(`[SelectorAutoDetector] Heuristics disabled for ${type}; skipping recovery.`);
            s.recovering = false;
            return null;
        }

        const site = window.InjectionTargetsOnWebsite?.activeSite || 'Unknown';
        const heuristics = window.OneClickPromptsSiteHeuristics?.resolve
            ? window.OneClickPromptsSiteHeuristics.resolve(site)
            : window.OneClickPromptsSelectorAutoDetectorBase;

        // Wait a moment for the UI to stabilize (e.g. if the button is just about to appear)
        await new Promise(resolve => setTimeout(resolve, 400));

        // Run Heuristics
        let result = null;
        if (type === 'editor') {
            result = await heuristics.detectEditor({ site });
        } else if (type === 'sendButton') {
            result = await heuristics.detectSendButton({ site });
        }

        if (result) {
            logConCgp(`[SelectorAutoDetector] Heuristics found new ${type}!`, result);
            const offered = await this.offerToSaveSelector(type, result);
            if (!offered && window.showToast) {
                window.showToast(`OneClickPrompts: Found the ${typeName}.`, 'success');
            }
            s.failures = 0;
        } else {
            logConCgp(`[SelectorAutoDetector] Heuristics failed to find ${type}.`);
            if (window.showToast) window.showToast(`OneClickPrompts: Could not find ${typeName}. Please report this issue.`, 'error');
        }

        s.recovering = false;
        return result;
    },

    loadSettings: async function () {
        if (!chrome?.runtime?.sendMessage) {
            return;
        }
        try {
            const response = await chrome.runtime.sendMessage({ type: 'getSelectorAutoDetectorSettings' });
            if (response && response.settings) {
                this.settings = {
                    enableEditorHeuristics: response.settings.enableEditorHeuristics !== false,
                    enableSendButtonHeuristics: response.settings.enableSendButtonHeuristics !== false,
                    loaded: true
                };
            }
        } catch (error) {
            logConCgp('[SelectorAutoDetector] Failed to load settings, falling back to defaults.', error);
        }
    },

    ensureSelectorSaver: async function () {
        if (window.OCPSelectorPersistence) {
            return window.OCPSelectorPersistence;
        }
        const saverUrl = chrome?.runtime?.getURL ? chrome.runtime.getURL('modules/selector-auto-detector/selector-save.js') : null;
        if (!saverUrl) return null;
        try {
            const module = await import(saverUrl);
            return module?.OCPSelectorPersistence || window.OCPSelectorPersistence || null;
        } catch (error) {
            logConCgp('[SelectorAutoDetector] Failed to load selector saver module.', error);
            return null;
        }
    },

    /**
     * Offers the user to save a newly found selector via toast action.
     * @param {'editor'|'sendButton'} type
     * @param {HTMLElement} element
     * @returns {Promise<boolean>} whether an actionable toast was shown
     */
    offerToSaveSelector: async function (type, element) {
        const saver = await this.ensureSelectorSaver();
        if (!saver || typeof saver.deriveSelectorFromElement !== 'function' || typeof saver.saveSelectorFromElement !== 'function') {
            return false;
        }
        const site = window.InjectionTargetsOnWebsite?.activeSite || 'Unknown';
        const selector = saver.deriveSelectorFromElement(element);
        if (!selector || !window.showToast) {
            return false;
        }

        const now = Date.now();
        const previous = this.lastOffers[type] || { selector: null, site: null, at: 0 };
        if (previous.selector === selector && previous.site === site && now - previous.at < 15000) {
            logConCgp('[SelectorAutoDetector] Skipping duplicate save toast for selector.', { type, selector, site });
            return false;
        }
        this.lastOffers[type] = { selector, site, at: now };

        const typeName = type === 'editor' ? 'text input selector' : 'send button selector';
        logConCgp('[SelectorAutoDetector] Offering to save selector.', { type, selector, site });
        window.showToast(`OneClickPrompts: Found a ${typeName}. Save it to Custom selectors?`, 'success', {
            duration: 8000,
            actionLabel: 'Save selector',
            onAction: async () => {
                const result = await saver.saveSelectorFromElement({
                    site,
                    type,
                    element,
                    selectorOverride: selector
                });
                if (result?.ok) {
                    logConCgp('[SelectorAutoDetector] Selector saved via toast action.', { type, selector: result.selector, site: result.site });
                    window.showToast('Selector saved to Custom selectors.', 'success', 2500);
                } else {
                    logConCgp('[SelectorAutoDetector] Selector save failed.', { type, selector, site, reason: result?.reason });
                    window.showToast('Could not save selector. Try Advanced settings.', 'error', 2500);
                }
            }
        });
        return true;
    }
};

// Initial settings sync and live updates
window.OneClickPromptsSelectorAutoDetector.loadSettings();

if (chrome?.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message) => {
        if (message?.type === 'selectorAutoDetectorSettingsChanged' && message.settings) {
            window.OneClickPromptsSelectorAutoDetector.settings = {
                enableEditorHeuristics: message.settings.enableEditorHeuristics !== false,
                enableSendButtonHeuristics: message.settings.enableSendButtonHeuristics !== false,
                loaded: true
            };
        }
    });
}
