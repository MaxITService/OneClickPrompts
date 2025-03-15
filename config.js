// config.js
// Version: 1.1
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS. This one too!
// This service worker does all Config stuff with sync storage, it handles storage exclusively, other files request data from it and don't care how it is stored.
// There is also welcome page handling, it opens a welcome page on install, has to be there cause it's service worker.
'use strict';
// Dependencies: default-config.json

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

// Function to save profile configuration
async function saveProfileConfig(profileName, config) {
    logConfigurationRelatedStuff(`Saving profile: ${profileName}`);
    try {
        await chrome.storage.local.set({
            'currentProfile': profileName,
            [`profiles.${profileName}`]: config
        });
        logConfigurationRelatedStuff(`Profile ${profileName} saved successfully`);
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
async function switchProfile(profileName) {
    logConfigurationRelatedStuff(`Switching to profile: ${profileName}`);
    try {
        const profile = await loadProfileConfig(profileName);
        if (profile) {
            await chrome.storage.local.set({ 'currentProfile': profileName });
            logConfigurationRelatedStuff(`Switched to profile: ${profileName}`);
            
            // Broadcast profile change to all tabs
            broadcastProfileChange(profileName, profile);
            
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
async function broadcastProfileChange(profileName, profileData) {
    try {
        const tabs = await chrome.tabs.query({});
        tabs.forEach(tab => {
            // Only send to URLs that match our content script patterns
            if (tab.url && (
                tab.url.includes('chat.openai.com') || 
                tab.url.includes('grok.x.ai') || 
                tab.url.includes('claude.ai') ||
                tab.url.includes('o3') || 
                tab.url.includes('x.ai')
            )) {
                chrome.tabs.sendMessage(tab.id, {
                    type: 'profileChanged',
                    profileName: profileName,
                    config: profileData
                }).catch(error => {
                    // Suppress errors when content script is not running on a tab
                    // This is normal for tabs that don't have our extension active
                    logConfigurationRelatedStuff(`Could not send message to tab ${tab.id}: ${error.message}`);
                });
            }
        });
        logConfigurationRelatedStuff(`Broadcasted profile change (${profileName}) to all matching tabs`);
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
            switchProfile(request.profileName).then(config => {
                sendResponse({ config });
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
        // ----- New Cases for Dark Theme Support -----
        case 'getTheme':
            (async () => {
                try {
                    const result = await chrome.storage.local.get(['darkTheme']);
                    // Default to 'light' if not set
                    const theme = result.darkTheme ? result.darkTheme : 'light';
                    logConfigurationRelatedStuff('Retrieved theme preference: ' + theme);
                    sendResponse({ darkTheme: theme });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ error: error.message });
                }
            })();
            return true;
        case 'setTheme':
            (async () => {
                try {
                    await chrome.storage.local.set({ darkTheme: request.darkTheme });
                    logConfigurationRelatedStuff('Set theme preference to: ' + request.darkTheme);
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
                    const result = await chrome.storage.local.get(['customSelectors']);
                    const customSelectors = result.customSelectors || {};
                    logConfigurationRelatedStuff('Retrieved custom selectors for: ' + request.site);
                    sendResponse({ selectors: customSelectors[request.site] || null });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ error: error.message });
                }
            })();
            return true;
        case 'saveCustomSelectors':
            (async () => {
                try {
                    const result = await chrome.storage.local.get(['customSelectors']);
                    const customSelectors = result.customSelectors || {};
                    
                    if (request.selectors) {
                        customSelectors[request.site] = request.selectors;
                        logConfigurationRelatedStuff('Saved custom selectors for: ' + request.site);
                    } else {
                        delete customSelectors[request.site];
                        logConfigurationRelatedStuff('Removed custom selectors for: ' + request.site);
                    }
                    
                    await chrome.storage.local.set({ customSelectors });
                    sendResponse({ success: true });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ error: error.message });
                }
            })();
            return true;
        // ----- End Custom Selectors Cases -----
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

        // Preserve existing migration logic from activate event
        const migrationSuccessful = await migrateSyncToLocal();
        if (!migrationSuccessful) {
            await createDefaultProfile();
        }
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
