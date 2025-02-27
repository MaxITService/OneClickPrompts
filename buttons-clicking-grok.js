// buttons-clicking-grok.js
// version 1.0
// This file handles what happens after clicking on the custom button on grok.com page.
// It processes the custom send button click event for Grok by inserting custom text into the editor
// and auto-sending the message if the global auto-send flag is enabled.

'use strict';

/**
 * Processes the custom send button click for Grok.
 * @param {Event} event - The click event triggered by the custom send button.
 * @param {string} customText - The custom text to be sent.
 * @param {boolean} autoSend - Flag indicating whether auto-send is enabled.
 */
function processGrokCustomSendButtonClick(event, customText, autoSend) {
    // Prevent default button behavior
    event.preventDefault();
    logConCgp('[grok] Custom send button clicked.');

    // Locate the Grok text editor using selectors defined in InjectionTargetsOnWebsite
    const editorArea = document.querySelector(
        window.InjectionTargetsOnWebsite.selectors.editors.find(selector => document.querySelector(selector))
    );
    if (!editorArea) {
        logConCgp('[grok] Editor area not found. Aborting send process.');
        return;
    }

    // Check if the editor is in its initial state (i.e. empty)
    const isEditorInInitialState = () => {
        const currentText = editorArea.value ? editorArea.value.trim() : editorArea.innerText.trim();
        const isInitial = currentText === '';
        logConCgp('[grok] Editor initial state check:', isInitial);
        return isInitial;
    };

    // Threshold for large prompt; if exceeded, use direct insertion instead of simulating keystrokes.
    const LARGE_PROMPT_THRESHOLD = 200;

    // Insert custom text into the editor: simulate typing if in initial state; else, append text. THIS IS NEEDED FOR AUTOSIZING EDITORS!
    if (isEditorInInitialState()) {
        if (customText.length > LARGE_PROMPT_THRESHOLD) {
            logConCgp('[grok] Editor is in initial state and large prompt detected. Using direct insertion.');
            if (editorArea.value !== undefined) {
                // For textarea elements, set value and move cursor to the end.
                editorArea.value = customText;
                editorArea.focus();
                editorArea.selectionStart = editorArea.value.length;
                editorArea.selectionEnd = editorArea.value.length;
                logConCgp('[grok] Cursor moved to the end of textarea after direct insertion.');
            } else {
                // For contenteditable elements, set innerText and use the utility to move the cursor.
                editorArea.innerText = customText;
                if (window.MaxExtensionUtils && typeof window.MaxExtensionUtils.moveCursorToEnd === 'function') {
                    window.MaxExtensionUtils.moveCursorToEnd(editorArea);
                }
            }
        } else {
            logConCgp('[grok] Editor is in initial state. Simulating typing.');
            editorArea.focus();
            const eventTypes = ['keydown', 'input', 'keyup'];
            for (const char of customText) {
                for (const type of eventTypes) {
                    let evt;
                    if (type === 'input') {
                        evt = new InputEvent(type, {
                            data: char,
                            inputType: 'insertText',
                            bubbles: true,
                            cancelable: true
                        });
                    } else {
                        evt = new KeyboardEvent(type, {
                            key: char,
                            code: `Key${char.toUpperCase()}`,
                            bubbles: true,
                            cancelable: true
                        });
                    }
                    editorArea.dispatchEvent(evt);
                    if (type === 'input') {
                        // Append the character to the textarea's value or innerText.
                        if (editorArea.value !== undefined) {
                            editorArea.value += char;
                        } else {
                            editorArea.innerText += char;
                        }
                    }
                }
            }
        }
        logConCgp('[grok] Custom text inserted into editor.');
    } else {
        logConCgp('[grok] Editor already has content. Appending custom text.');
        if (editorArea.value !== undefined) {
            editorArea.value += customText;
        } else {
            editorArea.innerText += customText;
        }
        logConCgp('[grok] Custom text appended.');
    }

    // For non-textarea contentEditable elements, ensure the cursor is moved to the end.
    if (editorArea.value === undefined && window.MaxExtensionUtils && typeof window.MaxExtensionUtils.moveCursorToEnd === 'function') {
        window.MaxExtensionUtils.moveCursorToEnd(editorArea);
    }

    // If auto-send is enabled in both the global configuration and the function parameter, initiate auto-send.
    if (globalMaxExtensionConfig.globalAutoSendEnabled && autoSend) {
        logConCgp('[grok] Auto-send enabled. Preparing to click send button.');
        window.autoSendInterval = setInterval(() => {
            const currentText = editorArea.value ? editorArea.value.trim() : editorArea.innerText.trim();
            if (currentText.length === 0) {
                logConCgp('[grok] Editor became empty during auto-send. Stopping auto-send.');
                clearInterval(window.autoSendInterval);
                window.autoSendInterval = null;
                return;
            }
            // Locate the Grok send button using selectors from InjectionTargetsOnWebsite.
            const sendButton = document.querySelector(
                window.InjectionTargetsOnWebsite.selectors.sendButtons.find(selector => document.querySelector(selector))
            );
            if (sendButton) {
                logConCgp('[grok] Send button found. Clicking send button.');
                window.MaxExtensionUtils.simulateClick(sendButton);
                clearInterval(window.autoSendInterval);
                window.autoSendInterval = null;
                logConCgp('[grok] Auto-send: Send button clicked, auto-send stopped.');
            } else {
                logConCgp('[grok] Send button not found. Retrying...');
            }
        }, 100);
    }
}

// Expose the function globally
window.processGrokCustomSendButtonClick = processGrokCustomSendButtonClick;
