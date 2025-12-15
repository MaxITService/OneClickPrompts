// Version: 1.5
//
// Documentation:
/**
 * This file serves as the main initializer for the OneClickPrompts extension.
 *
 * Overview:
 * - Retrieves configuration data from the service worker.
 * - Identifies the active website (e.g., ChatGPT or Claude) and loads 
 *   the appropriate extension scripts.
 * - Applies necessary settings and manages keyboard shortcuts to enhance 
 *   user interaction.
 * - Monitors URL changes in single-page applications and ensures resiliency 
 *   by validating and reinitializing custom modifications in the DOM.
 * - Uses debouncing to limit excessive function executions for performance.
 *
 * Usage:
 * - Ensure the following scripts are loaded (in order) before this file:
 *   1. buttons.js
 *   2. buttons-init-and-render.js
 *   3. buttons-injection.js
 * - The initialization process starts automatically upon script load.
 *
 * Dependencies:
 * - This is the main script, and it depends on all other helper files that are 
 *   used as content scripts.
 * - Popup page scripts are handled separately.
 *
 */

// ALL CODE IN ALL FILES MUST USE logConCgp FOR LOGGING. NO CONSOLE LOGGING.

'use strict';

function normalizeCrossChatConfig(settings = {}) {
    const normalized = {
        enabled: false,
        placement: 'after',
        autosendCopy: false,
        autosendPaste: false,
        dangerAutoSendAll: false,
        hideStandardButtons: false,
        ...settings
    };
    normalized.enabled = !!normalized.enabled;
    normalized.autosendCopy = !!normalized.autosendCopy;
    normalized.autosendPaste = !!normalized.autosendPaste;
    normalized.dangerAutoSendAll = !!normalized.dangerAutoSendAll;
    normalized.hideStandardButtons = !!normalized.hideStandardButtons;
    normalized.placement = normalized.placement === 'before' ? 'before' : 'after';
    return normalized;
}

function applyCrossChatConfig(settings = {}) {
    const normalized = normalizeCrossChatConfig(settings);
    window.globalCrossChatConfig = normalized;
    if (!normalized.dangerAutoSendAll) {
        window.__OCP_dangerReceiveBlocked = false;
    } else if (typeof window.__OCP_dangerReceiveBlocked !== 'boolean') {
        window.__OCP_dangerReceiveBlocked = false;
    }
    return normalized;
}

// === Global, idempotent message/listener helpers for SPA-safe operation ===
if (!window.__OCP_messageListenerRegistered_v2) {
    window.__OCP_messageListenerRegistered_v2 = true;

    // Guard to prevent concurrent nukes
    window.__OCP_nukeInProgress = false;

    // Lightweight UI refresh that preserves the floating panel state
    // Accepts an optional `origin` parameter to limit refreshing to the initiator (e.g. 'panel' or 'inline').
    window.__OCP_partialRefreshUI = function (optionalNewConfig, origin = null) {
        try {
            if (optionalNewConfig) {
                window.globalMaxExtensionConfig = optionalNewConfig;
            }
            if (window.MaxExtensionButtonsInit && typeof window.MaxExtensionButtonsInit.updateButtonsForProfileChange === 'function') {
                // Forward origin so updateButtonsForProfileChange can limit which container(s) are updated.
                // Default to 'inline' if no origin is specified, as that's the primary UI element
                const effectiveOrigin = origin || 'inline';
                window.MaxExtensionButtonsInit.updateButtonsForProfileChange(effectiveOrigin);
            }
        } catch (e) {
            // If anything goes wrong, fallback to full re-init on next call
            logConCgp('[init] Partial refresh failed; will fallback to full re-init if needed.');
        }
    };

    // Expose a single entry to perform partial or full refresh depending on panel presence
    // Accepts optional `origin` so partial refresh can be targeted when appropriate.
    window.__OCP_nukeAndRefresh = function (optionalNewConfig, origin = null) {
        if (window.__OCP_nukeInProgress) return;
        window.__OCP_nukeInProgress = true;
        try {
            const hasPanel = !!(window.MaxExtensionFloatingPanel && window.MaxExtensionFloatingPanel.panelElement);

            if (hasPanel) {
                // Preserve panel DOM/state; only refresh buttons/inline
                window.__OCP_partialRefreshUI(optionalNewConfig, origin);
            } else {
                // Full re-init path (no panel in DOM)
                if (optionalNewConfig) {
                    window.globalMaxExtensionConfig = optionalNewConfig;
                }

                // 1) Stop resiliency monitors and timers from previous run
                try {
                    if (window.OneClickPropmts_currentResiliencyTimeout) {
                        clearTimeout(window.OneClickPropmts_currentResiliencyTimeout);
                        window.OneClickPropmts_currentResiliencyTimeout = null;
                    }
                    if (window.OneClickPropmts_extendedMonitoringObserver) {
                        window.OneClickPropmts_extendedMonitoringObserver.disconnect();
                        window.OneClickPropmts_extendedMonitoringObserver = null;
                    }
                } catch (e) { }

                // 2) Remove inline buttons container(s)
                try {
                    const containerId = window?.InjectionTargetsOnWebsite?.selectors?.buttonsContainerId;
                    if (containerId) {
                        document.querySelectorAll('#' + CSS.escape(containerId)).forEach(node => node.remove());
                    }
                } catch (e) { }

                // 3) Do NOT remove the panel here (it is already absent in this branch)

                // 4) Detach keyboard listener to avoid duplicates
                try { window.removeEventListener('keydown', manageKeyboardShortcutEvents); } catch (e) { }

                // 5) Re-run full initialization
                publicStaticVoidMain();
            }
        } finally {
            // Allow subsequent nukes after the next tick so re-init can attach first
            setTimeout(() => { window.__OCP_nukeInProgress = false; }, 0);
        }
    };

    // Single runtime message listener for this page
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message && message.type === 'profileChanged') {
            logConCgp('[init] Received profileChanged. Refreshing UI.');
            // Pass origin along if provided to limit refresh scope.
            const origin = message.origin || null;
            // Prefer partial refresh to preserve panel state
            if (typeof window.__OCP_partialRefreshUI === 'function') {
                window.__OCP_partialRefreshUI(message.config, origin);
            } else {
                window.__OCP_nukeAndRefresh(message.config, origin);
            }
            sendResponse?.({ ok: true });
            return true;
        }
        if (message && message.type === 'crossChatChanged') {
            logConCgp('[init] Received crossChatChanged broadcast. Updating configuration.');
            const mergedSettings = { ...(window.globalCrossChatConfig || {}), ...(message.settings || {}) };
            applyCrossChatConfig(mergedSettings);

            if (window.MaxExtensionButtonsInit && typeof window.MaxExtensionButtonsInit.updateButtonsForProfileChange === 'function') {
                try {
                    window.MaxExtensionButtonsInit.updateButtonsForProfileChange('inline');
                } catch (err) {
                    logConCgp('[init] Failed updating inline buttons after crossChat change:', err?.message || err);
                }
                try {
                    window.MaxExtensionButtonsInit.updateButtonsForProfileChange('panel');
                } catch (err) {
                    logConCgp('[init] Failed updating panel buttons after crossChat change:', err?.message || err);
                }
            }
            sendResponse?.({ ok: true });
            return false;
        }
        if (message && message.type === 'crossChatDangerDispatchPrompt') {
            const shouldAccept = window.globalCrossChatConfig?.enabled &&
                window.globalCrossChatConfig?.dangerAutoSendAll &&
                !window.__OCP_dangerReceiveBlocked;
            const promptText = typeof message.promptText === 'string' ? message.promptText : '';
            const trimmedPrompt = promptText.trim();

            if (!shouldAccept || !trimmedPrompt) {
                sendResponse?.({ ok: false });
                return false;
            }

            if (!window.InjectionTargetsOnWebsite || typeof processCustomSendButtonClick !== 'function') {
                logConCgp('[init] Cross-chat danger dispatch ignored: target environment not ready.');
                sendResponse?.({ ok: false });
                return false;
            }

            logConCgp('[init] Executing cross-chat danger dispatch.');
            try {
                const syntheticEvent = {
                    __fromQueue: true,
                    __fromDangerBroadcast: true,
                    preventDefault() { },
                    stopPropagation() { },
                    shiftKey: false,
                };
                processCustomSendButtonClick(syntheticEvent, trimmedPrompt, true);
                sendResponse?.({ ok: true });
            } catch (err) {
                logConCgp('[init] Error during cross-chat danger dispatch:', err?.message || err);
                sendResponse?.({ ok: false, error: err?.message || String(err) });
            }
            return false;
        }
        return false;
    });
}

/**
 * Main entry point. Retrieves configuration and then starts the async initialization.
 */
function publicStaticVoidMain() {
    // Start a chain of callbacks to load all necessary configurations before initializing.
    chrome.runtime.sendMessage({ type: 'getConfig' }, (response) => {
        if (chrome.runtime.lastError || !response?.config) {
            logConCgp('[init] Error loading main configuration:', chrome.runtime.lastError?.message);
            return;
        }
        const mainConfig = response.config;
        logConCgp('[init] Main configuration successfully loaded:', mainConfig);

        const loadInlineProfileSelectorSettings = () => {
            chrome.runtime.sendMessage({ type: 'getInlineProfileSelectorSettings' }, (selectorResponse) => {
                if (chrome.runtime.lastError || !selectorResponse?.settings) {
                    logConCgp('[init] Could not load Inline Profile Selector settings.', chrome.runtime.lastError?.message);
                    window.globalInlineSelectorConfig = { enabled: false, placement: 'before' };
                } else {
                    window.globalInlineSelectorConfig = selectorResponse.settings;
                    logConCgp('[init] Inline Profile Selector settings loaded:', window.globalInlineSelectorConfig);
                }

                // Start main initialization only after all global configs are present
                commenceExtensionInitialization(mainConfig);
            });
        };

        const applyCrossChatAndContinue = (settings, logLabel) => {
            const appliedSettings = applyCrossChatConfig(settings);
            if (logLabel) {
                logConCgp(logLabel, appliedSettings);
            }
            loadInlineProfileSelectorSettings();
        };

        // After loading the main config, load the cross-chat module settings.
        chrome.runtime.sendMessage({ type: 'getCrossChatModuleSettings' }, (moduleResponse) => {
            const settingsError = chrome.runtime.lastError;
            if (settingsError || !moduleResponse?.settings) {
                logConCgp('[init] Could not load Cross-Chat module settings. Attempting defaults.', settingsError?.message);
                chrome.runtime.sendMessage({ type: 'getCrossChatModuleDefaults' }, (defaultsResponse) => {
                    const defaultsError = chrome.runtime.lastError;
                    if (defaultsError || !defaultsResponse?.defaults) {
                        logConCgp('[init] Cross-Chat defaults unavailable. Using fallback disabled state.', defaultsError?.message);
                        applyCrossChatAndContinue({}, '[init] Cross-Chat module defaults unavailable; using fallback:');
                    } else {
                        applyCrossChatAndContinue(defaultsResponse.defaults, '[init] Cross-Chat module defaults applied:');
                    }
                });
                return;
            }

            applyCrossChatAndContinue(moduleResponse.settings, '[init] Cross-Chat module settings loaded:');
        });
    });
}

/**
 * Initializes the extension using an async "decide-first" approach.
 * @param {Object} configurationObject - The configuration object.
 */
async function commenceExtensionInitialization(configurationObject) {
    logConCgp('[init] Async initialization started.');
    // Configs are now set in publicStaticVoidMain before this is called.
    window.globalMaxExtensionConfig = configurationObject;

    /**
     * Helper to get panel visibility setting from storage, wrapped in a Promise.
     * @returns {Promise<boolean>} - True if the panel should be visible.
     */
    async function getFloatingPanelVisibility() {
        return new Promise(resolve => {
            const hostname = window.location.hostname;
            chrome.runtime.sendMessage({ type: 'getFloatingPanelSettings', hostname: hostname }, response => {
                if (chrome.runtime.lastError) {
                    logConCgp('[init] Error getting panel settings:', chrome.runtime.lastError.message);
                    resolve(false);
                    return;
                }
                resolve(response?.settings?.isVisible || false);
            });
        });
    }

    const shouldPanelBeVisible = await getFloatingPanelVisibility();

    if (shouldPanelBeVisible) {
        logConCgp('[init] Decide-first: Panel should be visible. Creating panel and buttons directly.');
        if (window.MaxExtensionFloatingPanel) {
            await window.MaxExtensionFloatingPanel.createFloatingPanel();
            const buttonsArea = document.getElementById('max-extension-buttons-area');
            const panel = window.MaxExtensionFloatingPanel.panelElement;

            if (panel && buttonsArea) {
                // Create buttons directly in the panel's buttons area. No flicker.
                window.MaxExtensionButtonsInit.createAndInsertCustomElements(buttonsArea);

                // Manually make panel visible and set state.
                panel.style.display = 'flex';
                window.MaxExtensionFloatingPanel.isPanelVisible = true;
                // Ensure a sane position if this is a non-user summon (fallback path).
                logConCgp('[floating-panel][fallback] Non-user summon path engaged during decide-first; ensuring default position (bottom-right) if needed.');
                window.MaxExtensionFloatingPanel.updatePanelFromSettings();
            } else {
                logConCgp('[init] Decide-first: Failed to create panel. Falling back to inline injection.');
                buttonBoxCheckingAndInjection(true); // Fallback
            }
        }
    } else {
        logConCgp('[init] Decide-first: Panel is hidden. Using standard inline injection.');
        buttonBoxCheckingAndInjection(true);
        // Initialize per-tab flags if absent
        if (typeof window.__OCP_inlineHealthy === 'undefined') window.__OCP_inlineHealthy = false;
        /**
         * When inline injection fails (e.g., because the target container cannot be found),
         * there is no user click event to supply a mouse position for the floating panel.
         * In this scenario we automatically summon the floating panel after a short delay
         * and position it in the bottom-right corner as a fallback. This ensures that the
         * user always has access to the prompts even when inline injection is not possible.
         * 
         * NOTE: If container heuristics are enabled, we skip this automatic fallback and let
         * the heuristics system handle recovery (which offers manual placement + floating panel option).
         */
        setTimeout(() => {
            try {
                // Check if container heuristics are enabled - if so, skip auto fallback
                const containerHeuristicsEnabled = window.OneClickPromptsSelectorAutoDetector?.settings?.enableContainerHeuristics !== false;

                if (containerHeuristicsEnabled) {
                    logConCgp('[init] Container heuristics enabled. Skipping automatic floating panel fallback.');
                    return;
                }

                // Check if inline buttons were injected by looking for the container and its children.
                let modsExist = (() => {
                    const containerId = window?.InjectionTargetsOnWebsite?.selectors?.buttonsContainerId;
                    if (!containerId) return false;
                    const el = document.getElementById(containerId);
                    return !!(el && el.children && el.children.length > 0);
                })();
                // Only trigger fallback if no mods exist and the panel isn't already visible.
                const userDisabled = !!window.__OCP_userDisabledFallback;
                if (!modsExist && !window.__OCP_inlineHealthy && !userDisabled &&
                    window.MaxExtensionFloatingPanel && !window.MaxExtensionFloatingPanel.isPanelVisible) {
                    logConCgp("[init] We haven't found the place to inject buttons, so we will fall back to a floating panel instead.");
                    window.MaxExtensionFloatingPanel.createFloatingPanel().then(() => {
                        const panelElement = window.MaxExtensionFloatingPanel.panelElement;
                        const buttonsArea = document.getElementById('max-extension-buttons-area');
                        if (panelElement && buttonsArea) {
                            // Clear old buttons and insert custom buttons.
                            buttonsArea.innerHTML = '';
                            if (window.MaxExtensionButtonsInit &&
                                typeof window.MaxExtensionButtonsInit.createAndInsertCustomElements === 'function') {
                                window.MaxExtensionButtonsInit.createAndInsertCustomElements(buttonsArea);
                            }
                            // Position the panel in the TOP-right corner (fallback).
                            if (typeof window.MaxExtensionFloatingPanel.positionPanelTopRight === 'function') {
                                window.MaxExtensionFloatingPanel.positionPanelTopRight();
                            } else if (typeof window.MaxExtensionFloatingPanel.positionPanelBottomRight === 'function') {
                                // safety net if someone removes the new helper
                                window.MaxExtensionFloatingPanel.positionPanelBottomRight();
                            }
                            panelElement.style.display = 'flex';
                            window.MaxExtensionFloatingPanel.isPanelVisible = true;
                            if (window.MaxExtensionFloatingPanel.currentPanelSettings) {
                                // note: do not set inlineHealthy here — we are in fallback mode
                                window.MaxExtensionFloatingPanel.currentPanelSettings.isVisible = true;
                                window.MaxExtensionFloatingPanel.debouncedSavePanelSettings?.();
                            }
                        }
                    }).catch((err) => {
                        logConCgp('[init] Error during fallback panel creation:', err);
                    });
                }
            } catch (err) {
                logConCgp('[init] Error during fallback detection:', err);
            }
        }, 2500); // Wait 2.5 seconds before checking; gives inline injection time to succeed.
    }

    // After the initial decision and creation, initialize the full floating panel system.
    // This loads settings, profiles, and attaches event listeners.
    if (window.MaxExtensionFloatingPanel) {
        window.MaxExtensionFloatingPanel.initialize();
        logConCgp('[init] Floating panel system initialized in a controlled manner.');
    }

    // --- All subsequent logic for shortcuts and SPA navigation remains the same ---
    const activeWebsite = window.InjectionTargetsOnWebsite.activeSite;

    // Make the listener idempotent by removing it before adding it. This prevents duplicate listeners
    // when the extension re-initializes and also cleans up the listener if shortcuts are disabled
    // or when navigating away from the relevant site.
    window.removeEventListener('keydown', manageKeyboardShortcutEvents);

    // Keyboard shortcuts:
    if (activeWebsite !== 'Unknown' && window.globalMaxExtensionConfig.enableShortcuts) {
        window.addEventListener('keydown', manageKeyboardShortcutEvents);
        logConCgp(`[init] Keyboard shortcut listener is active for ${activeWebsite}.`);
    }

    resilientStartAndRetryOnSPANavigation(() => {
        logConCgp('[init] Path change detected via MutationObserver. Re-initializing script...');
        const debouncedEnhancedInitialization = debounceFunctionExecution(() => {
            publicStaticVoidMain();
        }, 100);
        debouncedEnhancedInitialization();
    });

    patchHistoryMethods();
}

/**
 * Manages keyboard shortcut events to trigger custom send buttons on the webpage.
 * @param {KeyboardEvent} event - The keyboard event object.
 */
function manageKeyboardShortcutEvents(event) {
    if (!globalMaxExtensionConfig.enableShortcuts) return;

    // We check for Alt key, but not Ctrl or Meta (Cmd/Win). The 'code' property is layout-independent.
    if (event.altKey && !event.ctrlKey && !event.metaKey && event.code.startsWith('Digit')) {
        let pressedKey = parseInt(event.code.replace('Digit', ''), 10);
        // Map Alt+0 to shortcut key 10.
        if (pressedKey === 0) {
            pressedKey = 10;
        }

        // Find the button with the corresponding data-shortcut-key attribute.
        const targetButton = document.querySelector(`button[data-shortcut-key="${pressedKey}"]`);

        if (targetButton) {
            event.preventDefault();
            // Simulate a click event. Pass the shiftKey status so users can override autosend.
            const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, view: window, shiftKey: event.shiftKey });
            targetButton.dispatchEvent(clickEvent);
        } else {
            logConCgp('[init] No button found for the pressed shortcut key:', pressedKey);
        }
    }
}

/**
 * Debounces a function to limit how often it can be executed.
 * @param {Function} func - The function to debounce.
 * @param {number} delay - The debounce delay in milliseconds.
 * @returns {Function} - The debounced function.
 */
function debounceFunctionExecution(func, delay) {
    let timeoutIdentifier;
    return function (...argumentsList) {
        clearTimeout(timeoutIdentifier);
        timeoutIdentifier = setTimeout(() => func.apply(this, argumentsList), delay);
    };
}

/**
 * Observes changes to the URL in Single Page Applications.
 * @param {Function} callback - The function to execute when a URL change is detected.
 */
function resilientStartAndRetryOnSPANavigation(callback) {
    // Ensure only one observer is active across re-inits
    try {
        if (window.__OCP_urlChangeObserver) {
            window.__OCP_urlChangeObserver.disconnect();
            window.__OCP_urlChangeObserver = null;
        }
    } catch (e) { }

    let previousUrl = location.href;
    const urlChangeObserver = new MutationObserver(() => {
        const currentUrl = location.href;
        if (currentUrl !== previousUrl) {
            previousUrl = currentUrl;
            document.dispatchEvent(new CustomEvent('ocp-page-navigated'));
            callback();
        }
    });
    urlChangeObserver.observe(document, { subtree: true, childList: true });
    window.__OCP_urlChangeObserver = urlChangeObserver;
}

/**
 * Monkey-patches History API methods for immediate navigation detection.
 */
function patchHistoryMethods() {
    if (history.__patchedByOneClickPrompts) return;
    history.__patchedByOneClickPrompts = true;
    const methods = ['pushState', 'replaceState'];
    methods.forEach(method => {
        const original = history[method];
        history[method] = function (...args) {
            const result = original.apply(this, args);
            logConCgp(`[init] ${method} called. URL:`, args[2]);
            document.dispatchEvent(new CustomEvent('ocp-page-navigated'));
            publicStaticVoidMain(); // Re-run the full initialization logic
            return result;
        };
    });
}

// Automatically start the initialization process upon script load.
publicStaticVoidMain();
