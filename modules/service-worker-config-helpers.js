// modules/service-worker-config-helpers.js
/*
Service worker utility functions for configuration management.
Extracted from config.js to improve maintainability.
*/
'use strict';

let serviceWorkerLogGateInitialized = false;
let browserConsoleLogsDisabled = false;

async function refreshServiceWorkerConsoleLogPreference() {
    try {
        const current = await chrome.storage.local.get(['currentProfile']);
        const profileName = current.currentProfile || 'Default';
        const profileKey = `profiles.${profileName}`;
        const storedProfile = await chrome.storage.local.get([profileKey]);
        browserConsoleLogsDisabled = !!storedProfile[profileKey]?.disableBrowserConsoleLogs;
    } catch (_) {
        browserConsoleLogsDisabled = false;
    }
}

export function serviceWorkerConsoleLogsAreDisabled() {
    return browserConsoleLogsDisabled;
}

export function initializeServiceWorkerConsoleLogPreference() {
    if (serviceWorkerLogGateInitialized || typeof chrome === 'undefined' || !chrome.storage?.local) {
        return;
    }
    serviceWorkerLogGateInitialized = true;
    refreshServiceWorkerConsoleLogPreference();
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'local') {
            return;
        }
        if (changes.currentProfile || Object.keys(changes).some(key => key.startsWith('profiles.'))) {
            refreshServiceWorkerConsoleLogPreference();
        }
    });
}

// Function to handle logging with [config] prefix
export function logConfigurationRelatedStuff(message, ...optionalParams) {
    if (browserConsoleLogsDisabled) {
        return;
    }
    console.log(`[config] ${message}`, ...optionalParams);
}

// Helper function to handle storage errors
export function handleStorageError(error) {
    if (error) {
        logConfigurationRelatedStuff('Storage error:', error);
        if (error.message.includes('QUOTA_BYTES')) {
            logConfigurationRelatedStuff('Storage quota exceeded. Some data may not be saved.');
        }
    }
    return error;
}

// Function to load default configuration from JSON file
export async function loadDefaultConfig() {
    try {
        const response = await fetch(chrome.runtime.getURL('default-config.json'));
        if (!response.ok) {
            throw new Error(`Failed to load default-config.json: ${response.statusText}`);
        }
        const config = await response.json();
        logConfigurationRelatedStuff('Default configuration loaded from default-config.json');
        return config;
    } catch (error) {
        handleStorageError(error);
        // Since we are removing hardcoded defaultConfig, do not provide a fallback
        throw new Error('Unable to load default configuration.');
    }
}
