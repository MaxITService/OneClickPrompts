// floating-panel-settings.js
// Version: 1.0
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
// - initialize(): Sets up the floating panel (creates UI and loads settings)
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
// - floating-panel-ui.js: Provides UI update methods
// - config.js (Service Worker): Handles persistent storage operations

'use strict';


/**
 * Debounced version of savePanelSettings.
 * Waits 150ms after the last call before actually saving.
 */
window.MaxExtensionFloatingPanel.debouncedSavePanelSettings = function() {
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
window.MaxExtensionFloatingPanel.loadPanelSettings = function() {
    try {
        // Initialize with default settings immediately to avoid null references.
        this.currentPanelSettings = { ...this.defaultPanelSettings };
        const hostname = window.location.hostname;
        
        // Request settings from the service worker.
        chrome.runtime.sendMessage({
            type: 'getFloatingPanelSettings',
            hostname: hostname
        }, (response) => {
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
            
            // Restore panel visibility state after settings are loaded.
            this.restorePanelState();
        });
    } catch (error) {
        logConCgp('[floating-panel] Error loading panel settings: ' + error.message);
        this.currentPanelSettings = { ...this.defaultPanelSettings };
    }
};

/**
 * Saves panel settings to Chrome's storage via the config service worker.
 */
window.MaxExtensionFloatingPanel.savePanelSettings = function() {
    try {
        const hostname = window.location.hostname;
        chrome.runtime.sendMessage({
            type: 'saveFloatingPanelSettings',
            hostname: hostname,
            settings: this.currentPanelSettings
        }, (response) => {
            if (response && response.success) {
                logConCgp('[floating-panel] Saved panel settings for ' + hostname);
            } else {
                logConCgp('[floating-panel] Failed to save panel settings for ' + hostname);
            }
        });
    } catch (error) {
        logConCgp('[floating-panel] Error saving panel settings: ' + error.message);
    }
};

/**
 * Loads available profiles from the service worker.
 */
window.MaxExtensionFloatingPanel.loadAvailableProfiles = function() {
    chrome.runtime.sendMessage(
        { type: 'listProfiles' },
        (response) => {
            if (response.profiles && Array.isArray(response.profiles)) {
                this.availableProfiles = response.profiles;
                console.log('[floating-panel] Available profiles loaded:', this.availableProfiles);
                // After loading profiles, get the current profile.
                this.getCurrentProfile();
            }
        }
    );
};

/**
 * Gets the current active profile from the service worker.
 */
window.MaxExtensionFloatingPanel.getCurrentProfile = function() {
    chrome.runtime.sendMessage(
        { type: 'getConfig' },
        (response) => {
            if (response.config) {
                // Retrieve current profile name from storage.
                chrome.storage.local.get(['currentProfile'], (result) => {
                    if (result.currentProfile) {
                        this.currentProfileName = result.currentProfile;
                        console.log('[floating-panel] Current profile:', this.currentProfileName);
                        // Update the profile switcher UI.
                        this.createProfileSwitcher();
                    }
                });
            }
        }
    );
};

/**
 * Handles switching to a different profile.
 */
window.MaxExtensionFloatingPanel.switchToProfile = function(profileName) {
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
                // Update the current profile name and global config.
                this.currentProfileName = profileName;
                window.globalMaxExtensionConfig = response.config;
                // Refresh buttons in the panel.
                this.refreshButtonsInPanel();
                console.log(`[floating-panel] Successfully switched to profile: ${profileName}`);
            }
        }
    );
};

/**
 * Initializes the floating panel functionality.
 * (This method calls both UI creation and settings loading.)
 */
window.MaxExtensionFloatingPanel.initialize = function() {
    // Set default panel settings.
    this.currentPanelSettings = { ...this.defaultPanelSettings };
    // Create the floating panel (UI).
    this.createFloatingPanel();
    // Load saved settings.
    this.loadPanelSettings();
    // Load available profiles.
    this.loadAvailableProfiles();
    logConCgp('[floating-panel] Floating panel initialized.');
};
