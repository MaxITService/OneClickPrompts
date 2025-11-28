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

    const isBusyStopButton = (btn) => {
        if (!btn) return false;
        const aria = (btn.getAttribute && btn.getAttribute('aria-label') || '').toLowerCase();
        const testId = (btn.getAttribute && btn.getAttribute('data-testid') || '').toLowerCase();
        const text = (btn.innerText || '').toLowerCase();
        return aria.includes('stop') || testId.includes('stop') || text.includes('stop');
    };

    // Auto-send if enabled
    if (globalMaxExtensionConfig.globalAutoSendEnabled && autoSend) {
        logConCgp('[buttons] AI Studio Auto-send enabled, attempting to send message');

        // Robust retry mechanism: poll for send button with multiple attempts
        const MAX_ATTEMPTS = 10; // 2 seconds max (10 × 200ms)
        let attempts = 0;
        let pollInterval;

        const attemptSend = async () => {
            attempts++;
            logConCgp(`[buttons] AI Studio auto-send attempt ${attempts}/${MAX_ATTEMPTS}`);

            let btn = null;

            // For all attempts except the last one, use silent selector queries
            // This avoids triggering auto-detector during normal DOM update delays
            if (attempts < MAX_ATTEMPTS) {
                // Silent query without triggering auto-detector
                const selectors = window.InjectionTargetsOnWebsite?.selectors?.sendButtons || [];
                btn = window.OneClickPromptsSelectorGuard._querySelectors(selectors, { requireEnabled: true });
            } else {
                // On final attempt, use full SelectorGuard which enables auto-detector and heuristics
                btn = await window.OneClickPromptsSelectorGuard.findSendButton();
            }

            if (btn) {
                if (isBusyStopButton(btn)) {
                    logConCgp('[buttons] AI Studio send button is a Stop state; waiting.');
                    attempts--; // do not punish busy state
                    return;
                }
                logConCgp('[buttons] AI Studio Send button found, clicking now');
                MaxExtensionUtils.simulateClick(btn);
                clearInterval(pollInterval);
            } else if (attempts >= MAX_ATTEMPTS) {
                // Error already shown by SelectorGuard on final attempt
                logConCgp('[buttons] AI Studio Send button not found after all retry attempts');
                clearInterval(pollInterval);
            }
            // If not found and attempts remain, keep polling silently
        };

        // Start polling after initial delay to let text settle
        setTimeout(() => {
            pollInterval = setInterval(attemptSend, 200);
            attemptSend(); // Immediate first attempt
        }, 100);
    }
}

// Expose the function globally
window.processAIStudioCustomSendButtonClick = processAIStudioCustomSendButtonClick;
