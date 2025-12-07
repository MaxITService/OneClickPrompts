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
     * Tries to find a stop button using site-specific selectors or heuristics.
     * @param {Function|null} customFinder - Optional site-specific finder
     * @returns {HTMLElement|null}
     */
    findStopButton: (customFinder = null) => {
        // 1. Try custom finder if provided
        if (customFinder) {
            const btn = customFinder();
            if (btn) return btn;
        }

        // 2. Try site-specific selectors from InjectionTargetsOnWebsite
        const siteSelectors = window.InjectionTargetsOnWebsite?.selectors?.stopButtons || [];
        if (siteSelectors.length > 0) {
            const candidates = siteSelectors
                .map(s => document.querySelectorAll(s))
                .flatMap(nodeList => Array.from(nodeList));

            const visible = candidates.find(el => {
                if (!el || el.offsetParent === null) return false;
                const style = window.getComputedStyle(el);
                return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
            });
            if (visible) return visible;
        }

        // 3. Heuristic fallback: Search for visible buttons with "stop" in relevant attributes
        // Exclude OCP buttons and hidden elements
        const allButtons = Array.from(document.querySelectorAll('button, [role="button"], div.ds-icon-button'));
        return allButtons.find(btn => {
            if (!btn || btn.offsetParent === null) return false;

            // Exclude OCP UI
            const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
            if (testId.startsWith('custom-send-button') || btn.closest('[id*="custom-buttons-container"]')) {
                return false;
            }

            // Check content/attributes
            const text = (
                (btn.getAttribute('aria-label') || '') +
                (btn.getAttribute('title') || '') +
                (btn.getAttribute('data-testid') || '') +
                (btn.innerText || '')
            ).toLowerCase();

            if (!text.includes('stop')) return false;

            // Visibility check
            const style = window.getComputedStyle(btn);
            return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        }) || null;
    },

    /**
     * Configurable Auto-Send Engine with Stop-Button Awareness.
     * Returns a contract: { status: 'sent' | 'blocked_by_stop' | 'not_found' | 'failed', reason?, button? }
     * @returns {Promise<{status: string, reason?: string, button?: HTMLElement}>}
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
                findStopButton = null, // Optional override
                isBusy = window.ButtonsClickingShared.isBusyStopButton,
                isEnabled = (btn) => !btn.disabled && btn.getAttribute('aria-disabled') !== 'true',
                preClickValidation = () => true,
                clickAction = (btn) => window.MaxExtensionUtils.simulateClick(btn),
                interval = 100,
                maxAttempts = 50
            } = config;

            let attempts = 0;

            // Helper to finalize and clean up
            const finish = (result) => {
                if (window.sharedAutoSendInterval) {
                    clearInterval(window.sharedAutoSendInterval);
                    window.sharedAutoSendInterval = null;
                }
                resolve(result);
            };

            window.sharedAutoSendInterval = setInterval(async () => {
                attempts++;

                // A. Find Send Button
                const btn = await findButton();

                // B. If Send Button Found
                if (btn) {
                    // Check if it's actually a stop button (some sites reuse the same element)
                    if (isBusy(btn)) {
                        // It's busy/stop state. Treat as if send button not found, but we found a stop button.
                        // Fall through to stop handling logic below? 
                        // Or handle it here.
                        // If the send button IS the stop button, we should wait for it to become send button.
                        // But the requirement says: "if no send found, probe stop buttons".
                        // If findButton returns the stop button, it means our selector matched it.
                        // We should probably treat it as "blocked_by_stop" if we can't click it.
                        // Let's assume isBusy means "don't click yet".
                        // But if it persists as busy, we might want to enter the watcher flow.
                        // For now, let's stick to the existing "wait" logic for isBusy, but maybe with a limit?
                        // Actually, if it's busy, it IS a stop button. So we should probably trigger the stop watcher.

                        // Let's trigger stop watcher if isBusy is true.
                        handleStopButtonFound(btn);
                        return;
                    }

                    // Not busy, check enabled & validation
                    const buttonReady = isEnabled(btn);

                    if (buttonReady) {
                        if (preClickValidation(btn)) {
                            clickAction(btn);
                            finish({ status: 'sent', button: btn });
                        } else if (attempts >= maxAttempts) {
                            finish({ status: 'failed', reason: 'validation_failed' });
                        }
                    } else if (attempts >= maxAttempts) {
                        finish({ status: 'failed', reason: 'disabled' });
                    }
                    return;
                }

                // C. Send Button NOT Found - Probe for Stop Button
                const stopBtn = window.ButtonsClickingShared.findStopButton(findStopButton);
                if (stopBtn) {
                    handleStopButtonFound(stopBtn);
                    return;
                }

                // D. Neither Found - Timeout
                if (attempts >= maxAttempts) {
                    finish({ status: 'not_found' });
                }

            }, interval);

            // Shared Stop Button Watcher Logic
            const handleStopButtonFound = (stopElement) => {
                // Clear the search interval
                if (window.sharedAutoSendInterval) {
                    clearInterval(window.sharedAutoSendInterval);
                    window.sharedAutoSendInterval = null;
                }

                // Notify user
                if (window.showToast) {
                    window.showToast('AI is still typing…', 'info', 3000);
                }

                // Start 5-minute watcher
                const stopTimeout = 5 * 60 * 1000; // 5 minutes
                const watchStartTime = Date.now();

                const stopWatcher = setInterval(async () => {
                    // Check if stop button is still there/visible
                    const isStillVisible = document.body.contains(stopElement) &&
                        window.getComputedStyle(stopElement).display !== 'none';

                    // Also re-check using the finder in case the DOM node was replaced but a stop button still exists
                    const currentStopBtn = window.ButtonsClickingShared.findStopButton(findStopButton);

                    if (!isStillVisible && !currentStopBtn) {
                        // Stop button disappeared!
                        clearInterval(stopWatcher);

                        // Retry send search with a short polling loop to handle transitional DOM delays
                        let postStopAttempts = 0;
                        const postStopMaxAttempts = 20; // Try for ~3 seconds

                        const postStopPoller = setInterval(async () => {
                            postStopAttempts++;
                            const retryBtn = await findButton();

                            if (retryBtn && isEnabled(retryBtn) && preClickValidation(retryBtn)) {
                                if (isBusy(retryBtn)) {
                                    // Should not happen if selectors are correct, but safety net
                                    if (postStopAttempts >= postStopMaxAttempts) {
                                        clearInterval(postStopPoller);
                                        finish({ status: 'blocked_by_stop', reason: 'still_busy_after_transition' });
                                    }
                                } else {
                                    clearInterval(postStopPoller);
                                    clickAction(retryBtn);
                                    finish({ status: 'sent', button: retryBtn });
                                }
                            } else {
                                if (postStopAttempts >= postStopMaxAttempts) {
                                    clearInterval(postStopPoller);
                                    if (window.showToast) {
                                        window.showToast('Unable to find send button after waiting.', 'error');
                                    }
                                    finish({ status: 'not_found', reason: 'post-stop-missing-send' });
                                }
                            }
                        }, 150);
                    } else if (Date.now() - watchStartTime > stopTimeout) {
                        // Timeout
                        clearInterval(stopWatcher);
                        finish({ status: 'blocked_by_stop', reason: 'timeout' });
                    }
                }, 1000);
            };
        });
    }
};