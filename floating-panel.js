// Version: 1.0
//
// Documentation:
// This file implements the entry point for the OneClickPrompts floating panel.
// It defines the window.MaxExtensionFloatingPanel namespace (with common properties)
// and loads additional functionality split into separate files: floating-panel-ui-creation.js, 
// floating-panel-ui-interaction.js, and floating-panel-settings.js.
//
// Structure:
// 1. Namespace: window.MaxExtensionFloatingPanel - Global object containing all floating panel functionality
// 2. Properties:
//    - panelElement: Reference to the panel DOM element
//    - isPanelVisible: Boolean tracking current visibility state
//    - currentProfileName: Currently active profile name
//    - availableProfiles: Array of all available profile names
//    - storageKeyPrefix: Prefix used for storing settings ('floating_panel_')
//    - defaultPanelSettings: Default configuration for new panels
//    - currentPanelSettings: Current active settings for the panel
//    - savePositionTimer: Used for debounced settings saves
//
// Dependencies:
// - floating-panel-ui-creation.js: Contains UI creation methods
// - floating-panel-ui-interaction.js: Contains UI interaction methods
// - floating-panel-settings.js: Contains settings and profile management
// - config.js (Service Worker): Handles persistent storage of panel settings
//
// Communication:
// The floating panel uses chrome.runtime.sendMessage to communicate with the config.js
// service worker for storing and retrieving settings based on the website hostname.
// 
// IMPORTANT: DO NOT REMOVE COMMENTS. All old names are preserved.

'use strict';

// Define the namespace and shared properties.
window.MaxExtensionFloatingPanel = {
    panelElement: null,
    isPanelVisible: false,
    currentProfileName: null,
    availableProfiles: [],
    storageKeyPrefix: 'floating_panel_',
    defaultPanelSettings: {
        width: 300,
        height: 400,
        posX: 100,
        posY: 100,
        opacity: 0.7,
        isVisible: false
    },
    currentPanelSettings: null,
    savePositionTimer: null,

    // Prompt Queue properties
    promptQueue: [],
    queueSectionElement: null,
    queueDisplayArea: null,
    playQueueButton: null,
    resetQueueButton: null,
    delayInputElement: null,
    queueModeToggle: null
};

// No need to load files: they are imported in manifest.json