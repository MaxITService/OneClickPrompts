// buttons-clicking-chatgpt.js
// This file is a dependency for buttons.js. It provides functions to handle the send button clicking process for ChatGPT.

// #region ChatGPT

function processChatGPTCustomSendButtonClick(event, customText, autoSend) {
    // Prevent default button behavior
    event.preventDefault();
    logConCgp('[buttons] Custom send button was clicked.');

    const editorSelectors = window.InjectionTargetsOnWebsite.selectors.editors;
    let editorArea = null;

    // Iterate through editor selectors to find the editor area
    editorSelectors.forEach((selector) => {
        const foundEditor = document.querySelector(selector);
        if (foundEditor && !editorArea) {
            editorArea = foundEditor;
            logConCgp('[buttons] Editor area found:', editorArea);
        }
    });

    // If editor area is not found, log and exit the function
    if (!editorArea) {
        logConCgp('[buttons] Editor area not found. Unable to proceed.');
        return;
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
            const button = document.querySelector(selector);
            if (button) {
                logConCgp('[buttons] Send button located using selector:', selector);
                sendButtons.push(button);
            }
        });

        if (sendButtons.length === 0) {
            logConCgp('[buttons] Send buttons not found using dynamic selectors.');
        }

        return sendButtons;
    }

    // Locate send buttons initially
    let originalSendButtons = locateSendButtons();

    // If no send buttons are found, set up a MutationObserver to detect them
    if (originalSendButtons.length === 0) {
        logConCgp('[buttons] Send buttons not found initially. Setting up MutationObserver to detect them.');

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
    } else {
        // If send buttons are found, handle them immediately
        handleSendButtons(originalSendButtons);
    }

    /**
     * Handles the send buttons by inserting text and initiating auto-send if enabled.
     * @param {HTMLElement[]} sendButtons - Array of send button elements.
     */
    function handleSendButtons(sendButtons) {
        if (sendButtons.length > 0) {
            logConCgp('[buttons] Send buttons are available. Proceeding with sending message.');

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

            // Check if auto-send is enabled both globally and for this button
            if (globalMaxExtensionConfig.globalAutoSendEnabled && autoSend) {
                logConCgp('[buttons] Auto-send is enabled. Starting auto-send process.');

                // Start the auto-send process
                startAutoSend(sendButtons, editorArea);
            } else {
                logConCgp('[buttons] Auto-send is disabled. Message will not be sent automatically.');
            }
        } else {
            logConCgp('[buttons] Send buttons are not available to handle.');
        }
    }

    /**
     * Starts the auto-send interval to automatically click send buttons until the editor is empty.
     * @param {HTMLElement[]} sendButtons - Array of send button elements.
     * @param {HTMLElement} editor - The editor area element.
     */
    function startAutoSend(sendButtons, editor) {
        // Prevent multiple auto-send intervals from running simultaneously
        if (window.autoSendInterval) {
            logConCgp('[auto-send] Auto-send is already running. Skipping initiation.');
            return;
        }

        logConCgp('[auto-send] Starting auto-send interval to click send buttons every 100ms.');

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
                logConCgp('[auto-send] Send buttons not found during auto-send. Stopping auto-send interval.');
                clearInterval(window.autoSendInterval);
                window.autoSendInterval = null;
                return;
            }

            // Click each send button found
            updatedSendButtons.forEach((sendButton, index) => {
                if (sendButton) {
                    logConCgp(`[auto-send] Clicking send button ${index + 1}:`, sendButton);
                    MaxExtensionUtils.simulateClick(sendButton);
                    logConCgp('[auto-send] Send button clicked successfully.');

                    // After a successful click, assume the message is sent and stop auto-send
                    clearInterval(window.autoSendInterval);
                    window.autoSendInterval = null;
                    logConCgp('[auto-send] Auto-send interval stopped after successful send.');
                } else {
                    logConCgp('[auto-send] Send button not found during auto-send.');
                }
            });
        }, 100); // Interval set to 100 milliseconds
    }
}

// #endregion


