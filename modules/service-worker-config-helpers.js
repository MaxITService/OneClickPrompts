// modules/service-worker-config-helpers.js
/*
Service worker utility functions for configuration management.
Extracted from config.js to improve maintainability.
*/
'use strict';

// Function to handle logging with [config] prefix
export function logConfigurationRelatedStuff(message, ...optionalParams) {
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