// config.js
// Version: 1.1
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS. This one too!
// This service worker does all Config stuff with sync storage, it handles storage exclusively, other files request data from it and don't care how it is stored.
'use strict';
// Dependencies: default-config.json

// Ensure the service worker is registered
self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// Function to handle logging with [config] prefix
function logConCgp(message, ...optionalParams) {
    console.log(`[config] ${message}`, ...optionalParams);
}

// Function to load default configuration from JSON file
async function loadDefaultConfig() {
    try {
        const response = await fetch(chrome.runtime.getURL('default-config.json'));
        if (!response.ok) {
            throw new Error(`Failed to load default-config.json: ${response.statusText}`);
        }
        const config = await response.json();
        logConCgp('Default configuration loaded from default-config.json');
        return config;
    } catch (error) {
        handleStorageError(error);
        // Since we are removing hardcoded defaultConfig, do not provide a fallback
        throw new Error('Unable to load default configuration.');
    }
}

// Helper function to handle storage errors
function handleStorageError(error) {
    if (error) {
        logConCgp('Storage error:', error);
        if (error.message.includes('QUOTA_BYTES_PER_ITEM')) {
            logConCgp('Storage quota exceeded. Some data may not be saved.');
        }
    }
    return error;
}

// Function to create default profile
async function createDefaultProfile() {
    logConCgp('Creating default profile');
    try {
        const defaultConfig = await loadDefaultConfig(); // Load from JSON
        await chrome.storage.sync.set({
            'currentProfile': 'Default',
            'profiles.Default': defaultConfig
        });
        logConCgp('Default profile created successfully');
        return defaultConfig;
    } catch (error) {
        handleStorageError(error);
        throw new Error('Failed to create default profile.');
    }
}

// Function to save profile configuration
async function saveProfileConfig(profileName, config) {
    logConCgp(`Saving profile: ${profileName}`);
    try {
        await chrome.storage.sync.set({
            'currentProfile': profileName,
            [`profiles.${profileName}`]: config
        });
        logConCgp(`Profile ${profileName} saved successfully`);
        return true;
    } catch (error) {
        handleStorageError(error);
        return false;
    }
}

// Function to load profile configuration
async function loadProfileConfig(profileName) {
    logConCgp(`Loading profile: ${profileName}`);
    try {
        const result = await chrome.storage.sync.get([`profiles.${profileName}`]);
        const profile = result[`profiles.${profileName}`];
        
        if (profile) {
            logConCgp(`Profile ${profileName} loaded successfully`);
            return profile;
        } else {
            logConCgp(`Profile ${profileName} not found`);
            return null;
        }
    } catch (error) {
        handleStorageError(error);
        return null;
    }
}

// Function to switch to a different profile
async function switchProfile(profileName) {
    logConCgp(`Switching to profile: ${profileName}`);
    try {
        const profile = await loadProfileConfig(profileName);
        if (profile) {
            await chrome.storage.sync.set({ 'currentProfile': profileName });
            logConCgp(`Switched to profile: ${profileName}`);
            return profile;
        } else {
            logConCgp(`Failed to switch to profile: ${profileName}`);
            return null;
        }
    } catch (error) {
        handleStorageError(error);
        return null;
    }
}

// Function to get currently active profile
async function getCurrentProfileConfig() {
    logConCgp('Retrieving current profile from storage');
    try {
        const result = await chrome.storage.sync.get(['currentProfile']);
        const currentProfile = result.currentProfile;

        if (currentProfile) {
            logConCgp(`Current profile found: ${currentProfile}`);
            const profile = await loadProfileConfig(currentProfile);
            if (profile) {
                return profile;
            }
        }

        logConCgp('No current profile found. Creating default profile');
        return await createDefaultProfile();
    } catch (error) {
        handleStorageError(error);
        throw new Error('Unable to retrieve current profile configuration.');
    }
}

// Function to list all available profiles
async function listProfiles() {
    try {
        const storage = await chrome.storage.sync.get(null);
        const profiles = Object.keys(storage)
            .filter(key => key.startsWith('profiles.'))
            .map(key => key.replace('profiles.', ''));
        
        logConCgp('Available profiles:', profiles);
        return profiles;
    } catch (error) {
        handleStorageError(error);
        return ['Default'];
    }
}

// Function to clear all storage
async function clearStorage() {
    try {
        await chrome.storage.sync.clear();
        logConCgp('Storage cleared successfully');
        return true;
    } catch (error) {
        handleStorageError(error);
        return false;
    }
}

// Function to delete a specific profile
async function deleteProfile(profileName) {
    logConCgp(`Deleting profile: ${profileName}`);
    try {
        // Don't allow deleting the default profile
        if (profileName === 'Default') {
            logConCgp('Cannot delete Default profile');
            return false;
        }

        // Get current profile
        const result = await chrome.storage.sync.get(['currentProfile']);
        
        // If we're deleting the current profile, switch to Default
        if (result.currentProfile === profileName) {
            await switchProfile('Default');
        }

        // Remove the profile from storage
        await chrome.storage.sync.remove(`profiles.${profileName}`);
        logConCgp(`Profile ${profileName} deleted successfully`);
        return true;
    } catch (error) {
        handleStorageError(error);
        return false;
    }
}

// Message handler for extension communication
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.type) {
        case 'getConfig':
            getCurrentProfileConfig().then(config => {
                sendResponse({ config });
                logConCgp('Sent config to requesting script');
            }).catch(error => {
                sendResponse({ error: error.message });
            });
            return true;

        case 'saveConfig':
            saveProfileConfig(request.profileName, request.config).then(success => {
                sendResponse({ success });
                logConCgp('Config save request processed');
            });
            return true;

        case 'switchProfile':
            switchProfile(request.profileName).then(config => {
                sendResponse({ config });
                logConCgp('Profile switch request processed');
            });
            return true;

        case 'listProfiles':
            listProfiles().then(profiles => {
                sendResponse({ profiles });
                logConCgp('Profile list request processed');
            });
            return true;

        case 'clearStorage':
            clearStorage().then(success => {
                sendResponse({ success });
                logConCgp('Storage clear request processed');
            });
            return true;

        case 'deleteProfile':
            deleteProfile(request.profileName).then(success => {
                sendResponse({ success });
                logConCgp('Profile deletion request processed');
            });
            return true;

        case 'createDefaultProfile':
            createDefaultProfile().then(config => {
                sendResponse({ config });
                logConCgp('Default profile creation request processed');
            }).catch(error => {
                sendResponse({ error: error.message });
            });
            return true;

        default:
            logConCgp('Unknown message type received:', request.type);
            sendResponse({ error: 'Unknown message type' });
            return false;
    }
});

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
        for (let [key, { oldValue, newValue }] of Object.entries(changes)) {
            logConCgp(`Storage key "${key}" changed:`, {
                'from': oldValue,
                'to': newValue
            });
        }
    }
});
