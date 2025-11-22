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

        // Readable name for the type
        const typeName = type === 'editor' ? 'Text input area' : 'send button';

        // Notify user
        if (window.showToast) {
            window.showToast(`OneClickPrompts: ${typeName} not found. Trying to find it...`, 'info');
        } else {
            console.warn(`OneClickPrompts: ${typeName} not found. Analyzing page structure...`);
        }

        // Run Heuristics
        let result = null;
        if (type === 'editor') {
            result = await window.OneClickPromptsSelectorAutoDetectorBase.detectEditor();
        } else if (type === 'sendButton') {
            result = await window.OneClickPromptsSelectorAutoDetectorBase.detectSendButton();
        }

        if (result) {
            logConCgp(`[SelectorAutoDetector] Heuristics found new ${type}!`, result);
            // TODO: Save new selector to storage
            // Removed "Found!" toast to avoid false positives if the element turns out to be invalid.
            s.failures = 0;
        } else {
            logConCgp(`[SelectorAutoDetector] Heuristics failed to find ${type}.`);
            if (window.showToast) window.showToast(`OneClickPrompts: Could not find ${typeName}. Please report this issue.`, 'error');
        }

        s.recovering = false;
        return result;
    }
};
