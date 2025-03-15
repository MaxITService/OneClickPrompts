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
// - updateButtonsForProfileChange: Updates all buttons and toggles in response to a profile change.
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
        // Add floating panel toggle button at the beginning
        if (window.MaxExtensionFloatingPanel) {
            const floatingPanelToggleButton = window.MaxExtensionFloatingPanel.createPanelToggleButton();
            container.appendChild(floatingPanelToggleButton);
            logConCgp('[init] Floating panel toggle button has been created and appended.');
        }

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
            z-index: 1000;
        `;

        // Append custom send buttons
        this.generateAndAppendCustomSendButtons(customElementsContainer);
        // Append toggle switches
        this.generateAndAppendToggles(customElementsContainer);

        targetContainer.appendChild(customElementsContainer);
        logConCgp('[init] Custom elements have been inserted into the DOM.');
        
        // Initialize floating panel if available
        if (window.MaxExtensionFloatingPanel) {
            window.MaxExtensionFloatingPanel.initialize();
            logConCgp('[init] Floating panel has been initialized.');
        }
    },
    
    /**
     * Updates all buttons and toggles in response to a profile change.
     * This refreshes both the floating panel and the original container.
     */
    updateButtonsForProfileChange: function() {
        // Update buttons in the original container
        const originalContainer = document.getElementById(window.InjectionTargetsOnWebsite.selectors.buttonsContainerId);
        if (originalContainer) {
            // Clear existing buttons and toggles
            originalContainer.innerHTML = '';
            
            // Re-generate buttons and toggles with new profile data
            this.generateAndAppendCustomSendButtons(originalContainer);
            this.generateAndAppendToggles(originalContainer);
            
            logConCgp('[init] Updated buttons in original container for profile change.');
        }
        
        // Update buttons in the floating panel if it exists and is initialized
        if (window.MaxExtensionFloatingPanel && window.MaxExtensionFloatingPanel.panelElement) {
            const panelContent = document.getElementById('max-extension-floating-panel-content');
            if (panelContent) {
                // Clear existing buttons and toggles
                panelContent.innerHTML = '';
                
                // Re-generate buttons and toggles with new profile data
                this.generateAndAppendCustomSendButtons(panelContent);
                this.generateAndAppendToggles(panelContent);
                
                logConCgp('[init] Updated buttons in floating panel for profile change.');
            }
        }
    }
};

// Listen for profile change events
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'profileChanged') {
        logConCgp('[init] Received profile change notification');
        
        // Update the global config with the new profile data
        window.globalMaxExtensionConfig = message.config;
        
        // Update the UI components
        window.MaxExtensionButtonsInit.updateButtonsForProfileChange();
        
        // Acknowledge the message
        sendResponse({ success: true });
    }
    return true;
});
