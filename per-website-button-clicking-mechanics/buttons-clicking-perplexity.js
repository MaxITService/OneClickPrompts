// per-website-button-clicking-mechanics/buttons-clicking-perplexity.js
// Handles Perplexity-specific editor insertion and send button automation.

'use strict';

/**
 * Inserts text into Perplexity's editor and optionally auto-sends.
 * @param {Event|Object} event - Triggering event (or queue token).
 * @param {string} customText - Text to inject.
 * @param {boolean} autoSend - Whether auto-send is requested.
 */
function processPerplexityCustomSendButtonClick(event, customText, autoSend) {
    if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
    }

    logConCgp('[Perplexity] Starting custom button handling.');

    const selectors = window?.InjectionTargetsOnWebsite?.selectors || {};
    const editorElement = Array.isArray(selectors.editors)
        ? selectors.editors
            .map(selector => document.querySelector(selector))
            .find(Boolean)
        : null;

    if (!editorElement) {
        logConCgp('[Perplexity] Editor element not found.');
        showToast('Could not find the text input area.', 'error');
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
    setTimeout(() => beginPerplexityAutoSend(selectors, customText), 150);
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

        // Preferred path: simulate a paste so Lexical processes updates through its own handlers.
        if (window.MaxExtensionUtils && typeof window.MaxExtensionUtils.simulatePaste === 'function') {
            MaxExtensionUtils.simulatePaste(editorElement, text);
        } else {
            // Fallback: position caret at end and use execCommand insertion.
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(editorElement);
            range.collapse(false);
            if (selection) {
                selection.removeAllRanges();
                selection.addRange(range);
            }

            const inserted = document.execCommand && document.execCommand('insertText', false, text);
            if (!inserted) {
                editorElement.textContent += text;
            }
        }

        const inputEvent = typeof InputEvent === 'function'
            ? new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })
            : new Event('input', { bubbles: true });
        editorElement.dispatchEvent(inputEvent);
        editorElement.dispatchEvent(new Event('change', { bubbles: true }));

        if (window.MaxExtensionUtils && typeof window.MaxExtensionUtils.moveCursorToEnd === 'function') {
            MaxExtensionUtils.moveCursorToEnd(editorElement);
        }

        logConCgp('[Perplexity] Text insertion dispatched to editor.');
        return true;
    } catch (error) {
        logConCgp('[Perplexity] Error during text insertion:', error);
        return false;
    }
}

/**
 * Attempts to click the Perplexity submit button with retries.
 * @param {Object} selectors - Selector bundle from InjectionTargetsOnWebsite.
 */
function beginPerplexityAutoSend(selectors, expectedText) {
    const sendButtonSelectors = Array.isArray(selectors.sendButtons) ? selectors.sendButtons : [];
    const MAX_ATTEMPTS = 20;
    const INTERVAL_MS = 250;
    let attempts = 0;

    function findEnabledButton() {
        for (const selector of sendButtonSelectors) {
            const button = document.querySelector(selector);
            if (button && isPerplexityButtonEnabled(button)) {
                return button;
            }
        }
        return null;
    }

    function tryClick() {
        attempts += 1;
        const button = findEnabledButton();

        if (button) {
            // Guard: ensure editor has content before dispatching click to avoid empty sends.
            if (!perplexityEditorHasContent(expectedText)) {
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

    if (tryClick()) {
        return;
    }

    const intervalId = setInterval(() => {
        if (tryClick()) {
            clearInterval(intervalId);
        }
    }, INTERVAL_MS);
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
 * @returns {boolean} True if the editor appears to contain content.
 */
function perplexityEditorHasContent(expectedText) {
    try {
        const selectors = window?.InjectionTargetsOnWebsite?.selectors || {};
        const editor = Array.isArray(selectors.editors)
            ? selectors.editors.map(selector => document.querySelector(selector)).find(Boolean)
            : null;
        if (!editor) {
            return false;
        }
        const currentText = editor.innerText || editor.textContent || '';
        if (expectedText) {
            return currentText.includes(expectedText.trim().slice(0, 20));
        }
        return currentText.trim().length > 0;
    } catch (error) {
        logConCgp('[Perplexity] Error while verifying editor content:', error);
        return true;
    }
}

window.processPerplexityCustomSendButtonClick = processPerplexityCustomSendButtonClick;
