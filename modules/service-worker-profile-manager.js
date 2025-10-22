// modules/service-worker-profile-manager.js
/*
Profile management module for service worker.
Handles all profile CRUD operations, broadcasting, and normalization.
Extracted from config.js to improve maintainability.
*/
'use strict';

import { logConfigurationRelatedStuff, handleStorageError, loadDefaultConfig } from './service-worker-config-helpers.js';

// Function to normalize profile configuration with default values
function normalizeProfileConfig(profile, profileName) {
    // Ensure the profile has a 'customButtons' property
    if (!profile.customButtons) {
        profile.customButtons = [];
        logConfigurationRelatedStuff(`Initialized missing 'customButtons' for profile: ${profileName}`);
    }
    // Ensure queue settings exist for backward compatibility
    if (typeof profile.queueDelayMinutes === 'undefined') {
        profile.queueDelayMinutes = 5; // Default delay in minutes
        logConfigurationRelatedStuff(`Initialized missing 'queueDelayMinutes' for profile: ${profileName}`);
    }
    if (typeof profile.queueDelaySeconds === 'undefined') {
        profile.queueDelaySeconds = 300; // Default delay in seconds
        logConfigurationRelatedStuff(`Initialized missing 'queueDelaySeconds' for profile: ${profileName}`);
    }
    if (typeof profile.queueDelayUnit === 'undefined') {
        profile.queueDelayUnit = 'min'; // Default unit is minutes
        logConfigurationRelatedStuff(`Initialized missing 'queueDelayUnit' for profile: ${profileName}`);
    }
    if (typeof profile.enableQueueMode === 'undefined') {
        profile.enableQueueMode = false;
        logConfigurationRelatedStuff(`Initialized missing 'enableQueueMode' for profile: ${profileName}`);
    }
    if (typeof profile.queueRandomizeEnabled === 'undefined') {
        profile.queueRandomizeEnabled = false;
        logConfigurationRelatedStuff(`Initialized missing 'queueRandomizeEnabled' for profile: ${profileName}`);
    }
    if (typeof profile.queueRandomizePercent === 'undefined') {
        profile.queueRandomizePercent = 5;
        logConfigurationRelatedStuff(`Initialized missing 'queueRandomizePercent' for profile: ${profileName}`);
    }
    if (typeof profile.queueHideActivationToggle === 'undefined') {
        profile.queueHideActivationToggle = false;
        logConfigurationRelatedStuff(`Initialized missing 'queueHideActivationToggle' for profile: ${profileName}`);
    }
    return profile;
}

// Function to compare profile configurations
export function areProfileConfigsEqual(existingConfig, newConfig) {
    try {
        return JSON.stringify(existingConfig) === JSON.stringify(newConfig);
    } catch (error) {
        handleStorageError(error);
        return false;
    }
}

// Function to create default profile
export async function createDefaultProfile() {
    logConfigurationRelatedStuff('Creating default profile');
    try {
        const defaultConfig = await loadDefaultConfig(); // Load from JSON
        await chrome.storage.local.set({
            'currentProfile': 'Default',
            'profiles.Default': defaultConfig
        });
        logConfigurationRelatedStuff('Default profile created successfully');
        return defaultConfig;
    } catch (error) {
        handleStorageError(error);
        throw new Error('Failed to create default profile.');
    }
}

// Function to load profile configuration
export async function loadProfileConfig(profileName) {
    logConfigurationRelatedStuff(`Loading profile: ${profileName}`);
    try {
        const result = await chrome.storage.local.get([`profiles.${profileName}`]);
        const profile = result[`profiles.${profileName}`];

        if (profile) {
            logConfigurationRelatedStuff(`Profile ${profileName} loaded successfully`);
            return profile;
        } else {
            logConfigurationRelatedStuff(`Profile ${profileName} not found`);
            return null;
        }
    } catch (error) {
        handleStorageError(error);
        return null;
    }
}

// Function to broadcast profile change to all tabs
export async function broadcastProfileChange(profileName, profileData, excludeTabId, origin = null) {
    try {
        const tabs = await chrome.tabs.query({});
        tabs.forEach(tab => {
            if (excludeTabId && tab.id === excludeTabId) return;
            // Send broadly; content scripts will ignore if not present. Errors are expected on non‑matched tabs.
            chrome.tabs.sendMessage(tab.id, {
                type: 'profileChanged',
                profileName: profileName,
                config: profileData,
                origin: origin
            }).catch(error => {
                // Suppress errors when content script is not running on a tab
                logConfigurationRelatedStuff(`Could not send message to tab ${tab.id}: ${error.message}`);
            });
        });
        logConfigurationRelatedStuff(`Broadcasted profile change (${profileName}) to all tabs`);
    } catch (error) {
        handleStorageError(error);
        logConfigurationRelatedStuff(`Error broadcasting profile change: ${error.message}`);
    }
}

// Function to save profile configuration
export async function saveProfileConfig(profileName, config) {
    logConfigurationRelatedStuff(`Saving profile: ${profileName}`);
    try {
        const snapshot = await chrome.storage.local.get([`profiles.${profileName}`, 'currentProfile']);
        const existingConfig = snapshot[`profiles.${profileName}`];
        const wasActiveProfile = snapshot.currentProfile ? snapshot.currentProfile === profileName : true;

        await chrome.storage.local.set({
            'currentProfile': profileName,
            [`profiles.${profileName}`]: config
        });
        logConfigurationRelatedStuff(`Profile ${profileName} saved successfully`);

        const configChanged = !areProfileConfigsEqual(existingConfig, config);
        if (configChanged && wasActiveProfile) {
            logConfigurationRelatedStuff(`Detected changes for active profile ${profileName}; broadcasting updates.`);
            await broadcastProfileChange(profileName, config, null, 'inline');
            await broadcastProfileChange(profileName, config, null, 'panel');
        }

        return true;
    } catch (error) {
        handleStorageError(error);
        return false;
    }
}

// Function to switch to a different profile
export async function switchProfile(profileName, excludeTabId, origin = null) {
    logConfigurationRelatedStuff(`Switching to profile: ${profileName}`);
    try {
        const profile = await loadProfileConfig(profileName);
        if (profile) {
            await chrome.storage.local.set({ 'currentProfile': profileName });
            logConfigurationRelatedStuff(`Switched to profile: ${profileName}`);

            // Broadcast profile change to all tabs except the initiator (if provided).
            // Include origin so content scripts can limit their refresh scope.
            broadcastProfileChange(profileName, profile, excludeTabId, origin);

            return profile;
        } else {
            logConfigurationRelatedStuff(`Failed to switch to profile: ${profileName}`);
            return null;
        }
    } catch (error) {
        handleStorageError(error);
        return null;
    }
}

// Function to get currently active profile
export async function getCurrentProfileConfig() {
    logConfigurationRelatedStuff('Retrieving current profile from storage');
    try {
        const result = await chrome.storage.local.get(['currentProfile']);
        const profileName = result.currentProfile;

        if (profileName) {
            logConfigurationRelatedStuff(`Current profile found: ${profileName}`);
            let profile = await loadProfileConfig(profileName);
            if (profile) {
                return normalizeProfileConfig(profile, profileName);
            }
        }

        logConfigurationRelatedStuff('No valid current profile found. Creating default profile');
        const defaultProfile = await createDefaultProfile();
        return normalizeProfileConfig(defaultProfile, 'Default');
    } catch (error) {
        handleStorageError(error);
        throw new Error('Unable to retrieve current profile configuration.');
    }
}

// Function to list all available profiles
export async function listProfiles() {
    try {
        const storage = await chrome.storage.local.get(null);
        const profiles = Object.keys(storage)
            .filter(key => key.startsWith('profiles.'))
            .map(key => key.replace('profiles.', ''));

        logConfigurationRelatedStuff('Available profiles:', profiles);
        return profiles;
    } catch (error) {
        handleStorageError(error);
        return ['Default'];
    }
}

// Function to delete a specific profile
export async function deleteProfile(profileName) {
    logConfigurationRelatedStuff(`Deleting profile: ${profileName}`);
    try {
        // Don't allow deleting the default profile
        if (profileName === 'Default') {
            logConfigurationRelatedStuff('Cannot delete Default profile');
            return false;
        }

        // Get current profile
        const result = await chrome.storage.local.get(['currentProfile']);

        // If we're deleting the current profile, switch to Default
        if (result.currentProfile === profileName) {
            await switchProfile('Default');
        }

        // Remove the profile from storage
        await chrome.storage.local.remove(`profiles.${profileName}`);
        logConfigurationRelatedStuff(`Profile ${profileName} deleted successfully`);
        return true;
    } catch (error) {
        handleStorageError(error);
        return false;
    }
}