// config.js
/*
Version: 1.2
Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS. This one too!

Service worker responsibilities (current):
- Single entry point for extension messaging (onMessage) and lifecycle (install/activate).
- Owns profile storage and related handlers (getConfig/saveConfig/switchProfile/etc.).
- Delegates non‑profile storage (theme, custom selectors, floating panel, cross‑chat) to modules/service-worker-auxiliary-state-store.js.
- Opens the welcome page on fresh install.

ARCHITECTURE NOTE:
This file has been refactored to improve maintainability. Most functionality has been extracted
into separate modules while maintaining the exact same external API. All message types and
responses remain unchanged - this is purely internal reorganization.

MODULE DEPENDENCIES:
===================

1. context-menu.js (imported for side effects)
   - Registers right-click menu on extension icon
   - Shows "Open Welcome page" option

2. modules/service-worker-auxiliary-state-store.js (StateStore)
   - Handles ALL non-profile storage operations
   - Manages: themes, custom selectors, floating panel settings, cross-chat data,
     inline selector settings, token approximator settings
   - Provides broadcast mechanism for settings changes to all tabs
   - Used by: message router for non-profile message types

3. modules/service-worker-message-router.js (handleMessage)
   - Contains the large switch statement that was previously inline here
   - Routes 30+ message types to their appropriate handlers
   - Message types include: getConfig, saveConfig, switchProfile, listProfiles,
     deleteProfile, getTheme, setTheme, getCustomSelectors, saveCustomSelectors,
     all floating panel operations, all cross-chat operations, module settings, etc.
   - Returns: async response handling (returns true for all async operations)
   - Dependencies: Uses StateStore and profile-manager functions internally

4. modules/service-worker-profile-manager.js (profile functions)
   - Exports: createDefaultProfile, getCurrentProfileConfig, saveProfileConfig,
     loadProfileConfig, switchProfile, broadcastProfileChange, listProfiles,
     deleteProfile, areProfileConfigsEqual
   - Handles all profile CRUD operations
   - Manages profile normalization (adding default properties for backward compatibility)
   - Broadcasts profile changes to content scripts in all tabs
   - Dependencies: Uses config-helpers for logging and error handling

5. modules/service-worker-config-helpers.js (utility functions)
   - Exports: logConfigurationRelatedStuff, handleStorageError, loadDefaultConfig
   - Provides logging with [config] prefix
   - Handles storage quota errors
   - Loads default-config.json for initial profile creation
   - No external dependencies (base utilities)

MESSAGE FLOW DIAGRAM:
====================
Content Script/Popup → chrome.runtime.sendMessage({type: 'getConfig'})
                     ↓
            config.js (onMessage listener)
                     ↓
         modules/service-worker-message-router.js (handleMessage switch)
                     ↓
         modules/service-worker-profile-manager.js (getCurrentProfileConfig)
                     ↓
         modules/service-worker-config-helpers.js (logging/error handling)
                     ↓
            sendResponse({config: ...})

EXTERNAL API CONTRACT (unchanged):
==================================
All message types, request formats, and response formats remain exactly the same.
Examples:
- chrome.runtime.sendMessage({type: 'getConfig'}) → {config: {...}}
- chrome.runtime.sendMessage({type: 'saveConfig', profileName, config}) → {success: true}
- chrome.runtime.sendMessage({type: 'switchProfile', profileName}) → {config: {...}}

No changes required in any files that communicate with this service worker.
*/
'use strict';

// Module imports with clear documentation
import './context-menu.js'; // Side-effect: registers extension icon right-click menu
// Note: StateStore is imported and used by service-worker-message-router.js, not directly here
import { handleMessage } from './modules/service-worker-message-router.js'; // Routes all message types
import { createDefaultProfile } from './modules/service-worker-profile-manager.js'; // Used on install

// ===== Service Worker Lifecycle =====

// Ensure the service worker is registered and activated immediately
self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

// Claim all clients on activation (takes control of all tabs immediately)
self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            await self.clients.claim();
        })()
    );
});

// ===== Message Handler =====

// Central message routing - delegates to handleMessage in message-router module
// This maintains the same external API while organizing code internally
// All 30+ message types are handled in modules/service-worker-message-router.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    return handleMessage(request, sender, sendResponse);
});

// ===== Extension Installation Handler =====

// Opens welcome page and creates default profile on fresh install
chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        // Create welcome page tab
        chrome.tabs.create({
            url: chrome.runtime.getURL('welcome.html')
        });

        // Initialize default profile from default-config.json
        await createDefaultProfile();
    }
});

// ===== Storage Change Listener (for debugging) =====

// Logs all storage changes for debugging purposes
// Helps track configuration updates across the extension
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        for (let [key, { oldValue, newValue }] of Object.entries(changes)) {
            console.log(`[config] Storage key "${key}" changed:`, {
                'from': oldValue,
                'to': newValue
            });
        }
    }
});
