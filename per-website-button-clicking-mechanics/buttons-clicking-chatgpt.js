// per-website-button-clicking-mechanics/buttons-clicking-chatgpt.js
// This file provides functions to handle the send button clicking process for ChatGPT.

'use strict';

/**
 * Processes the custom send button click for ChatGPT, handling both manual and autosend functionalities.
 * @param {Event} event - The click event triggered by the send button.
 * @param {string} customText - The custom text to be sent.
 * @param {boolean} autoSend - Flag indicating whether autosend is enabled.
 */
function processChatGPTCustomSendButtonClick(event, customText, autoSend) {
    // Prevent default button behavior
    event.preventDefault();
    logConCgp('[buttons] Custom send button was clicked.');

    // Locate the editor area using the provided selectors from the global InjectionTargetsOnWebsite object
    // Map selectors to elements and pick the first existing match (avoids duplicate queries)
    const editorArea = window.InjectionTargetsOnWebsite.selectors.editors
        .map((selector) => document.querySelector(selector))
        .find(Boolean);

    if (!editorArea) {
        logConCgp('[buttons] Editor area not found. Unable to proceed.');
        showToast('Could not find the text input area.', 'error');
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
     * Locates all send buttons based on the provided selectors.
     * @returns {HTMLElement[]} Array of found send button elements.
     */
    const locateSendButtons = () => {
        return [...new Set(
            window.InjectionTargetsOnWebsite.selectors.sendButtons
                .flatMap(selector => [...document.querySelectorAll(selector)])
        )];
    };

    // Initial retrieval of send buttons.
    let originalSendButtons = locateSendButtons();

    /**
     * Handles the send buttons by initiating auto-send if enabled.
     * Operates only on the first send button to prevent duplicate sends.
     * @param {HTMLElement[]} sendButtons - Array of send button elements.
     */
    const handleSendButtons = (sendButtons) => {
        logConCgp('[buttons] handleSendButtons called.');
        if (!sendButtons.length) {
            // If auto-send was intended, notify the user that the button was not found.
            if (globalMaxExtensionConfig.globalAutoSendEnabled && autoSend) {
                logConCgp('[buttons] Auto-send failed: Send button not found.');
                showToast('Could not find the send button.', 'error');
            }
            logConCgp('[buttons] Send buttons are not available to handle.');
            return;
        }
        logConCgp('[buttons] Send buttons are available. Proceeding with sending message.');

        if (globalMaxExtensionConfig.globalAutoSendEnabled && autoSend) {
            logConCgp('[buttons] Auto-send is enabled. Starting auto-send process.');
            startAutoSend([sendButtons[0]], editorArea);
        }
    };

    /**
     * Starts the auto-send interval to automatically click send buttons until the editor is empty.
     * Ensures only one interval runs at a time and clicks only the first send button.
     * @param {HTMLElement[]} sendButtons - Array of send button elements.
     * @param {HTMLElement} editor - The editor area element.
     */
    const startAutoSend = (sendButtons, editor) => {
        logConCgp('[auto-send] startAutoSend called.');

        // Prevent multiple auto-send intervals from running simultaneously
        if (window.autoSendInterval) {
            logConCgp('[auto-send] Auto-send is already running. Skipping initiation.');
            return;
        }

        logConCgp('[auto-send] Starting auto-send interval to click send button every 100ms.');
        window.autoSendInterval = setInterval(() => {
            const currentText = editor.innerText.trim();
            logConCgp('[auto-send] Current text in editor:', currentText);

            // If editor is empty, stop the auto-send interval
            if (currentText.length === 0) {
                logConCgp('[auto-send] Editor is empty. Stopping auto-send interval.');
                clearInterval(window.autoSendInterval);
                window.autoSendInterval = null;
                return;
            }

            // Attempt to locate send buttons again in case they have changed
            const updatedSendButtons = locateSendButtons();
            if (updatedSendButtons.length === 0) {
                logConCgp('[auto-send] Send button not found during auto-send. Stopping auto-send interval.');
                clearInterval(window.autoSendInterval);
                showToast('Send button not found. Auto-send stopped.', 'error');
                window.autoSendInterval = null;
                return;
            }

            // Click only the first send button found
            const sendButton = updatedSendButtons[0];
            if (sendButton) {
                logConCgp('[auto-send] Clicking send button:', sendButton);
                MaxExtensionUtils.simulateClick(sendButton);
                logConCgp('[auto-send] Send button clicked successfully.');
                clearInterval(window.autoSendInterval);
                window.autoSendInterval = null;
                logConCgp('[auto-send] Auto-send interval stopped after successful send.');
            } else {
                logConCgp('[auto-send] Send button not found during auto-send.');
            }
        }, 100); // Interval set to 100 milliseconds
    };

    /**
     * Waits for send buttons to appear in the DOM using a promise-based approach.
     * This modern helper replaces the previous MutationObserver duplication.
     * @param {number} timeout - Maximum time in milliseconds to wait for the buttons.
     * @returns {Promise<HTMLElement[]>} Resolves with the send buttons if found.
     */
    const waitForSendButtons = (timeout = 5000) => {
        return new Promise((resolve, reject) => {
            const buttons = locateSendButtons();
            if (buttons.length > 0) {
                return resolve(buttons);
            }
            const observer = new MutationObserver((mutations, obs) => {
                const buttonsNow = locateSendButtons();
                if (buttonsNow.length > 0) {
                    obs.disconnect();
                    resolve(buttonsNow);
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
            setTimeout(() => {
                observer.disconnect();
                reject(new Error('Timeout waiting for send buttons'));
            }, timeout);
        });
    };

    /**
     * Handles the entire process of inserting text and sending the message.
     * This includes state detection, text insertion, and send button handling.
     */
    const handleMessageInsertion = () => {
        logConCgp('[buttons] handleMessageInsertion called.');
        const initialState = isEditorInInitialState(editorArea);

        if (initialState) {
            // Insert whole text in one go (no per-character emulation)
            logConCgp('[buttons][ChatGPT] Editor empty/placeholder. Inserting text (bulk).');
            insertTextIntoChatGPTEditor(editorArea, customText, true);
            logConCgp('[buttons][ChatGPT] Custom text inserted.');

            // Use the promise-based helper to wait for send buttons instead of duplicating MutationObserver logic
            setTimeout(() => {
                waitForSendButtons(5000)
                    .then((buttons) => {
                        originalSendButtons = buttons;
                        handleSendButtons(originalSendButtons);
                    })
                    .catch((error) => {
                        logConCgp('[buttons] ' + error.message);
                        showToast('Could not find the send button.', 'error');
                    });
            }, 500); // Delay to allow the editor to update
        } else {
            logConCgp('[buttons][ChatGPT] Editor has content. Appending text (bulk insert).');
            insertTextIntoChatGPTEditor(editorArea, customText, false);
            // Proceed to handle send buttons immediately
            handleSendButtons(originalSendButtons);
        }
    };

    // ----------------------------
    // Start the message insertion and sending process
    // ----------------------------
    handleMessageInsertion();
}

// Expose the function globally
window.processChatGPTCustomSendButtonClick = processChatGPTCustomSendButtonClick;
