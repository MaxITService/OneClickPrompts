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
        return Promise.resolve({ status: 'sent', reason: 'manual' });
    }

    logConCgp('[Perplexity] Auto-send requested; locating submit button.');
    await new Promise(r => setTimeout(r, 150));
    return beginPerplexityAutoSend(customText, editorElement);
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

        // Store the text to insert in a data attribute so the injector script can read it
        editorElement.setAttribute('data-ocp-target', 'true');
        editorElement.setAttribute('data-ocp-text', text);

        // Inject external script to run in Main World (bypasses CSP)
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('per-website-button-clicking-mechanics/perplexity-injector.js');
        script.onload = () => script.remove();
        script.onerror = () => {
            logConCgp('[Perplexity] Failed to load injector script.');
            script.remove();
        };
        (document.head || document.documentElement).appendChild(script);

        // Visual feedback: Move cursor to end in isolated world too (just in case)
        if (window.MaxExtensionUtils && typeof window.MaxExtensionUtils.moveCursorToEnd === 'function') {
            setTimeout(() => MaxExtensionUtils.moveCursorToEnd(editorElement), 50);
        }

        logConCgp('[Perplexity] Text insertion script injected into main world.');
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
    return ButtonsClickingShared.performAutoSend({
        interval: 250,
        maxAttempts: 20,
        isEnabled: (button) => isPerplexityButtonEnabled(button),
        preClickValidation: () => perplexityEditorHasContent(expectedText, editorElement)
    }).then((result) => {
        if (result.status === 'sent' || result.status === 'blocked_by_stop') {
            return result;
        }
        if (result.reason === 'validation_failed') {
            logConCgp('[Perplexity] Editor content still not ready after retries; aborting auto-send.');
            showToast('Editor content not ready; please send manually.', 'error');
            return result;
        }
        if (result.status === 'not_found' || result.reason === 'disabled') {
            if (result.reason !== 'post-stop-missing-send') {
                logConCgp('[Perplexity] Failed to find enabled submit button within timeout.');
                showToast('Could not find the send button.', 'error');
            }
        }
        return result;
    });
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
