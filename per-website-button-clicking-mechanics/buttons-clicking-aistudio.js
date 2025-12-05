// per-website-button-clicking-mechanics/buttons-clicking-aistudio.js
// This file is a dependency for buttons.js. It provides functions to handle the send button clicking process for AI Studio.
'use strict';

/**
 * Processes the custom send button click for AI Studio, handling both manual and autosend functionalities.
 * @param {Event} event - The click event triggered by the send button.
 * @param {string} customText - The custom text to be sent.
 * @param {boolean} autoSend - Flag indicating whether autosend is enabled.
 */
async function processAIStudioCustomSendButtonClick(event, customText, autoSend) {
    // Prevent default button behavior
    event.preventDefault();
    logConCgp('[AIStudio] Starting process with text:', customText);

    const injectionTargets = window.InjectionTargetsOnWebsite;
    const aiStudioSelectors = injectionTargets.selectors;

    // Use SelectorGuard to find the editor (enables heuristics)
    const editorArea = await window.OneClickPromptsSelectorGuard.findEditor();

    if (editorArea) {
        logConCgp('[AIStudio] Found editor using SelectorGuard');
    }

    if (!editorArea) {
        logConCgp('[buttons] AI Studio Editor not found. Unable to proceed.');
        showToast('Could not find the text input area.', 'error');
        return;
    }

    // Insert text and trigger Angular's change detection
    editorArea.value = editorArea.value + customText;

    // Dispatch events for Angular binding
    const events = ['input', 'change'];
    events.forEach(eventType => {
        const event = new Event(eventType, { bubbles: true });
        editorArea.dispatchEvent(event);
    });

    // Move cursor to end
    editorArea.setSelectionRange(editorArea.value.length, editorArea.value.length);

    // Auto-send if enabled
    if (globalMaxExtensionConfig.globalAutoSendEnabled && autoSend) {
        logConCgp('[buttons] AI Studio Auto-send enabled, attempting to send message');

        const MAX_ATTEMPTS = 10; // 2 seconds max (10 x 200ms)
        const selectors = window.InjectionTargetsOnWebsite?.selectors?.sendButtons || [];
        let findAttempts = 0;

        // Start polling after initial delay to let text settle
        // Start polling after initial delay to let text settle
        await new Promise(r => setTimeout(r, 100));
        return ButtonsClickingShared.performAutoSend({
            interval: 200,
            maxAttempts: MAX_ATTEMPTS,
            findButton: async () => {
                findAttempts += 1;
                if (findAttempts < MAX_ATTEMPTS) {
                    return window.OneClickPromptsSelectorGuard._querySelectors(selectors, { requireEnabled: true });
                }
                return window.OneClickPromptsSelectorGuard.findSendButton();
            },
            clickAction: (btn) => MaxExtensionUtils.simulateClick(btn)
        });
    }
    return Promise.resolve({ status: 'sent', reason: 'manual' });
}

// Expose the function globally
window.processAIStudioCustomSendButtonClick = processAIStudioCustomSendButtonClick;
