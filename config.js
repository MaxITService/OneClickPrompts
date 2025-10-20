// config.js
/*
Version: 1.1
Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS. This one too!

Service worker responsibilities (current):
- Single entry point for extension messaging (onMessage) and lifecycle (install/activate).
- Owns profile storage and related handlers (getConfig/saveConfig/switchProfile/etc.).
- Delegates non‑profile storage (theme, custom selectors, floating panel, cross‑chat) to modules/service-worker-auxiliary-state-store.js.
- Opens the welcome page on fresh install.
*/
'use strict';
// when you right click on extension icon in broser
import './context-menu.js';
// Save mechanism for UI popup state, ALL modules, floating panel settings, custom selectors.
import { StateStore } from './modules/service-worker-auxiliary-state-store.js'; 

// Ensure the service worker is registered
self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

// Migration helper functions
async function checkMigrationStatus() {
    const result = await chrome.storage.local.get(['migrationComplete']);
    return result.migrationComplete === true;
}

async function setMigrationComplete() {
    await chrome.storage.local.set({ migrationComplete: true });
    logConfigurationRelatedStuff('Migration marked as complete');
}

async function migrateSyncToLocal() {
    try {
        // Check if migration already completed
        if (await checkMigrationStatus()) {
            logConfigurationRelatedStuff('Migration already completed');
            return true;
        }

        // Get all data from sync storage
        const syncData = await chrome.storage.sync.get(null);
        if (Object.keys(syncData).length === 0) {
            logConfigurationRelatedStuff('No sync data to migrate');
            await setMigrationComplete();
            return true;
        }

        // Copy to local storage
        await chrome.storage.local.set(syncData);

        // Verify migration
        const localData = await chrome.storage.local.get(null);
        const verified = JSON.stringify(syncData) === JSON.stringify(localData);

        if (verified) {
            // Clear sync storage after successful migration
            await chrome.storage.sync.clear();
            await setMigrationComplete();
            logConfigurationRelatedStuff('Migration completed successfully');
            return true;
        } else {
            throw new Error('Migration verification failed');
        }
    } catch (error) {
        handleStorageError(error);
        logConfigurationRelatedStuff('Migration failed:', error);
        return false;
    }
}

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            await self.clients.claim();
            // Verify migration status but don't force migration
            if (!await checkMigrationStatus()) {
                logConfigurationRelatedStuff('Existing migration process not triggered');
            }
        })()
    );
});

// Function to handle logging with [config] prefix
function logConfigurationRelatedStuff(message, ...optionalParams) {
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
        logConfigurationRelatedStuff('Default configuration loaded from default-config.json');
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
        logConfigurationRelatedStuff('Storage error:', error);
        if (error.message.includes('QUOTA_BYTES')) {
            logConfigurationRelatedStuff('Storage quota exceeded. Some data may not be saved.');
        }
    }
    return error;
}

// Function to create default profile
async function createDefaultProfile() {
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

function areProfileConfigsEqual(existingConfig, newConfig) {
    try {
        return JSON.stringify(existingConfig) === JSON.stringify(newConfig);
    } catch (error) {
        handleStorageError(error);
        return false;
    }
}

// Function to save profile configuration
async function saveProfileConfig(profileName, config) {
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

// Function to load profile configuration
async function loadProfileConfig(profileName) {
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

// Function to switch to a different profile
async function switchProfile(profileName, excludeTabId, origin = null) {
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

// Function to broadcast profile change to all tabs
async function broadcastProfileChange(profileName, profileData, excludeTabId, origin = null) {
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

// Function to get currently active profile
async function getCurrentProfileConfig() {
    logConfigurationRelatedStuff('Retrieving current profile from storage');
    try {
        const result = await chrome.storage.local.get(['currentProfile']);
        const profileName = result.currentProfile;

        if (profileName) {
            logConfigurationRelatedStuff(`Current profile found: ${profileName}`);
            let profile = await loadProfileConfig(profileName);
            if (profile) {
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
        }

        logConfigurationRelatedStuff('No valid current profile found. Creating default profile');
        const defaultProfile = await createDefaultProfile();
        // Ensure the default profile includes 'customButtons'
        if (!defaultProfile.customButtons) {
            defaultProfile.customButtons = [];
            logConfigurationRelatedStuff("Initialized missing 'customButtons' for default profile");
        }
        if (typeof defaultProfile.queueDelayMinutes === 'undefined') {
            defaultProfile.queueDelayMinutes = 5;
            logConfigurationRelatedStuff("Initialized missing 'queueDelayMinutes' for default profile");
        }
        if (typeof defaultProfile.queueDelaySeconds === 'undefined') {
            defaultProfile.queueDelaySeconds = 300;
            logConfigurationRelatedStuff("Initialized missing 'queueDelaySeconds' for default profile");
        }
        if (typeof defaultProfile.queueDelayUnit === 'undefined') {
            defaultProfile.queueDelayUnit = 'min';
            logConfigurationRelatedStuff("Initialized missing 'queueDelayUnit' for default profile");
        }
        if (typeof defaultProfile.enableQueueMode === 'undefined') {
            defaultProfile.enableQueueMode = false;
            logConfigurationRelatedStuff("Initialized missing 'enableQueueMode' for default profile");
        }
        if (typeof defaultProfile.queueRandomizeEnabled === 'undefined') {
            defaultProfile.queueRandomizeEnabled = false;
            logConfigurationRelatedStuff("Initialized missing 'queueRandomizeEnabled' for default profile");
        }
        if (typeof defaultProfile.queueRandomizePercent === 'undefined') {
            defaultProfile.queueRandomizePercent = 5;
            logConfigurationRelatedStuff("Initialized missing 'queueRandomizePercent' for default profile");
        }
        if (typeof defaultProfile.queueHideActivationToggle === 'undefined') {
            defaultProfile.queueHideActivationToggle = false;
            logConfigurationRelatedStuff("Initialized missing 'queueHideActivationToggle' for default profile");
        }
        return defaultProfile;
    } catch (error) {
        handleStorageError(error);
        throw new Error('Unable to retrieve current profile configuration.');
    }
}


// Function to list all available profiles
async function listProfiles() {
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

// Function to clear all storage
async function clearStorage() {
    try {
        await chrome.storage.local.clear();
        logConfigurationRelatedStuff('Storage cleared successfully');
        return true;
    } catch (error) {
        handleStorageError(error);
        return false;
    }
}

// Function to delete a specific profile
async function deleteProfile(profileName) {
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

// Message handler for extension communication
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.type) {
        case 'getConfig':
            getCurrentProfileConfig().then(config => {
                sendResponse({ config });
                logConfigurationRelatedStuff('Sent config to requesting script');
            }).catch(error => {
                sendResponse({ error: error.message });
            });
            return true;
        case 'saveConfig':
            saveProfileConfig(request.profileName, request.config).then(success => {
                sendResponse({ success });
                logConfigurationRelatedStuff('Config save request processed');
            });
            return true;
        case 'switchProfile':
            // Identify the sender tab (if any) to avoid echoing a broadcast back immediately.
            switchProfile(request.profileName, sender?.tab?.id, request.origin).then(config => {
                // Echo the origin back to the initiator for clarity.
                sendResponse({ config, origin: request.origin || null });
                logConfigurationRelatedStuff('Profile switch request processed');
            });
            return true;
        case 'listProfiles':
            listProfiles().then(profiles => {
                sendResponse({ profiles });
                logConfigurationRelatedStuff('Profile list request processed');
            });
            return true;
        case 'clearStorage':
            clearStorage().then(success => {
                sendResponse({ success });
                logConfigurationRelatedStuff('Storage clear request processed');
            });
            return true;
        case 'deleteProfile':
            deleteProfile(request.profileName).then(success => {
                sendResponse({ success });
                logConfigurationRelatedStuff('Profile deletion request processed');
            });
            return true;
        case 'createDefaultProfile':
            createDefaultProfile().then(config => {
                sendResponse({ config });
                logConfigurationRelatedStuff('Default profile creation request processed');
            }).catch(error => {
                sendResponse({ error: error.message });
            });
            return true;
        // ----- Global Settings Cases -----
        case 'getGlobalSettings':
            (async () => {
                try {
                    const result = await chrome.storage.local.get(['globalSettings']);
                    const settings = result.globalSettings || { acceptedQueueTOS: false };
                    // Ensure the setting exists with a default value
                    if (typeof settings.acceptedQueueTOS === 'undefined') {
                        settings.acceptedQueueTOS = false;
                    }
                    logConfigurationRelatedStuff('Retrieved global settings:', settings);
                    sendResponse({ settings });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ error: error.message, settings: { acceptedQueueTOS: false } });
                }
            })();
            return true;
        case 'saveGlobalSettings':
            (async () => {
                try {
                    await chrome.storage.local.set({ globalSettings: request.settings });
                    logConfigurationRelatedStuff('Saved global settings:', request.settings);
                    sendResponse({ success: true });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ error: error.message });
                }
            })();
            return true;
        // ----- Dark Theme Saving -----
        case 'getTheme':
            (async () => {
                try {
                    const theme = await StateStore.getUiTheme(); // 'light' | 'dark'
                    // Minimal check: was ui.theme ever set? (without changing StateStore)
                    let initialized = false;
                    try {
                        const raw = await chrome.storage.local.get(['ui.theme']);
                        initialized = Object.prototype.hasOwnProperty.call(raw, 'ui.theme');
                    } catch {}
                    logConfigurationRelatedStuff(`Retrieved theme preference: ${theme} (initialized=${initialized})`);
                    // Return both a canonical string and a legacy boolean, plus init flag
                    sendResponse({ theme, darkTheme: theme === 'dark', initialized });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ error: error.message });
                }
            })();
            return true;
        case 'setTheme':
            (async () => {
                try {
                    
                    let incoming = request.theme;
                    if (incoming !== 'light' && incoming !== 'dark') {
                        if (request.darkTheme === 'dark' || request.darkTheme === true) incoming = 'dark';
                        else incoming = 'light';
                    }
                    await StateStore.setUiTheme(incoming);
                    logConfigurationRelatedStuff('Set theme preference to: ' + incoming);
                    sendResponse({ success: true });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ error: error.message });
                }
            })();
            return true;
        // ----- Custom Selectors Cases -----
        case 'getCustomSelectors':
            (async () => {
                try {
                    const selectors = await StateStore.getCustomSelectors(request.site);
                       if (selectors) {
                           logConfigurationRelatedStuff('Retrieved custom selectors for: ' + request.site);
                       } else {                          
                           logConfigurationRelatedStuff('No custom selectors found for: ' + request.site +
                               '. Using default selectors defined in utils.js.');
                       }
                    sendResponse({ selectors: selectors || null });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ error: error.message });
                }
            })();
            return true;
        case 'saveCustomSelectors':
            (async () => {
                try {
                    await StateStore.saveCustomSelectors(request.site, request.selectors);
                    logConfigurationRelatedStuff((request.selectors ? 'Saved' : 'Removed') + ' custom selectors for: ' + request.site);
                    sendResponse({ success: true });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ error: error.message });
                }
            })();
            return true;
        case 'resetAdvancedSelectors':
            (async () => {
                try {
                    const count = await StateStore.resetAdvancedSelectors(request.site);
                    sendResponse({ success: true, count });
                    logConfigurationRelatedStuff('Reset advanced selectors');
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ error: error.message });
                }
            })();
            return true;
        // ----- End Custom Selectors Cases -----

        // ----- Floating Panel Settings Cases -----
        case 'getFloatingPanelSettings':
            (async () => {
                if (!request.hostname) {
                    sendResponse({ error: 'Hostname is required' });
                    return;
                }
                try {
                    const settings = await StateStore.getFloatingPanelSettings(request.hostname);
                    if (settings) {
                        logConfigurationRelatedStuff(`Retrieved floating panel settings for ${request.hostname}`);
                        sendResponse({ settings });
                    } else {
                        logConfigurationRelatedStuff(`No saved floating panel settings for ${request.hostname}`);
                        sendResponse({ settings: null });
                    }
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ error: error.message });
                }
            })();
            return true;

        case 'saveFloatingPanelSettings':
            (async () => {
                if (!request.hostname || !request.settings) {
                    sendResponse({ error: 'Hostname and settings are required' });
                    return;
                }
                try {
                    await StateStore.saveFloatingPanelSettings(request.hostname, request.settings);
                    logConfigurationRelatedStuff(`Saved floating panel settings for ${request.hostname}`);
                    sendResponse({ success: true });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true;

        case 'resetFloatingPanelSettings':
            (async () => {
                try {
                    const count = await StateStore.resetFloatingPanelSettings();
                    sendResponse({ success: true, count });
                    logConfigurationRelatedStuff(`Reset ${count} floating panel settings`);
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true;

        case 'getFloatingPanelHostnames':
            (async () => {
                try {
                    const hostnames = await StateStore.listFloatingPanelHostnames();
                    sendResponse({ success: true, hostnames });
                    logConfigurationRelatedStuff(`Found ${hostnames.length} hostnames with floating panel settings.`);
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true;

        case 'resetFloatingPanelSettingsForHostname':
            (async () => {
                if (!request.hostname) {
                    sendResponse({ error: 'Hostname is required' });
                    return;
                }
                try {
                    await StateStore.resetFloatingPanelSettingsForHostname(request.hostname);
                    sendResponse({ success: true });
                    logConfigurationRelatedStuff(`Reset floating panel settings for ${request.hostname}`);
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true;
        // ----- End Floating Panel Settings Cases -----

        // ===== Cross-Chat Module Cases =====
        // Note to developers: These settings are global and not tied to profiles.
        case 'getCrossChatModuleSettings':
            (async () => {
                try {
                    const cc = await StateStore.getCrossChat();
                    logConfigurationRelatedStuff('Retrieved Cross-Chat module settings:', cc.settings);
                    sendResponse({ settings: cc.settings });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ error: error.message });
                }
            })();
            return true;

        case 'getCrossChatModuleDefaults':
            (async () => {
                try {
                    const cc = await StateStore.getCrossChat();
                    sendResponse({ defaults: cc.settings });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ error: error.message });
                }
            })();
            return true;

        case 'saveCrossChatModuleSettings':
            (async () => {
                try {
                    await StateStore.saveCrossChat(request.settings);
                    logConfigurationRelatedStuff('Saved Cross-Chat module settings:', request.settings);
                    sendResponse({ success: true });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ error: error.message });
                }
            })();
            return true;

        // DEVELOPER INSTRUCTION: Use this message type from the content script's "Copy Prompt" button logic.
        // The `request.promptText` should be the text captured from the chat input area.
        case 'saveStoredPrompt':
            (async () => {
                try {
                    await StateStore.saveStoredPrompt(request.promptText);
                    logConfigurationRelatedStuff('Saved cross-chat prompt.');
                    sendResponse({ success: true });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ error: error.message });
                }
            })();
            return true;

        // DEVELOPER INSTRUCTION: Use this message type to fetch the prompt for the "Paste & Send" button's
        // tooltip and its main functionality.
        case 'getStoredPrompt':
            (async () => {
                try {
                    const promptText = await StateStore.getStoredPrompt();
                    logConfigurationRelatedStuff('Retrieved cross-chat prompt.');
                    sendResponse({ promptText });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ error: error.message });
                }
            })();
            return true;

        case 'clearStoredPrompt':
            (async () => {
                try {
                    await StateStore.clearStoredPrompt();
                    logConfigurationRelatedStuff('Cleared cross-chat prompt.');
                    sendResponse({ success: true });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ error: error.message });
                }
            })();
            return true;

        case 'triggerDangerCrossChatSend':
            (async () => {
                try {
                    const promptText = typeof request.promptText === 'string' ? request.promptText : '';
                    const trimmed = promptText.trim();
                    if (!trimmed) {
                        sendResponse({ success: false, reason: 'emptyPrompt' });
                        return;
                    }

                    const crossChatState = await StateStore.getCrossChat();
                    if (!crossChatState?.settings?.dangerAutoSendAll) {
                        sendResponse({ success: false, reason: 'settingDisabled' });
                        return;
                    }

                    const originTabId = sender?.tab?.id || null;
                    const tabs = await chrome.tabs.query({});
                    let successCount = 0;
                    let failureCount = 0;
                    let skippedCount = 0;
                    const failureReasons = [];

                    await Promise.all(tabs.map(async (tab) => {
                        if (!tab.id || tab.id === originTabId) {
                            return;
                        }
                        try {
                            const response = await chrome.tabs.sendMessage(tab.id, {
                                type: 'crossChatDangerDispatchPrompt',
                                promptText: trimmed,
                            });
                            if (response?.ok) {
                                successCount++;
                            } else {
                                failureCount++;
                                if (response?.error || response?.reason) {
                                    failureReasons.push(response.error || response.reason);
                                }
                            }
                        } catch (error) {
                            const message = error?.message || '';
                            if (message.includes('Could not establish connection') || message.includes('Receiving end does not exist')) {
                                skippedCount++;
                            } else {
                                failureCount++;
                                if (message) {
                                    failureReasons.push(message);
                                }
                            }
                        }
                    }));

                    const success = successCount > 0;
                    const reason = success
                        ? undefined
                        : (failureCount > 0 ? 'noRecipientsAccepted' : 'noRecipientsReachable');
                    sendResponse({
                        success,
                        dispatched: successCount,
                        failed: failureCount,
                        skipped: skippedCount,
                        reasons: failureReasons,
                        reason
                    });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true;
        // ===== End Cross-Chat Module Cases =====

        // ===== Inline Profile Selector Cases =====
        case 'getInlineProfileSelectorSettings':
            (async () => {
                try {
                    const settings = await StateStore.getInlineProfileSelectorSettings();
                    logConfigurationRelatedStuff('Retrieved Inline Profile Selector settings:', settings);
                    sendResponse({ settings });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ error: error.message });
                }
            })();
            return true;

        case 'saveInlineProfileSelectorSettings':
            (async () => {
                try {
                    await StateStore.saveInlineProfileSelectorSettings(request.settings);
                    logConfigurationRelatedStuff('Saved Inline Profile Selector settings:', request.settings);
                    sendResponse({ success: true });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ error: error.message });
                }
            })();
            return true;
        // ===== End Inline Profile Selector Cases =====

        // ===== Token Approximator Cases =====
        case 'getTokenApproximatorSettings':
            (async () => {
                try {
                    const settings = await StateStore.getTokenApproximatorSettings();
                    logConfigurationRelatedStuff('Retrieved Token Approximator settings:', settings);
                    sendResponse({ settings });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ error: error.message });
                }
            })();
            return true;

        case 'saveTokenApproximatorSettings':
            (async () => {
                try {
                    await StateStore.saveTokenApproximatorSettings(request.settings);
                    logConfigurationRelatedStuff('Saved Token Approximator settings:', request.settings);
                    sendResponse({ success: true });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ error: error.message });
                }
            })();
            return true;
        // ===== End Token Approximator Cases =====

        case 'openSettingsPage':
            (async () => {
                try {
                    await chrome.tabs.create({
                        url: chrome.runtime.getURL('popup.html?isTab=true')
                    });
                    logConfigurationRelatedStuff('Settings page opened on request.');
                    sendResponse({ success: true });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true;

        default:
            logConfigurationRelatedStuff('Unknown message type received:', request.type);
            sendResponse({ error: 'Unknown message type' });
            return false;
    }
});

// ==== Welcome Page Handling ==== //
chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        // Create welcome page tab
        chrome.tabs.create({
            url: chrome.runtime.getURL('welcome.html')
        });

        await createDefaultProfile();
    }
});

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        for (let [key, { oldValue, newValue }] of Object.entries(changes)) {
            logConfigurationRelatedStuff(`Storage key "${key}" changed:`, {
                'from': oldValue,
                'to': newValue
            });
        }
    }
});
