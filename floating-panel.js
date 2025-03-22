// floating-panel.js
// Version: 1.0
//
// Documentation:
// This file implements the entry point for the OneClickPrompts floating panel.
// It defines the window.MaxExtensionFloatingPanel namespace (with common properties)
// and loads additional functionality split into two files: floating-panel-ui.js and floating-panel-settings.js.
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
    savePositionTimer: null
};

// No need to load files: they are imported in manifest.json