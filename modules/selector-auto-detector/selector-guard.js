/**
 * File: modules/selector-auto-detector/selector-guard.js
 * Version: 1.0
 *
 * Description:
 * The "Guard" adapter that replaces direct DOM queries.
 * It acts as a proxy, trying standard selectors first, then reporting success/failure
 * to the AutoDetector.
 */

'use strict';

window.OneClickPromptsSelectorGuard = {
    /**
     * Tries to find the editor element using known selectors.
     * @returns {Promise<HTMLElement|null>}
     */
    findEditor: async function () {
        const selectors = window.InjectionTargetsOnWebsite?.selectors?.editors || [];

        // 1. Try standard selectors
        let element = this._querySelectors(selectors);

        // 2. Handle Result
        if (element) {
            window.OneClickPromptsSelectorAutoDetector.reportRecovery('editor');
            return element;
        } else {
            // Try to recover
            return await window.OneClickPromptsSelectorAutoDetector.reportFailure('editor', { selectors });
        }
    },

    /**
     * Tries to find the send button element using known selectors.
     * @returns {Promise<HTMLElement|null>}
     */
    findSendButton: async function () {
        const selectors = window.InjectionTargetsOnWebsite?.selectors?.sendButtons || [];
        const editorSelectors = window.InjectionTargetsOnWebsite?.selectors?.editors || [];
        const detector = window.OneClickPromptsSelectorAutoDetector;
        const sendState = detector?.state?.sendButton;
        const autoSendActive = !!window.sharedAutoSendInterval;

        // During Auto-Send recovery, pause lookups until the user confirms/adjusts the send button.
        if (autoSendActive && sendState?.autoSendAwaitingUser) {
            return null;
        }

        // After the user closes the picker, Auto-Send should click the chosen element once.
        if (autoSendActive && sendState?.autoSendPendingElement) {
            const pending = sendState.autoSendPendingElement;
            if (pending && pending.nodeType === Node.ELEMENT_NODE && pending.isConnected) {
                return pending;
            }
            sendState.autoSendPendingElement = null;
        }

        // 1. Try standard selectors
        let element = this._querySelectors(selectors, { requireEnabled: true });

        // 2. Handle Result
        if (element) {
            window.OneClickPromptsSelectorAutoDetector.reportRecovery('sendButton');
            return element;
        } else {
            // If editor is also missing, surface that failure first to guide the user.
            const editorElement = this._querySelectors(editorSelectors);
            if (!editorElement && window.OneClickPromptsSelectorAutoDetector) {
                await window.OneClickPromptsSelectorAutoDetector.reportFailure('editor', { selectors: editorSelectors });
            }

            // Check if stop button is visible — if so, the missing send button is expected (AI is generating)
            const stopBtn = window.ButtonsClickingShared?.findStopButton?.();
            if (stopBtn) {
                // AI is generating, send button absence is expected — don't report failure
                return null;
            }

            // If we've already seen the send button this session, treat misses as temporary and keep quiet.
            const seenBefore = !!sendState?.everFound;
            if (seenBefore) {
                // Detect disabled/busy variants to refresh lastSeenAt and prolong the grace period.
                const disabledCandidate = this._querySelectors(selectors, { requireEnabled: false });
                if (disabledCandidate && sendState) {
                    sendState.lastSeenAt = Date.now();
                }
                return null;
            }
            // Try to recover
            return await window.OneClickPromptsSelectorAutoDetector.reportFailure('sendButton', { selectors });
        }
    },

    /**
     * Helper to iterate selectors and find the first matching visible element.
     * @param {string[]} selectors 
     * @param {Object} options
     * @returns {HTMLElement|null}
     */
    _querySelectors: function (selectors, options = {}) {
        const requireEnabled = options.requireEnabled || false;
        if (!selectors || selectors.length === 0) return null;

        // Try to find a visible element first
        // Some sites have multiple hidden textareas, we usually want the visible one
        const candidates = [];
        for (const selector of selectors) {
            if (!selector) continue;
            let nodeList;
            try {
                nodeList = document.querySelectorAll(selector);
            } catch (err) {
                logConCgp('[SelectorGuard] Skipping invalid selector.', { selector, error: err?.message || err });
                continue;
            }
            candidates.push(...Array.from(nodeList));
        }

        // Filter for existence and basic visibility (offsetParent is a quick check for 'display: none')
        const visibleCandidate = candidates.find(el => {
            if (!el || el.offsetParent === null) return false;
            if (el.getAttribute) {
                const testId = (el.getAttribute('data-testid') || '').toLowerCase();
                if (testId.startsWith('custom-send-button')) return false;
            }
            if (el.closest && el.closest('[id*="custom-buttons-container"]')) return false;
            if (!requireEnabled) return true;
            const ariaDisabled = el.getAttribute && el.getAttribute('aria-disabled');
            return !el.disabled && ariaDisabled !== 'true';
        });

        if (visibleCandidate) return visibleCandidate;

        // Fallback to just existence if no visible candidate found (rare but possible)
        return candidates.find(el => {
            if (!el) return false;
            if (el.getAttribute) {
                const testId = (el.getAttribute('data-testid') || '').toLowerCase();
                if (testId.startsWith('custom-send-button')) return false;
            }
            if (el.closest && el.closest('[id*="custom-buttons-container"]')) return false;
            if (!requireEnabled) return true;
            const ariaDisabled = el.getAttribute && el.getAttribute('aria-disabled');
            return !el.disabled && ariaDisabled !== 'true';
        }) || null;
    }
};
