// buttons-clicking-gemini.js
// This file provides functions to handle the send button clicking process for Google Gemini.
'use strict';

/**
 * Processes the custom send button click for Google Gemini.
 * @param {Event} event - The click event triggered by the custom button.
 * @param {string} customText - The custom text to be sent.
 * @param {boolean} autoSend - Flag indicating whether autosend is enabled.
 */
function processGeminiCustomSendButtonClick(event, customText, autoSend) {
    event.preventDefault();
    logConCgp('[Gemini] Custom send button clicked. Processing...');

    const injectionTargets = window.InjectionTargetsOnWebsite;
    const geminiSelectors = injectionTargets.selectors;

    // Find editor area
    const editorArea = geminiSelectors.editors.reduce((found, selector) =>
        found || document.querySelector(selector), null);

    if (!editorArea) {
        logConCgp('[Gemini] Editor area not found. Unable to proceed.');
        return;
    }

    // Find send button
    const locateSendButton = () => {
        return geminiSelectors.sendButtons
            .map(selector => document.querySelector(selector))
            .find(button => button && button.getAttribute('aria-disabled') !== 'true'); // Only find enabled button
    };

    let sendButton = locateSendButton();

    /**
     * Inserts text into the Gemini editor (Quill).
     * @param {HTMLElement} editor - The contenteditable editor element.
     * @param {string} text - The text to insert.
     */
    const insertTextIntoGeminiEditor = (editor, text) => {
        editor.focus();
        logConCgp('[Gemini] Editor focused.');

        // Clear existing placeholder/content if editor is effectively empty
        const isInitial = editor.classList.contains('ql-blank') || editor.innerHTML === '<p><br></p>';
        const currentText = isInitial ? '' : editor.innerText.trim();
        const newText = `${currentText}${text}`;

        // Set innerHTML - Quill expects paragraphs
        editor.innerHTML = `<p>${newText.replace(/\n/g, '</p><p>')}</p>`;
        logConCgp('[Gemini] Editor innerHTML updated.');

        // Dispatch events to notify the framework (likely Angular)
        // 'input' is crucial for Quill/Angular to recognize the change
        editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true })); // Optional but good practice
        logConCgp('[Gemini] Input and change events dispatched.');

        // Move cursor to the end after insertion (important for UX)
        MaxExtensionUtils.moveCursorToEnd(editor);
    };

    // Insert the custom text
    insertTextIntoGeminiEditor(editorArea, customText);

    // Auto-send logic
    if (globalMaxExtensionConfig.globalAutoSendEnabled && autoSend) {
        logConCgp('[Gemini] Auto-send enabled. Attempting to send.');

        // Use a MutationObserver or interval to wait for the button to become enabled
        const attemptSend = (maxAttempts = 20) => {
            let attempts = 0;
            const intervalId = setInterval(() => {
                sendButton = locateSendButton(); // Re-check for the button
                if (sendButton) {
                    clearInterval(intervalId);
                    logConCgp('[Gemini] Send button found and enabled. Clicking.');
                    MaxExtensionUtils.simulateClick(sendButton);
                } else if (++attempts >= maxAttempts) {
                    clearInterval(intervalId);
                    logConCgp('[Gemini] Send button did not become enabled after multiple attempts.');
                } else {
                     logConCgp(`[Gemini] Send button not enabled yet. Attempt ${attempts}/${maxAttempts}`);
                }
            }, 100); // Check every 100ms
        };
        attemptSend(); // Start trying to send
    } else {
         logConCgp('[Gemini] Auto-send disabled or not requested for this button.');
         // Optional: Re-focus editor after insertion if not auto-sending
         editorArea.focus();
         MaxExtensionUtils.moveCursorToEnd(editorArea);
    }
}

// Expose the function globally (if needed, depends on how buttons.js calls it)
window.processGeminiCustomSendButtonClick = processGeminiCustomSendButtonClick;