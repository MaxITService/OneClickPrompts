// buttons-init.js
// Version: 1.0
//
// Documentation:
// This file handles the initialization of custom buttons and toggles within the ChatGPT extension.
// It ensures that custom buttons and toggles are created and appended to the DOM without duplication.
//
// Functions:
// - createAndInsertCustomElements: Creates and inserts custom buttons and toggles into the target container.
// - generateAndAppendToggles: Creates and appends toggle switches (e.g., Auto-send, Hotkeys) to a specified container.
//
// Usage:
// Ensure that `buttons.js` and `init.js` are loaded before this script to utilize button initialization functionalities.
// This script should be included in the `content_scripts` section of the manifest to be injected into the target pages.
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS. This one too!
'use strict';

/**
 * Namespace object containing initialization functions for custom buttons and toggles.
 */
window.MaxExtensionButtonsInit = {
    /**
     * Creates and appends toggle switches to the specified container.
     * @param {HTMLElement} container - The DOM element to which toggles will be appended.
     */
    generateAndAppendToggles: function(container) {
        const autoSendToggle = MaxExtensionInterface.createToggle(
            'auto-send-toggle',
            'Enable Auto-send',
            globalMaxExtensionConfig.globalAutoSendEnabled,
            (state) => {
                globalMaxExtensionConfig.globalAutoSendEnabled = state;
            }
        );
        container.appendChild(autoSendToggle);
        logConCgp('[init] Auto-send toggle has been created and appended.');

        const hotkeysToggle = MaxExtensionInterface.createToggle(
            'hotkeys-toggle',
            'Enable Hotkeys',
            globalMaxExtensionConfig.enableShortcuts,
            (state) => {
                globalMaxExtensionConfig.enableShortcuts = state;
            }
        );
        container.appendChild(hotkeysToggle);
        logConCgp('[init] Hotkeys toggle has been created and appended.');
    },

    /**
     * Creates and appends custom send buttons to the specified container.
     * @param {HTMLElement} container - The DOM element to which custom buttons will be appended.
     */
    generateAndAppendCustomSendButtons: function(container) {
        globalMaxExtensionConfig.customButtons.forEach((buttonConfiguration, index) => {
            if (buttonConfiguration.separator) {
                const separatorElement = MaxExtensionUtils.createSeparator();
                container.appendChild(separatorElement);
                logConCgp('[init] Separator element has been created and appended.');
            } else {
                const customSendButton = MaxExtensionButtons.createCustomSendButton(buttonConfiguration, index, processCustomSendButtonClick);
                container.appendChild(customSendButton);
                logConCgp(`[init] Custom send button ${index + 1} has been created:`, customSendButton);
            }
        });
    },

    /**
     * Creates and inserts custom buttons and toggles into the target container element.
     * @param {HTMLElement} targetContainer - The DOM element where custom elements will be inserted.
     */
    createAndInsertCustomElements: function(targetContainer) {
        // Prevent duplication by checking if the container already exists using dynamic selector
        if (doCustomModificationsExist()) {
            logConCgp('[init] Custom buttons container already exists. Skipping creation.');
            return;
        }

        const customElementsContainer = document.createElement('div');
        // This should be created already by 
        customElementsContainer.id = window.InjectionTargetsOnWebsite.selectors.buttonsContainerId; // where to insert buttons
        customElementsContainer.style.cssText = `
            display: flex;
            justify-content: flex-start;
            flex-wrap: wrap;
            gap: 8px;
            padding: 8px;
            width: 100%;
        `;

        // Append custom send buttons
        this.generateAndAppendCustomSendButtons(customElementsContainer);
        // Append toggle switches
        this.generateAndAppendToggles(customElementsContainer);

        targetContainer.appendChild(customElementsContainer);
        logConCgp('[init] Custom elements have been inserted into the DOM.');
    }
};

/**
 * Checks whether the custom buttons modifications already exist in the DOM.
 * @returns {boolean} - True if modifications exist, false otherwise.
 */
function doCustomModificationsExist() {
    return document.getElementById(window.InjectionTargetsOnWebsite.selectors.buttonsContainerId) !== null;
}
