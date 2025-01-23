// buttons-clicking-aistudio.js
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
    const editorSelectors = injectionTargets.selectors.editors;
    const sendButtonSelectors = injectionTargets.selectors.sendButtons;

    let editorArea = null;
    let sendButton = null;

    // Iterate through editor selectors to find the editor area
    for (const selector of editorSelectors) {
        const foundEditor = document.querySelector(selector);
        if (foundEditor) {
            editorArea = foundEditor;
            logConCgp('[buttons] AI Studio Editor area found:', editorArea);
            break;
        }
    }

    // Iterate through send button selectors to find the send button
    for (const selector of sendButtonSelectors) {
        const foundButton = document.querySelector(selector);
        if (foundButton) {
            sendButton = foundButton;
            logConCgp('[buttons] AI Studio Send button found:', sendButton);
            break;
        }
    }

    // If editor area or send button is not found, log and exit the function
    if (!editorArea) {
        logConCgp('[buttons] AI Studio Editor area not found. Unable to proceed.');
        return;
    }
    if (!sendButton) {
        logConCgp('[buttons] AI Studio Send button not found. Unable to proceed.');
        return;
    }

    // Insert text into the editor
    editorArea.focus();
    if (editorArea.tagName === 'TEXTAREA') {
        editorArea.value += customText;
        editorArea.dispatchEvent(new Event('input', { bubbles: true }));
        editorArea.dispatchEvent(new Event('change', { bubbles: true }));
    } else { // Assuming contenteditable div
        document.execCommand('insertText', false, customText);
    }

    // Move cursor to the end after insertion (if possible)
    if (typeof editorArea.selectionStart == "number") {
        editorArea.selectionStart = editorArea.selectionEnd = editorArea.value.length;
    } else if (typeof editorArea.setSelectionRange == "function") {
        editorArea.setSelectionRange(editorArea.value.length, editorArea.value.length);
    }


    // Auto-send if enabled
    if (globalMaxExtensionConfig.globalAutoSendEnabled && autoSend) {
        logConCgp('[buttons] AI Studio Auto-send enabled, attempting to send message');
        MaxExtensionUtils.simulateClick(sendButton);
    }
}

function initializeAIStudioButtonInjection() {
    const injectionTargets = window.InjectionTargetsOnWebsite;
    
    window.MaxExtensionUtils.waitForElements(
        injectionTargets.selectors.containers,
        (container) => {
            logConCgp('[AIStudio] Found container:', container);
            
            // Create dedicated buttons container
            let buttonsContainer = document.getElementById(
                injectionTargets.selectors.buttonsContainerId
            );
            
            if (!buttonsContainer) {
                buttonsContainer = document.createElement('div');
                buttonsContainer.id = injectionTargets.selectors.buttonsContainerId;
                buttonsContainer.style.cssText = `
                    display: flex;
                    gap: 8px;
                    padding: 8px;
                    align-items: center;
                    order: -1; /* Place before input area */
                `;
                
                // Insert within Angular component structure
                const inputWrapper = container.querySelector('ms-text-chunk');
                if (inputWrapper) {
                    inputWrapper.parentNode.insertBefore(buttonsContainer, inputWrapper);
                    logConCgp('[AIStudio] Inserted buttons container before input wrapper');
                } else {
                    container.appendChild(buttonsContainer);
                }
            }
            
            window.MaxExtensionButtonsInit.createAndInsertCustomElements(buttonsContainer);
        },
        10, // Increased max attempts
        500 // Longer timeout (500ms)
    );
}

// Update initialization
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeAIStudioButtonInjection);
} else {
    initializeAIStudioButtonInjection();
}

// Expose the function globally
window.processAIStudioCustomSendButtonClick = processAIStudioCustomSendButtonClick;
