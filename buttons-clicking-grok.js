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

    // Determine if the editor is a textarea/input (has a "value" property) or a contenteditable element.
    const isTextArea = (editorArea.value !== undefined);

    // Check if the editor is in its initial state (i.e. empty)
    const isEditorInInitialState = () => {
        const currentText = isTextArea ? editorArea.value.trim() : editorArea.innerText.trim();
        const isInitial = currentText === '';
        logConCgp('[grok] Editor initial state check:', isInitial);
        return isInitial;
    };

    // Threshold for large prompt; if exceeded, use direct insertion instead of simulating keystrokes.
    const LARGE_PROMPT_THRESHOLD = 200;

    if (isEditorInInitialState()) {
        if (customText.length > LARGE_PROMPT_THRESHOLD) {
            logConCgp('[grok] Editor is in initial state and large prompt detected. Using direct insertion.');
            if (isTextArea) {
                // For textarea elements, set value and move cursor to the end.
                editorArea.value = customText;
                editorArea.focus();
                editorArea.setSelectionRange(editorArea.value.length, editorArea.value.length);
                logConCgp('[grok] Direct insertion complete for textarea.');
            } else {
                // For contenteditable elements, set innerText and then move the cursor to the end.
                editorArea.innerText = customText;
                logConCgp('[grok] Direct insertion complete for contenteditable.');
                setTimeout(() => {
                    if (window.MaxExtensionUtils && typeof window.MaxExtensionUtils.moveCursorToEnd === 'function') {
                        window.MaxExtensionUtils.moveCursorToEnd(editorArea);
                        logConCgp('[grok] Cursor moved to the end of contenteditable after direct insertion.');
                    }
                }, 50);
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
                        if (isTextArea) {
                            editorArea.value += char;
                        } else {
                            editorArea.innerText += char;
                        }
                    }
                }
            }
            // After simulating typing, ensure the cursor is positioned at the end.
            if (isTextArea) {
                editorArea.focus();
                editorArea.setSelectionRange(editorArea.value.length, editorArea.value.length);
                logConCgp('[grok] Simulated typing complete. Cursor set for textarea.');
            } else {
                setTimeout(() => {
                    if (window.MaxExtensionUtils && typeof window.MaxExtensionUtils.moveCursorToEnd === 'function') {
                        window.MaxExtensionUtils.moveCursorToEnd(editorArea);
                        logConCgp('[grok] Simulated typing complete. Cursor moved to end for contenteditable.');
                    }
                }, 50);
            }
        }
        logConCgp('[grok] Custom text inserted into editor.');
    } else {
        logConCgp('[grok] Editor already has content. Appending custom text.');
        if (isTextArea) {
            editorArea.value += customText;
            editorArea.focus();
            editorArea.setSelectionRange(editorArea.value.length, editorArea.value.length);
        } else {
            editorArea.innerText += customText;
            setTimeout(() => {
                if (window.MaxExtensionUtils && typeof window.MaxExtensionUtils.moveCursorToEnd === 'function') {
                    window.MaxExtensionUtils.moveCursorToEnd(editorArea);
                }
            }, 50);
        }
        logConCgp('[grok] Custom text appended.');
    }

    // If auto-send is enabled in both the global configuration and the function parameter, initiate auto-send.
    if (globalMaxExtensionConfig.globalAutoSendEnabled && autoSend) {
        logConCgp('[grok] Auto-send enabled. Preparing to click send button.');
        window.autoSendInterval = setInterval(() => {
            const currentText = isTextArea ? editorArea.value.trim() : editorArea.innerText.trim();
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
