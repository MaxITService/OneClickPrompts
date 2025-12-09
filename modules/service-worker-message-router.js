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
    createDefaultProfile
} from './service-worker-profile-manager.js';
import { logConfigurationRelatedStuff, handleStorageError } from './service-worker-config-helpers.js';

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

        case 'listProfiles':
            listProfiles().then(profiles => {
                sendResponse({ profiles });
                logConfigurationRelatedStuff('Profile list request processed');
            });
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
