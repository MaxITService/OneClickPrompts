// buttons-clicking-chatgpt.js
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
    const editorArea = document.querySelector(
        window.InjectionTargetsOnWebsite.selectors.editors.find(selector => document.querySelector(selector))
    );

    if (!editorArea) {
        logConCgp('[buttons] Editor area not found. Unable to proceed.');
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
     * Creates an input or keyboard event for a given character.
     * @param {string} type - The event type ('keydown', 'input', or 'keyup').
     * @param {string} char - The character associated with the event.
     * @returns {Event} - The constructed event.
     */
    const createInputEvent = (type, char) => {
        const eventInit = {
            key: char,
            code: `Key${char.toUpperCase()}`,
            bubbles: true,
            composed: true,
            cancelable: true
        };

        return type === 'input'
            ? new InputEvent(type, {
                  data: char,
                  inputType: 'insertText',
                  bubbles: true,
                  composed: true,
                  cancelable: true
              })
            : new KeyboardEvent(type, eventInit);
    };

    /**
     * Simulates typing text into a ProseMirror editor.
     * Uses modern for‑of loops and dispatches key events for each character.
     * @param {HTMLElement} editorElement - The ProseMirror editor element.
     * @param {string} text - The text to type into the editor.
     */
    const simulateTypingIntoProseMirror = (editorElement, text) => {
        editorElement.focus();
        const eventTypes = ['keydown', 'input', 'keyup'];
        for (const char of text) {
            for (const eventType of eventTypes) {
                const evt = createInputEvent(eventType, char);
                editorElement.dispatchEvent(evt);
                if (eventType === 'input') {
                    // Modern approach to insert text
                    const selection = window.getSelection();
                    if (selection && selection.rangeCount > 0) {
                        const range = selection.getRangeAt(0);
                        const textNode = document.createTextNode(char);
                        range.insertNode(textNode);
                        range.collapse(false);
                        selection.removeAllRanges();
                        selection.addRange(range);
                    }
                }
            }
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

        // Threshold for using direct insertion instead of simulated typing for large prompts.
        const LARGE_PROMPT_THRESHOLD = 200;

        if (initialState) {
            // If the prompt is large, use direct insertion to improve performance.
            if (customText.length > LARGE_PROMPT_THRESHOLD) {
                logConCgp('[buttons] Editor is in initial state and large prompt detected. Using direct insertion.');
                MaxExtensionUtils.insertTextIntoEditor(editorArea, customText);
            } else {
                logConCgp('[buttons] Editor is in initial state. Simulating typing.');
                simulateTypingIntoProseMirror(editorArea, customText);
            }
            logConCgp('[buttons] Custom text inserted into editor.');

            // Use the promise-based helper to wait for send buttons instead of duplicating MutationObserver logic
            setTimeout(() => {
                waitForSendButtons(5000)
                    .then((buttons) => {
                        originalSendButtons = buttons;
                        handleSendButtons(originalSendButtons);
                    })
                    .catch((error) => {
                        logConCgp('[buttons] ' + error.message);
                    });
            }, 500); // Delay to allow the editor to update
        } else {
            logConCgp('[buttons] Editor is already in active state. Proceeding with existing logic.');
            // Retrieve existing text in the editor
            const existingText = editorArea.innerText;
            logConCgp('[buttons] Current text in editor:', existingText);

            // Concatenate existing text with custom text exactly as provided
            const newText = `${existingText}${customText}`;
            logConCgp('[buttons] Combined text to be inserted:', newText);

            // Insert the new text into the editor using the external utility methods
            MaxExtensionUtils.insertTextIntoEditor(editorArea, newText);
            // Move cursor to the end after insertion
            MaxExtensionUtils.moveCursorToEnd(editorArea);

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
