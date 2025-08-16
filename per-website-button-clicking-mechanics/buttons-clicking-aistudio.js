// per-website-button-clicking-mechanics/buttons-clicking-aistudio.js
// This file is a dependency for buttons.js. It provides functions to handle the send button clicking process for AI Studio.
'use strict';

/**
 * Processes the custom send button click for AI Studio, handling both manual and autosend functionalities.
 * @param {Event} event - The click event triggered by the send button.
 * @param {string} customText - The custom text to be sent.
 * @param {boolean} autoSend - Flag indicating whether autosend is enabled.
 */
function processAIStudioCustomSendButtonClick(event, customText, autoSend) {
    // Prevent default button behavior
    event.preventDefault();
    logConCgp('[AIStudio] Starting process with text:', customText);

    const injectionTargets = window.InjectionTargetsOnWebsite;
    const aiStudioSelectors = injectionTargets.selectors;

    let editorArea = null;
    // Try each editor selector until we find one that works
    for (const selector of aiStudioSelectors.editors) {
        try {
            const found = document.querySelector(selector);
            if (found) {
                editorArea = found;
                logConCgp('[AIStudio] Found editor using selector:', selector);
                break;
            }
        } catch (e) {
            logConCgp('[AIStudio] Invalid selector:', selector, e);
        }
    }

    let sendButton = null;

    // Find send button using selectors from configuration
    for (const selector of aiStudioSelectors.sendButtons) {
        const foundButton = document.querySelector(selector);
        if (foundButton) {
            sendButton = foundButton;
            logConCgp('[buttons] AI Studio Send button found:', selector);
            break;
        }
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
        setTimeout(() => {
            if (sendButton) {
                MaxExtensionUtils.simulateClick(sendButton);
            } else {
                logConCgp('[buttons] AI Studio Send button not found for auto-send.');
                showToast('Could not find the send button.', 'error');
            }
        }, 100);
    }
}

// Expose the function globally
window.processAIStudioCustomSendButtonClick = processAIStudioCustomSendButtonClick;
