// buttons.js
// Version: 1.0
//
// Documentation:
// This file manages the creation and functionality of custom send buttons within the ChatGPT extension.
// It provides utility functions to create buttons based on configuration and assigns keyboard shortcuts where applicable.
//
// Functions:
// - createCustomSendButton: Creates a custom send button based on provided configuration.
// - determineShortcutKeyForButtonIndex: Assigns a shortcut key to a button based on its index.
//
// Usage:
// Ensure that `buttons-init.js` and `init.js` are loaded before this script to utilize button functionalities.
// This script should be included in the `content_scripts` section of the manifest to be injected into the target pages.
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS. This one too!
'use strict';

/**
 * Namespace object containing functions related to creating and managing custom buttons.
 */
window.MaxExtensionButtons = {
    /**
     * Creates a custom send button based on the provided configuration.
     * @param {Object} buttonConfig - The configuration object for the custom button.
     * @param {number} buttonIndex - The index of the button in the custom buttons array.
     * @param {Function} onClickHandler - The function to handle the button's click event.
     * @returns {HTMLButtonElement} - The newly created custom send button element.
     */
    createCustomSendButton: function (buttonConfig, buttonIndex, onClickHandler) {
        const customButtonElement = document.createElement('button');
        customButtonElement.innerHTML = buttonConfig.icon;
        customButtonElement.setAttribute('data-testid', `custom-send-button-${buttonIndex}`);

        // Assign keyboard shortcuts to the first 10 non-separator buttons if shortcuts are enabled
        let assignedShortcutKey = null;
        if (MaxExtensionConfig.enableShortcuts) {
            assignedShortcutKey = this.determineShortcutKeyForButtonIndex(buttonIndex);
            if (assignedShortcutKey !== null) {
                customButtonElement.dataset.shortcutKey = assignedShortcutKey.toString();
            }
        }

        const shortcutDescription = assignedShortcutKey !== null ? ` (Shortcut: Alt+${assignedShortcutKey})` : '';
        customButtonElement.setAttribute('title', `${buttonConfig.text}${shortcutDescription}`);

        customButtonElement.style.cssText = `
            background-color: transparent;
            border: none;
            cursor: pointer;
            padding: 1px;
            font-size: 20px;
            margin-right: 5px;
            margin-bottom: 5px;
        `;

        // Attach the click event listener to handle custom send actions
        customButtonElement.addEventListener('click', (event) => onClickHandler(event, buttonConfig.text, buttonConfig.autoSend));

        return customButtonElement;
    },

    /**
     * Determines the appropriate shortcut key for a button based on its index, skipping separator buttons.
     * @param {number} buttonIndex - The index of the button in the custom buttons array.
     * @returns {number|null} - The assigned shortcut key (1-10) or null if no shortcut is assigned.
     */
    determineShortcutKeyForButtonIndex: function (buttonIndex) {
        let shortcutAssignmentCount = 0;
        for (let i = 0; i < MaxExtensionConfig.customButtons.length; i++) {
            if (!MaxExtensionConfig.customButtons[i].separator) {
                shortcutAssignmentCount++;
                if (i === buttonIndex && shortcutAssignmentCount <= 10) {
                    return shortcutAssignmentCount % 10; // 0 represents 10
                }
            }
        }
        return null;
    }
};

/**
 * Handles the click event on a custom send button.
 * @param {Event} event - The click event object.
 * @param {string} customText - The custom text to be inserted.
 * @param {boolean} autoSend - Flag indicating whether to automatically send the message.
 */
function processCustomSendButtonClick(event, customText, autoSend) {
    // Prevent default button behavior
    event.preventDefault();
    logConCgp('[init] Custom send button was clicked.');

    // Detect the editor area using dynamic selector
    const editorArea = document.querySelector(window.InjectionTargetsOnWebsite.selectors.editor); // Dynamic selector
    if (editorArea) {
        logConCgp('[init] Editor area found:', editorArea);
    } else {
        logConCgp('[init] Editor area not found. Unable to proceed.');
        return;
    }


    /**
     * Attempts to locate the send button using dynamic selectors from InjectionTargetsOnWebsite.
     * Iterates through an array of selectors to find the first matching send button.
     * 
     * @returns {HTMLElement|null} - The send button element if found; otherwise, null.
     */
    function locateSendButton() {
        // Retrieve the array of send button selectors from InjectionTargetsOnWebsite
        const sendButtonSelectors = window.InjectionTargetsOnWebsite.selectors.sendButton;

        // Check if sendButtonSelectors is an array
        if (Array.isArray(sendButtonSelectors)) {
            // Iterate through each selector to find the send button
            for (const selector of sendButtonSelectors) {
                const button = document.querySelector(selector);
                if (button) {
                    logConCgp('[init] Send button located using selector:', selector);
                    return button;
                }
            }
        }
        // If sendButtonSelectors is a single string selector
        else if (typeof sendButtonSelectors === 'string') {
            const button = document.querySelector(sendButtonSelectors);
            if (button) {
                logConCgp('[init] Send button located using selector:', sendButtonSelectors);
                return button;
            }
        }

        // If no send button is found using the provided selectors
        logConCgp('[init] Send button not found using dynamic selectors.');
        return null;
    }

    // Locate the send button
    let originalSendButton = locateSendButton();
    if (!originalSendButton) {
        logConCgp('[init] Send button not found initially. Setting up MutationObserver to detect it.');
    }

    /**
     * Handles the send button click logic.
     * @param {HTMLElement} sendButton - The send button element.
     */
    function handleSendButton(sendButton) {
        if (sendButton) {
            logConCgp('[init] Send button is available. Proceeding with sending message.');

            // Retrieve existing text in the editor
            const existingText = editorArea.innerText;
            logConCgp('[init] Current text in editor:', existingText);

            // Concatenate existing text with custom text exactly as provided
            const newText = `${existingText}${customText}`;
            logConCgp('[init] Combined text to be inserted:', newText);

            // Insert the new text into the editor
            MaxExtensionUtils.insertTextIntoEditor(editorArea, newText);

            // Move cursor to the end after insertion
            MaxExtensionUtils.moveCursorToEnd(editorArea);

            // Auto-send the message if global auto-send is enabled and this button's config allows it
            if (MaxExtensionConfig.globalAutoSendEnabled && autoSend) {
                logConCgp('[init] Starting auto-send interval to click send button every 100ms until editor is empty.');

                // Define the interval ID so it can be cleared later
                const sendInterval = setInterval(() => {
                    const currentText = editorArea.innerText.trim();
                    logConCgp('[auto-send] Current text in editor:', currentText);

                    if (currentText.length === 0) {
                        logConCgp('[auto-send] Editor is empty. Stopping auto-send interval.');
                        clearInterval(sendInterval);
                        return;
                    }

                    // I SPENT FIVE HOURS DETECTING THAT THIS BUTTON CHANGES AND NEEDS TO BE RE-DETECTED. 
                    // do not delete above comment.
                    originalSendButton = locateSendButton();
                    if (originalSendButton) {
                        logConCgp('[init] Original send button located:', originalSendButton);
                        logConCgp('[auto-send] Attempting to click the send button.');
                        MaxExtensionUtils.simulateClick(originalSendButton);
                        logConCgp('[auto-send] Original send button was clicked automatically.');
                    } else {
                        logConCgp('[init] Original send button not found. Unable to proceed.');
                        clearInterval(sendInterval);
                    }
                }, 100); // Interval set to 100 milliseconds
            } else {
                logConCgp('[init] Auto-send is disabled. Message will not be sent automatically.');
            }
        } else {
            logConCgp('[init] Send button is not available to handle.');
        }
    }

    // If the send button is not found, set up a MutationObserver to detect when it appears
    if (!originalSendButton) {
        const observer = new MutationObserver((mutations, obs) => {
            originalSendButton = locateSendButton();
            if (originalSendButton) {
                handleSendButton(originalSendButton);
                obs.disconnect(); // Stop observing once the button is found
                logConCgp('[init] Send button detected and observer disconnected.');
            } else {
                logConCgp('[init] MutationObserver detected changes, but send button still not found.');
            }
        });

        // Start observing the DOM for changes
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    } else {
        // If send button is found, handle it immediately
        handleSendButton(originalSendButton);
    }
}

/**
 * Creates and appends custom send buttons to the specified container.
 * This function has been moved to `buttons-init.js` to enhance modularity.
 * @param {HTMLElement} container - The DOM element to which custom buttons will be appended.
 */
// Function moved to buttons-init.js
