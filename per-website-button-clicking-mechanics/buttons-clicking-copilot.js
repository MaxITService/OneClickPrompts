'use strict';

/**
 * Processes the custom send button click for Copilot.
 * @param {Event} event - The click event triggered by the send button.
 * @param {string} customText - The custom text to be sent.
 * @param {boolean} autoSend - Flag indicating whether autosend is enabled.
 */
async function processCopilotCustomSendButtonClick(event, customText, autoSend) {
    event.preventDefault();
    logConCgp('[buttons] Custom send button was clicked.');

    // Find editor using SelectorGuard
    const editorArea = await window.OneClickPromptsSelectorGuard.findEditor();

    if (!editorArea) {
        logConCgp('[buttons] Editor area not found. Unable to proceed.');
        // Toast handled by SelectorGuard
        return;
    }

    const isEditorInInitialState = (element) => {
        const currentValue = element.value ?? '';
        const isInitial = currentValue.trim() === '';
        logConCgp('[buttons] Editor initial state check:', isInitial);
        return isInitial;
    };

    const setEditorValueDirectly = (element, text) => {
        element.focus();
        logConCgp('[buttons] Editor focused for setting value directly.');

        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(element),
            'value'
        )?.set;

        if (nativeInputValueSetter) {
            nativeInputValueSetter.call(element, text);
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            logConCgp('[buttons] Events dispatched after setting value directly.');
        }
    };

    const handleSendButton = (sendButton) => {
        if (!sendButton) {
            logConCgp('[buttons] Send button is not available to handle.');
            if (globalMaxExtensionConfig.globalAutoSendEnabled && autoSend) {
                logConCgp('[buttons] Auto-send failed: Send button not found.');
                showToast('Could not find the send button.', 'error');
            }
            return;
        }

        if (globalMaxExtensionConfig.globalAutoSendEnabled && autoSend) {
            logConCgp('[buttons] Auto-send is enabled. Starting auto-send process.');
            startAutoSend(sendButton, editorArea);
        }
    };

    const startAutoSend = (initialSendButton, editor) => {
        if (window.autoSendInterval) {
            logConCgp('[auto-send] Auto-send is already running. Skipping initiation.');
            return;
        }

        let attempts = 0;
        const maxAttempts = 50; // 5 seconds

        const intervalId = setInterval(async () => {
            const currentText = editor.value?.trim() ?? '';

            if (!currentText) {
                clearInterval(intervalId);
                window.autoSendInterval = null;
                logConCgp('[auto-send] Editor is empty. Stopping auto-send interval.');
                return;
            }

            // Use SelectorGuard to find the button
            const sendButton = await window.OneClickPromptsSelectorGuard.findSendButton();

            if (sendButton) {
                sendButton.click();
                clearInterval(intervalId);
                window.autoSendInterval = null;
                logConCgp('[auto-send] Message sent and interval stopped.');
            } else if (++attempts >= maxAttempts) {
                clearInterval(intervalId);
                window.autoSendInterval = null;
                logConCgp('[auto-send] Send button not found after multiple attempts.');
                showToast('Send button not found. Auto-send stopped.', 'error');
            }
        }, 100);
        window.autoSendInterval = intervalId;
    };

    const handleMessageInsertion = async () => {
        const initialState = isEditorInInitialState(editorArea);

        // Step 1: Consolidate text insertion logic to prevent duplication.
        if (initialState) {
            // If editor is empty, just set the text.
            setEditorValueDirectly(editorArea, customText);
        } else {
            // If editor has content, append the new text.
            const existingText = editorArea.value ?? '';
            const newText = `${existingText}${customText}`;
            setEditorValueDirectly(editorArea, newText);
        }

        // Step 2: Move cursor to the end after text is set.
        const finalLength = editorArea.value.length;
        if (editorArea.setSelectionRange) {
            editorArea.setSelectionRange(finalLength, finalLength);
            logConCgp('[buttons] Cursor moved to the end of the editor.');
        }

        // Step 3: Locate send buttons and handle auto-sending.
        // Use SelectorGuard to find the button
        const sendButton = await window.OneClickPromptsSelectorGuard.findSendButton();

        if (sendButton) {
            handleSendButton(sendButton);
        } else {
            // If buttons aren't ready, wait for them with polling
            logConCgp('[buttons] Send button not found immediately, polling...');
            let attempts = 0;
            const maxAttempts = 50;

            const pollInterval = setInterval(async () => {
                const btn = await window.OneClickPromptsSelectorGuard.findSendButton();
                if (btn) {
                    clearInterval(pollInterval);
                    handleSendButton(btn);
                    logConCgp('[buttons] Send button detected via polling.');
                } else if (++attempts >= maxAttempts) {
                    clearInterval(pollInterval);
                    if (globalMaxExtensionConfig.globalAutoSendEnabled && autoSend) {
                        showToast('Could not find the send button.', 'error');
                    }
                    logConCgp('[buttons] Polling timed out.');
                }
            }, 100);
        }
    };

    await handleMessageInsertion();
}

