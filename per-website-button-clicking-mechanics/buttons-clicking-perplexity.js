// per-website-button-clicking-mechanics/buttons-clicking-perplexity.js
// Handles Perplexity-specific editor insertion and send button automation.

'use strict';

/**
 * Inserts text into Perplexity's editor and optionally auto-sends.
 * @param {Event|Object} event - Triggering event (or queue token).
 * @param {string} customText - Text to inject.
 * @param {boolean} autoSend - Whether auto-send is requested.
 */
async function processPerplexityCustomSendButtonClick(event, customText, autoSend) {
    if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
    }

    logConCgp('[Perplexity] Starting custom button handling.');

    // Find editor using SelectorGuard
    const editorElement = await window.OneClickPromptsSelectorGuard.findEditor();

    if (!editorElement) {
        logConCgp('[Perplexity] Editor element not found.');
        // Toast handled by SelectorGuard
        return;
    }

    const insertionSucceeded = insertTextIntoPerplexityEditor(editorElement, customText);
    if (!insertionSucceeded) {
        logConCgp('[Perplexity] Text insertion failed.');
        showToast('Failed to insert text.', 'error');
        return;
    }

    if (!autoSend || !globalMaxExtensionConfig?.globalAutoSendEnabled) {
        return;
    }

    logConCgp('[Perplexity] Auto-send requested; locating submit button.');
    setTimeout(() => beginPerplexityAutoSend(customText, editorElement), 150);
}

/**
 * Populates Perplexity's Lexical editor with supplied text.
 * @param {HTMLElement} editorElement - The editor container.
 * @param {string} textToInsert - Text to insert.
 * @returns {boolean} Whether insertion succeeded.
 */
function insertTextIntoPerplexityEditor(editorElement, textToInsert) {
    try {
        const text = String(textToInsert || '');
        if (!text) {
            logConCgp('[Perplexity] Empty text provided. Skipping insertion.');
            return true;
        }

        editorElement.focus();

        const selection = window.getSelection();
        if (selection) {
            selection.removeAllRanges();
            const range = document.createRange();
            range.selectNodeContents(editorElement);
            range.deleteContents();
            range.collapse(true);
            selection.addRange(range);
        } else {
            editorElement.textContent = '';
        }

        let insertionSucceeded = false;
        if (typeof document.execCommand === 'function') {
            try {
                insertionSucceeded = document.execCommand('insertText', false, text);
            } catch (execError) {
                logConCgp('[Perplexity] execCommand insertText failed:', execError);
            }
        }

        if (!insertionSucceeded) {
            editorElement.textContent = text;
        }

        const inputEvent = typeof InputEvent === 'function'
            ? new InputEvent('input', { bubbles: true })
            : new Event('input', { bubbles: true });
        editorElement.dispatchEvent(inputEvent);
        editorElement.dispatchEvent(new Event('change', { bubbles: true }));

        if (window.MaxExtensionUtils && typeof window.MaxExtensionUtils.moveCursorToEnd === 'function') {
            MaxExtensionUtils.moveCursorToEnd(editorElement);
        }

        logConCgp('[Perplexity] Text inserted into editor.');
        return true;
    } catch (error) {
        logConCgp('[Perplexity] Error during text insertion:', error);
        return false;
    }
}

/**
 * Attempts to click the Perplexity submit button with retries.
 * @param {string} expectedText - Text we attempted to insert.
 * @param {HTMLElement} editorElement - The editor element to check for content.
 */
function beginPerplexityAutoSend(expectedText, editorElement) {
    const MAX_ATTEMPTS = 20;
    const INTERVAL_MS = 250;
    let attempts = 0;
    let intervalId = null;

    async function tryClick() {
        attempts += 1;

        // Use SelectorGuard to find the button
        const button = await window.OneClickPromptsSelectorGuard.findSendButton();

        if (button && isBusyStopButton(button)) {
            logConCgp('[Perplexity] Send button is Stop; waiting.');
            attempts--; // don't count busy state
            return false;
        }

        if (button && isPerplexityButtonEnabled(button)) {
            // Guard: ensure editor has content before dispatching click to avoid empty sends.
            if (!perplexityEditorHasContent(expectedText, editorElement)) {
                if (attempts >= MAX_ATTEMPTS) {
                    logConCgp('[Perplexity] Editor content still not ready after retries; aborting auto-send.');
                    showToast('Editor content not ready; please send manually.', 'error');
                    return true;
                }

                logConCgp('[Perplexity] Editor content not ready, deferring auto-send.');
                return false;
            }

            logConCgp('[Perplexity] Submit button located; dispatching click.');
            if (window.MaxExtensionUtils && typeof window.MaxExtensionUtils.simulateClick === 'function') {
                MaxExtensionUtils.simulateClick(button);
            } else {
                button.click();
            }
            return true;
        }

        if (attempts >= MAX_ATTEMPTS) {
            logConCgp('[Perplexity] Failed to find enabled submit button within timeout.');
            showToast('Could not find the send button.', 'error');
            return true;
        }

        return false;
    }

    function clearRetryInterval() {
        if (intervalId !== null) {
            clearInterval(intervalId);
            intervalId = null;
        }
    }

    // Initial attempt
    tryClick().then(done => {
        if (done) return;

        // Start polling
        intervalId = setInterval(async () => {
            if (await tryClick()) {
                clearRetryInterval();
            }
        }, INTERVAL_MS);
    });
}

/**
 * Detects whether a button is currently acting as a stop button.
 * @param {HTMLElement} btn - Candidate button element.
 * @returns {boolean} True if the button looks like a stop button.
 */
function isBusyStopButton(btn) {
    if (!btn) return false;
    const aria = (btn.getAttribute && btn.getAttribute('aria-label') || '').toLowerCase();
    const testId = (btn.getAttribute && btn.getAttribute('data-testid') || '').toLowerCase();
    const text = (btn.innerText || '').toLowerCase();
    return aria.includes('stop') || testId.includes('stop') || text.includes('stop');
}

/**
 * Validates that we can click Perplexity's submit button.
 * @param {HTMLButtonElement} button - Candidate button.
 * @returns {boolean} Whether the button appears enabled.
 */
function isPerplexityButtonEnabled(button) {
    const ariaDisabled = button.getAttribute('aria-disabled');
    const dataDisabled = button.getAttribute('data-disabled');
    const isDisabled = button.disabled || ariaDisabled === 'true' || dataDisabled === 'true';

    if (isDisabled) {
        return false;
    }

    // Button briefly reports enabled while still transitioning; check opacity style if present.
    const styleOpacity = window.getComputedStyle(button).opacity;
    if (styleOpacity && Number(styleOpacity) < 0.2) {
        return false;
    }

    return true;
}

/**
 * Checks whether the editor reflects the inserted text to avoid sending prematurely.
 * @param {string} expectedText - Text we attempted to insert.
 * @param {HTMLElement} editorElement - The editor element to check.
 * @returns {boolean} True if the editor appears to contain content.
 */
function perplexityEditorHasContent(expectedText, editorElement) {
    try {
        if (!editorElement) {
            // Should not happen if passed correctly, but as fallback
            return false;
        }
        const currentText = editorElement.innerText || editorElement.textContent || '';
        const normalizedCurrent = currentText.replace(/\s+/g, '').toLowerCase();

        if (expectedText) {
            const normalizedExpected = expectedText.replace(/\s+/g, '').toLowerCase();
            const probe = normalizedExpected.slice(0, 30);
            if (probe && normalizedCurrent.includes(probe)) {
                return true;
            }
        }

        // Fallback: any non-whitespace content counts as ready.
        return normalizedCurrent.length > 0;
    } catch (error) {
        logConCgp('[Perplexity] Error while verifying editor content:', error);
        return true;
    }
}

window.processPerplexityCustomSendButtonClick = processPerplexityCustomSendButtonClick;
