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

    const editorSelectors = window.InjectionTargetsOnWebsite.selectors.editors;
    let editorArea = null;

    // Iterate through editor selectors to find the editor area
    for (const selector of editorSelectors) {
        const foundEditor = document.querySelector(selector);
        if (foundEditor) {
            editorArea = foundEditor;
            logConCgp('[buttons] Editor area found:', editorArea);
            break;
        }
    }

    // If editor area is not found, log and exit the function
    if (!editorArea) {
        logConCgp('[buttons] Editor area not found. Unable to proceed.');
        return;
    }

    /**
     * Determines if the editor is in its initial state (contains placeholder text).
     * @param {HTMLElement} element - The editor element.
     * @returns {boolean} - True if in initial state, false otherwise.
     */
    function isEditorInInitialState(element) {
        const placeholderElement = element.querySelector('p.placeholder');
        const isInitial = !!placeholderElement;
        logConCgp('[buttons] Editor initial state check:', isInitial);
        return isInitial;
    }

    /**
     * Simulates typing text into a ProseMirror editor.
     * @param {HTMLElement} editorElement - The ProseMirror editor element.
     * @param {string} text - The text to type into the editor.
     */
    function simulateTypingIntoProseMirror(editorElement, text) {
        editorElement.focus();
        for (let i = 0; i < text.length; i++) {
            const char = text.charAt(i);

            // Create and dispatch a keydown event
            const keyDownEvent = new KeyboardEvent('keydown', {
                key: char,
                code: char,
                charCode: char.charCodeAt(0),
                keyCode: char.charCodeAt(0),
                which: char.charCodeAt(0),
                bubbles: true,
            });
            editorElement.dispatchEvent(keyDownEvent);

            // Insert the character into the editor's content
            document.execCommand('insertText', false, char);

            // Create and dispatch an input event
            const inputEvent = new InputEvent('input', {
                data: char,
                bubbles: true,
            });
            editorElement.dispatchEvent(inputEvent);

            // Create and dispatch a keyup event
            const keyUpEvent = new KeyboardEvent('keyup', {
                key: char,
                code: char,
                charCode: char.charCodeAt(0),
                keyCode: char.charCodeAt(0),
                which: char.charCodeAt(0),
                bubbles: true,
            });
            editorElement.dispatchEvent(keyUpEvent);
        }
    }

    /**
     * Locates all send buttons based on the provided selectors.
     * @returns {HTMLElement[]} Array of found send button elements.
     */
    function locateSendButtons() {
        const sendButtonSelectors = window.InjectionTargetsOnWebsite.selectors.sendButtons;
        const sendButtons = [];

        // Iterate through send button selectors to find all matching buttons
        sendButtonSelectors.forEach((selector) => {
            const buttons = document.querySelectorAll(selector);
            buttons.forEach((button) => {
                if (!sendButtons.includes(button)) {
                    logConCgp('[buttons] Send button located using selector:', selector);
                    sendButtons.push(button);
                }
            });
        });

        if (sendButtons.length === 0) {
            logConCgp('[buttons] Send buttons not found using dynamic selectors.');
        }

        return sendButtons;
    }

    // Locate send buttons initially
    let originalSendButtons = locateSendButtons();

    /**
     * Handles the send buttons by inserting text and initiating auto-send if enabled.
     * Operates on only the first send button to prevent duplicate sends.
     * @param {HTMLElement[]} sendButtons - Array of send button elements.
     */
    function handleSendButtons(sendButtons) {
        logConCgp('[buttons] handleSendButtons called.');
        if (sendButtons.length > 0) {
            logConCgp('[buttons] Send buttons are available. Proceeding with sending message.');

            // Check if auto-send is enabled both globally and for this button
            if (globalMaxExtensionConfig.globalAutoSendEnabled && autoSend) {
                logConCgp('[buttons] Auto-send is enabled. Starting auto-send process.');

                // Use only the first send button
                startAutoSend([sendButtons[0]], editorArea);
            } else {
                logConCgp('[buttons] Auto-send is disabled. Message will not be sent automatically.');
            }
        } else {
            logConCgp('[buttons] Send buttons are not available to handle.');
        }
    }

    /**
     * Starts the auto-send interval to automatically click send buttons until the editor is empty.
     * Ensures only one interval runs at a time and clicks only the first send button.
     * @param {HTMLElement[]} sendButtons - Array of send button elements.
     * @param {HTMLElement} editor - The editor area element.
     */
    function startAutoSend(sendButtons, editor) {
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

                // After a successful click, assume the message is sent and stop auto-send
                clearInterval(window.autoSendInterval);
                window.autoSendInterval = null;
                logConCgp('[auto-send] Auto-send interval stopped after successful send.');
            } else {
                logConCgp('[auto-send] Send button not found during auto-send.');
            }
        }, 100); // Interval set to 100 milliseconds
    }

    /**
     * Handles the entire process of inserting text and sending the message.
     * This includes state detection, text insertion, and send button handling.
     */
    function handleMessageInsertion() {
        logConCgp('[buttons] handleMessageInsertion called.');
        const initialState = isEditorInInitialState(editorArea);

        if (initialState) {
            logConCgp('[buttons] Editor is in initial state. Simulating typing.');

            // Simulate typing to activate the editor and insert text
            simulateTypingIntoProseMirror(editorArea, customText);
            logConCgp('[buttons] Custom text typed into editor.');

            // Wait for the send button to appear
            setTimeout(() => {
                // Proceed to handle send buttons
                originalSendButtons = locateSendButtons();

                if (originalSendButtons.length === 0) {
                    // If send buttons are still not found, set up a MutationObserver
                    logConCgp('[buttons] Send buttons not found after typing. Setting up MutationObserver.');
                    const observer = new MutationObserver((mutations, obs) => {
                        originalSendButtons = locateSendButtons();
                        if (originalSendButtons.length > 0) {
                            handleSendButtons(originalSendButtons);
                            obs.disconnect();
                            logConCgp('[buttons] Send buttons detected and observer disconnected.');
                        } else {
                            logConCgp('[buttons] MutationObserver detected changes, but send buttons still not found.');
                        }
                    });

                    // Start observing the DOM for changes to detect send buttons
                    observer.observe(document.body, {
                        childList: true,
                        subtree: true
                    });

                    // Set a timeout to disconnect the observer after a reasonable time
                    setTimeout(() => {
                        if (window.autoSendInterval) {
                            // If auto-send is already running, do not disconnect
                            logConCgp('[buttons] MutationObserver timeout reached, but auto-send is running. Observer remains.');
                            return;
                        }
                        observer.disconnect();
                        logConCgp('[buttons] MutationObserver disconnected after timeout.');
                    }, 5000); // 5 seconds timeout
                } else {
                    // If send buttons are found after insertion, handle them
                    handleSendButtons(originalSendButtons);
                }
            }, 500); // Delay to allow the editor to update
        } else {
            logConCgp('[buttons] Editor is already in active state. Proceeding with existing logic.');

            // Retrieve existing text in the editor
            const existingText = editorArea.innerText;
            logConCgp('[buttons] Current text in editor:', existingText);

            // Concatenate existing text with custom text exactly as provided
            const newText = `${existingText}${customText}`;
            logConCgp('[buttons] Combined text to be inserted:', newText);

            // Insert the new text into the editor
            MaxExtensionUtils.insertTextIntoEditor(editorArea, newText);

            // Move cursor to the end after insertion
            MaxExtensionUtils.moveCursorToEnd(editorArea);

            // Proceed to handle send buttons
            handleSendButtons(originalSendButtons);
        }
    }

    // Start the message insertion and sending process
    handleMessageInsertion();
}

// Expose the function globally
window.processChatGPTCustomSendButtonClick = processChatGPTCustomSendButtonClick;
