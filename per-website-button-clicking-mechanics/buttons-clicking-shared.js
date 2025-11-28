// per-website-button-clicking-mechanics/buttons-clicking-shared.js
'use strict';

window.ButtonsClickingShared = {
    /**
     * Checks if a button is in a "Stop" or "Busy" state.
     * @param {HTMLElement} btn
     * @returns {boolean}
     */
    isBusyStopButton: (btn) => {
        if (!btn) return false;
        const text = ((btn.getAttribute('aria-label') || btn.getAttribute('data-testid') || btn.innerText) || '').toLowerCase();
        return text.includes('stop'); 
    },

    /**
     * Configurable Auto-Send Engine.
     * @returns {Promise<{success: boolean, reason?: string}>}
     */
    performAutoSend: (config = {}) => {
        return new Promise((resolve) => {
            // 1. Safety Cleanup
            if (window.sharedAutoSendInterval) {
                clearInterval(window.sharedAutoSendInterval);
                window.sharedAutoSendInterval = null;
            }

            const {
                findButton = async () => await window.OneClickPromptsSelectorGuard.findSendButton(),
                isBusy = window.ButtonsClickingShared.isBusyStopButton,
                isEnabled = (btn) => !btn.disabled && btn.getAttribute('aria-disabled') !== 'true',
                preClickValidation = () => true,
                clickAction = (btn) => window.MaxExtensionUtils.simulateClick(btn),
                interval = 100,
                maxAttempts = 50
            } = config;

            let attempts = 0;
            
            // logConCgp('[AutoSendShared] Starting sequence...');

            window.sharedAutoSendInterval = setInterval(async () => {
                attempts++;
                
                // A. Find
                const btn = await findButton();

                // B. Busy Check
                if (btn && isBusy(btn)) {
                    // logConCgp('[AutoSendShared] Button is busy (Stop state). Waiting.');
                    attempts--; // Don't count waiting against the timeout
                    return;
                }

                // C. Enabled & Validation
                const buttonReady = btn && isEnabled(btn);
                
                if (buttonReady) {
                    if (preClickValidation(btn)) {
                        // logConCgp('[AutoSendShared] Button ready. Executing click action.');
                        clearInterval(window.sharedAutoSendInterval);
                        window.sharedAutoSendInterval = null;
                        clickAction(btn);
                        resolve({ success: true });
                    } else if (attempts >= maxAttempts) {
                        // Special case: Button found/enabled, but validation (e.g. empty text) failed repeatedly
                        clearInterval(window.sharedAutoSendInterval);
                        window.sharedAutoSendInterval = null;
                        resolve({ success: false, reason: 'validation_failed' });
                    }
                } 
                // D. Timeout
                else if (attempts >= maxAttempts) {
                    clearInterval(window.sharedAutoSendInterval);
                    window.sharedAutoSendInterval = null;
                    // Check if it was disabled or just not found
                    resolve({ success: false, reason: btn ? 'disabled' : 'not_found' });
                }
            }, interval);
        });
    }
};