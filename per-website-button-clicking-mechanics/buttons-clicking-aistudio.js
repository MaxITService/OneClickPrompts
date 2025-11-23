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

    // Use SelectorGuard to find the send button (enables heuristics)
    // Note: We find it early to check existence, but we'll find it again during auto-send
    // to ensure we have the latest reference if the DOM updated.
    const sendButton = await window.OneClickPromptsSelectorGuard.findSendButton();
    if (sendButton) {
        logConCgp('[buttons] AI Studio Send button found using SelectorGuard');
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
        // Use setTimeout to ensure text is processed before sending
        // Use setTimeout to ensure text is processed before sending
        setTimeout(async () => {
            // Re-fetch send button to be safe (and use heuristics if needed)
            const btn = await window.OneClickPromptsSelectorGuard.findSendButton();
            if (btn) {
                MaxExtensionUtils.simulateClick(btn);
            } else {
                logConCgp('[buttons] AI Studio Send button not found for auto-send.');
                showToast('Could not find the send button.', 'error');
            }
        }, 100);
    }
}

// Expose the function globally
window.processAIStudioCustomSendButtonClick = processAIStudioCustomSendButtonClick;
