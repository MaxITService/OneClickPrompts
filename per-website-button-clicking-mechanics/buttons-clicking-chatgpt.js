// per-website-button-clicking-mechanics/buttons-clicking-chatgpt.js
// This file provides functions to handle the send button clicking process for ChatGPT.

'use strict';

/**
 * Processes the custom send button click for ChatGPT, handling both manual and autosend functionalities.
 * @param {Event} event - The click event triggered by the send button.
 * @param {string} customText - The custom text to be sent.
 * @param {boolean} autoSend - Flag indicating whether autosend is enabled.
 */
async function processChatGPTCustomSendButtonClick(event, customText, autoSend) {
    // Prevent default button behavior
    event.preventDefault();
    logConCgp('[buttons] Custom send button was clicked.');

    // Locate the editor area using SelectorGuard
    const editorArea = await window.OneClickPromptsSelectorGuard.findEditor();

    if (!editorArea) {
        logConCgp('[buttons] Editor area not found. Unable to proceed.');
        // Toast handled by SelectorGuard/Detector
        return;
    }

    // ----------------------------
    // Helper Functions (Modernized)
    // ----------------------------

    /**
     * Determines if the editor is in its initial state (contains placeholder text).
     * @param {HTMLElement} element - The editor element.
     * @returns {boolean} - True if in initial state, false otherwise.
     */
    const isEditorInInitialState = (element) => {
        const placeholderElement = element.querySelector('p.placeholder');
        const isInitial = !!placeholderElement;
        logConCgp('[buttons] Editor initial state check:', isInitial);
        return isInitial;
    };

    /**
     * Inserts the whole text into ChatGPT's editor without per-character emulation.
     * Handles both textarea and contenteditable editors in one place.
     * @param {HTMLElement} editorElement - The editor element (textarea or contenteditable).
     * @param {string} textToInsert - The text to insert.
     * @param {boolean} replace - When true, treats editor as empty and inserts as fresh content; otherwise appends at the end.
     */
    const insertTextIntoChatGPTEditor = (editorElement, textToInsert, replace = false) => {
        try {
            // Textarea path (robust detection)
            if (editorElement instanceof HTMLTextAreaElement) {
                const existing = replace ? '' : (editorElement.value || '');
                editorElement.focus();
                editorElement.value = existing + textToInsert;
                editorElement.dispatchEvent(new Event('input', { bubbles: true }));
                editorElement.dispatchEvent(new Event('change', { bubbles: true }));
                if (editorElement.setSelectionRange) {
                    const end = editorElement.value.length;
                    editorElement.setSelectionRange(end, end);
                }
                return true;
            }

            // contenteditable path
            if (editorElement.isContentEditable || editorElement.getAttribute('contenteditable') === 'true') {
                editorElement.focus();

                // If replacing and editor looks empty or has placeholder, normalize minimal structure
                const looksEmpty = editorElement.textContent.trim() === '' || !!editorElement.querySelector('p.placeholder');
                if (replace && looksEmpty) {
                    editorElement.innerHTML = '<p><br></p>';
                }

                // Move caret to the end and try a single operation insert
                if (window.MaxExtensionUtils && typeof window.MaxExtensionUtils.moveCursorToEnd === 'function') {
                    window.MaxExtensionUtils.moveCursorToEnd(editorElement);
                } else {
                    const range = document.createRange();
                    range.selectNodeContents(editorElement);
                    range.collapse(false);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                }

                // First attempt: execCommand('insertText') — widely handled by editors
                let inserted = false;
                try {
                    inserted = document.execCommand('insertText', false, textToInsert);
                } catch (e) {
                    inserted = false;
                }

                // Fallback: direct Range insertion of a text node
                if (!inserted) {
                    const selection = window.getSelection();
                    if (selection && selection.rangeCount > 0) {
                        const range = selection.getRangeAt(0);
                        const textNode = document.createTextNode(textToInsert);
                        range.insertNode(textNode);
                        range.setStartAfter(textNode);
                        range.collapse(true);
                        selection.removeAllRanges();
                        selection.addRange(range);
                    } else {
                        editorElement.appendChild(document.createTextNode(textToInsert));
                    }
                }

                // Notify the framework/editor
                editorElement.dispatchEvent(new Event('input', { bubbles: true }));
                // Keep caret at the end for UX
                if (window.MaxExtensionUtils && typeof window.MaxExtensionUtils.moveCursorToEnd === 'function') {
                    window.MaxExtensionUtils.moveCursorToEnd(editorElement);
                }
                return true;
            }

            // Fallback — treat as generic node with textContent
            const base = replace ? '' : (editorElement.textContent || '');
            editorElement.textContent = base + textToInsert;
            editorElement.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        } catch (err) {
            logConCgp('[buttons][ChatGPT] insertTextIntoChatGPTEditor error:', err);
            showToast('Failed to insert text.', 'error');
            return false;
        }
    };

    /**
     * Handles the send buttons by initiating auto-send if enabled.
     * @param {HTMLElement} sendButton - The send button element.
     */
    const handleSendButton = (sendButton) => {
        logConCgp('[buttons] handleSendButton called.');
        if (!sendButton) {
            // If auto-send was intended, notify the user that the button was not found.
            if (globalMaxExtensionConfig.globalAutoSendEnabled && autoSend) {
                logConCgp('[buttons] Auto-send failed: Send button not found.');
                showToast('Could not find the send button.', 'error');
            }
            logConCgp('[buttons] Send button is not available to handle.');
            return;
        }
        logConCgp('[buttons] Send button is available. Proceeding with sending message.');

        if (globalMaxExtensionConfig.globalAutoSendEnabled && autoSend) {
            logConCgp('[buttons] Auto-send is enabled. Starting auto-send process.');
            startAutoSend(sendButton, editorArea);
        }
    };

    /**
     * Starts the auto-send interval to automatically click send buttons until the editor is empty.
     * Ensures only one interval runs at a time.
     * @param {HTMLElement} initialSendButton - The initial send button found.
     * @param {HTMLElement} editor - The editor area element.
     */
    const startAutoSend = (initialSendButton, editor) => {
        logConCgp('[auto-send] startAutoSend called.');

        // Prevent multiple auto-send intervals from running simultaneously
        if (window.autoSendInterval) {
            logConCgp('[auto-send] Auto-send is already running. Skipping initiation.');
            return;
        }

        logConCgp('[auto-send] Starting auto-send interval to click send button every 100ms.');
        window.autoSendInterval = setInterval(async () => {
            const currentText = editor.innerText.trim();
            logConCgp('[auto-send] Current text in editor:', currentText);

            // If editor is empty, stop the auto-send interval
            if (currentText.length === 0) {
                logConCgp('[auto-send] Editor is empty. Stopping auto-send interval.');
                clearInterval(window.autoSendInterval);
                window.autoSendInterval = null;
                return;
            }

            // Attempt to locate send button again using SelectorGuard
            const sendButton = await window.OneClickPromptsSelectorGuard.findSendButton();

            if (sendButton) {
                logConCgp('[auto-send] Clicking send button:', sendButton);
                MaxExtensionUtils.simulateClick(sendButton);
                logConCgp('[auto-send] Send button clicked successfully.');
                clearInterval(window.autoSendInterval);
                window.autoSendInterval = null;
                logConCgp('[auto-send] Auto-send interval stopped after successful send.');
            } else {
                logConCgp('[auto-send] Send button not found during auto-send.');
                // Note: SelectorGuard might trigger recovery toasts here if it keeps failing
                // We might want to stop after some attempts, but SelectorGuard handles its own failure thresholds
                // For now, we rely on the interval to keep trying or user to intervene
            }
        }, 100); // Interval set to 100 milliseconds
    };

    /**
     * Waits for send button to appear in the DOM using SelectorGuard polling.
     * @param {number} timeout - Maximum time in milliseconds to wait for the buttons.
     * @returns {Promise<HTMLElement>} Resolves with the send button if found.
     */
    const waitForSendButton = async (timeout = 5000) => {
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            const btn = await window.OneClickPromptsSelectorGuard.findSendButton();
            if (btn) return btn;
            await new Promise(r => setTimeout(r, 200));
        }
        throw new Error('Timeout waiting for send buttons');
    };

    /**
     * Handles the entire process of inserting text and sending the message.
     * This includes state detection, text insertion, and send button handling.
     */
    const handleMessageInsertion = async () => {
        logConCgp('[buttons] handleMessageInsertion called.');
        const initialState = isEditorInInitialState(editorArea);

        if (initialState) {
            // Insert whole text in one go (no per-character emulation)
            logConCgp('[buttons][ChatGPT] Editor empty/placeholder. Inserting text (bulk).');
            insertTextIntoChatGPTEditor(editorArea, customText, true);
            logConCgp('[buttons][ChatGPT] Custom text inserted.');

            // Wait for send button
            setTimeout(async () => {
                try {
                    const btn = await waitForSendButton(5000);
                    handleSendButton(btn);
                } catch (error) {
                    logConCgp('[buttons] ' + error.message);
                    showToast('Could not find the send button.', 'error');
                }
            }, 500); // Delay to allow the editor to update
        } else {
            logConCgp('[buttons][ChatGPT] Editor has content. Appending text (bulk insert).');
            insertTextIntoChatGPTEditor(editorArea, customText, false);
            // Proceed to handle send buttons immediately
            const btn = await window.OneClickPromptsSelectorGuard.findSendButton();
            handleSendButton(btn);
        }
    };

    // ----------------------------
    // Start the message insertion and sending process
    // ----------------------------
    await handleMessageInsertion();
}

// Expose the function globally
window.processChatGPTCustomSendButtonClick = processChatGPTCustomSendButtonClick;
