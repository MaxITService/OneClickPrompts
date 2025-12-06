// per-website-button-clicking-mechanics/buttons-clicking-gemini.js
// This file provides functions to handle the send button clicking process for Google Gemini.
'use strict';

/**
 * Processes the custom send button click for Google Gemini.
 * @param {Event} event - The click event triggered by the custom button.
 * @param {string} customText - The custom text to be sent.
 * @param {boolean} autoSend - Flag indicating whether autosend is enabled.
 */
async function processGeminiCustomSendButtonClick(event, customText, autoSend) {
    event.preventDefault();
    logConCgp('[Gemini] Custom send button clicked. Processing...');

    // Find editor area using SelectorGuard
    const editorArea = await window.OneClickPromptsSelectorGuard.findEditor();

    if (!editorArea) {
        logConCgp('[Gemini] Editor area not found. Unable to proceed.');
        // Toast handled by SelectorGuard
        return;
    }

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
    // Auto-send logic
    if (globalMaxExtensionConfig.globalAutoSendEnabled && autoSend) {
        logConCgp('[Gemini] Auto-send enabled. Attempting to send.');

        return ButtonsClickingShared.performAutoSend({
            isEnabled: (sendButton) => sendButton && sendButton.getAttribute('aria-disabled') !== 'true',
            clickAction: (btn) => MaxExtensionUtils.simulateClick(btn)
        }).then((result) => {
            if (result.status !== 'sent' && result.status !== 'blocked_by_stop') {
                logConCgp('[Gemini] Send button did not become enabled after multiple attempts.');
                showToast('Send button did not become active.', 'error');
            }
            return result;
        });
    } else {
        logConCgp('[Gemini] Auto-send disabled or not requested for this button.');
        // Optional: Re-focus editor after insertion if not auto-sending
        editorArea.focus();
        MaxExtensionUtils.moveCursorToEnd(editorArea);
        return Promise.resolve({ status: 'sent', reason: 'manual' });
    }
}

// Expose the function globally (if needed, depends on how buttons.js calls it)
window.processGeminiCustomSendButtonClick = processGeminiCustomSendButtonClick;
