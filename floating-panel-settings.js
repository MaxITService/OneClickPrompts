// Version: 1.1
//
// Documentation:
// This file handles settings persistence and profile management for the floating panel.
// It includes methods for loading/saving panel settings, debouncing saves, and profile switching.
// These functions extend the window.MaxExtensionFloatingPanel namespace.
//
// Key Components:
// 1. Settings Management - Loading and saving panel configuration per website
// 2. Storage Integration - Communication with the config.js service worker
// 3. Profile Management - Loading available profiles and handling profile switching
// 4. Initialization - Setup of the floating panel system
//
// Key Methods:
// - loadPanelSettings(): Fetches settings from service worker for current hostname
// - savePanelSettings(): Stores current panel settings via service worker
// - debouncedSavePanelSettings(): Throttles saves to improve performance
// - loadAvailableProfiles(): Gets profile list from service worker
// - getCurrentProfile(): Fetches and sets current active profile
// - switchToProfile(): Changes active profile and updates panel content
// - initialize(): Sets up the floating panel by creating UI and loading settings
//
// Implementation Details:
// - All settings are stored with the prefix 'floating_panel_' followed by hostname
// - Settings are loaded asynchronously via chrome.runtime.sendMessage
// - The panel uses a debounce mechanism (150ms) to avoid excessive storage writes
// - Each website has its own panel settings (position, size, visibility)
// - Profile switching refreshes the buttons shown in the panel
//
// Dependencies:
// - floating-panel.js: Provides the namespace and shared properties
// - floating-panel-ui-creation.js: Provides UI creation methods
// - floating-panel-ui-interaction.js: Provides UI interaction methods
// - config.js (Service Worker): Handles persistent storage operations

'use strict';


/**
 * Debounced version of savePanelSettings.
 * Waits 150ms after the last call before actually saving.
 */
window.MaxExtensionFloatingPanel.debouncedSavePanelSettings = function () {
    if (this.savePositionTimer) {
        clearTimeout(this.savePositionTimer);
    }
    this.savePositionTimer = setTimeout(() => {
        this.savePanelSettings();
        this.savePositionTimer = null;
    }, 150);
};

/**
 * Loads panel settings from Chrome's storage via the config service worker.
 * If no settings are found, default settings are used.
 */
window.MaxExtensionFloatingPanel.loadPanelSettings = function () {
    try {
        // Initialize with default settings immediately to avoid null references.
        this.currentPanelSettings = { ...this.defaultPanelSettings };
        const hostname = window.location.hostname;

        // Request settings from the service worker.
        chrome.runtime.sendMessage({
            type: 'getFloatingPanelSettings',
            hostname: hostname
        }, (response) => {
            if (chrome.runtime.lastError) {
                logConCgp('[floating-panel] Error loading panel settings:', chrome.runtime.lastError.message);
                this.currentPanelSettings = { ...this.defaultPanelSettings };
                return;
            }

            if (response && response.settings) {
                this.currentPanelSettings = response.settings;
                logConCgp('[floating-panel] Loaded panel settings for ' + hostname);
            } else {
                logConCgp('[floating-panel] Using default panel settings for ' + hostname);
            }

            // Apply settings to panel if it exists.
            if (this.panelElement) {
                this.updatePanelFromSettings();
            }

            // Initial panel state restoration is now handled by init.js (the Director).
        });
    } catch (error) {
        logConCgp('[floating-panel] Error loading panel settings: ' + error.message);
        this.currentPanelSettings = { ...this.defaultPanelSettings };
    }
};

/**
 * Saves panel settings to Chrome's storage via the config service worker.
 * Returns a Promise that resolves on success and rejects on failure.
 */
window.MaxExtensionFloatingPanel.savePanelSettings = function () {
    return new Promise((resolve, reject) => {
        try {
            const hostname = window.location.hostname;
            chrome.runtime.sendMessage({
                type: 'saveFloatingPanelSettings',
                hostname: hostname,
                settings: this.currentPanelSettings
            }, (response) => {
                if (chrome.runtime.lastError) {
                    const errorMsg = `Failed to save panel settings: ${chrome.runtime.lastError.message}`;
                    logConCgp(`[floating-panel] ${errorMsg}`);
                    reject(new Error(errorMsg));
                } else if (response && response.success) {
                    logConCgp('[floating-panel] Saved panel settings for ' + hostname);
                    resolve();
                } else {
                    const errorMsg = `Save failed with response: ${JSON.stringify(response)}`;
                    logConCgp(`[floating-panel] ${errorMsg}`);
                    reject(new Error(errorMsg));
                }
            });
        } catch (error) {
            const errorMsg = `Error saving panel settings: ${error.message}`;
            logConCgp(`[floating-panel] ${errorMsg}`);
            reject(error);
        }
    });
};

/**
 * Loads global (non-profile) settings from the service worker.
 */
window.MaxExtensionFloatingPanel.loadGlobalSettings = function () {
    chrome.runtime.sendMessage({ type: 'getGlobalSettings' }, (response) => {
        if (chrome.runtime.lastError) {
            logConCgp('[floating-panel] Error loading global settings:', chrome.runtime.lastError.message);
            return;
        }
        if (response && response.settings) {
            window.MaxExtensionGlobalSettings = response.settings;
            logConCgp('[floating-panel] Loaded global settings:', response.settings);
        }
    });
};

/**
 * Saves global (non-profile) settings via the service worker.
 */
window.MaxExtensionFloatingPanel.saveGlobalSettings = function () {
    chrome.runtime.sendMessage({
        type: 'saveGlobalSettings',
        settings: window.MaxExtensionGlobalSettings
    }, (response) => {
        if (chrome.runtime.lastError) {
            logConCgp('[floating-panel] Failed to save global settings:', chrome.runtime.lastError.message);
        } else if (response && response.success) {
            logConCgp('[floating-panel] Global settings saved successfully.');
        }
    });
};


/**
 * Saves the current global config to storage for the active profile.
 */
window.MaxExtensionFloatingPanel.saveCurrentProfileConfig = function () {
    if (!this.currentProfileName || !window.globalMaxExtensionConfig) {
        logConCgp('[floating-panel] Cannot save profile: profile name or config not available.');
        return;
    }
    chrome.runtime.sendMessage({
        type: 'saveConfig',
        profileName: this.currentProfileName,
        config: window.globalMaxExtensionConfig
    }, (response) => {
        if (chrome.runtime.lastError) {
            logConCgp('[floating-panel] Failed to save current profile config:', chrome.runtime.lastError.message);
        } else if (response && response.success) {
            logConCgp('[floating-panel] Current profile config saved successfully.');
        } else {
            logConCgp('[floating-panel] Failed to save current profile config. Response:', response);
        }
    });
};

/**
 * Loads available profiles from the service worker.
 */
window.MaxExtensionFloatingPanel.loadAvailableProfiles = function () {
    chrome.runtime.sendMessage(
        { type: 'listProfiles' },
        (response) => {
            if (response && response.profiles && Array.isArray(response.profiles)) {
                this.availableProfiles = response.profiles;
                logConCgp('[floating-panel] Available profiles loaded:', this.availableProfiles);
                // After loading profiles, get the current profile.
                this.getCurrentProfile();
            }
        }
    );
};

/**
 * Gets the current active profile from the service worker.
 */
window.MaxExtensionFloatingPanel.getCurrentProfile = function () {
    chrome.runtime.sendMessage(
        { type: 'getConfig' },
        (response) => {
            if (response && response.config) {
                // Retrieve current profile name from storage.
                chrome.storage.local.get(['currentProfile'], (result) => {
                    if (result.currentProfile) {
                        this.currentProfileName = result.currentProfile;
                        logConCgp('[floating-panel] Current profile:', this.currentProfileName);
                        // Update the profile switcher UI.
                        this.createProfileSwitcher();
                    }
                });
            }
        }
    );
};

/**
 * Handles switching to a different profile. Unlike standard buttons, Panel is capable of immediately changing buttons on profile change. 
 */
window.MaxExtensionFloatingPanel.switchToProfile = function (profileName) {
    // Prevent switching to the same profile.
    if (profileName === this.currentProfileName) return;
    chrome.runtime.sendMessage(
        { type: 'switchProfile', profileName: profileName },
        (response) => {
            if (response.error) {
                console.error(`[floating-panel] Error switching to profile ${profileName}:`, response.error);
                return;
            }
            if (response.config) {
                // The service worker broadcasts the change to other tabs. For this tab,
                // we update the UI directly for immediate and reliable feedback.
                this.currentProfileName = profileName; // Update internal state
                window.globalMaxExtensionConfig = response.config; // Update global config
                window.MaxExtensionButtonsInit.updateButtonsForProfileChange(); // Trigger UI refresh
                logConCgp(`[floating-panel] Successfully switched to profile: ${profileName}`);
            }
        }
    );
};

/**
 * Initializes the floating panel functionality.
 * It now uses .then() to handle the asynchronous creation of the panel from the HTML template.
 */
window.MaxExtensionFloatingPanel.initialize = function () {
    this.currentPanelSettings = { ...this.defaultPanelSettings };
    this.loadGlobalSettings(); // Load global settings like TOS acceptance

    // If panel was already created by the director (init.js), this will do nothing.
    // Otherwise, this will create the panel if the user toggles it on later.
    this.createFloatingPanel().then(() => {
        if (this.panelElement) {
            // Load saved settings (which will apply them).
            this.loadPanelSettings();
            // Load available profiles (which will populate the switcher).
            this.loadAvailableProfiles();
        }
    });

    logConCgp('[floating-panel] Floating panel initialization process started.');
};