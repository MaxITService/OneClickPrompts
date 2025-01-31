/* buttons.js
   Version: 1.0

   Documentation:

   This file is a dependency. Designed to host helper functions for init.js. Manages the creation and functionality of custom send buttons within the ChatGPT extension.
   It provides utility functions to create buttons based on configuration and assigns keyboard shortcuts where applicable.

   Functions:
   - createCustomSendButton: Creates a custom send button based on provided configuration.
   - determineShortcutKeyForButtonIndex: Assigns a shortcut key to a button based on its index.

   After that, tje 

   Usage:
   Ensure that dependencies are loaded before this script to utilize button functionalities.
      
   Depends on:
   utils.js - object containing all selectors and identifiers
   buttons-init.js - handles only some initializations.
   +
   buttons-clicking-chatgpt.js - handles the send button clicking process for ChatGPT
   buttons-clicking-copilot.js - ... for Copilot
   buttons-clicking-claude.js - ... Claude

   Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS. This one too!
*/
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
        if (globalMaxExtensionConfig.enableShortcuts) {
            assignedShortcutKey = this.determineShortcutKeyForButtonIndex(buttonIndex);
            if (assignedShortcutKey !== null) {
                customButtonElement.dataset.shortcutKey = assignedShortcutKey.toString();
            }
        }

        // Prepare tooltip parts: append (Auto-sends) if autoSend behavior is enabled
        const autoSendDescription = buttonConfig.autoSend ? ' (Auto-sends)' : '';
        const shortcutDescription = assignedShortcutKey !== null ? ` (Shortcut: Alt+${assignedShortcutKey})` : '';

        // Set the tooltip (title attribute) combining the button text with auto-send and shortcut info
        customButtonElement.setAttribute('title', `${buttonConfig.text}${autoSendDescription}${shortcutDescription}`);

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
        for (let i = 0; i < globalMaxExtensionConfig.customButtons.length; i++) {
            if (!globalMaxExtensionConfig.customButtons[i].separator) {
                shortcutAssignmentCount++;
                if (i === buttonIndex && shortcutAssignmentCount <= 10) {
                    return shortcutAssignmentCount % 10; // 0 represents 10
                }
            }
        }
        return null;
    }
};

// #region clickingbuttons - entry

/**
 * Handles click events on custom send buttons across different supported sites.
 * Orchestrates different text insertion and send strategies based on the active site.
 * This is it, from there the functions are called that are located in different sites:
 * buttons-claude.js, buttons-copilot.js, buttons-chatgpt.js
 * @param {Event} event - The click event object
 * @param {string} customText - The custom text to be inserted
 * @param {boolean} autoSend - Flag indicating whether to automatically send the message
 */
function processCustomSendButtonClick(event, customText, autoSend) {
    event.preventDefault();
    logConCgp('[buttons] Custom send button clicked');

    // Invert autoSend if Shift key is pressed during the click
    if (event.shiftKey) {
        autoSend = !autoSend;
        logConCgp('[buttons] Shift key detected. autoSend inverted to:', autoSend);
    }
    // Get the active site from the injection targets
    const activeSite = window.InjectionTargetsOnWebsite.activeSite;
    logConCgp('[buttons] Active site:', activeSite);

    // Handle different sites
    // In processCustomSendButtonClick function
    switch (activeSite) {
        case 'ChatGPT':
            processChatGPTCustomSendButtonClick(event, customText, autoSend);
            break;
        case 'Claude':
            processClaudeCustomSendButtonClick(event, customText, autoSend);
            break;
        case 'Copilot':
            processCopilotCustomSendButtonClick(event, customText, autoSend);
            break;
        case 'DeepSeek':
            processDeepSeekCustomSendButtonClick(event, customText, autoSend);
            break;
        case 'AIStudio':
            processAIStudioCustomSendButtonClick(event, customText, autoSend);
            break;
        case 'AIStudio':
            processAIStudioCustomSendButtonClick(event, customText, autoSend);
            break;
        default:
            logConCgp('[buttons] Unsupported site:', activeSite);
    }
}

// #endregion
