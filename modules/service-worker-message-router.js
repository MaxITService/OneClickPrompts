// modules/service-worker-message-router.js
/*
Message routing module for service worker.
Handles all chrome.runtime.onMessage types and delegates to appropriate handlers.
Extracted from config.js to improve maintainability.
*/
'use strict';

import { StateStore } from './service-worker-auxiliary-state-store.js';
import {
    getCurrentProfileConfig,
    saveProfileConfig,
    switchProfile,
    listProfiles,
    deleteProfile,
    createDefaultProfile,
    loadProfileConfig,
    broadcastProfileChange,
    normalizeProfileConfig
} from './service-worker-profile-manager.js';
import { logConfigurationRelatedStuff, handleStorageError } from './service-worker-config-helpers.js';

const BACKUP_KIND = 'OneClickPromptsBackup';
const BACKUP_VERSION = 2;
const DANGEROUS_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function isPlainObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
}

function deepCloneSafeJson(value) {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map((item) => deepCloneSafeJson(item)).filter((item) => typeof item !== 'undefined');
    }

    if (!isPlainObject(value)) {
        return undefined;
    }

    const sanitized = {};
    Object.entries(value).forEach(([key, entryValue]) => {
        if (DANGEROUS_OBJECT_KEYS.has(key)) {
            return;
        }
        const safeValue = deepCloneSafeJson(entryValue);
        if (typeof safeValue !== 'undefined') {
            sanitized[key] = safeValue;
        }
    });
    return sanitized;
}

function sanitizeProfileName(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function sanitizeProfilesMap(rawProfiles) {
    if (!isPlainObject(rawProfiles)) {
        return {};
    }

    const sanitizedProfiles = {};
    Object.entries(rawProfiles).forEach(([rawName, rawProfile]) => {
        const profileName = sanitizeProfileName(rawName);
        if (!profileName || !isPlainObject(rawProfile)) {
            return;
        }

        const safeProfile = deepCloneSafeJson(rawProfile);
        if (!isPlainObject(safeProfile)) {
            return;
        }

        safeProfile.PROFILE_NAME = profileName;
        sanitizedProfiles[profileName] = normalizeProfileConfig(safeProfile, profileName);
    });

    return sanitizedProfiles;
}

function sanitizeAppSettings(rawAppSettings) {
    if (!isPlainObject(rawAppSettings)) {
        return null;
    }

    const sanitized = {};

    if (rawAppSettings.theme === 'light' || rawAppSettings.theme === 'dark') {
        sanitized.theme = rawAppSettings.theme;
    }

    if (isPlainObject(rawAppSettings.globalSettings)) {
        sanitized.globalSettings = deepCloneSafeJson(rawAppSettings.globalSettings);
    }

    if (isPlainObject(rawAppSettings.crossChatSettings)) {
        sanitized.crossChatSettings = deepCloneSafeJson(rawAppSettings.crossChatSettings);
    }

    if (typeof rawAppSettings.crossChatStoredPrompt === 'string') {
        sanitized.crossChatStoredPrompt = rawAppSettings.crossChatStoredPrompt;
    }

    if (isPlainObject(rawAppSettings.inlineProfileSelector)) {
        sanitized.inlineProfileSelector = deepCloneSafeJson(rawAppSettings.inlineProfileSelector);
    }

    if (isPlainObject(rawAppSettings.tokenApproximator)) {
        sanitized.tokenApproximator = deepCloneSafeJson(rawAppSettings.tokenApproximator);
    }

    if (isPlainObject(rawAppSettings.selectorAutoDetector)) {
        sanitized.selectorAutoDetector = deepCloneSafeJson(rawAppSettings.selectorAutoDetector);
    }

    if (isPlainObject(rawAppSettings.tooltip)) {
        sanitized.tooltip = deepCloneSafeJson(rawAppSettings.tooltip);
    }

    if (isPlainObject(rawAppSettings.manualQueueCards)) {
        sanitized.manualQueueCards = deepCloneSafeJson(rawAppSettings.manualQueueCards);
    }

    if (isPlainObject(rawAppSettings.floatingPanel)) {
        sanitized.floatingPanel = deepCloneSafeJson(rawAppSettings.floatingPanel);
    }

    if (isPlainObject(rawAppSettings.customSelectors)) {
        sanitized.customSelectors = deepCloneSafeJson(rawAppSettings.customSelectors);
    }

    return Object.keys(sanitized).length > 0 ? sanitized : null;
}

function sanitizeBackupPayload(rawPayload) {
    if (!isPlainObject(rawPayload)) {
        return null;
    }

    const isLegacySingleProfile = typeof rawPayload.PROFILE_NAME === 'string' && Array.isArray(rawPayload.customButtons);
    if (isLegacySingleProfile) {
        const profileName = sanitizeProfileName(rawPayload.PROFILE_NAME);
        if (!profileName) {
            return null;
        }

        const safeProfile = deepCloneSafeJson(rawPayload);
        if (!isPlainObject(safeProfile)) {
            return null;
        }

        safeProfile.PROFILE_NAME = profileName;
        return {
            kind: BACKUP_KIND,
            backupVersion: BACKUP_VERSION,
            exportScope: 'currentProfile',
            currentProfile: profileName,
            profiles: {
                [profileName]: normalizeProfileConfig(safeProfile, profileName),
            },
            appSettings: null,
        };
    }

    const profiles = sanitizeProfilesMap(rawPayload.profiles);
    const appSettings = sanitizeAppSettings(rawPayload.appSettings);
    const currentProfile = sanitizeProfileName(rawPayload.currentProfile);
    const exportScope = rawPayload.exportScope === 'allProfilesAndAppSettings'
        ? 'allProfilesAndAppSettings'
        : rawPayload.exportScope === 'allProfiles'
            ? 'allProfiles'
            : 'currentProfile';

    if (Object.keys(profiles).length === 0 && !appSettings) {
        return null;
    }

    return {
        kind: BACKUP_KIND,
        backupVersion: Number.isFinite(rawPayload.backupVersion) ? Number(rawPayload.backupVersion) : BACKUP_VERSION,
        exportScope,
        currentProfile,
        profiles,
        appSettings,
    };
}

async function buildBackupPayload(scope = 'currentProfile') {
    const normalizedScope = scope === 'allProfilesAndAppSettings'
        ? 'allProfilesAndAppSettings'
        : scope === 'allProfiles'
            ? 'allProfiles'
            : 'currentProfile';
    const currentResponse = await chrome.storage.local.get(['currentProfile', 'globalSettings']);
    const currentProfileName = sanitizeProfileName(currentResponse.currentProfile) || 'Default';
    const profiles = {};

    if (normalizedScope === 'currentProfile') {
        const currentProfile = await getCurrentProfileConfig();
        profiles[currentProfileName] = deepCloneSafeJson(currentProfile);
    } else {
        const profileNames = await listProfiles();
        for (const profileName of profileNames) {
            const profile = await loadProfileConfig(profileName);
            if (!profile) {
                continue;
            }
            profiles[profileName] = deepCloneSafeJson(normalizeProfileConfig(profile, profileName));
        }
    }

    let appSettings = null;
    if (normalizedScope === 'allProfilesAndAppSettings') {
        const crossChat = await StateStore.getCrossChat();
        const floatingPanel = {};
        const hostnames = await StateStore.listFloatingPanelHostnames();
        for (const hostname of hostnames) {
            floatingPanel[hostname] = await StateStore.getFloatingPanelSettings(hostname);
        }

        appSettings = {
            theme: await StateStore.getUiTheme(),
            globalSettings: deepCloneSafeJson(currentResponse.globalSettings || { acceptedQueueTOS: false }),
            crossChatSettings: deepCloneSafeJson(crossChat.settings),
            crossChatStoredPrompt: typeof crossChat.storedPrompt === 'string' ? crossChat.storedPrompt : '',
            inlineProfileSelector: deepCloneSafeJson(await StateStore.getInlineProfileSelectorSettings()),
            tokenApproximator: deepCloneSafeJson(await StateStore.getTokenApproximatorSettings()),
            selectorAutoDetector: deepCloneSafeJson(await StateStore.getSelectorAutoDetectorSettings()),
            tooltip: deepCloneSafeJson(await StateStore.getTooltipSettings()),
            manualQueueCards: deepCloneSafeJson(await StateStore.getManualQueueCards()),
            floatingPanel: deepCloneSafeJson(floatingPanel),
            customSelectors: deepCloneSafeJson(await StateStore.getCustomSelectors()),
        };
    }

    return {
        kind: BACKUP_KIND,
        backupVersion: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        exportScope: normalizedScope,
        currentProfile: currentProfileName,
        profiles,
        appSettings,
    };
}

async function applyBackupPayload(rawPayload, options = {}) {
    const backup = sanitizeBackupPayload(rawPayload);
    if (!backup) {
        throw new Error('Backup payload is invalid or contains no importable data.');
    }

    const overwriteExisting = options.overwriteExisting !== false;
    const existingProfiles = new Set(await listProfiles());
    const profileEntries = Object.entries(backup.profiles || {});
    const importedProfiles = [];
    const skippedProfiles = [];
    const storagePatch = {};

    for (const [profileName, profileConfig] of profileEntries) {
        if (!overwriteExisting && existingProfiles.has(profileName)) {
            skippedProfiles.push(profileName);
            continue;
        }

        storagePatch[`profiles.${profileName}`] = normalizeProfileConfig(deepCloneSafeJson(profileConfig), profileName);
        importedProfiles.push(profileName);
    }

    if (Object.keys(storagePatch).length > 0) {
        await chrome.storage.local.set(storagePatch);
    }

    let appSettingsApplied = false;
    if (backup.appSettings) {
        const appSettings = backup.appSettings;

        if (appSettings.theme === 'light' || appSettings.theme === 'dark') {
            await StateStore.setUiTheme(appSettings.theme);
        }

        if (isPlainObject(appSettings.globalSettings)) {
            await chrome.storage.local.set({ globalSettings: deepCloneSafeJson(appSettings.globalSettings) });
        }

        if (isPlainObject(appSettings.crossChatSettings)) {
            await StateStore.saveCrossChat(appSettings.crossChatSettings);
        }

        if (typeof appSettings.crossChatStoredPrompt === 'string') {
            await StateStore.saveStoredPrompt(appSettings.crossChatStoredPrompt);
        }

        if (isPlainObject(appSettings.inlineProfileSelector)) {
            await StateStore.saveInlineProfileSelectorSettings(appSettings.inlineProfileSelector);
        }

        if (isPlainObject(appSettings.tokenApproximator)) {
            await StateStore.saveTokenApproximatorSettings(appSettings.tokenApproximator);
        }

        if (isPlainObject(appSettings.selectorAutoDetector)) {
            await StateStore.saveSelectorAutoDetectorSettings(appSettings.selectorAutoDetector);
        }

        if (isPlainObject(appSettings.tooltip)) {
            await StateStore.saveTooltipSettings(appSettings.tooltip);
        }

        if (isPlainObject(appSettings.manualQueueCards)) {
            await StateStore.saveManualQueueCards(appSettings.manualQueueCards);
        }

        if (isPlainObject(appSettings.floatingPanel)) {
            await StateStore.resetFloatingPanelSettings();
            for (const [hostname, settings] of Object.entries(appSettings.floatingPanel)) {
                if (!hostname || !isPlainObject(settings)) {
                    continue;
                }
                await StateStore.saveFloatingPanelSettings(hostname, deepCloneSafeJson(settings));
            }
        }

        if (isPlainObject(appSettings.customSelectors)) {
            await StateStore.resetAdvancedSelectors();
            for (const [site, selectors] of Object.entries(appSettings.customSelectors)) {
                if (!site || !isPlainObject(selectors)) {
                    continue;
                }
                await StateStore.saveCustomSelectors(site, deepCloneSafeJson(selectors));
            }
        }

        appSettingsApplied = true;
    }

    const importedProfileSet = new Set(importedProfiles);
    let nextCurrentProfile = sanitizeProfileName(backup.currentProfile);
    if (!nextCurrentProfile || (!importedProfileSet.has(nextCurrentProfile) && !existingProfiles.has(nextCurrentProfile))) {
        nextCurrentProfile = importedProfiles[0] || sanitizeProfileName((await chrome.storage.local.get(['currentProfile'])).currentProfile) || 'Default';
    }

    await chrome.storage.local.set({ currentProfile: nextCurrentProfile });
    let activeProfile = await loadProfileConfig(nextCurrentProfile);
    if (!activeProfile) {
        activeProfile = await createDefaultProfile();
        nextCurrentProfile = 'Default';
    }
    if (activeProfile) {
        await broadcastProfileChange(nextCurrentProfile, normalizeProfileConfig(activeProfile, nextCurrentProfile), null, 'backupImport');
    }

    return {
        importedProfiles,
        skippedProfiles,
        appSettingsApplied,
        currentProfile: nextCurrentProfile,
    };
}

async function createCustomButtonFromEditorText(payload = {}) {
    const rawText = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!rawText) {
        return { success: false, reason: 'empty_text' };
    }

    const current = await chrome.storage.local.get(['currentProfile']);
    const profileName = sanitizeProfileName(current.currentProfile) || 'Default';
    const loadedProfile = await loadProfileConfig(profileName);
    if (!loadedProfile) {
        return { success: false, reason: 'profile_not_found' };
    }

    const profile = normalizeProfileConfig(deepCloneSafeJson(loadedProfile), profileName);
    const button = {
        icon: '+',
        text: rawText,
        autoSend: payload.autoSend !== false
    };

    profile.customButtons.push(button);
    const buttonIndex = profile.customButtons.length - 1;
    const success = await saveProfileConfig(profileName, profile);
    return {
        success,
        profileName,
        buttonIndex,
        button
    };
}

async function updateCustomButtonFromEditorOptions(payload = {}) {
    const profileName = sanitizeProfileName(payload.profileName);
    const text = typeof payload.text === 'string' ? payload.text : '';
    const requestedIndex = Number(payload.buttonIndex);

    if (!profileName || !text) {
        return { success: false, reason: 'invalid_request' };
    }

    const loadedProfile = await loadProfileConfig(profileName);
    if (!loadedProfile) {
        return { success: false, reason: 'profile_not_found' };
    }

    const profile = normalizeProfileConfig(deepCloneSafeJson(loadedProfile), profileName);
    let buttonIndex = Number.isInteger(requestedIndex) ? requestedIndex : -1;
    let button = profile.customButtons[buttonIndex];
    if (!button || button.separator || button.text !== text) {
        buttonIndex = profile.customButtons.findLastIndex((candidate) => (
            candidate && !candidate.separator && candidate.text === text
        ));
        button = profile.customButtons[buttonIndex];
    }

    if (!button) {
        return { success: false, reason: 'button_not_found' };
    }

    if (typeof payload.autoSend === 'boolean') {
        button.autoSend = payload.autoSend;
    }
    if (typeof payload.icon === 'string') {
        const icon = payload.icon.trim();
        button.icon = icon || '+';
    }

    const success = await saveProfileConfig(profileName, profile);
    return { success, profileName, buttonIndex, button };
}

// Main message handler function
export function handleMessage(request, sender, sendResponse) {
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

        case 'createCustomButtonFromEditorText':
            createCustomButtonFromEditorText(request).then(result => {
                sendResponse(result);
                logConfigurationRelatedStuff('Create button from editor request processed');
            }).catch(error => {
                handleStorageError(error);
                sendResponse({ success: false, error: error.message });
            });
            return true;

        case 'updateCustomButtonFromEditorOptions':
        case 'updateCustomButtonAutoSend':
            updateCustomButtonFromEditorOptions(request).then(result => {
                sendResponse(result);
                logConfigurationRelatedStuff('Update custom button from editor options request processed');
            }).catch(error => {
                handleStorageError(error);
                sendResponse({ success: false, error: error.message });
            });
            return true;

        case 'listProfiles':
            listProfiles().then(profiles => {
                sendResponse({ profiles });
                logConfigurationRelatedStuff('Profile list request processed');
            });
            return true;

        case 'getBackupPayload':
            (async () => {
                try {
                    const payload = await buildBackupPayload(request.scope);
                    sendResponse({ payload });
                    logConfigurationRelatedStuff(`Backup payload built for scope: ${request.scope || 'currentProfile'}`);
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ error: error.message });
                }
            })();
            return true;

        case 'applyBackupPayload':
            (async () => {
                try {
                    const result = await applyBackupPayload(request.payload, request.options || {});
                    sendResponse({ success: true, result });
                    logConfigurationRelatedStuff('Backup payload applied successfully');
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true;

        case 'clearStorage':
            (async () => {
                try {
                    await chrome.storage.local.clear();
                    logConfigurationRelatedStuff('Storage cleared successfully');
                    sendResponse({ success: true });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ success: false });
                }
            })();
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

        // ----- Queue Keep Awake -----
        case 'queueKeepAwake':
            (async () => {
                try {
                    if (!chrome?.power?.requestKeepAwake || !chrome?.power?.releaseKeepAwake) {
                        sendResponse({ success: false, error: 'chrome.power API is unavailable (missing permission or unsupported browser).' });
                        return;
                    }

                    const level = request.level === 'system' ? 'system' : 'display';
                    if (request.enabled) {
                        chrome.power.requestKeepAwake(level);
                    } else {
                        chrome.power.releaseKeepAwake();
                    }
                    sendResponse({ success: true });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ success: false, error: error.message });
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
                    } catch { }
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

        // ===== Selector Auto-Detector Cases =====
        case 'getSelectorAutoDetectorSettings':
            (async () => {
                try {
                    const settings = await StateStore.getSelectorAutoDetectorSettings();
                    logConfigurationRelatedStuff('Retrieved Selector Auto-Detector settings:', settings);
                    sendResponse({ settings });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ error: error.message });
                }
            })();
            return true;

        case 'saveSelectorAutoDetectorSettings':
            (async () => {
                try {
                    await StateStore.saveSelectorAutoDetectorSettings(request.settings);
                    logConfigurationRelatedStuff('Saved Selector Auto-Detector settings:', request.settings);
                    sendResponse({ success: true });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ error: error.message });
                }
            })();
            return true;
        // ===== End Selector Auto-Detector Cases =====

        // ===== Tooltip Cases =====
        case 'getTooltipSettings':
            (async () => {
                try {
                    const settings = await StateStore.getTooltipSettings();
                    logConfigurationRelatedStuff('Retrieved Tooltip settings:', settings);
                    sendResponse({ settings });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ error: error.message });
                }
            })();
            return true;

        case 'saveTooltipSettings':
            (async () => {
                try {
                    await StateStore.saveTooltipSettings(request.settings);
                    logConfigurationRelatedStuff('Saved Tooltip settings:', request.settings);
                    sendResponse({ success: true });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ error: error.message });
                }
            })();
            return true;
        // ===== End Tooltip Cases =====

        // ===== Manual Queue Cards Cases =====
        case 'getManualQueueCards':
            (async () => {
                try {
                    const data = await StateStore.getManualQueueCards();
                    logConfigurationRelatedStuff('Retrieved Manual Queue Cards:', data);
                    sendResponse({ data });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ error: error.message });
                }
            })();
            return true;

        case 'saveManualQueueCards':
            (async () => {
                try {
                    await StateStore.saveManualQueueCards(request.data);
                    logConfigurationRelatedStuff('Saved Manual Queue Cards:', request.data);
                    sendResponse({ success: true });
                } catch (error) {
                    handleStorageError(error);
                    sendResponse({ error: error.message });
                }
            })();
            return true;
        // ===== End Manual Queue Cards Cases =====

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
}
